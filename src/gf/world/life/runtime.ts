import type { DatabaseSync } from "node:sqlite";
import type {
  ObservationV1,
  WorkingSelfV1,
  SourceRef,
  MemoryBundleV1,
  MemoryEvidenceV1,
} from "../../generated/agentPipelineTypes.js";
import {
  ChangeAggregator,
  CognitiveAdmissionPipeline,
  CognitiveGate,
  type AccumulatedSignalContext,
} from "../../cognition/admission/cognitiveAdmission.js";
import {
  PerceptionProjector,
  type PerceptionCandidate,
} from "../../cognition/perception/perceptionProjector.js";
import {
  WorkingSelfBuilder,
  type WorkingSelfCandidate,
} from "../../cognition/workingSelf/workingSelfBuilder.js";
import {
  CognitiveEnergyEngine,
  CognitiveBudgetPlanner,
  CognitiveCapacityLimiter,
  VersionedUsageSettlement,
} from "../../cognition/energy/energyEngine.js";
import { CognitiveCallLifecycle } from "../../cognition/lifecycle/cognitiveCallLifecycle.js";
import { VersionedUsageClassifier } from "../../inference/usage/usageAccounting.js";
import type { StateManager } from "../../state/stateManager.js";
import type { LifeModel } from "./model.js";
import { hash } from "./model.js";
import {
  computeInputClosureHash,
  normalizeSourceRefs,
} from "../../validation/derivedInputClosure.js";
import { lifeId } from "./kernel.js";
import { OPEN_POLICY_PROMPT_VERSION } from "../../cognition/policy/openGenerativePolicy.js";
export interface LifeEventRow {
  event_id: string;
  kind: string;
  origin: string;
  occurred_at: string;
  payload_json: string;
}
export class LifeRuntime {
  private busy = false;
  private readonly admission = new CognitiveAdmissionPipeline(
    new ChangeAggregator(),
    new PerceptionProjector(),
    new CognitiveGate(),
  );
  private readonly energy = new CognitiveEnergyEngine({
    version: "life-recovery.v1",
    baseUnitsPerHour: 12000,
    protectedReplyReserveUnits: 12000,
  });
  constructor(
    private readonly db: DatabaseSync,
    private readonly state: StateManager,
    private readonly model: LifeModel,
    private readonly owner: string,
    private readonly proactive = false,
  ) {}
  /** One serial episode at a time. Inbound ingestion can proceed during inference. */
  async cycle(at = new Date().toISOString()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.state.advanceLife(at);
      const row = this.db
        .prepare(
          `SELECT e.* FROM life_event_queue q JOIN world_events e USING(event_id) WHERE q.status='pending' AND (q.next_attempt_at IS NULL OR q.next_attempt_at<=?) ORDER BY CASE e.origin WHEN 'user' THEN 0 ELSE 1 END,e.occurred_at,e.event_id LIMIT 1`,
        )
        .get(at) as unknown as LifeEventRow | undefined;
      if (!row) return;
      try {
        await this.process(row, at);
      } catch {
        this.state.markLifeEvent(row.event_id, "cognition_failed", at);
      }
    } finally {
      this.busy = false;
    }
  }
  private async process(row: LifeEventRow, at: string) {
    const snapshot = this.state.lifeSnapshot()!;
    const source: SourceRef = { source_type: "event", source_id: row.event_id };
    const payload = JSON.parse(row.payload_json) as {
      summary: string;
      salience: number;
      location?: string;
      device?: boolean;
    };
    const user = row.origin === "user";
    const visibility: PerceptionCandidate["visibility"] = user
      ? {
          kind: "direct_message",
          channel_id: "private_im",
          recipient_actor_ids: ["muelsyse"],
        }
      : payload.device
        ? { kind: "device_feed", feed_id: "s4-sensor" }
        : payload.location
          ? { kind: "co_located", location_id: payload.location }
          : { kind: "authorized_record", record_id: "self-actions" };
    const previous = this.accumulations(row.kind);
    const result = this.admission.evaluate({
      changes: [
        {
          changeId: row.event_id,
          aggregationKey: row.kind,
          eventKind: user ? "message.user" : row.kind,
          entityIds: ["S-4"],
          locationIds: payload.location ? [payload.location] : [],
          salience: payload.salience ?? 0.2,
          boundaryHint:
            row.kind === "life.activity.completed"
              ? "activity_boundary"
              : "observable_change",
          recursiveInternal:
            row.kind === "life.speech.staged" ||
            row.kind.startsWith("life.delivery."),
          perceptionCandidate: {
            summary: payload.summary,
            occurred_at: row.occurred_at,
            privacy_scope: user ? "private_im" : "internal",
            source_refs: user
              ? [source, { source_type: "message", source_id: row.event_id }]
              : [source],
            provenance: {
              kind: user
                ? "message"
                : visibility.kind === "authorized_record"
                  ? "record"
                  : "world_event",
              principal_id: user ? this.owner : "muelsyse",
              trust: user ? "authenticated" : "verified",
            },
            visibility,
          },
        },
      ],
      aggregation: {
        windowStartedAt: row.occurred_at,
        windowEndedAt: at,
        accumulatorVersion: "life-aggregation.v1",
      },
      perception: {
        actor_id: "muelsyse",
        actor_location_id: snapshot.state.location,
        private_channel_ids: ["private_im"],
        public_channel_ids: [],
        device_feed_ids: ["s4-sensor"],
        authorized_record_ids: ["self-actions"],
        projected_at: at,
        projection_version: "life-perception.v1",
        base_state_revision: snapshot.revision,
      },
      gate: {
        currentActivity: {
          activityId: snapshot.state.activity?.id ?? "activity:idle",
          continuation: "automatic",
          sourceRefs: [source],
        },
        hardInterrupts: [],
        activeSubscriptions: [],
        previousAccumulations: previous,
        parameters: {
          parameterVersion: "life-gate.v1",
          wakeSalience: 0.8,
          accumulateSalience: 0.2,
          accumulatedWakeCount: 3,
          accumulatedWakeSalience: 0.8,
        },
        gateVersion: "cognitive-gate.v1",
        decidedAt: at,
      },
    });
    if (!result.candidate || !result.decision) {
      this.state.markLifeEvent(row.event_id);
      return;
    }
    this.state.recordWakeDecision(result.candidate, result.decision, {
      inputSources: result.decision.observation_refs,
      affectMode: "off",
      affectContributed: false,
    });
    this.state.submitCognitiveArtifacts(
      { observations: [...result.observations] },
      { inputSources: result.candidate.observation_refs },
    );
    if (result.decision.disposition !== "wake") {
      this.state.markLifeEvent(row.event_id);
      return;
    }
    const evidence: WorkingSelfCandidate[] = result.observations.map((o) => ({
      evidenceId: o.observation_id,
      origin: user ? "current_input" : "current_fact",
      narrative: o.summary,
      sourceRefs: o.source_refs,
      asOf: o.observed_at,
    }));
    const seed = this.db
      .prepare(
        "SELECT event_id,payload_json FROM world_events WHERE kind='life.seed' LIMIT 1",
      )
      .get() as { event_id: string; payload_json: string };
    if (seed.event_id !== row.event_id)
      evidence.push({
        evidenceId: "identity:seed",
        origin: "persona",
        narrative: JSON.parse(seed.payload_json).summary,
        sourceRefs: [{ source_type: "event", source_id: seed.event_id }],
      });
    // Keep the currently running self-action even through a long conversation.
    if (snapshot.state.activity) {
      const activity = snapshot.state.activity;
      const event = this.db
        .prepare(
          "SELECT event_id,payload_json FROM world_events WHERE kind='life.activity.started' AND occurred_at=? ORDER BY event_id LIMIT 1",
        )
        .get(activity.startedAt) as
        | { event_id: string; payload_json: string }
        | undefined;
      if (event && event.event_id !== row.event_id)
        evidence.push({
          evidenceId: "current:activity",
          origin: "activity",
          narrative: JSON.parse(event.payload_json).summary,
          sourceRefs: [{ source_type: "event", source_id: event.event_id }],
          asOf: at,
        });
    }
    // Retrieval is bounded and source-only. Recent rejected actions are protected counter-evidence.
    const memories = this.db
      .prepare(
        "SELECT payload_json FROM observations WHERE actor_id='muelsyse' ORDER BY observed_at DESC,observation_id DESC LIMIT 24",
      )
      .all() as { payload_json: string }[];
    const seenSources = new Set(
      evidence.flatMap((e) =>
        e.sourceRefs.map((s) => `${s.source_type}:${s.source_id}`),
      ),
    );
    const memory: MemoryEvidenceV1[] = [];
    const counterIds: string[] = [];
    for (const m of memories) {
      const o = JSON.parse(m.payload_json) as ObservationV1;
      if (
        o.source_refs.every((s) =>
          seenSources.has(`${s.source_type}:${s.source_id}`),
        )
      )
        continue;
      o.source_refs.forEach((s) =>
        seenSources.add(`${s.source_type}:${s.source_id}`),
      );
      memory.push({
        memory_id: o.observation_id,
        kind: "episodic",
        summary: o.summary,
        source_refs: o.source_refs,
        as_of: o.observed_at,
      });
      if (
        o.source_refs.some(
          (s) =>
            s.source_type === "event" &&
            this.db
              .prepare(
                "SELECT 1 FROM world_events WHERE event_id=? AND kind='life.action.rejected'",
              )
              .get(s.source_id),
        )
      )
        counterIds.push(o.observation_id);
    }
    const memorySources = normalizeSourceRefs(
      memory.flatMap((m) => m.source_refs),
    );
    const memoryBundle: MemoryBundleV1 | undefined = memory.length
      ? {
          schema_version: "1.0",
          bundle_id: lifeId("life-memory", {
            sources: memorySources,
            revision: snapshot.revision,
          }),
          actor_id: "muelsyse",
          evidence: memory,
          supporting_memory_ids: memory
            .filter((m) => !counterIds.includes(m.memory_id))
            .map((m) => m.memory_id),
          counter_memory_ids: counterIds,
          input_closure: {
            source_refs: memorySources,
            closure_hash: computeInputClosureHash(
              snapshot.revision,
              memorySources,
            ),
            base_state_revision: snapshot.revision,
          },
          retrieval_version: "life-recent-memory.v1",
          retrieved_at: at,
        }
      : undefined;
    const account = this.state.getCognitiveEnergyAccount("muelsyse")!;
    this.state.recoverLifeEnergy(
      this.energy.proposeRecovery(account, {
        now: at,
        activityRecoveryFactor: 1,
        physiologyRecoveryFactor: 1,
        concurrentLoadFraction: 0,
      }),
    );
    const recovered = this.state.getCognitiveEnergyAccount("muelsyse")!;
    const episodeId = lifeId("episode", {
      trigger: row.event_id,
      revision: snapshot.revision,
      at,
    });
    const runId = lifeId("run", episodeId);
    // Budget bounds are engine-only. An authenticated input that cannot fit remains queued.
    const mandatory = Math.max(1000, payload.summary.length * 2 + 1000);
    const reservation = new CognitiveBudgetPlanner().plan(
      result.decision,
      recovered,
      {
        reservationId: lifeId("reserve", episodeId),
        promptRunId: runId,
        purpose: "policy",
        accessClass: user ? "reply" : "autonomous",
        requestedNormalizedUnits: 30000,
        mandatorySemanticUnits: mandatory,
        minimumExpressionUnits: 2048,
        accountingVersion: "life-energy.v1",
        expiresAt: new Date(Date.parse(at) + 180000).toISOString(),
        idempotencyKey: episodeId,
      },
    );
    if (!reservation) {
      this.state.markLifeEvent(row.event_id, "capacity_wait", at);
      return;
    }
    const envelope = new CognitiveCapacityLimiter().limit(
      recovered,
      reservation,
      [source],
      {
        mandatorySemanticUnits: mandatory,
        requestedOptionalSemanticUnits: 6000,
        requestedDeliberationUnits: 0,
        minimumExpressionUnits: 2048,
        requestedExtraExpressionUnits: 0,
        requestedToolRounds: 0,
        deliberationUnitsPerToolRound: 0,
      },
    );
    const ws = new WorkingSelfBuilder().build({
      episodeId,
      actorId: "muelsyse",
      baseStateRevision: snapshot.revision,
      evidence,
      memoryBundle,
      capacityEnvelope: envelope,
      assemblerVersion: "life-working-self.v1",
      assembledAt: at,
    }) as WorkingSelfV1;
    const lifecycle = new CognitiveCallLifecycle(
      this.state,
      this.energy,
      new VersionedUsageClassifier(),
      new VersionedUsageSettlement(),
    );
    const value = await lifecycle.execute({
      reservation,
      reservedAccount: this.energy.proposeReservation(recovered, reservation),
      capacityEnvelope: envelope,
      promptRunStarted: {
        runId,
        promptName: "open_policy",
        promptVersion: OPEN_POLICY_PROMPT_VERSION,
        promptManifestHash: hash(OPEN_POLICY_PROMPT_VERSION),
        inputHash: hash(ws),
        modelId: this.model.modelId,
        startedAt: at,
      },
      baseStateRevision: snapshot.revision,
      inputSources: ws.input_closure.source_refs,
      classificationContext: {
        attemptClass: "accepted_semantic" as const,
        inputClosureHash: ws.input_closure.closure_hash,
        inputSegments: [
          {
            segmentId: "life-evidence",
            purpose: "memory" as const,
            weight: JSON.stringify(ws).length,
            sourceRefs: ws.input_closure.source_refs,
          },
          {
            segmentId: "runtime-format",
            purpose: "runtime_overhead" as const,
            weight: 1500,
            sourceRefs: [],
          },
        ],
        outputPurpose: "expression" as const,
      },
      settlementContext: {
        accountingVersion: "life-energy.v1",
        settledAt: at,
        normalization: {
          version: "life-deepseek-units.v1",
          modelId: this.model.modelId,
          tokenizerVersion: "deepseek.responses.usage.v1",
          semanticInputWeight: 1,
          deliberationWeight: 1,
          expressionWeight: 1,
        },
      },
      failureFinishedAt: at,
      run: async () => {
        const r = await this.model.policy(
          ws,
          runId,
          envelope.max_expression_units,
        );
        return {
          value: r.policy,
          receipt: r.receipt,
          promptRunFinished: r.finished,
          capacityApplication: {
            semanticInput: "applied",
            expression: "applied",
            deliberation: "unsupported_explicit",
            toolRounds: "applied",
          },
        };
      },
    });
    const command = await this.model.compile(value.value, ws);
    this.state.completeLifeEpisode({
      episodeId,
      trigger: row.event_id,
      baseRevision: snapshot.revision,
      workingSelf: ws,
      policy: value.value,
      command,
      owner: this.owner,
      at,
      proactive: this.proactive,
    });
  }
  private accumulations(kind: string): AccumulatedSignalContext[] {
    const rows = this.db
      .prepare(
        `SELECT e.event_id,e.payload_json,d.disposition FROM wake_decision_audit d JOIN wake_candidates c ON c.candidate_id=d.candidate_id JOIN world_events e ON e.event_id=json_extract(c.payload_json,'$.observation_refs[0].source_id') WHERE e.kind=? ORDER BY d.decided_at DESC LIMIT 3`,
      )
      .all(kind) as {
      event_id: string;
      payload_json: string;
      disposition: string;
    }[];
    const refs: SourceRef[] = [];
    let salience = 0;
    for (const r of rows) {
      if (r.disposition !== "accumulate") break;
      refs.push({ source_type: "event", source_id: r.event_id });
      salience += JSON.parse(r.payload_json).salience ?? 0.2;
    }
    return refs.length
      ? [
          {
            accumulationId: lifeId("accum", refs),
            aggregationKey: kind,
            signalCount: refs.length,
            salience,
            sourceRefs: refs,
          },
        ]
      : [];
  }
}
