import assert from "node:assert/strict";
import test from "node:test";
import { seedLife, stepLife, adjudicateLife } from "../world/life/kernel.js";
import { LifeRuntime } from "../world/life/runtime.js";
import { OpenGenerativePolicy } from "../cognition/policy/openGenerativePolicy.js";
import type { LifeModel } from "../world/life/model.js";
import type { LifeCommandV1 } from "../generated/lifeRuntimeTypes.js";
import { SchemaRegistry } from "../validation/schemas.js";
import { setupRuntime } from "./helpers.js";
import { acceptFeishuMessage, LifeOutboxWorker } from "../adapters/feishu.js";
import { connect } from "../state/db.js";
import { StateManager } from "../state/stateManager.js";
const AT = "2026-09-15T08:00:00.000Z";
const owner = "ou_test_owner";
const schemas = new SchemaRegistry("schemas");
const command = (
  primitive: LifeCommandV1["primitive"],
  target = "S-4",
  text = "",
): LifeCommandV1 => ({
  primitive,
  target,
  text,
  detail: "frozen test execution",
});
function fakeModel(
  next: LifeCommandV1 = command(
    "communicate",
    "doctor",
    "我刚在生态园看了 S-4 的记录。",
  ),
): LifeModel {
  return {
    modelId: "deepseek-v4-flash",
    async policy(ws, runId) {
      const policy = await new OpenGenerativePolicy(
        {
          generate: async () => ({
            policyRunId: runId,
            proposedAt: ws.assembled_at,
            draft: {
              action: {
                intent:
                  next.primitive === "communicate"
                    ? "把刚才在生态园的经历告诉博士"
                    : "观察 S-4",
                source_refs: ws.input_closure.source_refs,
              },
            },
          }),
        },
        schemas,
      ).propose(ws);
      return {
        policy,
        receipt: {
          schema_version: "1.0",
          receipt_id: `receipt:${runId}`,
          prompt_run_id: runId,
          provider_request_id: `provider:${runId}`,
          model_id: "deepseek-v4-flash",
          tokenizer_version: "deepseek.responses.usage.v1",
          input_tokens: 200,
          output_tokens: 50,
          cached_input_tokens: 0,
          reasoning_tokens: 0,
          attempt_ordinal: 1,
          completion_status: "completed",
          usage_source: "provider",
          received_at: ws.assembled_at,
        },
        finished: {
          runId,
          status: "validated",
          outputHash: "a".repeat(64),
          finishedAt: ws.assembled_at,
        },
      };
    },
    async compile() {
      return next;
    },
  };
}
const event = (id: string, text: string, sender = owner) => ({
  sender: { sender_type: "user", sender_id: { open_id: sender } },
  message: {
    message_id: id,
    message_type: "text",
    chat_type: "p2p",
    content: JSON.stringify({ text }),
  },
});

test("life kernel catches up identically to stepwise execution and conserves supplies", () => {
  const initial = seedLife(AT);
  const end = new Date(Date.parse(AT) + 72 * 3600000).toISOString();
  const offline = stepLife(initial, end);
  let online = initial;
  const changes = [];
  for (let i = 1; i <= 72; i++) {
    const r = stepLife(
      online,
      new Date(Date.parse(AT) + i * 3600000).toISOString(),
    );
    online = r.state;
    changes.push(...r.changes);
  }
  assert.deepEqual(online, offline.state);
  assert.deepEqual(changes, offline.changes);
  assert.ok(
    Math.abs(online.water + online.waterUsed - online.waterSupplied) < 1e-5,
  );
  assert.ok(
    Math.abs(online.energy + online.energyUsed - online.energySupplied) < 1e-5,
  );
  assert.deepEqual(stepLife(online, end).changes, []);
});
test("physical actions start before finishing; unmet constraints cannot change the world", () => {
  const initial = seedLife(AT);
  const started = adjudicateLife(
    initial,
    command("move", "office"),
    "回办公室",
    AT,
  );
  assert.equal(started.state.location, "garden");
  assert.ok(started.state.activity);
  assert.equal(
    stepLife(started.state, "2026-09-15T08:09:00.000Z").state.location,
    "garden",
  );
  const ended = stepLife(started.state, "2026-09-15T08:10:00.000Z");
  assert.equal(ended.state.location, "office");
  assert.deepEqual(
    adjudicateLife(ended.state, command("observe"), "查看 S-4", ended.state.at)
      .state,
    ended.state,
  );
  assert.equal(
    adjudicateLife(initial, command("capability_gap"), "去月球", AT).changes[0]
      .kind,
    "life.action.rejected",
  );
});
test("Feishu owner/private/text validation, durable duplicate ACK, and restart-persistent mute", () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    assert.equal(
      acceptFeishuMessage(
        event("m1", "你好", "ou_other"),
        owner,
        r.stateManager,
        AT,
      ),
      false,
    );
    assert.equal(
      acceptFeishuMessage(
        {
          ...event("m1", "你好"),
          message: { ...event("m1", "你好").message, chat_type: "group" },
        },
        owner,
        r.stateManager,
        AT,
      ),
      false,
    );
    assert.equal(
      acceptFeishuMessage(event("m1", "你好"), owner, r.stateManager, AT),
      true,
    );
    assert.equal(
      acceptFeishuMessage(event("m1", "你好"), owner, r.stateManager, AT),
      false,
    );
    acceptFeishuMessage(event("mute", "/mute"), owner, r.stateManager, AT);
    const restarted = new StateManager(() => connect(r.dbPath), schemas);
    assert.equal(restarted.lifeSnapshot()!.muted, true);
    assert.equal(
      (
        r.db
          .prepare(
            "SELECT count(*) n FROM life_event_queue q JOIN world_events e USING(event_id) WHERE e.origin='user'",
          )
          .get() as { n: number }
      ).n,
      1,
    );
  } finally {
    r.cleanup();
  }
});
test("no inbound message: committed world -> perception -> gate -> policy -> atomic speech/outbox -> receipt", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    const runtime = new LifeRuntime(
      r.db,
      r.stateManager,
      fakeModel(),
      owner,
      true,
    );
    await runtime.cycle(AT);
    const errors = r.db
      .prepare("SELECT * FROM life_event_queue WHERE last_error IS NOT NULL")
      .all();
    assert.deepEqual(errors, []);
    assert.equal(
      (
        r.db.prepare("SELECT count(*) n FROM life_episodes").get() as {
          n: number;
        }
      ).n,
      1,
    );
    assert.equal(
      (r.db.prepare("SELECT count(*) n FROM outbox").get() as { n: number }).n,
      1,
    );
    let sends = 0;
    const worker = new LifeOutboxWorker(r.stateManager, {
      async send() {
        sends++;
        return "om_test";
      },
    });
    assert.equal(await worker.dispatch(AT), true);
    assert.equal(await worker.dispatch(AT), false);
    assert.equal(sends, 1);
    assert.equal(
      (r.db.prepare("SELECT status FROM outbox").get() as { status: string })
        .status,
      "sent",
    );
    const audit = JSON.parse(
      (
        r.db.prepare("SELECT input_json FROM life_episodes").get() as {
          input_json: string;
        }
      ).input_json,
    );
    assert.doesNotMatch(
      JSON.stringify(audit),
      /max_expression|available|tokenizer|capacity_envelope/,
    );
  } finally {
    r.cleanup();
  }
});
test("mute blocks delivery and autonomous feature-off does not manufacture messages", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    const runtime = new LifeRuntime(
      r.db,
      r.stateManager,
      fakeModel(),
      owner,
      false,
    );
    await runtime.cycle(AT);
    assert.equal(
      (r.db.prepare("SELECT count(*) n FROM outbox").get() as { n: number }).n,
      0,
    );
    acceptFeishuMessage(event("u1", "在做什么？"), owner, r.stateManager, AT);
    await runtime.cycle(AT);
    assert.equal(
      (r.db.prepare("SELECT count(*) n FROM outbox").get() as { n: number }).n,
      1,
    );
    acceptFeishuMessage(event("mute2", "/mute"), owner, r.stateManager, AT);
    const worker = new LifeOutboxWorker(r.stateManager, {
      async send() {
        throw new Error("must not send");
      },
    });
    assert.equal(await worker.dispatch(AT), false);
  } finally {
    r.cleanup();
  }
});
test("failed model leaves inbound durable, no speech, and releases cognitive lease", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    const model = fakeModel();
    model.policy = async () => {
      throw new Error("provider unavailable");
    };
    acceptFeishuMessage(event("failure", "你好"), owner, r.stateManager, AT);
    await new LifeRuntime(r.db, r.stateManager, model, owner, true).cycle(AT);
    assert.equal(
      (r.db.prepare("SELECT count(*) n FROM outbox").get() as { n: number }).n,
      0,
    );
    assert.equal(
      r.stateManager.getCognitiveEnergyAccount("muelsyse")!.reserved,
      0,
    );
    assert.ok(
      r.db
        .prepare(
          "SELECT 1 FROM life_event_queue WHERE status='pending' AND last_error='cognition_failed'",
        )
        .get(),
    );
  } finally {
    r.cleanup();
  }
});
test("accumulated sensor signals retain legal source closure across calls", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    const runtime = new LifeRuntime(
      r.db,
      r.stateManager,
      fakeModel(command("wait")),
      owner,
      false,
    );
    await runtime.cycle(AT);
    for (let i = 1; i <= 7; i++) {
      const at = new Date(Date.parse(AT) + i * 3600000).toISOString();
      for (let j = 0; j < 5; j++) await runtime.cycle(at);
    }
    const errs = r.db
      .prepare("SELECT * FROM life_event_queue WHERE last_error IS NOT NULL")
      .all();
    assert.deepEqual(errs, []);
    assert.ok(
      (
        r.db.prepare("SELECT count(*) n FROM wake_decision_audit").get() as {
          n: number;
        }
      ).n > 2,
    );
  } finally {
    r.cleanup();
  }
});

test("crash after provider acceptance reuses the same delivery key; mute also blocks recovered sends", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    await new LifeRuntime(r.db, r.stateManager, fakeModel(), owner, true).cycle(
      AT,
    );
    const first = r.stateManager.claimLifeDelivery(AT)!;
    assert.ok(first);
    const provider = new Map<string, string>();
    provider.set(first.key, "om_once");
    // Simulate a process dying after remote success but before saving its receipt.
    const later = "2026-09-15T08:01:01.000Z";
    acceptFeishuMessage(
      event("mute-crash", "/mute"),
      owner,
      r.stateManager,
      later,
    );
    assert.equal(r.stateManager.claimLifeDelivery(later), null);
    acceptFeishuMessage(
      event("resume-crash", "/unmute"),
      owner,
      r.stateManager,
      later,
    );
    let attempts = 0;
    const worker = new LifeOutboxWorker(r.stateManager, {
      async send(_owner, _text, key) {
        attempts++;
        if (!provider.has(key)) provider.set(key, "unexpected_new");
        return provider.get(key)!;
      },
    });
    assert.equal(await worker.dispatch(later), true);
    assert.equal(provider.size, 1);
    assert.equal(attempts, 1);
    assert.equal(
      (
        r.db.prepare("SELECT provider_message_id FROM deliveries").get() as {
          provider_message_id: string;
        }
      ).provider_message_id,
      "om_once",
    );
  } finally {
    r.cleanup();
  }
});
test("uncertain old delivery stops instead of retrying beyond deduplication horizon", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    await new LifeRuntime(r.db, r.stateManager, fakeModel(), owner, true).cycle(
      AT,
    );
    assert.ok(r.stateManager.claimLifeDelivery(AT));
    assert.equal(
      r.stateManager.claimLifeDelivery("2026-09-15T09:00:00.000Z"),
      null,
    );
    assert.equal(
      (r.db.prepare("SELECT status FROM outbox").get() as { status: string })
        .status,
      "dead_letter",
    );
  } finally {
    r.cleanup();
  }
});
test("database recipient identity cannot change on restart", () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    r.stateManager.bindLifeOwner(owner, "cli_test");
    r.stateManager.bindLifeOwner(owner, "cli_test");
    assert.throws(
      () => r.stateManager.bindLifeOwner("ou_other", "cli_test"),
      /binding_mismatch/,
    );
  } finally {
    r.cleanup();
  }
});
test("stale open action cannot commit speech or consume physical resources", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    const model = fakeModel();
    const compile = model.compile;
    model.compile = async (p, w) => {
      r.stateManager.advanceLife("2026-09-15T10:00:00.000Z");
      return compile(p, w);
    };
    await new LifeRuntime(r.db, r.stateManager, model, owner, true).cycle(AT);
    assert.equal(
      (r.db.prepare("SELECT count(*) n FROM outbox").get() as { n: number }).n,
      0,
    );
    assert.ok(
      r.db
        .prepare(
          "SELECT 1 FROM life_event_queue WHERE last_error='cognition_failed'",
        )
        .get(),
    );
  } finally {
    r.cleanup();
  }
});

test("real provider adapter is wired through policy validation, energy settlement and compilation", async () => {
  const { DeepSeekLifeModel } = await import("../world/life/model.js");
  const r = setupRuntime();
  const at = new Date().toISOString();
  let calls = 0;
  try {
    r.stateManager.initializeLife(at);
    const mockFetch: typeof fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "deepseek-v4-flash");
      assert.ok(body.max_output_tokens <= 2048);
      const input = JSON.parse(body.input[1].content);
      const output =
        calls === 1
          ? {
              action: {
                intent: "将生态园的情况告诉博士",
                source_refs: input.input_closure.source_refs,
              },
            }
          : {
              primitive: "communicate",
              target: "doctor",
              detail: "Explicit communication intent",
              text: "我刚在生态园。",
            };
      if (calls === 1)
        assert.doesNotMatch(
          body.input[1].content,
          /available|max_semantic_input_units|tokenizer_version/,
        );
      return new Response(
        JSON.stringify({
          id: `mock:${calls}`,
          model: "deepseek-v4-flash",
          output_text: JSON.stringify(output),
          usage: {
            input_tokens: 200,
            output_tokens: 80,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    await new LifeRuntime(
      r.db,
      r.stateManager,
      new DeepSeekLifeModel("test-key", schemas, r.stateManager, mockFetch),
      owner,
      true,
    ).cycle(at);
    assert.equal(calls, 2);
    assert.deepEqual(
      r.db
        .prepare("SELECT * FROM life_event_queue WHERE last_error IS NOT NULL")
        .all(),
      [],
    );
    assert.equal(
      (r.db.prepare("SELECT count(*) n FROM outbox").get() as { n: number }).n,
      1,
    );
    assert.equal(
      r.stateManager.getCognitiveEnergyAccount("muelsyse")!.reserved,
      0,
    );
    assert.equal(
      (
        r.db.prepare("SELECT count(*) n FROM life_model_attempts").get() as {
          n: number;
        }
      ).n,
      2,
    );
  } finally {
    r.cleanup();
  }
});
