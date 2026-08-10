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
          intent: "先检查 S-4 所在区域的灌溉压力，不直接下结论。",
          execution: {
            primitive: "observe",
            target: "S-4",
            aspect: "irrigation-pressure",
          },
        },
      };
    }

    if (this.inputs.length === 2) {
      return {
        kind: "act",
        action: {
          intent: "再看一下根区含水状态，确认低压力是否已经影响到植株。",
          execution: {
            primitive: "observe",
            target: "S-4",
            aspect: "root-zone-moisture",
          },
        },
      };
    }

    return {
      kind: "yield",
      reason: "已经拿到两条相互支持的现场证据，先结束这次认知。",
    };
  }
}

test("S-4 hidden world state stays outside cognition while agent controls a multi-step episode", async () => {
  const policy = new CapturingPolicy();
  const loop = new S4AttentionLoop({
    policy,
    initialWorld: {
      currentActivity: "ecology-garden routine work",
      pumpPressure: "normal",
      rootZoneMoisture: "normal",
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

  assert.equal(policy.inputs.length, 3);

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
  assert.equal(firstSerialized.includes("rootZoneMoisture"), false);
  assert.equal(firstSerialized.includes("evt_pump_low"), false);

  assert.equal(visible.episodeHistory.length, 2);

  const irrigationStep = visible.episodeHistory[0];
  assert.deepEqual(irrigationStep.action.execution, {
    primitive: "observe",
    target: "S-4",
    aspect: "irrigation-pressure",
  });
  assert.deepEqual(irrigationStep.outcome.newObservations, [
    {
      sourceEventId: irrigationStep.outcome.outcomeEventId,
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
  assert.equal(JSON.stringify(secondInput).includes("evt_pump_low"), false);

  const rootZoneStep = visible.episodeHistory[1];
  assert.deepEqual(rootZoneStep.action.execution, {
    primitive: "observe",
    target: "S-4",
    aspect: "root-zone-moisture",
  });
  assert.deepEqual(rootZoneStep.outcome.newObservations, [
    {
      sourceEventId: rootZoneStep.outcome.outcomeEventId,
      observedAt: "2026-08-10T13:20:00+08:00",
      text: "检查后发现 S-4 根区含水明显偏低。",
    },
  ]);

  const thirdInput = policy.inputs[2];
  assert.equal(thirdInput.observations.length, 3);
  assert.equal(
    thirdInput.observations[2].text,
    "检查后发现 S-4 根区含水明显偏低。",
  );
  assert.equal(JSON.stringify(thirdInput).includes("rootZoneMoisture"), false);
  assert.equal(JSON.stringify(thirdInput).includes("evt_pump_low"), false);

  assert.deepEqual(visible.end, {
    kind: "agent_yield",
    reason: "已经拿到两条相互支持的现场证据，先结束这次认知。",
  });
});
