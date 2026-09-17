import type { DatabaseSync } from "../../state/db.js";
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
import { LIFE_POLICY_PROMPT_VERSION } from "./prompts.js";
import { projectLifeConversation } from "./conversation.js";
import { eventTimeContext } from "./timeContext.js";
export interface LifeEventRow {
  event_id: string;
  ledger_order?: number;
  kind: string;
  origin: string;
  occurred_at: string;
  payload_json: string;
  principal_id: string;
  causation_event_id?: string | null;
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
      // Freeze the input set before inference; later arrivals belong to another turn.
      const batch = row.origin === "user" ? this.pendingUserBatch(at) : [row];
      if (!batch.length) return;
      try {
        await this.process(batch, at);
      } catch {
        this.state.markLifeEvents(batch.map((e) => e.event_id), "cognition_failed", at);
      }
    } finally {
      this.busy = false;
    }
  }
  private pendingUserBatch(at: string): LifeEventRow[] {
    const rows = this.db.prepare(
      `SELECT e.* FROM life_event_queue q JOIN world_events e USING(event_id)
       WHERE q.status='pending' AND e.origin='user' AND e.principal_id=?
       AND (q.next_attempt_at IS NULL OR q.next_attempt_at<=?)
       ORDER BY e.occurred_at,e.event_id LIMIT 8`,
    ).all(this.owner, at) as unknown as LifeEventRow[];
    const batch: LifeEventRow[] = [];
    let chars = 0;
    for (const row of rows) {
      const size = JSON.parse(row.payload_json).summary.length;
      if (batch.length && chars + size > 8000) break;
      batch.push(row);
      chars += size;
    }
    return batch;
  }
  private async process(batch: LifeEventRow[], at: string) {
    const row = batch[0];
    const snapshot = this.state.lifeSnapshot()!;
    const source: SourceRef = { source_type: "event", source_id: row.event_id };
    const user = row.origin === "user";
    const batchIds = batch.map((e) => e.event_id);
    const batchSources: SourceRef[] = batch.map((e) => ({ source_type: "event", source_id: e.event_id }));
    const previous = this.accumulations(row.kind);
    const result = this.admission.evaluate({
      changes: batch.map((row) => {
        const payload = JSON.parse(row.payload_json) as {
          summary: string;
          salience: number;
          location?: string;
          device?: boolean;
        };
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
        const source: SourceRef = { source_type: "event", source_id: row.event_id };
        return {
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
            summary: this.eventNarrative(row),
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
        };
      }),
      aggregation: {
        windowStartedAt: row.occurred_at,
        windowEndedAt: at,
        accumulatorVersion: "life-aggregation.v2",
      },
      perception: {
        actor_id: "muelsyse",
        actor_location_id: snapshot.state.location,
        private_channel_ids: ["private_im"],
        public_channel_ids: [],
        device_feed_ids: ["s4-sensor"],
        authorized_record_ids: ["self-actions"],
        projected_at: at,
        projection_version: "life-perception.v2",
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
      this.state.markLifeEvents(batchIds);
      return;
    }
    this.state.recordWakeDecision(result.candidate, result.decision, {
      inputSources: result.decision.observation_refs,
      affectMode: "off",
      affectContributed: false,
    });
    // Admission projects each event separately; persist each exact projection closure.
    for (const observation of result.observations)
      this.state.submitCognitiveArtifacts(
        { observations: [observation] },
        { inputSources: observation.source_refs },
      );
    if (result.decision.disposition !== "wake") {
      this.state.markLifeEvents(batchIds);
      return;
    }
    const evidence: WorkingSelfCandidate[] = result.observations.map((o) => ({
      evidenceId: o.observation_id,
      origin: user ? "current_input" : "current_fact",
      narrative: this.observationNarrative(o, at, "本次触发"),
      sourceRefs: o.source_refs,
      asOf: this.observationTime(o),
    }));
    evidence.push(...this.recentSpeechEvidence(snapshot, at));
    const seed = this.db
      .prepare(
        "SELECT event_id,payload_json,occurred_at FROM world_events WHERE kind='life.seed' LIMIT 1",
      )
      .get() as { event_id: string; payload_json: string; occurred_at: string };
    if (seed.event_id !== row.event_id)
      evidence.push({
        evidenceId: "identity:seed",
        origin: "persona",
        narrative: `身份与初始化记录（${seed.occurred_at}，其中进度只描述初始时刻）：${JSON.parse(seed.payload_json).summary}`,
        asOf: seed.occurred_at,
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
          narrative: `本轮仍在进行的自身活动，开始于 ${activity.startedAt}，预计结束于 ${activity.endsAt}（只确认已执行的步骤；记录中的打算不代表已完成，引用他人话语不代表自己的经历）：${JSON.parse(event.payload_json).summary}`,
          sourceRefs: [{ source_type: "event", source_id: event.event_id }],
          asOf: at,
        });
    }
    // Retrieval is bounded and source-only. Recent rejected actions are protected counter-evidence.
    const memories = this.db
      .prepare(
        `WITH ranked AS (
          SELECT o.payload_json,o.observation_id,o.observed_at,
            COALESCE((SELECT MAX(e.occurred_at) FROM json_each(json_extract(o.payload_json,'$.source_refs')) ref
              JOIN world_events e ON e.event_id=json_extract(ref.value,'$.source_id')
              WHERE json_extract(ref.value,'$.source_type')='event'),o.observed_at) AS event_time,
            ROW_NUMBER() OVER (
              PARTITION BY json_extract(o.payload_json,'$.source_refs')
              ORDER BY o.observed_at DESC,o.observation_id DESC
            ) AS source_rank
          FROM observations o WHERE o.actor_id='muelsyse'
        ) SELECT payload_json FROM ranked WHERE source_rank=1
          ORDER BY event_time DESC,observed_at DESC,observation_id DESC LIMIT 24`,
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
        summary: this.observationNarrative(o, at, "历史背景"),
        source_refs: o.source_refs,
        as_of: this.observationTime(o),
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
          retrieval_version: "life-recent-memory.v3",
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
    const mandatory = Math.max(1000,
      evidence.reduce((n, e) => n + e.narrative.length, 0)
      + memory.filter((m) => counterIds.includes(m.memory_id)).reduce((n, m) => n + m.summary.length, 0)
      + 1000);
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
      this.state.markLifeEvents(batchIds, "capacity_wait", at);
      return;
    }
    const envelope = new CognitiveCapacityLimiter().limit(
      recovered,
      reservation,
      batchSources,
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
      assemblerVersion: "life-working-self.v3",
      assembledAt: at,
    }) as WorkingSelfV1;
    const conversation = projectLifeConversation(ws, ws.input_closure.source_refs
      .filter(s => s.source_type === "event").flatMap(s => {
        const event = this.db.prepare(`SELECT e.*,e.rowid AS ledger_order FROM world_events e
          LEFT JOIN life_event_queue q USING(event_id)
          LEFT JOIN world_events parent ON parent.event_id=e.causation_event_id
          WHERE e.event_id=? AND (e.origin='user' OR e.kind='life.speech.staged')
          AND (e.origin<>'user' OR q.status='done' OR e.event_id IN (${batchIds.map(() => "?").join(",")}))
          AND (parent.origin IS NULL OR parent.origin<>'admin')`).get(s.source_id, ...batchIds) as unknown as LifeEventRow | undefined;
        return event ? [event] : [];
      }));
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
        promptVersion: LIFE_POLICY_PROMPT_VERSION,
        promptManifestHash: hash(LIFE_POLICY_PROMPT_VERSION),
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
          version: "life-deepseek-units.v2",
          modelId: this.model.modelId,
          modelAliases: this.model.modelId === "deepseek-v4-flash"
            ? ["deepseek-flash"] : [],
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
          conversation,
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
    const command = await this.model.compile(value.value, ws, conversation);
    this.state.completeLifeEpisode({
      episodeId,
      trigger: row.event_id,
      consumedEventIds: batchIds,
      baseRevision: snapshot.revision,
      workingSelf: ws,
      policy: value.value,
      command,
      owner: this.owner,
      at,
      proactive: this.proactive,
    });
  }
  /** Attribute legacy observations from their immutable source, not an inferred speaker. */
  private eventNarrative(row: LifeEventRow): string {
    const text = JSON.parse(row.payload_json).summary as string;
    if (row.origin === "user")
      return `博士 → 缪尔赛思；发送于 ${row.occurred_at}；博士原话：${JSON.stringify(text)}。这是对方的发言，不是你的自述。`;
    if (row.kind === "life.speech.staged") {
      const parent = row.causation_event_id
        ? this.db.prepare("SELECT origin FROM world_events WHERE event_id=?").get(row.causation_event_id) as { origin?: string } | undefined
        : undefined;
      return `${parent?.origin === "admin" ? "系统通知（不是角色发言）" : "缪尔赛思 → 博士，自身发言"}；记录 ${row.event_id}；时间 ${row.occurred_at}：${text}`;
    }
    if (row.kind.startsWith("life.delivery."))
      return `消息记录 ${row.causation_event_id ?? "未标识"} 的投递回执；时间 ${row.occurred_at}：${text}`;
    if (row.kind === "life.action.rejected")
      return `自身行动尝试记录（意图不是已发生的事实）：${text}`;
    if (row.kind === "life.activity.started")
      return `自身活动开始记录（只确认已执行步骤，整段意图不是事实）：${text}`;
    return text;
  }
  private observationEvents(o: ObservationV1): LifeEventRow[] {
    return o.source_refs.filter((r) => r.source_type === "event").flatMap((ref) => {
      const row = this.db.prepare("SELECT * FROM world_events WHERE event_id=?").get(ref.source_id) as unknown as LifeEventRow | undefined;
      return row ? [row] : [];
    });
  }
  private observationTime(o: ObservationV1): string {
    const times = this.observationEvents(o).map((e) => e.occurred_at).sort();
    return times.at(-1) ?? o.observed_at;
  }
  private observationNarrative(o: ObservationV1, now: string, usage: "本次触发" | "历史背景" | "发言历史"): string {
    const rows = this.observationEvents(o);
    const content = rows.length ? rows.map((r) => this.eventNarrative(r)).join("\n") : o.summary;
    const time = rows.length ? eventTimeContext(this.observationTime(o), now)
      : `原始事件时间未知；观察记录时间 ${o.observed_at}`;
    const meaning = usage === "本次触发"
      ? "这是本轮实际处理的事件；其发生时间可能早于本轮。"
      : "这里只是回看过去的记录，不表示此刻又发生一次，也不是新收到的请求。";
    return `【${usage}】${time}。${meaning}\n${content}`;
  }
  /** Self-authored speech and delivery receipts cross the same Perception boundary,
   * without waiting behind the inbound queue or recursively waking cognition. */
  private recentSpeechEvidence(snapshot: NonNullable<ReturnType<StateManager["lifeSnapshot"]>>, at: string): WorkingSelfCandidate[] {
    const rows = this.db.prepare(
      `WITH recent AS (
        SELECT * FROM world_events WHERE kind='life.speech.staged'
        ORDER BY occurred_at DESC,event_id DESC LIMIT 4
      ) SELECT * FROM recent UNION ALL
        SELECT e.* FROM world_events e WHERE e.kind LIKE 'life.delivery.%'
        AND e.causation_event_id IN (SELECT event_id FROM recent)
      ORDER BY occurred_at,event_id`,
    ).all() as unknown as LifeEventRow[];
    const history = this.db.prepare(`SELECT e.* FROM world_events e
      JOIN life_event_queue q USING(event_id) WHERE e.origin='user'
      AND e.principal_id=? AND q.status='done'
      ORDER BY e.occurred_at DESC,e.event_id DESC LIMIT 12`).all(this.owner) as unknown as LifeEventRow[];
    let chars = 0;
    for (const event of history) {
      const size = JSON.parse(event.payload_json).summary.length;
      if (chars + size > 8000) break;
      chars += size;
      rows.push(event);
    }
    if (!rows.length) return [];
    const projection = new PerceptionProjector().project({
      actor_id: "muelsyse", actor_location_id: snapshot.state.location,
      private_channel_ids: ["private_im"], public_channel_ids: [], device_feed_ids: [],
      authorized_record_ids: ["self-actions"], projected_at: at,
      projection_version: "life-self-speech.v1", base_state_revision: snapshot.revision,
      candidates: rows.map((row) => ({
        summary: this.eventNarrative(row), occurred_at: row.occurred_at,
        privacy_scope: "private_im", source_refs: row.origin === "user"
          ? [{ source_type: "event", source_id: row.event_id }, { source_type: "message", source_id: row.event_id }]
          : [{ source_type: "event", source_id: row.event_id }],
        provenance: row.origin === "user"
          ? { kind: "message", principal_id: this.owner, trust: "authenticated" }
          : { kind: "record", principal_id: "muelsyse", trust: "verified" },
        visibility: row.origin === "user"
          ? { kind: "direct_message", channel_id: "private_im", recipient_actor_ids: ["muelsyse"] }
          : { kind: "authorized_record", record_id: "self-actions" },
      })),
    });
    this.state.submitCognitiveArtifacts({ observations: [...projection.observations] }, { inputSources: projection.source_refs });
    return projection.observations.map((o) => ({
      evidenceId: o.observation_id, origin: "current_fact", narrative: this.observationNarrative(o, at, this.observationEvents(o).some(e => e.origin === "user") ? "历史背景" : "发言历史"),
      sourceRefs: o.source_refs, asOf: this.observationTime(o),
    }));
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
