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
import { Policy } from "../validation/policy.js";
import { SchemaRegistry, ValidationError } from "../validation/schemas.js";
import {
  SourceClosure,
  type SourceRef,
  closureFromDb,
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
      extraSources?: Iterable<[string, string]>;
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
        extraSources: options.extraSources ?? [],
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
      extraSources?: Iterable<[string, string]>;
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
        extraSources: options.extraSources ?? [],
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

  // ------------------------------------------------------------- internals
  private commitOperation(
    db: DatabaseSync,
    options: {
      kind: "tick" | "scene_settlement";
      proposal: Record<string, unknown>;
      triggerEvent: WorldEvent | null;
      sceneId: string | null;
      batchId: string | null;
      extraSources: Iterable<[string, string]>;
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

    const closure = closureFromDb(db, triggerEvent, options.extraSources);
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
      extraSources: Iterable<[string, string]>;
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
    const closure = closureFromDb(db, triggerEvent, options.extraSources);
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

export { randomUUID };
