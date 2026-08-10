import { test } from "node:test";
import assert from "node:assert/strict";
import {
  S4AttentionLoop,
  type S4OpenAction,
  type S4PolicyClient,
  type S4PolicyInput,
} from "../vertical-slices/s4AttentionLoop.js";

class CapturingPolicy implements S4PolicyClient {
  readonly inputs: S4PolicyInput[] = [];

  async decide(input: S4PolicyInput): Promise<S4OpenAction> {
    this.inputs.push(input);
    return {
      kind: "inspect",
      target: "S-4",
      focus: "irrigation",
      intent: "检查 S-4 的灌溉和根区状态，先不要下结论。",
    };
  }
}

test("S-4 hidden world change stays outside cognition until a visible attended anomaly appears", async () => {
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
  assert.equal(hidden.reason, "not_perceived");
  assert.equal(policy.inputs.length, 0);

  const visible = await loop.process({
    eventId: "evt_s4_wilted",
    occurredAt: "2026-08-10T13:20:00+08:00",
    kind: "s4_wilted",
    visibility: "observable",
  });

  assert.equal(visible.kind, "cognitive");
  assert.equal(policy.inputs.length, 1);

  const policyInput = policy.inputs[0];
  assert.equal(policyInput.currentActivity, "ecology-garden routine work");
  assert.equal(policyInput.attention.subject, "S-4");
  assert.deepEqual(policyInput.observations, [
    {
      sourceEventId: "evt_s4_wilted",
      observedAt: "2026-08-10T13:20:00+08:00",
      text: "S-4 出现持续萎蔫。",
    },
  ]);

  const serializedInput = JSON.stringify(policyInput);
  assert.equal(serializedInput.includes("pumpPressure"), false);
  assert.equal(serializedInput.includes("pump_pressure"), false);
  assert.equal(serializedInput.includes("evt_pump_low"), false);

  assert.deepEqual(visible.action, {
    kind: "inspect",
    target: "S-4",
    focus: "irrigation",
    intent: "检查 S-4 的灌溉和根区状态，先不要下结论。",
  });
  assert.deepEqual(visible.outcome.newObservations, [
    {
      sourceEventId: visible.outcome.outcomeEventId,
      observedAt: "2026-08-10T13:20:00+08:00",
      text: "检查后发现 S-4 所在区域的灌溉压力偏低。",
    },
  ]);
});
