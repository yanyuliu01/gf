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

for (const returnedModel of ["deepseek-v4-flash", "deepseek-flash", "unknown-model"]) {
test(`real provider lifecycle handles response model ${returnedModel}`, async () => {
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
              command: {
                primitive: "communicate", target: "doctor",
                detail: "Explicit communication intent", text: "我刚在生态园。",
              },
              action_quote: "将生态园的情况告诉博士", target_quote: "博士",
            };
      if (calls === 1)
        assert.doesNotMatch(
          body.input[1].content,
          /available|max_semantic_input_units|tokenizer_version/,
        );
      return new Response(
        JSON.stringify({
          id: `mock:${calls}`,
          model: returnedModel,
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
    assert.equal((r.db.prepare("SELECT model_id FROM inference_usage_receipts LIMIT 1").get() as {model_id: string}).model_id, returnedModel);
    if (returnedModel === "unknown-model") {
      assert.equal(calls, 1);
      assert.equal((r.db.prepare("SELECT count(*) n FROM outbox").get() as {n: number}).n, 0);
      assert.equal(r.stateManager.getCognitiveEnergyAccount("muelsyse")!.reserved, 0);
      assert.ok(r.db.prepare("SELECT 1 FROM life_event_queue WHERE last_error='cognition_failed'").get());
      return;
    }
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

}

test("pending messages form one attributed batch; late arrivals remain queued", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    for (const [id, text] of [["batch1", "你在做什么？"], ["batch2", "有点急正在调试系统"], ["batch3", "看看回复一下？"]])
      acceptFeishuMessage(event(id, text), owner, r.stateManager, AT);
    const model = fakeModel();
    const original = model.policy;
    model.policy = async (ws, run, max) => {
      const current = ws.evidence.filter((e) => e.role === "current_input");
      assert.equal(current.length, 3);
      assert.ok(current.every((e) => e.narrative.includes("博士 → 缪尔赛思") && e.narrative.includes("博士原话")));
      assert.match(current.map((e) => e.narrative).join("\n"), /有点急正在调试系统/);
      // A message arrives while an actual model request would be in flight.
      acceptFeishuMessage(event("late", "还有一件事"), owner, r.stateManager, AT);
      return original(ws, run, max);
    };
    await new LifeRuntime(r.db, r.stateManager, model, owner, false).cycle(AT);
    const queue = r.db.prepare("SELECT q.status,e.payload_json FROM life_event_queue q JOIN world_events e USING(event_id) WHERE e.origin='user'").all() as {status:string;payload_json:string}[];
    assert.equal(queue.filter((q) => q.status === "done").length, 3);
    assert.equal(queue.filter((q) => q.status === "pending").length, 1);
    assert.match(queue.find((q) => q.status === "pending")!.payload_json, /还有一件事/);
    assert.equal((r.db.prepare("SELECT count(*) n FROM outbox").get() as {n:number}).n, 1);
    const result = JSON.parse((r.db.prepare("SELECT result_json FROM life_episodes").get() as {result_json:string}).result_json);
    assert.equal(result.consumed_event_ids.length, 3);
  } finally { r.cleanup(); }
});

test("failed batch remains pending together and retries as a single episode", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    acceptFeishuMessage(event("f1", "你好"), owner, r.stateManager, AT);
    acceptFeishuMessage(event("f2", "在吗"), owner, r.stateManager, AT);
    const model = fakeModel();
    model.compile = async () => { throw new Error("compiler unavailable"); };
    await new LifeRuntime(r.db, r.stateManager, model, owner, false).cycle(AT);
    const q = r.db.prepare("SELECT q.* FROM life_event_queue q JOIN world_events e USING(event_id) WHERE e.origin='user'").all() as {status:string;attempts:number}[];
    assert.ok(q.every((r) => r.status === "pending" && r.attempts === 1));
    assert.equal((r.db.prepare("SELECT count(*) n FROM outbox").get() as {n:number}).n, 0);
    await new LifeRuntime(r.db, r.stateManager, fakeModel(), owner, false).cycle("2026-09-15T08:01:01.000Z");
    assert.equal((r.db.prepare("SELECT count(*) n FROM outbox").get() as {n:number}).n, 1);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_event_queue q JOIN world_events e USING(event_id) WHERE e.origin='user' AND q.status='pending'").get() as {n:number}).n, 0);
  } finally { r.cleanup(); }
});

test("next input sees self speech before its queued event is consumed, and sees delivery separately", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    acceptFeishuMessage(event("h1", "你好"), owner, r.stateManager, AT);
    await new LifeRuntime(r.db, r.stateManager, fakeModel(), owner, false).cycle(AT);
    // Deliberately leave speech-event pending behind the next user input.
    const worker = new LifeOutboxWorker(r.stateManager, { async send() { return "receipt-visible"; } });
    await worker.dispatch(AT);
    acceptFeishuMessage(event("h2", "然后呢？"), owner, r.stateManager, AT);
    const model = fakeModel(command("wait"));
    const original = model.policy;
    model.policy = async (ws, run, max) => {
      const all = ws.evidence.map((e) => e.narrative).join("\n");
      assert.match(all, /我刚在生态园看了 S-4 的记录/);
      assert.match(all, /已进入发送队列，尚未确认送达/);
      assert.match(all, /已确认消息送达；不代表博士已读/);
      assert.ok(ws.evidence.some((e) => e.source_refs.some((r) => r.source_id.startsWith("speech-event:"))));
      return original(ws, run, max);
    };
    await new LifeRuntime(r.db, r.stateManager, model, owner, false).cycle(AT);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_episodes").get() as {n:number}).n, 2);
  } finally { r.cleanup(); }
});

test("legacy bare observations regain speaker attribution from original message", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    acceptFeishuMessage(event("legacy", "有点急正在调试系统"), owner, r.stateManager, AT);
    await new LifeRuntime(r.db, r.stateManager, fakeModel(command("wait")), owner, false).cycle(AT);
    // Simulate pre-fix persisted observations without touching the source event.
    r.db.prepare("UPDATE observations SET payload_json=json_set(payload_json,'$.summary',?) WHERE json_extract(payload_json,'$.sensing_basis')='message'").run("有点急正在调试系统");
    acceptFeishuMessage(event("after", "你呢？"), owner, r.stateManager, AT);
    const model = fakeModel(command("wait")); const original = model.policy;
    model.policy = async (ws, run, max) => {
      const past = ws.evidence.find((e) => e.role !== "current_input" && e.narrative.includes("有点急正在调试系统"));
      assert.ok(past); assert.match(past.narrative, /博士原话/);
      return original(ws, run, max);
    };
    await new LifeRuntime(r.db, r.stateManager, model, owner, false).cycle(AT);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_episodes").get() as {n:number}).n, 2);
  } finally { r.cleanup(); }
});

test("stats alias produces a system response and never enters the cognitive queue", () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    acceptFeishuMessage(event("stats", "/stats"), owner, r.stateManager, AT);
    const row = r.db.prepare("SELECT origin,kind FROM world_events WHERE external_event_id='stats'").get();
    assert.equal(row?.origin, "admin");
    assert.match(String(r.db.prepare("SELECT content FROM speech_records").get()?.content), /系统状态/);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_event_queue q JOIN world_events e USING(event_id) WHERE e.external_event_id='stats'").get() as {n:number}).n, 0);
  } finally { r.cleanup(); }
});

test("compiler cannot borrow S-4 from background or a later plan step to replace reading messages", async () => {
  const { groundLifeCompilation } = await import("../world/life/compilation.js");
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    const model = fakeModel(); const original = model.policy;
    model.policy = async (ws, run, max) => {
      const result = await original(ws, run, max);
      const policy = structuredClone(result.policy);
      policy.action.intent = "回读博士的消息，然后观察 S-4";
      policy.action.plan = ["回读博士的消息", "观察 S-4"];
      assert.equal(groundLifeCompilation({command:command("observe"),action_quote:"回读博士的消息",target_quote:"S-4"},policy).primitive,"capability_gap");
      assert.equal(groundLifeCompilation({command:command("observe"),action_quote:"观察 S-4",target_quote:"S-4"},policy).primitive,"capability_gap");
      policy.action.plan = ["观察 S-4"];
      assert.equal(groundLifeCompilation({command:command("observe"),action_quote:"观察 S-4",target_quote:"S-4"},policy).primitive,"observe");
      return result;
    };
    await new LifeRuntime(r.db,r.stateManager,model,owner,false).cycle(AT);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_episodes").get() as {n:number}).n,1);
  } finally { r.cleanup(); }
});

test("batch limit leaves excess inputs durable and a world wake sees prior speech", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    for (let i = 0; i < 9; i++) acceptFeishuMessage(event(`bounded${i}`, `消息${i}`), owner, r.stateManager, AT);
    const runtime = new LifeRuntime(r.db,r.stateManager,fakeModel(),owner,false);
    await runtime.cycle(AT);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_event_queue q JOIN world_events e USING(event_id) WHERE e.origin='user' AND q.status='pending'").get() as {n:number}).n,1);
    await runtime.cycle(AT);
    const model = fakeModel(command("wait")); const original=model.policy;
    model.policy=async (ws,run,max) => {
      assert.ok(ws.evidence.some((e)=>e.narrative.includes("缪尔赛思 → 博士，自身发言")));
      assert.ok(!ws.evidence.some((e)=>e.role==="current_input"));
      return original(ws,run,max);
    };
    await new LifeRuntime(r.db,r.stateManager,model,owner,false).cycle(AT);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_episodes").get() as {n:number}).n,3);
  } finally {r.cleanup();}
});

test("StateManager rejects consuming a message that was not in the frozen input", async () => {
  const r=setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    acceptFeishuMessage(event("known","你好"),owner,r.stateManager,AT);
    const model=fakeModel(); const original=model.compile;
    model.compile=async (policy,ws)=>{
      acceptFeishuMessage(event("unseen","新消息"),owner,r.stateManager,AT);
      const id=String(r.db.prepare("SELECT event_id FROM world_events WHERE external_event_id='unseen'").get()!.event_id);
      const trigger=ws.evidence.find((e)=>e.role==="current_input")!.source_refs.find((s)=>s.source_type==="event")!.source_id;
      const compiled=await original(policy,ws);
      assert.throws(()=>r.stateManager.completeLifeEpisode({
        episodeId:ws.episode_id,trigger,consumedEventIds:[trigger,id],
        baseRevision:ws.input_closure.base_state_revision,workingSelf:ws,policy,command:compiled,owner,at:AT,proactive:false,
      }), /life_unseen_or_consumed_input/);
      assert.equal((r.db.prepare("SELECT count(*) n FROM outbox").get() as {n:number}).n,0);
      return compiled;
    };
    await new LifeRuntime(r.db,r.stateManager,model,owner,false).cycle(AT);
    assert.equal((r.db.prepare("SELECT count(*) n FROM outbox").get() as {n:number}).n,1);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_event_queue q JOIN world_events e USING(event_id) WHERE e.origin='user' AND q.status='pending'").get() as {n:number}).n,1);
  } finally {r.cleanup();}
});

test("Feishu reconnect preserves original send time and duplicate IDs never requeue", async () => {
  const r = setupRuntime();
  const received = "2026-09-15T10:00:00.000Z";
  try {
    r.stateManager.initializeLife(AT);
    const input = event("replayed", "刚才问过了");
    input.message = { ...input.message, create_time: String(Date.parse(AT)) } as typeof input.message;
    assert.equal(acceptFeishuMessage(input, owner, r.stateManager, received), true);
    const row = r.db.prepare("SELECT occurred_at,received_at FROM world_events WHERE external_event_id='replayed'").get();
    assert.equal(row?.occurred_at, AT);
    assert.equal(row?.received_at, received);
    await new LifeRuntime(r.db, r.stateManager, fakeModel(), owner, false).cycle(received);
    const restarted = new StateManager(() => connect(r.dbPath), schemas);
    assert.equal(acceptFeishuMessage(input, owner, restarted, "2026-09-15T12:00:00.000Z"), false);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_event_queue q JOIN world_events e USING(event_id) WHERE e.origin='user' AND q.status='pending'").get() as {n:number}).n, 0);
    assert.equal((r.db.prepare("SELECT count(*) n FROM outbox").get() as {n:number}).n, 1);
  } finally { r.cleanup(); }
});

test("restart wake distinguishes old input and self speech from the current world trigger", async () => {
  const r=setupRuntime(); const later="2026-09-15T12:00:00.000Z";
  try {
    r.stateManager.initializeLife(AT);
    acceptFeishuMessage(event("old-question","老板安排了无聊的活，你呢？"),owner,r.stateManager,AT);
    await new LifeRuntime(r.db,r.stateManager,fakeModel(),owner,false).cycle(AT);
    const restarted = new StateManager(() => connect(r.dbPath),schemas);
    const model=fakeModel(command("wait")); const original=model.policy;
    let checked=false;
    model.policy=async(ws,run,max)=>{
      checked=true;
      assert.equal(ws.assembled_at,later);
      assert.ok(!ws.evidence.some((e)=>e.role==="current_input"));
      const old=ws.evidence.find((e)=>e.narrative.includes("老板安排了无聊的活"));
      assert.ok(old); assert.equal(old.as_of,AT);
      assert.match(old.narrative,/【历史背景】/);assert.match(old.narrative,/4 小时/);
      const speech=ws.evidence.find((e)=>e.source_refs.some((s)=>s.source_id.startsWith("speech-event:")));
      assert.ok(speech);assert.equal(speech.as_of,AT);assert.match(speech.narrative,/【发言历史】/);
      const trigger=ws.evidence.find((e)=>e.narrative.startsWith("【本次触发】"));
      assert.ok(trigger);assert.match(trigger.narrative,/原事件发生于/);
      return original(ws,run,max);
    };
    await new LifeRuntime(r.db,restarted,model,owner,false).cycle(later);
    assert.ok(checked);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_episodes").get() as {n:number}).n,2);
    assert.equal((r.db.prepare("SELECT count(*) n FROM outbox").get() as {n:number}).n,1);
  } finally {r.cleanup();}
});

test("re-observing an old source many times cannot refresh its event time or crowd out distinct memories",async()=>{
  const { PerceptionProjector }=await import("../cognition/perception/perceptionProjector.js");
  const r=setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    acceptFeishuMessage(event("old-source","早上八点的事"),owner,r.stateManager,AT);
    await new LifeRuntime(r.db,r.stateManager,fakeModel(command("wait")),owner,false).cycle(AT);
    const next="2026-09-15T09:00:00.000Z";
    acceptFeishuMessage(event("newer-source","九点有新的情况"),owner,r.stateManager,next);
    await new LifeRuntime(r.db,r.stateManager,fakeModel(command("wait")),owner,false).cycle(next);
    const sourceId=String(r.db.prepare("SELECT event_id FROM world_events WHERE external_event_id='old-source'").get()!.event_id);
    const revision=r.stateManager.lifeSnapshot()!.revision;
    for(let i=0;i<30;i++) {
      const projection=new PerceptionProjector().project({
        actor_id:"muelsyse",actor_location_id:"garden",private_channel_ids:["private_im"],public_channel_ids:[],device_feed_ids:[],authorized_record_ids:[],
        projected_at:new Date(Date.parse(next)+60000+i*1000).toISOString(),projection_version:"test-reprojection.v1",base_state_revision:revision,
        candidates:[{summary:"早上八点的事",occurred_at:AT,privacy_scope:"private_im",
          source_refs:[{source_type:"event",source_id:sourceId},{source_type:"message",source_id:sourceId}],
          provenance:{kind:"message",principal_id:owner,trust:"authenticated"},visibility:{kind:"direct_message",channel_id:"private_im",recipient_actor_ids:["muelsyse"]}}],
      });
      r.stateManager.submitCognitiveArtifacts({observations:[...projection.observations]},{inputSources:projection.source_refs});
    }
    const later="2026-09-15T10:00:00.000Z";
    acceptFeishuMessage(event("latest","现在聊另一件事"),owner,r.stateManager,later);
    const model=fakeModel(command("wait"));const original=model.policy;
    model.policy=async(ws,run,max)=>{
      const memory=ws.evidence.filter((e)=>e.role!=="current_input");
      const old=memory.filter((e)=>e.narrative.includes("早上八点的事"));
      const newer=memory.filter((e)=>e.narrative.includes("九点有新的情况"));
      assert.equal(old.length,1);assert.equal(newer.length,1);
      assert.equal(old[0].as_of,AT);assert.equal(newer[0].as_of,next);

      return original(ws,run,max);
    };
    await new LifeRuntime(r.db,r.stateManager,model,owner,false).cycle(later);
    assert.equal((r.db.prepare("SELECT count(*) n FROM life_episodes").get() as {n:number}).n,3);
  } finally {r.cleanup();}
});

test("event ages preserve dates across midnight without treating old relative wording as now",async()=>{
  const {eventTimeContext}=await import("../world/life/timeContext.js");
  assert.match(eventTimeContext("2026-09-15T23:59:00.000Z","2026-09-16T00:01:00.000Z"),/已过 2 分钟/);
  assert.match(eventTimeContext(AT,"2026-09-17T09:00:00.000Z"),/已过 2 天 1 小时/);
  assert.match(eventTimeContext("2026-09-15T09:00:00.000Z",AT),/时间有冲突/);
});

test("native dialogue survives restart with exact roles and excludes arrivals during inference", async () => {
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    acceptFeishuMessage(event("native-old", "第一句话\n不要改我的原文"), owner, r.stateManager, AT);
    await new LifeRuntime(r.db,r.stateManager,fakeModel(command("communicate","doctor","嗯，看到了")),owner,false).cycle(AT);
    acceptFeishuMessage(event("native-new", "第二句话"), owner, r.stateManager, "2026-09-15T08:01:00.000Z");
    const model = fakeModel(command("wait")); const original = model.policy;
    let checked = false;
    model.policy = async (ws,run,max,conversation) => {
      checked = true;
      acceptFeishuMessage(event("native-later", "生成途中到达"),owner,r.stateManager,"2026-09-15T08:02:00.000Z");
      assert.deepEqual(conversation?.map(i => [i.role,i.content,i.current]), [
        ["user","第一句话\n不要改我的原文",false], ["assistant","嗯，看到了",false], ["user","第二句话",true],
      ]);
      assert.ok(conversation?.every(i=>ws.input_closure.source_refs.some(s=>s.source_id===i.eventId)));
      return original(ws,run,max);
    };
    const restarted = new StateManager(() => connect(r.dbPath),schemas);
    await new LifeRuntime(r.db,restarted,model,owner,false).cycle("2026-09-15T08:01:00.000Z");
    assert.ok(checked);
    assert.equal(r.db.prepare("SELECT count(*) n FROM life_episodes").get()?.n,2);
    assert.equal(r.db.prepare("SELECT count(*) n FROM life_event_queue q JOIN world_events e USING(event_id) WHERE e.origin='user' AND q.status='pending'").get()?.n,1);
  } finally {r.cleanup();}
});

test("provider receives native roles and world wakes end at a non-user turn boundary", async () => {
  const { DeepSeekLifeModel } = await import("../world/life/model.js");
  const r = setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    acceptFeishuMessage(event("wire-old","旧问题"),owner,r.stateManager,AT);
    await new LifeRuntime(r.db,r.stateManager,fakeModel(command("communicate","doctor","已经接过这句话")),owner,false).cycle(AT);
    let calls = 0;
    const mock: typeof fetch = async (_url,init) => {
      const body = JSON.parse(String(init?.body)); calls++;
      assert.deepEqual(body.input.slice(2,-2).map((m:{role:string;content:string})=>[m.role,m.content]),[
        ["user","旧问题"],["assistant","已经接过这句话"],
      ]);
      assert.equal(body.input.at(-1).role,"system");
      assert.match(body.input.at(-1).content,/本次调用的输出任务/);
      const boundary = JSON.parse(body.input.at(-2).content);
      assert.equal(boundary.trigger,"world_event");
      assert.deepEqual(boundary.current_input_ids,[]);
      assert.ok(!body.input[1].content.includes("旧问题"));
      const input = JSON.parse(body.input[1].content);
      const output = calls === 1 ? {action:{intent:"暂时等待",source_refs:input.input_closure.source_refs}}
        : {command:command("wait"),action_quote:"暂时等待",target_quote:""};
      return new Response(JSON.stringify({id:`native:${calls}`,model:"deepseek-v4-flash",output_text:JSON.stringify(output),
        usage:{input_tokens:200,output_tokens:80,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}),
        {status:200,headers:{"Content-Type":"application/json"}});
    };
    await new LifeRuntime(r.db,r.stateManager,new DeepSeekLifeModel("test",schemas,r.stateManager,mock),owner,false).cycle("2026-09-15T08:01:00.000Z");
    assert.equal(calls,2);
    assert.equal(r.db.prepare("SELECT count(*) n FROM life_episodes").get()?.n,2);
    assert.equal(r.db.prepare("SELECT count(*) n FROM outbox").get()?.n,1);
  } finally {r.cleanup();}
});

test("plain chat failure is persisted precisely and never sent as a fallback", async () => {
  const {DeepSeekLifeModel}=await import("../world/life/model.js");
  const r=setupRuntime();
  try {
    r.stateManager.initializeLife(AT);
    acceptFeishuMessage(event("plain-output","你下班了吗？"),owner,r.stateManager,AT);
    let requests=0;
    const mock:typeof fetch=async(_url,init)=>{
      requests++;
      const body=JSON.parse(String(init?.body));
      assert.equal(body.input.at(-1).role,"system");
      assert.match(body.input.at(-1).content,/单个 JSON 对象/);
      assert.equal(body.input.at(-2).content,"你下班了吗？");
      return new Response(JSON.stringify({status:"completed",model:"deepseek-v4-flash",output_text:"还没呢，灯还亮着。",
        usage:{input_tokens:40,output_tokens:12,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}),{status:200});
    };
    await new LifeRuntime(r.db,r.stateManager,new DeepSeekLifeModel("test",schemas,r.stateManager,mock),owner,false).cycle(AT);
    assert.equal(requests,1);
    const attempt=r.db.prepare("SELECT error_code,output_json FROM life_model_attempts").get()!;
    assert.equal(attempt.error_code,"invalid_json");
    assert.equal(JSON.parse(String(attempt.output_json)).failure.diagnostic.outputText,"还没呢，灯还亮着。");
    assert.equal(r.db.prepare("SELECT count(*) n FROM outbox").get()?.n,0);
    assert.equal(r.db.prepare("SELECT status FROM life_event_queue q JOIN world_events e USING(event_id) WHERE e.origin='user'").get()?.status,"pending");
  } finally {r.cleanup();}
});
