import { test } from "node:test";
import assert from "node:assert/strict";
import {
  S4AttentionLoop,
  type S4PolicyClient,
  type S4PolicyDecision,
  type S4PolicyInput,
} from "../vertical-slices/s4AttentionLoop.js";

class CapturingPolicy implements S4PolicyClient {
  readonly inputs: S4PolicyInput[] = [];

  async decide(input: S4PolicyInput): Promise<S4PolicyDecision> {
    this.inputs.push(input);

    if (this.inputs.length === 1) {
      return {
        kind: "act",
        action: {
          kind: "inspect",
          target: "S-4",
          focus: "irrigation",
          intent: "检查 S-4 的灌溉和根区状态，先不要下结论。",
        },
      };
    }

    return {
      kind: "yield",
      reason: "已经找到足够线索，先回到世界继续处理。",
    };
  }
}

test("S-4 hidden world change stays outside cognition and agent decides when the episode yields", async () => {
  const policy = new CapturingPolicy();
  const loop = new S4AttentionLoop({
    policy,
    initialWorld: {
      currentActivity: "ecology-garden routine work",
      pumpPressure: "normal",
      s4Wilted: false,
    },
    attention: {
      subject: "S-4",
      reason: "上午观察时觉得状态有点不对，下午继续留意。",
      expiresAt: "2026-08-10T18:00:00+08:00",
    },
  });

  const hidden = await loop.process({
    eventId: "evt_pump_low",
    occurredAt: "2026-08-10T12:40:00+08:00",
    kind: "pump_pressure_low",
    visibility: "hidden",
  });

  assert.equal(hidden.kind, "ignored");
  if (hidden.kind !== "ignored") {
    assert.fail("hidden pump state must not trigger cognition");
  }
  assert.equal(hidden.reason, "not_perceived");
  assert.equal(policy.inputs.length, 0);

  const visible = await loop.process({
    eventId: "evt_s4_wilted",
    occurredAt: "2026-08-10T13:20:00+08:00",
    kind: "s4_wilted",
    visibility: "observable",
  });

  assert.equal(visible.kind, "cognitive");
  if (visible.kind !== "cognitive") {
    assert.fail("visible attended S-4 anomaly must trigger cognition");
  }

  assert.equal(policy.inputs.length, 2);

  const firstInput = policy.inputs[0];
  assert.equal(firstInput.currentActivity, "ecology-garden routine work");
  assert.equal(firstInput.attention.subject, "S-4");
  assert.deepEqual(firstInput.observations, [
    {
      sourceEventId: "evt_s4_wilted",
      observedAt: "2026-08-10T13:20:00+08:00",
      text: "S-4 出现持续萎蔫。",
    },
  ]);
  assert.deepEqual(firstInput.episodeHistory, []);

  const firstSerialized = JSON.stringify(firstInput);
  assert.equal(firstSerialized.includes("pumpPressure"), false);
  assert.equal(firstSerialized.includes("pump_pressure"), false);
  assert.equal(firstSerialized.includes("evt_pump_low"), false);

  assert.equal(visible.episodeHistory.length, 1);
  const firstStep = visible.episodeHistory[0];
  assert.deepEqual(firstStep.action, {
    kind: "inspect",
    target: "S-4",
    focus: "irrigation",
    intent: "检查 S-4 的灌溉和根区状态，先不要下结论。",
  });
  assert.deepEqual(firstStep.outcome.newObservations, [
    {
      sourceEventId: firstStep.outcome.outcomeEventId,
      observedAt: "2026-08-10T13:20:00+08:00",
      text: "检查后发现 S-4 所在区域的灌溉压力偏低。",
    },
  ]);

  const secondInput = policy.inputs[1];
  assert.equal(secondInput.observations.length, 2);
  assert.equal(
    secondInput.observations[1].text,
    "检查后发现 S-4 所在区域的灌溉压力偏低。",
  );
  assert.equal(secondInput.episodeHistory.length, 1);
  assert.equal(JSON.stringify(secondInput).includes("evt_pump_low"), false);

  assert.deepEqual(visible.end, {
    kind: "agent_yield",
    reason: "已经找到足够线索，先回到世界继续处理。",
  });
});
