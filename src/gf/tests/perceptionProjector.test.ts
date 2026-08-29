import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PerceptionProjector,
  type PerceptionCandidate,
  type PerceptionProjectionInput,
} from "../cognition/perception/perceptionProjector.js";
import { SchemaRegistry } from "../validation/schemas.js";
import {
  SourceClosure,
  SourceClosureError,
} from "../validation/sourceClosure.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function eventCandidate(
  sourceId: string,
  summary: string,
  visibility: PerceptionCandidate["visibility"],
): PerceptionCandidate {
  return {
    summary,
    occurred_at: "2026-08-29T09:00:00+08:00",
    privacy_scope: "internal",
    subject_ids: ["s4", "pump-1"],
    source_refs: [{ source_type: "event", source_id: sourceId }],
    provenance: {
      kind: "world_event",
      principal_id: "world-engine",
      trust: "verified",
    },
    visibility,
  };
}

function baseInput(
  candidates: readonly Readonly<PerceptionCandidate>[],
): PerceptionProjectionInput {
  return {
    actor_id: "muelsyse",
    actor_location_id: "ecology-garden",
    private_channel_ids: ["doctor-private"],
    public_channel_ids: ["ecology-notices"],
    device_feed_ids: ["s4-monitor"],
    authorized_record_ids: ["record-s4-log"],
    candidates,
    projected_at: "2026-08-29T09:00:01+08:00",
    projection_version: "perception-projector.v1",
    base_state_revision: 42,
  };
}

test("stored but unseen events enter neither Observation nor source closure", () => {
  const projector = new PerceptionProjector();
  const visible = eventCandidate(
    "evt-visible",
    "S-4 的叶缘出现轻微卷曲。",
    { kind: "co_located", location_id: "ecology-garden" },
  );
  const hidden = eventCandidate(
    "evt-hidden",
    "地下供水管压力已经下降。",
    { kind: "hidden" },
  );

  const baseline = projector.project(baseInput([visible]));
  const withHidden = projector.project(baseInput([hidden, visible]));
  const withChangedHidden = projector.project(baseInput([
    {
      ...hidden,
      summary: "隐藏管线事实被任意改写，仍不得形成侧信道。",
      source_refs: [{ source_type: "event", source_id: "evt-hidden-changed" }],
    },
    visible,
  ]));

  assert.deepEqual(withHidden, baseline);
  assert.deepEqual(withChangedHidden, baseline);
  assert.equal(baseline.observations.length, 1);
  assert.equal(baseline.observations[0].summary, visible.summary);
  assert.deepEqual(baseline.source_refs, [
    { source_type: "event", source_id: "evt-visible" },
  ]);

  const closure = new SourceClosure();
  for (const source of baseline.source_refs) {
    closure.addKnown(source.source_type, source.source_id);
  }
  assert.doesNotThrow(() => closure.checkRef(visible.source_refs[0]));
  assert.throws(
    () => closure.checkRef(hidden.source_refs[0]),
    SourceClosureError,
  );
});

test("location, channel, grants, and provenance jointly control projection", () => {
  const projector = new PerceptionProjector();
  const candidates: PerceptionCandidate[] = [
    eventCandidate("evt-local", "同地可见", {
      kind: "co_located",
      location_id: "ecology-garden",
    }),
    eventCandidate("evt-remote", "异地不可见", {
      kind: "co_located",
      location_id: "engineering-bay",
    }),
    {
      summary: "博士发来的私信",
      occurred_at: "2026-08-29T09:00:02+08:00",
      privacy_scope: "private_im",
      source_refs: [{ source_type: "message", source_id: "msg-doctor" }],
      provenance: {
        kind: "message",
        principal_id: "doctor",
        trust: "authenticated",
      },
      visibility: {
        kind: "direct_message",
        channel_id: "doctor-private",
        recipient_actor_ids: ["muelsyse"],
      },
    },
    {
      summary: "未授权私信",
      occurred_at: "2026-08-29T09:00:03+08:00",
      privacy_scope: "private_im",
      source_refs: [{ source_type: "message", source_id: "msg-other" }],
      provenance: {
        kind: "message",
        principal_id: "other",
        trust: "authenticated",
      },
      visibility: {
        kind: "direct_message",
        channel_id: "other-private",
        recipient_actor_ids: ["muelsyse"],
      },
    },
    {
      summary: "生态部门公开通知",
      occurred_at: "2026-08-29T09:00:04+08:00",
      privacy_scope: "public_allowed",
      source_refs: [{ source_type: "message", source_id: "msg-notice" }],
      provenance: {
        kind: "message",
        principal_id: "ecology-office",
        trust: "attested",
      },
      visibility: { kind: "public_channel", channel_id: "ecology-notices" },
    },
    eventCandidate("evt-device", "S-4 监测端读数变化", {
      kind: "device_feed",
      feed_id: "s4-monitor",
      location_id: "ecology-garden",
    }),
    {
      summary: "同事转述泵房检修时间",
      occurred_at: "2026-08-29T09:00:05+08:00",
      privacy_scope: "internal",
      source_refs: [{ source_type: "event", source_id: "evt-report" }],
      provenance: {
        kind: "report",
        principal_id: "npc-lin",
        trust: "attested",
      },
      visibility: { kind: "npc_report", recipient_actor_ids: ["muelsyse"] },
    },
    {
      summary: "获准读取的 S-4 日志",
      occurred_at: "2026-08-29T09:00:06+08:00",
      privacy_scope: "internal",
      source_refs: [{ source_type: "claim", source_id: "claim-s4-log" }],
      provenance: {
        kind: "record",
        principal_id: "records-service",
        trust: "verified",
      },
      visibility: { kind: "authorized_record", record_id: "record-s4-log" },
    },
    {
      ...eventCandidate("evt-mislabeled", "来源类型与观察路径不符", {
        kind: "co_located",
        location_id: "ecology-garden",
      }),
      source_refs: [{ source_type: "message", source_id: "msg-mislabeled" }],
    },
  ];

  const result = projector.project(baseInput(candidates));
  assert.deepEqual(
    result.observations.map((observation) => observation.sensing_basis),
    [
      "device_feed",
      "co_located",
      "direct_message",
      "public_channel",
      "npc_report",
      "authorized_record",
    ],
  );
  assert.equal(result.observations.some((item) => item.summary === "异地不可见"), false);
  assert.equal(result.observations.some((item) => item.summary === "未授权私信"), false);
  assert.equal(
    result.observations.some((item) => item.summary === "来源类型与观察路径不符"),
    false,
  );

  const registry = new SchemaRegistry(join(ROOT, "schemas"));
  for (const observation of result.observations) {
    registry.validate("observation.schema.json", observation);
    assert.equal(observation.input_closure_hash, result.input_closure_hash);
  }
});

test("visible projection is byte-stable across candidate order", () => {
  const projector = new PerceptionProjector();
  const first = eventCandidate("evt-a", "第一条", {
    kind: "co_located",
    location_id: "ecology-garden",
  });
  const second = eventCandidate("evt-b", "第二条", {
    kind: "device_feed",
    feed_id: "s4-monitor",
  });

  const forward = projector.project(baseInput([first, second]));
  const reverse = projector.project(baseInput([second, first]));
  assert.deepEqual(reverse, forward);
  assert.match(forward.input_closure_hash, /^[a-f0-9]{64}$/);
});
