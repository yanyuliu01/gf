/**
 * Single-writer StateManager.
 *
 * The StateManager is the only state writer in the system. Every proposal is
 * buffered, validated (JSON Schema -> source closure -> policy), then committed
 * inside one `BEGIN IMMEDIATE` transaction with:
 *
 * - operation idempotency (`operation_commits.operation_id` / `proposal_hash`)
 * - optimistic concurrency (`runtime_revision` CAS)
 * - atomic writes of event / claim / patch / debt / speech / outbox
 *
 * Model output is always a proposal: nothing is written before validation and
 * nothing is delivered before commit.
 */

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { newId, parseIso, utcnowIso } from "../domain/ids.js";
import type {
  BeliefProposalV1,
  MemoryIndexDocumentV1,
  ObservationV1,
} from "../generated/agentPipelineTypes.js";
import type {
  CognitiveEnergyAccountV1,
  CognitiveEnergyReservationV1,
  CognitiveEnergySettlementV1,
  ExperiencedUsageBreakdownV1,
  InferenceUsageReceiptV1,
} from "../generated/cognitiveRuntimeTypes.js";
import type {
  PromptRunFinished,
  PromptRunStarted,
} from "../inference/base.js";
import { Policy } from "../validation/policy.js";
import { SchemaRegistry, ValidationError } from "../validation/schemas.js";
import {
  computeInputClosureHash,
  normalizeSourceRefs,
} from "../validation/derivedInputClosure.js";
import {
  SourceClosure,
  type SourceRef,
  closureFromInputs,
} from "../validation/sourceClosure.js";
import {
  EMPTY_STATE_DOCUMENTS,
  applyOps,
  computeStateHash,
  type Documents,
  type PatchOp,
} from "./reducers.js";
import { StateStore } from "./repositories.js";

export class CommitRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommitRejected";
  }
}

export interface CommitResult {
  operationId: string;
  committed: boolean;
  baseRevision: number;
  committedRevision: number;
  replay: boolean;
  speechIds: string[];
  outboxIds: string[];
  claimIds: string[];
}

export interface IngestResult {
  eventId: string;
  inserted: boolean;
  replay: boolean;
  expiredImpulse: boolean;
}

export interface CognitiveArtifactCommitResult {
  committed: boolean;
  replay: boolean;
  baseRevision: number;
  observationIds: string[];
  beliefProposalIds: string[];
}

export interface MemoryIndexCommitResult {
  committed: boolean;
  replay: boolean;
  baseRevision: number;
  documentIds: string[];
}

export interface CognitiveLeaseCommitResult {
  committed: boolean;
  replay: boolean;
  account: CognitiveEnergyAccountV1;
}

export interface WorldEvent {
  schema_version: string;
  event_id: string;
  origin: "user" | "system" | "impulse" | "scheduled" | "genesis" | "admin";
  kind: string;
  channel?: string | null;
  occurred_at: string;
  received_at: string;
  world_day?: number | null;
  world_phase?: string | null;
  provenance: {
    principal_id: string;
    connector_id?: string | null;
    external_event_id?: string | null;
    trust: string;
  };
  privacy_scope: string;
  causation_event_id?: string | null;
  correlation_id?: string | null;
  idempotency_key: string;
  payload: Record<string, unknown>;
}

export interface SurfaceMessage {
  schema_version: string;
  speech_id: string;
  operation_id: string;
  channel: "private_im";
  recipient_principal_id: string;
  privacy_scope: "private_im";
  capability_revision: number;
  authorization_decision_id?: string;
  source_refs: SourceRef[];
  bubbles: string[];
  created_at?: string;
}

interface ReplyProposal {
  kind: "reply";
  speech: SurfaceMessage;
  claims: ClaimLike[];
  patch_ops: PatchOp[];
  debts_add: DebtLike[];
}

interface ClaimLike {
  claim_id: string;
  scope: string;
  kind: string;
  text: string;
  epistemic_status: string;
  lands_in_terra: boolean;
  privacy_scope: string;
  source_refs: SourceRef[];
  causal_action_ref?: SourceRef | null;
}

interface DebtLike {
  debt_id: string;
  promise_text: string;
  source_refs: SourceRef[];
  created_at: string;
  privacy_scope: string;
  status: string;
  attempts: number;
  due_at?: string | null;
  repaid_by_event_id?: string | null;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function proposalHash(proposal: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(proposal))
    .digest("hex");
}

export class StateManager {
  private readonly policy: Policy;

  constructor(
    private readonly connFactory: () => DatabaseSync,
    private readonly schemas: SchemaRegistry,
    policy?: Policy,
  ) {
    this.policy = policy ?? new Policy();
  }

  recordPromptRunStarted(run: PromptRunStarted): void {
    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare(
        `SELECT * FROM prompt_runs WHERE run_id = ?`,
      ).get(run.runId) as Record<string, unknown> | undefined;
      if (existing) {
        const matches =
          existing.prompt_name === run.promptName
          && existing.prompt_version === run.promptVersion
          && existing.prompt_manifest_hash === run.promptManifestHash
          && existing.input_hash === run.inputHash
          && existing.model_id === run.modelId
          && existing.started_at === run.startedAt;
        if (!matches) {
          throw new CommitRejected(
            `prompt run ${run.runId} already exists with different inputs`,
          );
        }
        db.exec("COMMIT");
        return;
      }
      db.prepare(
        `
        INSERT INTO prompt_runs(
          run_id, operation_id, prompt_name, prompt_version,
          prompt_manifest_hash, input_hash, output_hash, model_id,
          status, error_code, started_at, finished_at
        ) VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, 'started', NULL, ?, NULL)
        `,
      ).run(
        run.runId,
        run.promptName,
        run.promptVersion,
        run.promptManifestHash,
        run.inputHash,
        run.modelId,
        run.startedAt,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  recordPromptRunFinished(run: PromptRunFinished): void {
    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare(
        `SELECT status, output_hash, error_code, finished_at
         FROM prompt_runs WHERE run_id = ?`,
      ).get(run.runId) as {
        status: string;
        output_hash: string | null;
        error_code: string | null;
        finished_at: string | null;
      } | undefined;
      if (!existing) {
        throw new CommitRejected(`unknown prompt run ${run.runId}`);
      }
      const outputHash = run.outputHash ?? null;
      const errorCode = run.errorCode ?? null;
      if (existing.status !== "started") {
        const matches =
          existing.status === run.status
          && existing.output_hash === outputHash
          && existing.error_code === errorCode
          && existing.finished_at === run.finishedAt;
        if (!matches) {
          throw new CommitRejected(
            `prompt run ${run.runId} already has a different result`,
          );
        }
        db.exec("COMMIT");
        return;
      }
      db.prepare(
        `
        UPDATE prompt_runs
        SET status = ?, output_hash = ?, error_code = ?, finished_at = ?
        WHERE run_id = ? AND status = 'started'
        `,
      ).run(
        run.status,
        outputHash,
        errorCode,
        run.finishedAt,
        run.runId,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  /** Commit an immutable raw provider/local usage proposal. */
  recordInferenceUsageReceipt(receipt: InferenceUsageReceiptV1): void {
    this.schemas.validate("inference-usage-receipt.schema.json", receipt);
    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const promptRun = db.prepare(
        "SELECT run_id FROM prompt_runs WHERE run_id = ?",
      ).get(receipt.prompt_run_id);
      if (!promptRun) {
        throw new CommitRejected(
          `unknown prompt run ${receipt.prompt_run_id} for usage receipt`,
        );
      }
      const existing = db.prepare(
        `SELECT payload_json FROM inference_usage_receipts
         WHERE receipt_id = ? OR (prompt_run_id = ? AND attempt_ordinal = ?)`,
      ).get(
        receipt.receipt_id,
        receipt.prompt_run_id,
        receipt.attempt_ordinal,
      ) as { payload_json: string } | undefined;
      const payload = canonicalJson(receipt);
      if (existing) {
        if (existing.payload_json !== payload) {
          throw new CommitRejected(
            "usage receipt id or attempt already exists with different counters",
          );
        }
        db.exec("COMMIT");
        return;
      }
      db.prepare(
        `INSERT INTO inference_usage_receipts(
          receipt_id, schema_version, prompt_run_id, provider_request_id,
          model_id, tokenizer_version, input_tokens, cached_input_tokens,
          output_tokens, reasoning_tokens, attempt_ordinal,
          completion_status, usage_source, payload_json, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        receipt.receipt_id,
        receipt.schema_version,
        receipt.prompt_run_id,
        receipt.provider_request_id,
        receipt.model_id,
        receipt.tokenizer_version,
        receipt.input_tokens,
        receipt.cached_input_tokens ?? null,
        receipt.output_tokens,
        receipt.reasoning_tokens ?? null,
        receipt.attempt_ordinal,
        receipt.completion_status,
        receipt.usage_source,
        payload,
        receipt.received_at,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected || error instanceof ValidationError) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  /**
   * Commit a source-closed experienced-usage classification. This does not
   * reserve or settle cognitive energy; M20-018 owns that lifecycle.
   */
  recordExperiencedUsageBreakdown(
    breakdown: ExperiencedUsageBreakdownV1,
    options: {
      baseStateRevision: number;
      inputSources: readonly SourceRef[];
      classifiedAt?: string;
    },
  ): void {
    this.schemas.validate("experienced-usage-breakdown.schema.json", breakdown);
    let inputSources: SourceRef[];
    try {
      inputSources = normalizeSourceRefs(options.inputSources);
    } catch (error) {
      throw new CommitRejected(String(error));
    }
    const expectedClosureHash = computeInputClosureHash(
      options.baseStateRevision,
      inputSources,
    );
    if (breakdown.input_closure_hash !== expectedClosureHash) {
      throw new CommitRejected(
        "usage breakdown input_closure_hash does not match exact call inputs",
      );
    }
    const segmentIds = new Set<string>();
    for (const segment of breakdown.segments) {
      if (segmentIds.has(segment.segment_id)) {
        throw new CommitRejected(
          `duplicate usage segment ${segment.segment_id}`,
        );
      }
      segmentIds.add(segment.segment_id);
      const shouldBeExperienced = segment.purpose !== "runtime_overhead";
      if (segment.experienced !== shouldBeExperienced) {
        throw new CommitRejected(
          `usage segment ${segment.segment_id} has an invalid experienced flag`,
        );
      }
      if (segment.experienced && segment.source_refs.length === 0) {
        throw new CommitRejected(
          `experienced usage segment ${segment.segment_id} has no source refs`,
        );
      }
    }

    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const receipt = db.prepare(
        `SELECT prompt_run_id, input_tokens, output_tokens, completion_status
         FROM inference_usage_receipts WHERE receipt_id = ?`,
      ).get(breakdown.usage_receipt_id) as {
        prompt_run_id: string;
        input_tokens: number;
        output_tokens: number;
        completion_status: string;
      } | undefined;
      if (!receipt) {
        throw new CommitRejected(
          `unknown usage receipt ${breakdown.usage_receipt_id}`,
        );
      }
      if (receipt.prompt_run_id !== breakdown.prompt_run_id) {
        throw new CommitRejected(
          "usage breakdown and receipt reference different prompt runs",
        );
      }
      const classifiedTotal = breakdown.segments.reduce(
        (sum, segment) => sum + segment.token_count,
        0,
      );
      if (classifiedTotal !== receipt.input_tokens + receipt.output_tokens) {
        throw new CommitRejected(
          "usage segment total does not match raw input plus output counters",
        );
      }
      if (
        breakdown.attempt_class === "accepted_semantic"
        && receipt.completion_status !== "completed"
      ) {
        throw new CommitRejected(
          "accepted semantic breakdown requires a completed receipt",
        );
      }
      if (
        breakdown.attempt_class !== "accepted_semantic"
        && breakdown.segments.some((segment) => segment.experienced)
      ) {
        throw new CommitRejected(
          "retry and repair breakdowns cannot contain experienced usage",
        );
      }
      if (
        breakdown.attempt_class === "transport_retry"
        && receipt.completion_status === "completed"
      ) {
        throw new CommitRejected(
          "transport retry breakdown requires a failed or cancelled receipt",
        );
      }

      const closure = closureFromInputs(db, inputSources);
      for (const segment of breakdown.segments) {
        closure.checkRefs(segment.source_refs);
      }
      const existing = db.prepare(
        `SELECT payload_json FROM experienced_usage_breakdowns
         WHERE breakdown_id = ? OR usage_receipt_id = ?`,
      ).get(
        breakdown.breakdown_id,
        breakdown.usage_receipt_id,
      ) as { payload_json: string } | undefined;
      const payload = canonicalJson(breakdown);
      if (existing) {
        if (existing.payload_json !== payload) {
          throw new CommitRejected(
            "usage breakdown id or receipt already has a different classification",
          );
        }
        db.exec("COMMIT");
        return;
      }

      db.prepare(
        `INSERT INTO experienced_usage_breakdowns(
          breakdown_id, schema_version, usage_receipt_id, prompt_run_id,
          attempt_class, classification_version, input_closure_hash,
          payload_json, classified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        breakdown.breakdown_id,
        breakdown.schema_version,
        breakdown.usage_receipt_id,
        breakdown.prompt_run_id,
        breakdown.attempt_class,
        breakdown.classification_version,
        breakdown.input_closure_hash,
        payload,
        options.classifiedAt ?? utcnowIso(),
      );
      const insertSegment = db.prepare(
        `INSERT INTO experienced_usage_segments(
          breakdown_id, segment_id, purpose, token_count, experienced, ordinal
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const insertSource = db.prepare(
        `INSERT INTO experienced_usage_segment_sources(
          breakdown_id, segment_id, source_type, source_id, quote_hash, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      breakdown.segments.forEach((segment, ordinal) => {
        insertSegment.run(
          breakdown.breakdown_id,
          segment.segment_id,
          segment.purpose,
          segment.token_count,
          segment.experienced ? 1 : 0,
          ordinal,
        );
        for (const source of normalizeSourceRefs(segment.source_refs)) {
          insertSource.run(
            breakdown.breakdown_id,
            segment.segment_id,
            source.source_type,
            source.source_id,
            source.quote_hash ?? null,
            source.observed_at ?? null,
          );
        }
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected || error instanceof ValidationError) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  getCognitiveEnergyAccount(actorId: string): CognitiveEnergyAccountV1 | null {
    const db = this.connFactory();
    try {
      const row = db.prepare(
        "SELECT * FROM cognitive_energy_accounts WHERE actor_id = ?",
      ).get(actorId) as Record<string, unknown> | undefined;
      return row ? this.cognitiveAccountFromRow(row) : null;
    } finally {
      db.close();
    }
  }

  /** Atomically commit an energy lease and its prompt-run shell. */
  reserveCognitiveCall(
    reservation: CognitiveEnergyReservationV1,
    proposedAccount: CognitiveEnergyAccountV1,
    promptRun: PromptRunStarted,
  ): CognitiveLeaseCommitResult {
    this.schemas.validate("cognitive-energy-reservation.schema.json", reservation);
    this.schemas.validate("cognitive-energy-account.schema.json", proposedAccount);
    if (reservation.prompt_run_id !== promptRun.runId) {
      throw new CommitRejected("reservation and prompt shell use different run ids");
    }
    if (reservation.actor_id !== proposedAccount.actor_id) {
      throw new CommitRejected("reservation and account use different actors");
    }
    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare(
        `SELECT payload_json, status FROM cognitive_energy_reservations
         WHERE reservation_id = ? OR idempotency_key = ?`,
      ).get(
        reservation.reservation_id,
        reservation.idempotency_key,
      ) as { payload_json: string; status: string } | undefined;
      if (existing) {
        if (
          existing.payload_json !== canonicalJson(reservation)
          || existing.status !== "active"
        ) {
          throw new CommitRejected(
            "reservation id or idempotency key already has a different lifecycle",
          );
        }
        const accountRow = db.prepare(
          "SELECT * FROM cognitive_energy_accounts WHERE actor_id = ?",
        ).get(reservation.actor_id) as Record<string, unknown>;
        const account = this.cognitiveAccountFromRow(accountRow);
        if (canonicalJson(account) !== canonicalJson(proposedAccount)) {
          throw new CommitRejected("reservation replay account does not match");
        }
        db.exec("COMMIT");
        return { committed: false, replay: true, account };
      }

      const currentRow = db.prepare(
        "SELECT * FROM cognitive_energy_accounts WHERE actor_id = ?",
      ).get(reservation.actor_id) as Record<string, unknown> | undefined;
      if (!currentRow) {
        throw new CommitRejected(
          `unknown cognitive energy account ${reservation.actor_id}`,
        );
      }
      const current = this.cognitiveAccountFromRow(currentRow);
      const held = reservation.max_normalized_token_units;
      const approximately = (left: number, right: number) =>
        Math.abs(left - right) <= 1e-6;
      if (
        proposedAccount.revision !== current.revision + 1
        || !approximately(proposedAccount.available, current.available - held)
        || !approximately(proposedAccount.reserved, current.reserved + held)
        || proposedAccount.capacity !== current.capacity
        || !approximately(
          proposedAccount.protected_reply_reserve,
          Math.min(current.protected_reply_reserve, proposedAccount.available),
        )
        || proposedAccount.recovered_at !== current.recovered_at
        || proposedAccount.recovery_model_version !== current.recovery_model_version
      ) {
        throw new CommitRejected("invalid cognitive reservation account transition");
      }
      if (
        reservation.access_class === "autonomous"
        && held > current.available - current.protected_reply_reserve + 1e-6
      ) {
        throw new CommitRejected("autonomous reservation enters protected reply reserve");
      }
      const wake = db.prepare(
        `SELECT actor_id, wake, base_state_revision FROM wake_decision_audit
         WHERE decision_id = ?`,
      ).get(reservation.wake_decision_id) as {
        actor_id: string;
        wake: number;
        base_state_revision: number;
      } | undefined;
      if (
        !wake
        || wake.actor_id !== reservation.actor_id
        || wake.wake !== 1
        || wake.base_state_revision !== reservation.base_state_revision
      ) {
        throw new CommitRejected("reservation requires its matching wake decision");
      }
      const currentWorldRevision = new StateStore(db).currentRevision();
      if (currentWorldRevision !== reservation.base_state_revision) {
        throw new CommitRejected("reservation base world revision is stale");
      }
      const priorPrompt = db.prepare(
        "SELECT run_id FROM prompt_runs WHERE run_id = ?",
      ).get(promptRun.runId);
      if (priorPrompt) {
        throw new CommitRejected("prompt run shell already exists without reservation");
      }
      db.prepare(
        `INSERT INTO prompt_runs(
          run_id, operation_id, prompt_name, prompt_version,
          prompt_manifest_hash, input_hash, output_hash, model_id,
          status, error_code, started_at, finished_at
        ) VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, 'started', NULL, ?, NULL)`,
      ).run(
        promptRun.runId,
        promptRun.promptName,
        promptRun.promptVersion,
        promptRun.promptManifestHash,
        promptRun.inputHash,
        promptRun.modelId,
        promptRun.startedAt,
      );
      db.prepare(
        `INSERT INTO cognitive_energy_reservations(
          reservation_id, schema_version, actor_id, wake_decision_id,
          prompt_run_id, purpose, max_normalized_token_units, access_class,
          status, base_state_revision, accounting_version, expires_at,
          idempotency_key, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      ).run(
        reservation.reservation_id,
        reservation.schema_version,
        reservation.actor_id,
        reservation.wake_decision_id,
        reservation.prompt_run_id,
        reservation.purpose,
        reservation.max_normalized_token_units,
        reservation.access_class,
        reservation.base_state_revision,
        reservation.accounting_version,
        reservation.expires_at,
        reservation.idempotency_key,
        canonicalJson(reservation),
        promptRun.startedAt,
      );
      this.updateCognitiveAccount(db, current, proposedAccount);
      db.exec("COMMIT");
      return { committed: true, replay: false, account: proposedAccount };
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected || error instanceof ValidationError) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  /** Atomically settle a classified accepted call and release unused lease. */
  settleCognitiveCall(
    settlement: CognitiveEnergySettlementV1,
    proposedAccount: CognitiveEnergyAccountV1,
  ): CognitiveLeaseCommitResult {
    this.schemas.validate("cognitive-energy-settlement.schema.json", settlement);
    this.schemas.validate("cognitive-energy-account.schema.json", proposedAccount);
    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare(
        "SELECT payload_json FROM cognitive_energy_settlements WHERE settlement_id = ? OR reservation_id = ?",
      ).get(
        settlement.settlement_id,
        settlement.reservation_id,
      ) as { payload_json: string } | undefined;
      if (existing) {
        if (existing.payload_json !== canonicalJson(settlement)) {
          throw new CommitRejected("reservation already has a different settlement");
        }
        const row = db.prepare(
          "SELECT * FROM cognitive_energy_accounts WHERE actor_id = ?",
        ).get(proposedAccount.actor_id) as Record<string, unknown>;
        const account = this.cognitiveAccountFromRow(row);
        if (canonicalJson(account) !== canonicalJson(proposedAccount)) {
          throw new CommitRejected("settlement replay account does not match");
        }
        db.exec("COMMIT");
        return { committed: false, replay: true, account };
      }
      const reservation = db.prepare(
        "SELECT * FROM cognitive_energy_reservations WHERE reservation_id = ?",
      ).get(settlement.reservation_id) as Record<string, unknown> | undefined;
      if (!reservation || reservation.status !== "active") {
        throw new CommitRejected("settlement requires an active reservation");
      }
      if (
        reservation.accounting_version !== settlement.accounting_version
        || Math.abs(
          Number(reservation.max_normalized_token_units)
          - settlement.energy_spent
          - settlement.released_reservation
        ) > 1e-6
      ) {
        throw new CommitRejected("settlement does not conserve its reservation");
      }
      const receipt = db.prepare(
        "SELECT prompt_run_id FROM inference_usage_receipts WHERE receipt_id = ?",
      ).get(settlement.usage_receipt_id) as { prompt_run_id: string } | undefined;
      const breakdown = db.prepare(
        `SELECT prompt_run_id, usage_receipt_id, payload_json
         FROM experienced_usage_breakdowns
         WHERE breakdown_id = ?`,
      ).get(settlement.experienced_breakdown_id) as {
        prompt_run_id: string;
        usage_receipt_id: string;
        payload_json: string;
      } | undefined;
      if (
        !receipt
        || !breakdown
        || receipt.prompt_run_id !== reservation.prompt_run_id
        || breakdown.prompt_run_id !== reservation.prompt_run_id
        || breakdown.usage_receipt_id !== settlement.usage_receipt_id
      ) {
        throw new CommitRejected("settlement receipt chain is inconsistent");
      }
      const currentRow = db.prepare(
        "SELECT * FROM cognitive_energy_accounts WHERE actor_id = ?",
      ).get(String(reservation.actor_id)) as Record<string, unknown>;
      const current = this.cognitiveAccountFromRow(currentRow);
      if (proposedAccount.actor_id !== current.actor_id) {
        throw new CommitRejected("settlement account actor mismatch");
      }
      const expectedAvailable = current.available + settlement.released_reservation;
      const expectedReserved = current.reserved
        - settlement.energy_spent
        - settlement.released_reservation;
      if (
        proposedAccount.revision !== current.revision + 1
        || Math.abs(proposedAccount.available - expectedAvailable) > 1e-6
        || Math.abs(proposedAccount.reserved - expectedReserved) > 1e-6
        || proposedAccount.capacity !== current.capacity
        || Math.abs(
          proposedAccount.protected_reply_reserve
          - Math.min(current.protected_reply_reserve, expectedAvailable)
        ) > 1e-6
        || proposedAccount.recovered_at !== current.recovered_at
        || proposedAccount.recovery_model_version
          !== current.recovery_model_version
      ) {
        throw new CommitRejected("invalid cognitive settlement account transition");
      }
      const storedBreakdown = JSON.parse(
        breakdown.payload_json,
      ) as ExperiencedUsageBreakdownV1;
      const expectedSources = normalizeSourceRefs(
        storedBreakdown.segments
          .filter((segment) => segment.experienced)
          .flatMap((segment) => segment.source_refs),
      );
      if (
        canonicalJson(normalizeSourceRefs(settlement.source_refs))
        !== canonicalJson(expectedSources)
      ) {
        throw new CommitRejected(
          "settlement sources do not match experienced breakdown sources",
        );
      }
      const closure = closureFromInputs(db, expectedSources);
      closure.checkRefs(expectedSources);
      db.prepare(
        `INSERT INTO cognitive_energy_settlements(
          settlement_id, schema_version, reservation_id, usage_receipt_id,
          experienced_breakdown_id, normalized_token_units, energy_spent,
          released_reservation, accounting_version, payload_json, settled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        settlement.settlement_id,
        settlement.schema_version,
        settlement.reservation_id,
        settlement.usage_receipt_id,
        settlement.experienced_breakdown_id,
        settlement.normalized_token_units,
        settlement.energy_spent,
        settlement.released_reservation,
        settlement.accounting_version,
        canonicalJson(settlement),
        settlement.settled_at,
      );
      const insertSource = db.prepare(
        `INSERT INTO cognitive_energy_settlement_sources(
          settlement_id, source_type, source_id, quote_hash, observed_at
        ) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const source of normalizeSourceRefs(settlement.source_refs)) {
        insertSource.run(
          settlement.settlement_id,
          source.source_type,
          source.source_id,
          source.quote_hash ?? null,
          source.observed_at ?? null,
        );
      }
      this.updateCognitiveAccount(db, current, proposedAccount);
      db.prepare(
        "UPDATE cognitive_energy_reservations SET status = 'settled' WHERE reservation_id = ? AND status = 'active'",
      ).run(settlement.reservation_id);
      db.exec("COMMIT");
      return { committed: true, replay: false, account: proposedAccount };
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected || error instanceof ValidationError) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  releaseCognitiveReservation(reservationId: string): boolean {
    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const reservation = db.prepare(
        "SELECT * FROM cognitive_energy_reservations WHERE reservation_id = ?",
      ).get(reservationId) as Record<string, unknown> | undefined;
      if (!reservation) {
        throw new CommitRejected(`unknown reservation ${reservationId}`);
      }
      if (reservation.status !== "active") {
        db.exec("COMMIT");
        return false;
      }
      const currentRow = db.prepare(
        "SELECT * FROM cognitive_energy_accounts WHERE actor_id = ?",
      ).get(String(reservation.actor_id)) as Record<string, unknown>;
      const current = this.cognitiveAccountFromRow(currentRow);
      const held = Number(reservation.max_normalized_token_units);
      const released: CognitiveEnergyAccountV1 = {
        ...current,
        available: Math.round((current.available + held) * 1e6) / 1e6,
        reserved: Math.round((current.reserved - held) * 1e6) / 1e6,
        protected_reply_reserve: Math.min(
          current.protected_reply_reserve,
          current.available + held,
        ),
        revision: current.revision + 1,
      };
      this.schemas.validate("cognitive-energy-account.schema.json", released);
      this.updateCognitiveAccount(db, current, released);
      db.prepare(
        "UPDATE cognitive_energy_reservations SET status = 'released' WHERE reservation_id = ? AND status = 'active'",
      ).run(reservationId);
      db.exec("COMMIT");
      return true;
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected || error instanceof ValidationError) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  // ------------------------------------------------------------------ ingest
  ingestEvent(event: WorldEvent, ttlSeconds = 7200): IngestResult {
    this.schemas.validate("world-event.schema.json", event);
    if (event.kind === "im.message.received") {
      this.schemas.validate("message-payload.schema.json", event.payload);
    }

    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const existing = db
        .prepare("SELECT event_id FROM world_events WHERE idempotency_key = ?")
        .get(event.idempotency_key) as { event_id: string } | undefined;
      if (existing) {
        db.exec("ROLLBACK");
        return {
          eventId: existing.event_id,
          inserted: false,
          replay: true,
          expiredImpulse: false,
        };
      }

      if (event.origin === "impulse" && ttlSeconds > 0 && event.occurred_at) {
        const age =
          parseIso(utcnowIso()).getTime() - parseIso(event.occurred_at).getTime();
        if (age > ttlSeconds * 1000) {
          db.exec("ROLLBACK");
          return {
            eventId: event.event_id,
            inserted: false,
            replay: false,
            expiredImpulse: true,
          };
        }
      }

      this.insertEventRows(db, event);
      db.exec("COMMIT");
      return {
        eventId: event.event_id,
        inserted: true,
        replay: false,
        expiredImpulse: false,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
  }

  private insertEventRows(db: DatabaseSync, event: WorldEvent): void {
    const prov = event.provenance;
    db.prepare(
      `
      INSERT INTO world_events(
        event_id, schema_version, origin, kind, channel, occurred_at,
        received_at, world_day, world_phase, principal_id, connector_id,
        external_event_id, trust, privacy_scope, causation_event_id,
        correlation_id, idempotency_key, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      event.event_id,
      event.schema_version,
      event.origin,
      event.kind,
      event.channel ?? null,
      event.occurred_at,
      event.received_at,
      event.world_day ?? null,
      event.world_phase ?? null,
      prov.principal_id,
      prov.connector_id ?? null,
      prov.external_event_id ?? null,
      prov.trust,
      event.privacy_scope,
      event.causation_event_id ?? null,
      event.correlation_id ?? null,
      event.idempotency_key,
      canonicalJson(event.payload),
    );

    if (event.kind === "im.message.received") {
      const payload = event.payload as {
        message_id: string;
        sender_principal_id: string;
        content: unknown;
      };
      db.prepare(
        `
        INSERT INTO messages(
          message_id, event_id, direction, channel, sender_principal_id,
          privacy_scope, content_json, created_at
        ) VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?)
        `,
      ).run(
        payload.message_id,
        event.event_id,
        event.channel ?? "private_im",
        payload.sender_principal_id,
        event.privacy_scope,
        canonicalJson(payload.content),
        event.received_at,
      );
    }
  }

  // ---------------------------------------------------------------- submit
  submitOperation(
    kind: "tick" | "scene_settlement",
    proposal: Record<string, unknown>,
    options: {
      triggerEvent?: WorldEvent | null;
      sceneId?: string | null;
      batchId?: string | null;
      inputSources?: Iterable<SourceRef>;
    } = {},
  ): CommitResult {
    if (kind === "tick") {
      this.schemas.validate("tick-proposal.schema.json", proposal);
    } else if (kind === "scene_settlement") {
      this.schemas.validate("scene-settlement.schema.json", proposal);
    } else {
      throw new Error(`unsupported operation kind ${kind}`);
    }

    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const result = this.commitOperation(db, {
        kind,
        proposal,
        triggerEvent: options.triggerEvent ?? null,
        sceneId: options.sceneId ?? null,
        batchId: options.batchId ?? null,
        inputSources: options.inputSources ?? [],
      });
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected || error instanceof ValidationError) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  submitReply(
    speech: SurfaceMessage,
    options: {
      claims?: ClaimLike[];
      patches?: PatchOp[];
      debtsAdd?: DebtLike[];
      triggerEvent: WorldEvent;
      scene: { scene_id: string };
      inputSources?: Iterable<SourceRef>;
    },
  ): CommitResult {
    this.schemas.validate("surface-message.schema.json", speech);
    const claims = options.claims ?? [];
    const patches = options.patches ?? [];
    const debtsAdd = options.debtsAdd ?? [];
    for (const claim of claims) {
      this.schemas.validate("claim.schema.json", claim);
    }
    for (const patch of patches) {
      this.schemas.validate("patch-op.schema.json", patch);
    }
    for (const debt of debtsAdd) {
      this.schemas.validate("debt.schema.json", debt);
    }

    const proposal: ReplyProposal = {
      kind: "reply",
      speech,
      claims,
      patch_ops: patches,
      debts_add: debtsAdd,
    };

    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const result = this.commitReply(db, {
        speech,
        claims,
        patches,
        debtsAdd,
        proposal,
        triggerEvent: options.triggerEvent,
        scene: options.scene,
        inputSources: options.inputSources ?? [],
      });
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected || error instanceof ValidationError) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  /**
   * Persist subject-side cognition without creating WorldEvents or changing
   * authoritative reducer state. The exact call-input roots are stored beside
   * every artifact for replay and source-closure audit.
   */
  submitCognitiveArtifacts(
    artifacts: {
      observations?: readonly ObservationV1[];
      beliefProposals?: readonly BeliefProposalV1[];
    },
    options: { inputSources: readonly SourceRef[] },
  ): CognitiveArtifactCommitResult {
    const observations = [...(artifacts.observations ?? [])];
    const beliefProposals = [...(artifacts.beliefProposals ?? [])];
    if (observations.length + beliefProposals.length === 0) {
      throw new CommitRejected("cognitive artifact batch is empty");
    }

    for (const observation of observations) {
      this.schemas.validate("observation.schema.json", observation);
    }
    for (const belief of beliefProposals) {
      this.schemas.validate("belief-proposal.schema.json", belief);
      if (belief.status !== "proposed") {
        throw new CommitRejected(
          `new belief ${belief.proposal_id} must enter as proposed`,
        );
      }
    }

    let inputSources: SourceRef[];
    try {
      inputSources = normalizeSourceRefs(options.inputSources);
    } catch (error) {
      throw new CommitRejected(String(error));
    }
    if (inputSources.length === 0) {
      throw new CommitRejected("cognitive artifacts require input sources");
    }
    const revisions = new Set([
      ...observations.map((item) => item.base_state_revision),
      ...beliefProposals.map((item) => item.base_state_revision),
    ]);
    if (revisions.size !== 1) {
      throw new CommitRejected("cognitive artifact batch mixes state revisions");
    }
    const baseRevision = [...revisions][0];
    const expectedClosureHash = computeInputClosureHash(
      baseRevision,
      inputSources,
    );
    for (const artifact of [...observations, ...beliefProposals]) {
      if (artifact.input_closure_hash !== expectedClosureHash) {
        throw new CommitRejected(
          `artifact input_closure_hash does not match exact call inputs`,
        );
      }
    }

    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const currentRevision = new StateStore(db).currentRevision();
      if (baseRevision !== currentRevision) {
        throw new CommitRejected(
          `stale base_state_revision ${baseRevision} != current ${currentRevision}`,
        );
      }

      const closure = closureFromInputs(db, inputSources);
      for (const observation of observations) {
        closure.checkRefs(observation.source_refs);
      }
      for (const belief of beliefProposals) {
        closure.checkRefs(belief.source_refs);
      }

      const existing = [
        ...observations.map((item) => this.cognitiveArtifactRecord(
          db,
          "observation",
          item.observation_id,
        )),
        ...beliefProposals.map((item) => this.cognitiveArtifactRecord(
          db,
          "belief_proposal",
          item.proposal_id,
        )),
      ];
      if (existing.some((payload) => payload !== undefined)) {
        const requestedPayloads = [
          ...observations.map((item) => canonicalJson(item)),
          ...beliefProposals.map((item) => canonicalJson(item)),
        ];
        if (
          existing.some((record) => record === undefined)
          || existing.some((record, index) =>
            record?.payloadJson !== requestedPayloads[index]
            || record.closureHash !== expectedClosureHash
            || record.baseRevision !== baseRevision
          )
        ) {
          throw new CommitRejected(
            "cognitive artifact id already exists with a different batch",
          );
        }
        db.exec("COMMIT");
        return {
          committed: false,
          replay: true,
          baseRevision,
          observationIds: observations.map((item) => item.observation_id),
          beliefProposalIds: beliefProposals.map((item) => item.proposal_id),
        };
      }

      for (const observation of observations) {
        this.insertObservation(db, observation);
        this.insertDerivedInputClosure(db, {
          artifactKind: "observation",
          artifactId: observation.observation_id,
          closureHash: expectedClosureHash,
          baseRevision,
          createdAt: observation.observed_at,
          inputSources,
        });
      }
      for (const belief of beliefProposals) {
        this.insertBeliefProposal(db, belief);
        this.insertDerivedInputClosure(db, {
          artifactKind: "belief_proposal",
          artifactId: belief.proposal_id,
          closureHash: expectedClosureHash,
          baseRevision,
          createdAt: belief.proposed_at,
          inputSources,
        });
      }
      db.exec("COMMIT");
      return {
        committed: true,
        replay: false,
        baseRevision,
        observationIds: observations.map((item) => item.observation_id),
        beliefProposalIds: beliefProposals.map((item) => item.proposal_id),
      };
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected || error instanceof ValidationError) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  /** Write a rebuildable structured/FTS memory index through the single writer. */
  submitMemoryIndexDocuments(
    documents: readonly MemoryIndexDocumentV1[],
    options: { inputSources: readonly SourceRef[] },
  ): MemoryIndexCommitResult {
    if (documents.length === 0) {
      throw new CommitRejected("memory index batch is empty");
    }
    for (const document of documents) {
      this.schemas.validate("memory-index-document.schema.json", document);
    }

    let inputSources: SourceRef[];
    try {
      inputSources = normalizeSourceRefs(options.inputSources);
    } catch (error) {
      throw new CommitRejected(String(error));
    }
    if (inputSources.length === 0) {
      throw new CommitRejected("memory index documents require input sources");
    }
    const revisions = new Set(documents.map((item) => item.base_state_revision));
    if (revisions.size !== 1) {
      throw new CommitRejected("memory index batch mixes state revisions");
    }
    const baseRevision = [...revisions][0];
    const expectedClosureHash = computeInputClosureHash(baseRevision, inputSources);
    if (documents.some((item) => item.input_closure_hash !== expectedClosureHash)) {
      throw new CommitRejected(
        "memory index input_closure_hash does not match exact call inputs",
      );
    }

    const db = this.connFactory();
    try {
      db.exec("BEGIN IMMEDIATE");
      const currentRevision = new StateStore(db).currentRevision();
      if (baseRevision !== currentRevision) {
        throw new CommitRejected(
          `stale base_state_revision ${baseRevision} != current ${currentRevision}`,
        );
      }
      const closure = closureFromInputs(db, inputSources);
      for (const document of documents) {
        closure.checkRefs(document.source_refs);
        this.validateMemoryIndexSource(db, document);
      }

      const existing = documents.map((document) =>
        db.prepare(
          "SELECT payload_json FROM memory_index_documents WHERE document_id = ?",
        ).get(document.document_id) as { payload_json: string } | undefined,
      );
      if (existing.some((row) => row !== undefined)) {
        if (
          existing.some((row) => row === undefined)
          || existing.some((row, index) =>
            row?.payload_json !== canonicalJson(documents[index])
          )
        ) {
          throw new CommitRejected(
            "memory index document id already exists with a different batch",
          );
        }
        db.exec("COMMIT");
        return {
          committed: false,
          replay: true,
          baseRevision,
          documentIds: documents.map((item) => item.document_id),
        };
      }

      for (const document of documents) {
        this.insertMemoryIndexDocument(db, document, inputSources);
      }
      db.exec("COMMIT");
      return {
        committed: true,
        replay: false,
        baseRevision,
        documentIds: documents.map((item) => item.document_id),
      };
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof CommitRejected || error instanceof ValidationError) {
        throw error;
      }
      throw new CommitRejected(String(error));
    } finally {
      db.close();
    }
  }

  // ------------------------------------------------------------- internals
  private commitOperation(
    db: DatabaseSync,
    options: {
      kind: "tick" | "scene_settlement";
      proposal: Record<string, unknown>;
      triggerEvent: WorldEvent | null;
      sceneId: string | null;
      batchId: string | null;
      inputSources: Iterable<SourceRef>;
    },
  ): CommitResult {
    const { kind, proposal, triggerEvent, sceneId, batchId } = options;
    const operationId = proposal.operation_id as string;
    const existing = db
      .prepare("SELECT operation_id FROM operation_commits WHERE operation_id = ?")
      .get(operationId);
    if (existing) {
      return emptyResult(operationId, true);
    }

    const store = new StateStore(db);
    const baseRevision = store.currentRevision();
    if (proposal.base_state_revision !== baseRevision) {
      throw new CommitRejected(
        `stale base_state_revision ${proposal.base_state_revision} != current ${baseRevision}`,
      );
    }

    const closure = closureFromInputs(db, [
      ...(triggerEvent
        ? [{ source_type: "event" as const, source_id: triggerEvent.event_id }]
        : []),
      ...options.inputSources,
    ]);
    const claims = (proposal.claims as ClaimLike[] | undefined) ?? [];
    const patches = (proposal.patch_ops as PatchOp[] | undefined) ?? [];
    this.validateClaims(db, claims, closure);
    this.validatePatches(db, patches, baseRevision, closure);
    if (kind === "scene_settlement") {
      this.validateDebts((proposal.debts_add as DebtLike[] | undefined) ?? [], closure);
    }

    const documents = this.loadDocuments(db);
    const newDocuments = applyOps(documents, patches);
    const stateHash = computeStateHash(newDocuments);
    const committedRevision = baseRevision + 1;
    const hash = proposalHash(proposal);
    const dup = db
      .prepare("SELECT operation_id FROM operation_commits WHERE proposal_hash = ?")
      .get(hash);
    if (dup) {
      throw new CommitRejected(
        `duplicate proposal hash; already committed as ${(dup as { operation_id: string }).operation_id}`,
      );
    }

    db.prepare(
      `
      INSERT INTO operation_commits(
        operation_id, operation_kind, trigger_event_id, scene_id,
        batch_id, base_state_revision, committed_state_revision,
        proposal_json, proposal_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      operationId,
      kind,
      triggerEvent?.event_id ?? null,
      sceneId,
      batchId,
      baseRevision,
      committedRevision,
      canonicalJson(proposal),
      hash,
    );

    const claimIds = this.insertClaims(db, operationId, claims);
    this.insertPatches(db, operationId, patches);
    if (kind === "scene_settlement") {
      this.insertSettlementRows(db, {
        operationId,
        proposal,
        sceneId,
      });
      this.insertDebts(
        db,
        operationId,
        (proposal.debts_add as DebtLike[] | undefined) ?? [],
      );
    }

    this.writeState(db, operationId, newDocuments, committedRevision);
    const cursor = db
      .prepare(
        "UPDATE runtime_revision SET current_revision = ? WHERE singleton_id = 1 AND current_revision = ?",
      )
      .run(committedRevision, baseRevision);
    if (cursor.changes !== 1) {
      throw new CommitRejected("revision CAS failed");
    }
    return {
      operationId,
      committed: true,
      baseRevision,
      committedRevision,
      replay: false,
      speechIds: [],
      outboxIds: [],
      claimIds,
    };
  }

  private commitReply(
    db: DatabaseSync,
    options: {
      speech: SurfaceMessage;
      claims: ClaimLike[];
      patches: PatchOp[];
      debtsAdd: DebtLike[];
      proposal: ReplyProposal;
      triggerEvent: WorldEvent;
      scene: { scene_id: string };
      inputSources: Iterable<SourceRef>;
    },
  ): CommitResult {
    const { speech, claims, patches, debtsAdd, proposal, triggerEvent, scene } =
      options;
    const operationId = speech.operation_id;
    const existing = db
      .prepare("SELECT operation_id FROM operation_commits WHERE operation_id = ?")
      .get(operationId);
    if (existing) {
      return emptyResult(operationId, true);
    }

    const store = new StateStore(db);
    const baseRevision = store.currentRevision();
    const closure = closureFromInputs(db, [
      { source_type: "event", source_id: triggerEvent.event_id },
      ...options.inputSources,
    ]);
    closure.checkRefs(speech.source_refs);
    this.validateClaims(db, claims, closure);
    this.validatePatches(db, patches, baseRevision, closure);
    this.validateDebts(debtsAdd, closure);

    const documents = this.loadDocuments(db);
    const newDocuments = applyOps(documents, patches);
    const committedRevision = baseRevision + 1;
    const hash = proposalHash(proposal);
    const dup = db
      .prepare("SELECT operation_id FROM operation_commits WHERE proposal_hash = ?")
      .get(hash);
    if (dup) {
      throw new CommitRejected(
        `duplicate proposal hash; already committed as ${(dup as { operation_id: string }).operation_id}`,
      );
    }

    const capability = store.latestCapabilitySnapshot();
    if (speech.capability_revision !== capability.revision) {
      throw new CommitRejected(
        `speech capability_revision ${speech.capability_revision} != current ${capability.revision}`,
      );
    }
    const authzId = speech.authorization_decision_id ?? newId("authz");
    const authorizationJson = {
      channel: speech.channel,
      recipient_principal_id: speech.recipient_principal_id,
      privacy_scope: speech.privacy_scope,
      capability_revision: speech.capability_revision,
      decision: "allowed",
      reason: "authenticated private_im text reply",
    };

    db.prepare(
      `
      INSERT INTO operation_commits(
        operation_id, operation_kind, trigger_event_id, scene_id,
        batch_id, base_state_revision, committed_state_revision,
        proposal_json, proposal_hash
      ) VALUES (?, 'admin', ?, NULL, NULL, ?, ?, ?, ?)
      `,
    ).run(
      operationId,
      triggerEvent.event_id,
      baseRevision,
      committedRevision,
      canonicalJson(proposal),
      hash,
    );

    const eventId = newId("evt");
    const messageId = newId("msg");
    const createdAt = speech.created_at ?? utcnowIso();
    db.prepare(
      `
      INSERT INTO world_events(
        event_id, schema_version, origin, kind, channel, occurred_at,
        received_at, world_day, world_phase, principal_id, connector_id,
        external_event_id, trust, privacy_scope, causation_event_id,
        correlation_id, idempotency_key, payload_json
      ) VALUES (?, '1.0', 'system', 'speech.outbound', 'private_im', ?, ?,
                NULL, NULL, ?, 'core:surface', NULL, 'generated',
                'private_im', ?, ?, ?, ?)
      `,
    ).run(
      eventId,
      createdAt,
      createdAt,
      speech.recipient_principal_id,
      triggerEvent.event_id,
      triggerEvent.correlation_id ?? null,
      operationId,
      canonicalJson({ speech_id: speech.speech_id, bubbles: speech.bubbles }),
    );
    db.prepare(
      `
      INSERT INTO messages(
        message_id, event_id, direction, channel, sender_principal_id,
        privacy_scope, content_json, created_at
      ) VALUES (?, ?, 'outbound', 'private_im', ?, 'private_im', ?, ?)
      `,
    ).run(
      messageId,
      eventId,
      speech.recipient_principal_id,
      canonicalJson({ bubbles: speech.bubbles }),
      createdAt,
    );

    const sceneId = scene.scene_id;
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM scene_messages WHERE scene_id = ?")
      .get(sceneId) as { n: number };
    db.prepare(
      "INSERT INTO scene_messages(scene_id, message_id, ordinal) VALUES (?, ?, ?)",
    ).run(sceneId, messageId, Number(row.n));

    db.prepare(
      `
      INSERT INTO speech_records(
        speech_id, operation_id, trigger_event_id, scene_id, channel,
        recipient_principal_id, privacy_scope, capability_revision,
        authorization_decision_id, content, status, created_at
      ) VALUES (?, ?, ?, ?, 'private_im', ?, 'private_im', ?, ?, ?, 'staged', ?)
      `,
    ).run(
      speech.speech_id,
      operationId,
      triggerEvent.event_id,
      sceneId,
      speech.recipient_principal_id,
      speech.capability_revision,
      authzId,
      canonicalJson({ bubbles: speech.bubbles }),
      createdAt,
    );
    const insertSpeechSource = db.prepare(
      `
      INSERT INTO speech_sources(speech_id, source_type, source_id, ordinal)
      VALUES (?, ?, ?, ?)
      `,
    );
    speech.source_refs.forEach((ref, idx) => {
      insertSpeechSource.run(speech.speech_id, ref.source_type, ref.source_id, idx);
    });

    const outboxId = newId("obx");
    db.prepare(
      `
      INSERT INTO outbox(
        outbox_id, operation_id, speech_id, channel, recipient_principal_id,
        privacy_scope, capability_revision, authorization_decision_id,
        authorization_json, payload_json, idempotency_key, status,
        attempts, next_attempt_at, created_at
      ) VALUES (?, ?, ?, 'private_im', ?, 'private_im', ?, ?, ?, ?, ?, 'pending',
                0, NULL, ?)
      `,
    ).run(
      outboxId,
      operationId,
      speech.speech_id,
      speech.recipient_principal_id,
      speech.capability_revision,
      authzId,
      canonicalJson(authorizationJson),
      canonicalJson({ bubbles: speech.bubbles }),
      operationId,
      createdAt,
    );

    const claimIds = this.insertClaims(db, operationId, claims);
    this.insertPatches(db, operationId, patches);
    this.insertDebts(db, operationId, debtsAdd);
    this.writeState(db, operationId, newDocuments, committedRevision);
    const cursor = db
      .prepare(
        "UPDATE runtime_revision SET current_revision = ? WHERE singleton_id = 1 AND current_revision = ?",
      )
      .run(committedRevision, baseRevision);
    if (cursor.changes !== 1) {
      throw new CommitRejected("revision CAS failed");
    }
    return {
      operationId,
      committed: true,
      baseRevision,
      committedRevision,
      replay: false,
      speechIds: [speech.speech_id],
      outboxIds: [outboxId],
      claimIds,
    };
  }

  // ----------------------------------------------------------- validators
  private validateClaims(
    db: DatabaseSync,
    claims: ClaimLike[],
    closure: SourceClosure,
  ): void {
    for (const claim of claims) {
      this.schemas.validate("claim.schema.json", claim);
      this.policy.checkClaim(claim as Parameters<Policy["checkClaim"]>[0]);
      closure.checkRefs(claim.source_refs);
      if (claim.causal_action_ref) {
        closure.checkRef(claim.causal_action_ref);
      }
      const hasUserReport = claim.source_refs.some(
        (ref) => ref.source_type === "message",
      );
      const hasVerifiedSystem = claim.source_refs.some(
        (ref) => ref.source_type === "event",
      );
      this.policy.checkCrossworld(claim as Parameters<Policy["checkCrossworld"]>[0], {
        hasExplicitUserReport: hasUserReport,
        hasVerifiedSystemEvidence: hasVerifiedSystem,
      });
    }
  }

  private validatePatches(
    db: DatabaseSync,
    patches: PatchOp[],
    baseRevision: number,
    closure: SourceClosure,
  ): void {
    for (const op of patches) {
      this.schemas.validate("patch-op.schema.json", op);
      this.policy.checkPatchShape(op);
      this.policy.checkPatchPath(op);
      this.policy.checkExpectedRevision(op, baseRevision);
      closure.checkRefs(op.source_refs as SourceRef[]);
      closure.checkEventIds(op.cause_event_ids);
    }
  }

  private validateDebts(debts: DebtLike[], closure: SourceClosure): void {
    for (const debt of debts) {
      this.schemas.validate("debt.schema.json", debt);
      closure.checkRefs(debt.source_refs);
    }
  }

  // ----------------------------------------------------------- row writers
  private loadDocuments(db: DatabaseSync): Documents {
    const rows = db
      .prepare("SELECT document_key, value_json FROM state_documents")
      .all() as { document_key: string; value_json: string }[];
    if (rows.length === 0) {
      return structuredClone(EMPTY_STATE_DOCUMENTS);
    }
    return Object.fromEntries(
      rows.map((row) => [row.document_key, JSON.parse(row.value_json)]),
    );
  }

  private writeState(
    db: DatabaseSync,
    operationId: string,
    documents: Documents,
    revision: number,
  ): void {
    const stateHash = computeStateHash(documents);
    const now = utcnowIso();
    for (const [key, doc] of Object.entries(documents)) {
      (doc as Record<string, unknown>).revision = revision;
      const exists = db
        .prepare("SELECT 1 FROM state_documents WHERE document_key = ?")
        .get(key);
      if (exists) {
        db.prepare(
          `
          UPDATE state_documents SET revision = ?, value_json = ?,
          updated_by_operation_id = ?, updated_at = ?
          WHERE document_key = ?
          `,
        ).run(revision, canonicalJson(doc), operationId, now, key);
      } else {
        db.prepare(
          `
          INSERT INTO state_documents(
            document_key, revision, value_json,
            updated_by_operation_id, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          `,
        ).run(key, revision, canonicalJson(doc), operationId, now);
      }
    }
    db.prepare(
      "INSERT INTO state_revisions(revision, operation_id, state_hash) VALUES (?, ?, ?)",
    ).run(revision, operationId, stateHash);
  }

  private insertClaims(
    db: DatabaseSync,
    operationId: string,
    claims: ClaimLike[],
  ): string[] {
    const claimIds: string[] = [];
    for (const claim of claims) {
      const causal = claim.causal_action_ref ?? null;
      db.prepare(
        `
        INSERT INTO claims(
          claim_id, operation_id, scope, kind, claim_text,
          epistemic_status, lands_in_terra, privacy_scope,
          causal_action_source_type, causal_action_source_id,
          causal_action_quote_hash, causal_action_observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        claim.claim_id,
        operationId,
        claim.scope,
        claim.kind,
        claim.text,
        claim.epistemic_status,
        claim.lands_in_terra ? 1 : 0,
        claim.privacy_scope,
        causal?.source_type ?? null,
        causal?.source_id ?? null,
        causal?.quote_hash ?? null,
        causal?.observed_at ?? null,
      );
      for (const ref of claim.source_refs) {
        db.prepare(
          `
          INSERT INTO claim_sources(claim_id, source_type, source_id,
                                    quote_hash, observed_at)
          VALUES (?, ?, ?, ?, ?)
          `,
        ).run(
          claim.claim_id,
          ref.source_type,
          ref.source_id,
          ref.quote_hash ?? null,
          ref.observed_at ?? null,
        );
      }
      claimIds.push(claim.claim_id);
    }
    return claimIds;
  }

  private cognitiveArtifactRecord(
    db: DatabaseSync,
    kind: "observation" | "belief_proposal",
    artifactId: string,
  ): {
    payloadJson: string;
    closureHash: string | null;
    baseRevision: number | null;
  } | undefined {
    const table = kind === "observation" ? "observations" : "belief_proposals";
    const idColumn = kind === "observation" ? "observation_id" : "proposal_id";
    const row = db
      .prepare(
        `
        SELECT artifact.payload_json, closure.closure_hash,
               closure.base_state_revision
        FROM ${table} AS artifact
        LEFT JOIN derived_input_closures AS closure
          ON closure.artifact_kind = ?
         AND closure.artifact_id = artifact.${idColumn}
        WHERE artifact.${idColumn} = ?
        `,
      )
      .get(kind, artifactId) as {
        payload_json: string;
        closure_hash: string | null;
        base_state_revision: number | null;
      } | undefined;
    return row
      ? {
          payloadJson: row.payload_json,
          closureHash: row.closure_hash,
          baseRevision: row.base_state_revision === null
            ? null
            : Number(row.base_state_revision),
        }
      : undefined;
  }

  private insertObservation(db: DatabaseSync, observation: ObservationV1): void {
    db.prepare(
      `
      INSERT INTO observations(
        observation_id, schema_version, actor_id, summary, sensing_basis,
        location_id, privacy_scope, observed_at, projection_version,
        base_state_revision, input_closure_hash, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      observation.observation_id,
      observation.schema_version,
      observation.actor_id,
      observation.summary,
      observation.sensing_basis,
      observation.location_id ?? null,
      observation.privacy_scope ?? null,
      observation.observed_at,
      observation.projection_version,
      observation.base_state_revision,
      observation.input_closure_hash,
      canonicalJson(observation),
    );
    const insertSource = db.prepare(
      `
      INSERT INTO observation_sources(
        observation_id, source_type, source_id, quote_hash, observed_at
      ) VALUES (?, ?, ?, ?, ?)
      `,
    );
    for (const source of normalizeSourceRefs(observation.source_refs)) {
      insertSource.run(
        observation.observation_id,
        source.source_type,
        source.source_id,
        source.quote_hash ?? null,
        source.observed_at ?? null,
      );
    }
  }

  private insertBeliefProposal(db: DatabaseSync, belief: BeliefProposalV1): void {
    db.prepare(
      `
      INSERT INTO belief_proposals(
        proposal_id, actor_id, content, status, epistemic_status,
        base_state_revision, input_closure_hash, proposal_version,
        payload_json, proposed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      belief.proposal_id,
      belief.actor_id,
      belief.content,
      belief.status,
      belief.epistemic_status,
      belief.base_state_revision,
      belief.input_closure_hash,
      belief.proposal_version,
      canonicalJson(belief),
      belief.proposed_at,
    );
    const insertSource = db.prepare(
      `
      INSERT INTO belief_proposal_sources(
        proposal_id, source_type, source_id, quote_hash, observed_at
      ) VALUES (?, ?, ?, ?, ?)
      `,
    );
    for (const source of normalizeSourceRefs(belief.source_refs)) {
      insertSource.run(
        belief.proposal_id,
        source.source_type,
        source.source_id,
        source.quote_hash ?? null,
        source.observed_at ?? null,
      );
    }
  }

  private insertDerivedInputClosure(
    db: DatabaseSync,
    options: {
      artifactKind: "observation" | "belief_proposal";
      artifactId: string;
      closureHash: string;
      baseRevision: number;
      createdAt: string;
      inputSources: readonly SourceRef[];
    },
  ): void {
    db.prepare(
      `
      INSERT INTO derived_input_closures(
        artifact_kind, artifact_id, closure_hash, base_state_revision, created_at
      ) VALUES (?, ?, ?, ?, ?)
      `,
    ).run(
      options.artifactKind,
      options.artifactId,
      options.closureHash,
      options.baseRevision,
      options.createdAt,
    );
    const insertSource = db.prepare(
      `
      INSERT INTO derived_input_sources(
        artifact_kind, artifact_id, source_type, source_id,
        quote_hash, observed_at, ordinal
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    );
    options.inputSources.forEach((source, ordinal) => {
      insertSource.run(
        options.artifactKind,
        options.artifactId,
        source.source_type,
        source.source_id,
        source.quote_hash ?? null,
        source.observed_at ?? null,
        ordinal,
      );
    });
  }

  private validateMemoryIndexSource(
    db: DatabaseSync,
    document: MemoryIndexDocumentV1,
  ): void {
    const sourceTables = {
      observation: ["observations", "observation_id", "actor_id"],
      belief_proposal: ["belief_proposals", "proposal_id", "actor_id"],
      memory_record: ["memory_records", "memory_id", null],
      open_loop: ["open_loop_records", "record_id", "actor_id"],
      world_outcome: ["world_outcome_audit", "outcome_id", "actor_id"],
    } as const;
    const expectedKinds = {
      observation: "episodic",
      belief_proposal: "belief",
      open_loop: "open_loop",
      world_outcome: "action_outcome",
    } as const;
    const expectedKind = expectedKinds[
      document.source_artifact_kind as keyof typeof expectedKinds
    ];
    if (expectedKind && document.memory_kind !== expectedKind) {
      throw new CommitRejected(
        `${document.source_artifact_kind} cannot index as ${document.memory_kind}`,
      );
    }

    const [table, idColumn, actorColumn] = sourceTables[document.source_artifact_kind];
    const row = db.prepare(
      `SELECT ${actorColumn ?? "1"} AS actor_id FROM ${table} WHERE ${idColumn} = ?`,
    ).get(document.source_artifact_id) as { actor_id: string | number } | undefined;
    if (!row) {
      throw new CommitRejected(
        `memory source artifact ${document.source_artifact_kind}:${document.source_artifact_id} is not stored`,
      );
    }
    if (actorColumn && row.actor_id !== document.actor_id) {
      throw new CommitRejected("memory index actor differs from source artifact actor");
    }

    if (document.memory_kind !== "action_outcome") {
      return;
    }
    const shape = document.action_outcome;
    if (!shape || document.source_artifact_id !== shape.outcome_id) {
      throw new CommitRejected("action-outcome memory must index its source outcome");
    }
    const audit = db.prepare(
      `
      SELECT action.intent, outcome.action_proposal_id, outcome.status,
             outcome.summary, outcome.hard_constraint_classes_json
      FROM world_outcome_audit AS outcome
      JOIN action_proposal_audit AS action
        ON action.proposal_id = outcome.action_proposal_id
      WHERE outcome.outcome_id = ?
      `,
    ).get(shape.outcome_id) as {
      intent: string;
      action_proposal_id: string;
      status: string;
      summary: string;
      hard_constraint_classes_json: string;
    } | undefined;
    const storedConstraints = audit
      ? (JSON.parse(audit.hard_constraint_classes_json) as string[]).sort()
      : [];
    const proposedConstraints = [...shape.hard_constraint_classes].sort();
    if (
      !audit
      || audit.intent !== shape.action_intent
      || audit.action_proposal_id !== shape.action_proposal_id
      || audit.status !== shape.outcome_status
      || audit.summary !== shape.outcome_summary
      || canonicalJson(storedConstraints) !== canonicalJson(proposedConstraints)
    ) {
      throw new CommitRejected("action-outcome memory differs from adjudication audit");
    }
  }

  private insertMemoryIndexDocument(
    db: DatabaseSync,
    document: MemoryIndexDocumentV1,
    inputSources: readonly SourceRef[],
  ): void {
    const shape = document.action_outcome;
    db.prepare(
      `
      INSERT INTO memory_index_documents(
        document_id, schema_version, actor_id, memory_kind, content,
        visibility_scope, epistemic_status, source_artifact_kind,
        source_artifact_id, action_proposal_id, outcome_id, action_intent,
        outcome_status, outcome_summary, occurred_at, index_version,
        base_state_revision, input_closure_hash, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      document.document_id,
      document.schema_version,
      document.actor_id,
      document.memory_kind,
      document.content,
      document.visibility_scope,
      document.epistemic_status,
      document.source_artifact_kind,
      document.source_artifact_id,
      shape?.action_proposal_id ?? null,
      shape?.outcome_id ?? null,
      shape?.action_intent ?? null,
      shape?.outcome_status ?? null,
      shape?.outcome_summary ?? null,
      document.occurred_at,
      document.index_version,
      document.base_state_revision,
      document.input_closure_hash,
      canonicalJson(document),
    );
    insertStringSet(db, "memory_index_entities", "entity_id", document.document_id, document.entity_ids);
    insertStringSet(
      db,
      "memory_index_relationships",
      "relationship_id",
      document.document_id,
      document.relationship_ids,
    );
    insertStringSet(
      db,
      "memory_index_commitments",
      "commitment_id",
      document.document_id,
      document.commitment_ids,
    );
    insertStringSet(
      db,
      "memory_index_outcome_constraints",
      "hard_constraint_class",
      document.document_id,
      shape?.hard_constraint_classes ?? [],
    );

    const insertSource = db.prepare(
      `
      INSERT INTO memory_index_sources(
        document_id, source_type, source_id, quote_hash, observed_at
      ) VALUES (?, ?, ?, ?, ?)
      `,
    );
    for (const source of normalizeSourceRefs(document.source_refs)) {
      insertSource.run(
        document.document_id,
        source.source_type,
        source.source_id,
        source.quote_hash ?? null,
        source.observed_at ?? null,
      );
    }
    const insertInput = db.prepare(
      `
      INSERT INTO memory_index_input_sources(
        document_id, source_type, source_id, quote_hash, observed_at, ordinal
      ) VALUES (?, ?, ?, ?, ?, ?)
      `,
    );
    inputSources.forEach((source, ordinal) => {
      insertInput.run(
        document.document_id,
        source.source_type,
        source.source_id,
        source.quote_hash ?? null,
        source.observed_at ?? null,
        ordinal,
      );
    });
    db.prepare(
      `
      INSERT INTO memory_index_fts(
        document_id, content, action_intent, outcome_summary
      ) VALUES (?, ?, ?, ?)
      `,
    ).run(
      document.document_id,
      document.content,
      shape?.action_intent ?? "",
      shape?.outcome_summary ?? "",
    );
  }

  private insertPatches(
    db: DatabaseSync,
    operationId: string,
    patches: PatchOp[],
  ): void {
    patches.forEach((op, ordinal) => {
      const value = op.value;
      db.prepare(
        `
        INSERT INTO patch_operations(
          op_id, operation_id, ordinal, target, path, op, value_json,
          expected_state_revision, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        op.op_id,
        operationId,
        ordinal,
        op.target,
        op.path,
        op.op,
        value === undefined || value === null ? null : canonicalJson(value),
        op.expected_state_revision,
        op.reason ?? null,
      );
      for (const claimId of op.claim_ids ?? []) {
        db.prepare("INSERT INTO patch_claims(op_id, claim_id) VALUES (?, ?)").run(
          op.op_id,
          claimId,
        );
      }
      for (const ref of op.source_refs ?? []) {
        db.prepare(
          `
          INSERT INTO patch_sources(op_id, source_type, source_id,
                                    quote_hash, observed_at)
          VALUES (?, ?, ?, ?, ?)
          `,
        ).run(
          op.op_id,
          (ref as SourceRef).source_type,
          (ref as SourceRef).source_id,
          (ref as SourceRef).quote_hash ?? null,
          (ref as SourceRef).observed_at ?? null,
        );
      }
      for (const eventId of op.cause_event_ids ?? []) {
        db.prepare("INSERT INTO patch_causes(op_id, event_id) VALUES (?, ?)").run(
          op.op_id,
          eventId,
        );
      }
    });
  }

  private insertDebts(
    db: DatabaseSync,
    operationId: string,
    debts: DebtLike[],
  ): void {
    for (const debt of debts) {
      db.prepare(
        `
        INSERT INTO debts(
          debt_id, promise_text, created_at, due_at, privacy_scope,
          status, attempts, created_by_operation_id,
          repaid_by_event_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        debt.debt_id,
        debt.promise_text,
        debt.created_at,
        debt.due_at ?? null,
        debt.privacy_scope,
        debt.status,
        debt.attempts,
        operationId,
        debt.repaid_by_event_id ?? null,
        utcnowIso(),
      );
      for (const ref of debt.source_refs) {
        db.prepare(
          `
          INSERT INTO debt_sources(debt_id, source_type, source_id,
                                   quote_hash, observed_at)
          VALUES (?, ?, ?, ?, ?)
          `,
        ).run(
          debt.debt_id,
          ref.source_type,
          ref.source_id,
          ref.quote_hash ?? null,
          ref.observed_at ?? null,
        );
      }
    }
  }

  private insertSettlementRows(
    db: DatabaseSync,
    options: {
      operationId: string;
      proposal: Record<string, unknown>;
      sceneId: string | null;
    },
  ): void {
    const { operationId, proposal, sceneId } = options;
    if (!sceneId) {
      throw new CommitRejected("scene settlement requires scene_id");
    }
    const processed = (proposal.processed_message_ids as string[] | undefined) ?? [];
    const insertProcessed = db.prepare(
      `
      INSERT INTO operation_processed_messages(
        operation_id, scene_id, message_id, ordinal
      ) VALUES (?, ?, ?, ?)
      `,
    );
    processed.forEach((messageId, idx) => {
      insertProcessed.run(operationId, sceneId, messageId, idx);
    });
    db.prepare(
      "UPDATE scenes SET summary = ?, status = 'closed', closed_at = ? WHERE scene_id = ?",
    ).run(proposal.scene_summary as string, utcnowIso(), sceneId);
  }

  private cognitiveAccountFromRow(
    row: Record<string, unknown>,
  ): CognitiveEnergyAccountV1 {
    return {
      schema_version: "1.0",
      actor_id: String(row.actor_id),
      available: Number(row.available),
      reserved: Number(row.reserved),
      capacity: Number(row.capacity),
      protected_reply_reserve: Number(row.protected_reply_reserve),
      recovered_at: String(row.recovered_at),
      recovery_model_version: String(row.recovery_model_version),
      revision: Number(row.revision),
    };
  }

  private updateCognitiveAccount(
    db: DatabaseSync,
    current: CognitiveEnergyAccountV1,
    proposed: CognitiveEnergyAccountV1,
  ): void {
    const result = db.prepare(
      `UPDATE cognitive_energy_accounts
       SET available = ?, reserved = ?, capacity = ?,
           protected_reply_reserve = ?, recovered_at = ?,
           recovery_model_version = ?, revision = ?
       WHERE actor_id = ? AND revision = ?`,
    ).run(
      proposed.available,
      proposed.reserved,
      proposed.capacity,
      proposed.protected_reply_reserve,
      proposed.recovered_at,
      proposed.recovery_model_version,
      proposed.revision,
      current.actor_id,
      current.revision,
    );
    if (result.changes !== 1) {
      throw new CommitRejected("cognitive energy account CAS failed");
    }
  }
}

function emptyResult(operationId: string, replay: boolean): CommitResult {
  return {
    operationId,
    committed: false,
    baseRevision: 0,
    committedRevision: 0,
    replay,
    speechIds: [],
    outboxIds: [],
    claimIds: [],
  };
}

function insertStringSet(
  db: DatabaseSync,
  table: string,
  valueColumn: string,
  documentId: string,
  values: readonly string[],
): void {
  const insert = db.prepare(
    `INSERT INTO ${table}(document_id, ${valueColumn}) VALUES (?, ?)`,
  );
  for (const value of [...values].sort()) {
    insert.run(documentId, value);
  }
}

export { randomUUID };
