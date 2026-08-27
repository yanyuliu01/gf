import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorldEvent } from "../state/stateManager.js";
import { setupRuntime, tickProposal, userEvent } from "./helpers.js";

test("migration creates schema and seeds runtime revision + capability", () => {
  const rt = setupRuntime();
  try {
    assert.equal(rt.state.currentRevision(), 0);
    const capability = rt.state.latestCapabilitySnapshot();
    assert.equal(capability.revision, 0);
    assert.equal(capability.transport.text, true);
    assert.equal(capability.diegetic.image, false);
    assert.equal(rt.events.count(), 0);
  } finally {
    rt.cleanup();
  }
});

test("event ingest is idempotent by idempotency_key", () => {
  const rt = setupRuntime();
  try {
    const event = userEvent("今天好累");
    const first = rt.stateManager.ingestEvent(event);
    assert.equal(first.inserted, true);
    const second = rt.stateManager.ingestEvent(event);
    assert.equal(second.inserted, false);
    assert.equal(second.replay, true);
    assert.equal(rt.events.count(), 1);
  } finally {
    rt.cleanup();
  }
});

test("tick commit bumps revision exactly once and replays idempotently", () => {
  const rt = setupRuntime();
  try {
    const event = userEvent("世界里的一个冲动", { origin: "impulse" });
    rt.stateManager.ingestEvent(event);
    const proposal = tickProposal(event.event_id, 0);
    const result = rt.stateManager.submitOperation("tick", proposal, {
      triggerEvent: event,
    });
    assert.equal(result.committed, true);
    assert.equal(result.committedRevision, 1);
    assert.equal(rt.state.currentRevision(), 1);

    const replay = rt.stateManager.submitOperation("tick", proposal, {
      triggerEvent: event,
    });
    assert.equal(replay.committed, false);
    assert.equal(replay.replay, true);
    assert.equal(rt.state.currentRevision(), 1);
  } finally {
    rt.cleanup();
  }
});

test("stale base_state_revision is rejected", () => {
  const rt = setupRuntime();
  try {
    const event = userEvent("触发");
    rt.stateManager.ingestEvent(event);
    const ok = rt.stateManager.submitOperation(
      "tick",
      tickProposal(event.event_id, 0),
      { triggerEvent: event },
    );
    assert.equal(ok.committed, true);
    const stale = tickProposal(event.event_id, 0);
    stale.base_state_revision = 5;
    assert.throws(
      () =>
        rt.stateManager.submitOperation("tick", stale, {
          triggerEvent: event,
        }),
      /stale base_state_revision/,
    );
    assert.equal(rt.state.currentRevision(), 1);
  } finally {
    rt.cleanup();
  }
});

test("crossworld: terra_effect without user report or verified system evidence is rejected", () => {
  const rt = setupRuntime();
  try {
    const event = userEvent("随便聊一句");
    rt.stateManager.ingestEvent(event);
    const proposal = tickProposal(event.event_id, 0);
    proposal.claims = [
      {
        claim_id: "clm_bad",
        scope: "terra",
        kind: "terra_effect",
        text: "罗德岛的战斗胜利了",
        epistemic_status: "verified",
        lands_in_terra: true,
        privacy_scope: "private_im",
        source_refs: [{ source_type: "event", source_id: "evt_unknown" }],
        causal_action_ref: {
          source_type: "event",
          source_id: "evt_unknown",
        },
      },
    ];
    assert.throws(
      () =>
        rt.stateManager.submitOperation("tick", proposal, {
          triggerEvent: event,
        }),
      /outside legal closure|lands_in_terra/,
    );
    assert.equal(rt.state.currentRevision(), 0);
  } finally {
    rt.cleanup();
  }
});

test("crossworld: doctor_attestation with explicit user report commits", () => {
  const rt = setupRuntime();
  try {
    const event = userEvent("我刚在游戏里把那场任务收尾了");
    rt.stateManager.ingestEvent(event);
    const message = rt.db
      .prepare("SELECT message_id FROM messages WHERE event_id = ?")
      .get(event.event_id) as { message_id: string };
    const proposal = tickProposal(event.event_id, 0);
    proposal.claims = [
      {
        claim_id: "clm_ok",
        scope: "terra",
        kind: "doctor_attestation",
        text: "博士报告完成了该场任务",
        epistemic_status: "attested",
        lands_in_terra: true,
        privacy_scope: "private_im",
        source_refs: [{ source_type: "message", source_id: message.message_id }],
        causal_action_ref: {
          source_type: "event",
          source_id: event.event_id,
        },
      },
    ];
    const result = rt.stateManager.submitOperation("tick", proposal, {
      triggerEvent: event,
      inputSources: [
        { source_type: "message", source_id: message.message_id },
      ],
    });
    assert.equal(result.committed, true);
    const claim = rt.db
      .prepare("SELECT * FROM claims WHERE claim_id = ?")
      .get("clm_ok") as { lands_in_terra: number };
    assert.equal(claim.lands_in_terra, 1);
  } finally {
    rt.cleanup();
  }
});

test("invalid patch path is rejected atomically", () => {
  const rt = setupRuntime();
  try {
    const event = userEvent("触发");
    rt.stateManager.ingestEvent(event);
    const proposal = tickProposal(event.event_id, 0);
    proposal.patch_ops = [
      {
        op_id: "op_bad",
        target: "world_state",
        path: "evil.unlisted_field",
        op: "replace",
        value: true,
        source_refs: [{ source_type: "event", source_id: event.event_id }],
        cause_event_ids: [event.event_id],
        expected_state_revision: 0,
      },
    ];
    assert.throws(
      () =>
        rt.stateManager.submitOperation("tick", proposal, {
          triggerEvent: event,
        }),
      /not in allowed world_state paths/,
    );
    assert.equal(rt.state.currentRevision(), 0);
    const ops = rt.db
      .prepare("SELECT COUNT(*) AS n FROM operation_commits")
      .get() as { n: number };
    assert.equal(ops.n, 0);
  } finally {
    rt.cleanup();
  }
});

test("reply commit requires the surface-message contract", () => {
  const rt = setupRuntime();
  try {
    const event = userEvent("在吗");
    rt.stateManager.ingestEvent(event);
    const scene = rt.scenes.createOpenScene();
    const speech = {
      schema_version: "1.0",
      speech_id: "sp_missing_authz",
      operation_id: "op_missing_authz",
      channel: "private_im",
      recipient_principal_id: "doctor",
      privacy_scope: "private_im",
      capability_revision: 0,
      // authorization_decision_id intentionally omitted
      source_refs: [
        {
          source_type: "message",
          source_id: (
            rt.db
              .prepare("SELECT message_id FROM messages WHERE event_id = ?")
              .get(event.event_id) as { message_id: string }
          ).message_id,
        },
      ],
      bubbles: ["缺少授权字段"],
    };
    assert.throws(
      () =>
        rt.stateManager.submitReply(
          speech as unknown as Parameters<
            typeof rt.stateManager.submitReply
          >[0],
          { triggerEvent: event, scene: { scene_id: scene.scene_id as string } },
        ),
      /authorization_decision_id/,
    );
    assert.equal(rt.state.currentRevision(), 0);
  } finally {
    rt.cleanup();
  }
});

test("reply commit writes speech + outbox + scene messages atomically", () => {
  const rt = setupRuntime();
  try {
    const event = userEvent("在吗");
    rt.stateManager.ingestEvent(event);
    const scene = rt.scenes.createOpenScene();
    const message = rt.db
      .prepare("SELECT message_id FROM messages WHERE event_id = ?")
      .get(event.event_id) as { message_id: string };
    rt.scenes.appendMessage(scene.scene_id as string, message.message_id);
    const speech = {
      schema_version: "1.0",
      speech_id: "sp_ok",
      operation_id: "op_ok",
      channel: "private_im",
      recipient_principal_id: "doctor",
      privacy_scope: "private_im",
      capability_revision: 0,
      authorization_decision_id: "authz_ok",
      source_refs: [{ source_type: "message", source_id: message.message_id }],
      bubbles: ["第一段", "第二段"],
    } as unknown as Parameters<typeof rt.stateManager.submitReply>[0];
    const result = rt.stateManager.submitReply(speech, {
      triggerEvent: event,
      scene: { scene_id: scene.scene_id as string },
      inputSources: [
        { source_type: "message", source_id: message.message_id },
      ],
    });
    assert.equal(result.committed, true);
    assert.equal(result.committedRevision, 1);
    assert.equal(rt.state.currentRevision(), 1);
    const speechRows = rt.db.prepare("SELECT * FROM speech_records").all();
    assert.equal(speechRows.length, 1);
    const outboxRows = rt.db.prepare("SELECT * FROM outbox").all();
    assert.equal(outboxRows.length, 1);
    const sceneMessages = rt.scenes.messagesInScene(scene.scene_id as string);
    assert.equal(sceneMessages.length, 2);
  } finally {
    rt.cleanup();
  }
});

test("stored but unseen event is outside the call source closure", () => {
  const rt = setupRuntime();
  try {
    const visible = userEvent("这是本轮可见消息");
    const hidden = userEvent("这是数据库里另一条未见消息");
    rt.stateManager.ingestEvent(visible);
    rt.stateManager.ingestEvent(hidden);
    const proposal = tickProposal(visible.event_id, 0);
    proposal.claims = [
      {
        claim_id: "clm_unseen_event",
        scope: "doctor_world",
        kind: "doctor_disclosure",
        text: "引用了未提供给本轮调用的事件",
        epistemic_status: "reported",
        lands_in_terra: false,
        privacy_scope: "private_im",
        source_refs: [{ source_type: "event", source_id: hidden.event_id }],
      },
    ];

    assert.throws(
      () =>
        rt.stateManager.submitOperation("tick", proposal, {
          triggerEvent: visible,
        }),
      /source event:.* outside legal closure/,
    );
    assert.equal(rt.state.currentRevision(), 0);
  } finally {
    rt.cleanup();
  }
});

test("stored but unseen message is outside the call source closure", () => {
  const rt = setupRuntime();
  try {
    const visible = userEvent("这是本轮可见消息");
    const hidden = userEvent("这是数据库里另一条未见消息");
    rt.stateManager.ingestEvent(visible);
    rt.stateManager.ingestEvent(hidden);
    const hiddenMessageId = (hidden.payload as { message_id: string }).message_id;
    const proposal = tickProposal(visible.event_id, 0);
    proposal.claims = [
      {
        claim_id: "clm_unseen_message",
        scope: "doctor_world",
        kind: "doctor_disclosure",
        text: "引用了未提供给本轮调用的消息",
        epistemic_status: "reported",
        lands_in_terra: false,
        privacy_scope: "private_im",
        source_refs: [
          { source_type: "message", source_id: hiddenMessageId },
        ],
      },
    ];

    assert.throws(
      () =>
        rt.stateManager.submitOperation("tick", proposal, {
          triggerEvent: visible,
        }),
      /source message:.* outside legal closure/,
    );
    assert.equal(rt.state.currentRevision(), 0);
  } finally {
    rt.cleanup();
  }
});

test("stored but unseen claim is outside the call source closure", () => {
  const rt = setupRuntime();
  try {
    const seedEvent = userEvent("作为种子声明的证据");
    rt.stateManager.ingestEvent(seedEvent);
    const seedMessageId = (seedEvent.payload as { message_id: string }).message_id;
    const seedProposal = tickProposal(seedEvent.event_id, 0);
    seedProposal.claims = [
      {
        claim_id: "clm_seed",
        scope: "doctor_world",
        kind: "doctor_disclosure",
        text: "一条已经持久化的声明",
        epistemic_status: "reported",
        lands_in_terra: false,
        privacy_scope: "private_im",
        source_refs: [
          { source_type: "message", source_id: seedMessageId },
        ],
      },
    ];
    rt.stateManager.submitOperation("tick", seedProposal, {
      triggerEvent: seedEvent,
      inputSources: [
        { source_type: "message", source_id: seedMessageId },
      ],
    });

    const visible = userEvent("新一轮可见消息");
    rt.stateManager.ingestEvent(visible);
    const proposal = tickProposal(visible.event_id, 1);
    proposal.claims = [
      {
        claim_id: "clm_unseen_claim",
        scope: "doctor_world",
        kind: "doctor_disclosure",
        text: "引用了未提供给本轮调用的声明",
        epistemic_status: "reported",
        lands_in_terra: false,
        privacy_scope: "private_im",
        source_refs: [{ source_type: "claim", source_id: "clm_seed" }],
      },
    ];

    assert.throws(
      () =>
        rt.stateManager.submitOperation("tick", proposal, {
          triggerEvent: visible,
        }),
      /source claim:clm_seed outside legal closure/,
    );
    assert.equal(rt.state.currentRevision(), 1);
  } finally {
    rt.cleanup();
  }
});

test("visible claim recursively exposes its recorded provenance", () => {
  const rt = setupRuntime();
  try {
    const seedEvent = userEvent("作为种子声明的证据");
    rt.stateManager.ingestEvent(seedEvent);
    const seedMessageId = (seedEvent.payload as { message_id: string }).message_id;
    const seedProposal = tickProposal(seedEvent.event_id, 0);
    seedProposal.claims = [
      {
        claim_id: "clm_recursive_seed",
        scope: "doctor_world",
        kind: "doctor_disclosure",
        text: "一条带有来源的声明",
        epistemic_status: "reported",
        lands_in_terra: false,
        privacy_scope: "private_im",
        source_refs: [
          { source_type: "message", source_id: seedMessageId },
        ],
      },
    ];
    rt.stateManager.submitOperation("tick", seedProposal, {
      triggerEvent: seedEvent,
      inputSources: [
        { source_type: "message", source_id: seedMessageId },
      ],
    });

    const visible = userEvent("新一轮可见消息");
    rt.stateManager.ingestEvent(visible);
    const proposal = tickProposal(visible.event_id, 1);
    proposal.claims = [
      {
        claim_id: "clm_recursive_result",
        scope: "doctor_world",
        kind: "doctor_disclosure",
        text: "沿可见声明追溯到原始消息",
        epistemic_status: "reported",
        lands_in_terra: false,
        privacy_scope: "private_im",
        source_refs: [
          { source_type: "message", source_id: seedMessageId },
        ],
      },
    ];

    const result = rt.stateManager.submitOperation("tick", proposal, {
      triggerEvent: visible,
      inputSources: [{ source_type: "claim", source_id: "clm_recursive_seed" }],
    });
    assert.equal(result.committed, true);
    assert.equal(rt.state.currentRevision(), 2);
  } finally {
    rt.cleanup();
  }
});

test("claim causal action must also be inside the call source closure", () => {
  const rt = setupRuntime();
  try {
    const visible = userEvent("我报告了一件事");
    const hidden = userEvent("未提供给本轮调用的因果事件");
    rt.stateManager.ingestEvent(visible);
    rt.stateManager.ingestEvent(hidden);
    const visibleMessageId = (visible.payload as { message_id: string }).message_id;
    const proposal = tickProposal(visible.event_id, 0);
    proposal.claims = [
      {
        claim_id: "clm_hidden_causal",
        scope: "terra",
        kind: "doctor_attestation",
        text: "因果动作不可越过本轮可见性",
        epistemic_status: "attested",
        lands_in_terra: true,
        privacy_scope: "private_im",
        source_refs: [
          { source_type: "message", source_id: visibleMessageId },
        ],
        causal_action_ref: {
          source_type: "event",
          source_id: hidden.event_id,
        },
      },
    ];

    assert.throws(
      () =>
        rt.stateManager.submitOperation("tick", proposal, {
          triggerEvent: visible,
          inputSources: [
            { source_type: "message", source_id: visibleMessageId },
          ],
        }),
      /source event:.* outside legal closure/,
    );
    assert.equal(rt.state.currentRevision(), 0);
  } finally {
    rt.cleanup();
  }
});

test("stable-looking canon id is illegal unless assembled for the call", () => {
  const rt = setupRuntime();
  try {
    const visible = userEvent("本轮没有检索到任何 canon");
    rt.stateManager.ingestEvent(visible);
    const proposal = tickProposal(visible.event_id, 0);
    proposal.claims = [
      {
        claim_id: "clm_unseen_canon",
        scope: "doctor_world",
        kind: "doctor_disclosure",
        text: "不能仅凭合法格式引用 canon",
        epistemic_status: "reported",
        lands_in_terra: false,
        privacy_scope: "private_im",
        source_refs: [
          { source_type: "canon", source_id: "cs_0123456789abcdef" },
        ],
      },
    ];

    assert.throws(
      () =>
        rt.stateManager.submitOperation("tick", proposal, {
          triggerEvent: visible,
        }),
      /source canon:cs_0123456789abcdef outside legal closure/,
    );
    assert.equal(rt.state.currentRevision(), 0);
  } finally {
    rt.cleanup();
  }
});

export type { WorldEvent };
