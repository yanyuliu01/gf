import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SocialOutcomeProposer,
  StubSocialOutcomeProposer,
  evaluateNPCChoice,
  evaluatePartialSuccess,
  evaluateMisunderstanding,
  evaluateSideEffects,
  proposeSocialOutcome,
  type NPCState,
  type SocialContext,
  type EnvironmentalFactor,
} from "../world/socialOutcome.js";
import type {
  WorldOutcomeProposalV1,
  ProposedWorldEffectV1,
} from "../generated/agentPipelineTypes.js";
import type { ExecutionPrimitiveV1 } from "../generated/cognitiveRuntimeTypes.js";
import { SchemaRegistry } from "../validation/schemas.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TEST_HASH = "a".repeat(64);

function makeNPC(overrides: Partial<NPCState> = {}): NPCState {
  return {
    npc_id: "researcher_wei",
    location_id: "lab",
    availability: "available",
    disposition: "cooperative",
    known_sources: new Set(["src_1", "src_2"]),
    active_commitments: [],
    ...overrides,
  };
}

function makeSocialContext(overrides: Partial<SocialContext> = {}): SocialContext {
  return {
    npcs: new Map([["researcher_wei", makeNPC()]]),
    environmental_factors: [],
    communication_channel: "private_im",
    source_refs: [{ source_type: "event", source_id: "evt_test" }],
    ...overrides,
  };
}

function makePrimitive(
  primitive: "observe" | "move" | "use_object" | "wait" | "communicate",
  target: string,
  detail: string = "test action",
): ExecutionPrimitiveV1 {
  const p: ExecutionPrimitiveV1 = { primitive, target, detail };
  if (primitive === "communicate") {
    p.text = "Hello, can you help me?";
  }
  return p;
}

function makeHardOutcome(
  status: "accepted" | "partial" | "rejected" = "accepted",
  effects: ProposedWorldEffectV1[] = [],
): WorldOutcomeProposalV1 {
  return {
    schema_version: "1.0",
    outcome_id: "out_test",
    action_proposal_id: "act_test",
    actor_id: "muelsyse",
    status,
    summary: `Hard adjudication: ${status}`,
    hard_constraint_classes: status === "rejected" ? ["location"] : [],
    proposed_effects: effects.length > 0 ? effects : [
      {
        effect_id: "eff_1",
        kind: "communicate",
        summary: "Communication sent",
        source_refs: [{ source_type: "event", source_id: "evt_test" }],
      },
    ],
    source_refs: [{ source_type: "event", source_id: "evt_test" }],
    adjudicator_version: "test.v1",
    rule_version: "test.v1",
    source_closure_hash: TEST_HASH,
    base_state_revision: 1,
    proposed_at: "2026-09-17T10:00:00.000Z",
  };
}

describe("NPC choice evaluation", () => {
  test("available cooperative NPC accepts", () => {
    const npc = makeNPC({ availability: "available", disposition: "cooperative" });
    const primitive = makePrimitive("communicate", "researcher_wei");
    const context = makeSocialContext();
    const result = evaluateNPCChoice(primitive, npc, context);
    assert.equal(result.choice, "accept");
  });

  test("unavailable NPC rejects", () => {
    const npc = makeNPC({ availability: "unavailable" });
    const primitive = makePrimitive("communicate", "researcher_wei");
    const context = makeSocialContext();
    const result = evaluateNPCChoice(primitive, npc, context);
    assert.equal(result.choice, "reject");
    assert.ok(result.reason.includes("unavailable"));
  });

  test("busy cooperative NPC negotiates", () => {
    const npc = makeNPC({ availability: "busy", disposition: "cooperative" });
    const primitive = makePrimitive("communicate", "researcher_wei");
    const context = makeSocialContext();
    const result = evaluateNPCChoice(primitive, npc, context);
    assert.equal(result.choice, "negotiate");
  });

  test("busy non-cooperative NPC rejects", () => {
    const npc = makeNPC({ availability: "busy", disposition: "neutral" });
    const primitive = makePrimitive("communicate", "researcher_wei");
    const context = makeSocialContext();
    const result = evaluateNPCChoice(primitive, npc, context);
    assert.equal(result.choice, "reject");
    assert.ok(result.reason.includes("busy"));
  });

  test("reluctant NPC negotiates", () => {
    const npc = makeNPC({ availability: "available", disposition: "reluctant" });
    const primitive = makePrimitive("communicate", "researcher_wei");
    const context = makeSocialContext();
    const result = evaluateNPCChoice(primitive, npc, context);
    assert.equal(result.choice, "negotiate");
    assert.ok(result.reason.includes("reluctant"));
  });

  test("unknown NPC rejects", () => {
    const primitive = makePrimitive("communicate", "unknown_npc");
    const context = makeSocialContext();
    const result = evaluateNPCChoice(primitive, undefined, context);
    assert.equal(result.choice, "reject");
    assert.ok(result.reason.includes("not found"));
  });
});

describe("partial success evaluation", () => {
  test("no obstacles means full success", () => {
    const primitive = makePrimitive("move", "lab");
    const context = makeSocialContext();
    const result = evaluatePartialSuccess(primitive, context);
    assert.equal(result.partial, false);
    assert.equal(result.reduction, 0);
  });

  test("major obstacle causes 50% reduction", () => {
    const context = makeSocialContext({
      environmental_factors: [
        {
          factor_id: "obs_1",
          kind: "obstacle",
          severity: "major",
          description: "Heavy equipment blocking path",
        },
      ],
    });
    const primitive = makePrimitive("move", "lab");
    const result = evaluatePartialSuccess(primitive, context);
    assert.equal(result.partial, true);
    assert.equal(result.reduction, 0.5);
    assert.ok(result.reason?.includes("Heavy equipment"));
  });

  test("moderate obstacle causes 25% reduction", () => {
    const context = makeSocialContext({
      environmental_factors: [
        {
          factor_id: "obs_1",
          kind: "distraction",
          severity: "moderate",
          description: "Ongoing experiment requires attention",
        },
      ],
    });
    const primitive = makePrimitive("observe", "specimen");
    const result = evaluatePartialSuccess(primitive, context);
    assert.equal(result.partial, true);
    assert.equal(result.reduction, 0.25);
  });

  test("minor obstacle does not cause partial success", () => {
    const context = makeSocialContext({
      environmental_factors: [
        {
          factor_id: "obs_1",
          kind: "obstacle",
          severity: "minor",
          description: "Small puddle on floor",
        },
      ],
    });
    const primitive = makePrimitive("move", "lab");
    const result = evaluatePartialSuccess(primitive, context);
    assert.equal(result.partial, false);
  });
});

describe("misunderstanding evaluation", () => {
  test("no noise means no misunderstanding", () => {
    const primitive = makePrimitive("communicate", "researcher_wei");
    const context = makeSocialContext();
    const result = evaluateMisunderstanding(primitive, context);
    assert.equal(result.misunderstood, false);
  });

  test("moderate noise causes misunderstanding", () => {
    const context = makeSocialContext({
      environmental_factors: [
        {
          factor_id: "noise_1",
          kind: "noise",
          severity: "moderate",
          description: "Machinery running loudly",
        },
      ],
    });
    const primitive = makePrimitive("communicate", "researcher_wei");
    const result = evaluateMisunderstanding(primitive, context);
    assert.equal(result.misunderstood, true);
    assert.ok(result.interpretation?.includes("partially lost"));
  });

  test("minor noise does not cause misunderstanding", () => {
    const context = makeSocialContext({
      environmental_factors: [
        {
          factor_id: "noise_1",
          kind: "noise",
          severity: "minor",
          description: "Background hum",
        },
      ],
    });
    const primitive = makePrimitive("communicate", "researcher_wei");
    const result = evaluateMisunderstanding(primitive, context);
    assert.equal(result.misunderstood, false);
  });

  test("non-communicate primitives cannot have misunderstandings", () => {
    const context = makeSocialContext({
      environmental_factors: [
        {
          factor_id: "noise_1",
          kind: "noise",
          severity: "major",
          description: "Explosion nearby",
        },
      ],
    });
    const primitive = makePrimitive("move", "lab");
    const result = evaluateMisunderstanding(primitive, context);
    assert.equal(result.misunderstood, false);
  });
});

describe("side effects evaluation", () => {
  test("major opportunity creates side effect", () => {
    const context = makeSocialContext({
      environmental_factors: [
        {
          factor_id: "opp_1",
          kind: "opportunity",
          severity: "major",
          description: "Rare specimen visible",
        },
      ],
    });
    const primitive = makePrimitive("observe", "lab");
    const effects = evaluateSideEffects(primitive, context);
    assert.equal(effects.length, 1);
    assert.equal(effects[0].kind, "opportunity_discovered");
    assert.ok(effects[0].summary.includes("Rare specimen"));
  });

  test("movement with distraction triggers observation", () => {
    const context = makeSocialContext({
      environmental_factors: [
        {
          factor_id: "dist_1",
          kind: "distraction",
          severity: "moderate",
          description: "Strange sounds from storage",
        },
      ],
    });
    const primitive = makePrimitive("move", "lab");
    const effects = evaluateSideEffects(primitive, context);
    assert.equal(effects.length, 1);
    assert.equal(effects[0].kind, "observation_triggered");
    assert.ok(effects[0].summary.includes("Strange sounds"));
  });

  test("no environmental factors means no side effects", () => {
    const context = makeSocialContext();
    const primitive = makePrimitive("move", "lab");
    const effects = evaluateSideEffects(primitive, context);
    assert.equal(effects.length, 0);
  });
});

describe("proposeSocialOutcome integration", () => {
  test("rejected hard outcome produces no social outcomes", () => {
    const hardOutcome = makeHardOutcome("rejected");
    const primitives = [makePrimitive("move", "lab")];
    const context = makeSocialContext();
    const results = proposeSocialOutcome(hardOutcome, primitives, context);
    assert.equal(results.length, 0);
  });

  test("communicate primitive with available NPC produces npc_accepted", () => {
    const hardOutcome = makeHardOutcome("accepted");
    const primitives = [makePrimitive("communicate", "researcher_wei")];
    const context = makeSocialContext();
    const results = proposeSocialOutcome(hardOutcome, primitives, context);
    assert.ok(results.some((r) => r.outcome_class === "npc_accepted"));
  });

  test("multiple social outcomes from complex scenario", () => {
    const hardOutcome = makeHardOutcome("accepted");
    const primitives = [
      makePrimitive("move", "lab"),
      makePrimitive("communicate", "researcher_wei"),
    ];
    const context = makeSocialContext({
      environmental_factors: [
        { factor_id: "opp_1", kind: "opportunity", severity: "major", description: "Sample ready" },
        { factor_id: "dist_1", kind: "distraction", severity: "moderate", description: "Alarm beeping" },
      ],
    });
    const results = proposeSocialOutcome(hardOutcome, primitives, context);
    assert.ok(results.length >= 2, "should have multiple social outcomes");
    assert.ok(results.some((r) => r.outcome_class === "npc_accepted"));
    assert.ok(results.some((r) => r.outcome_class === "side_effect"));
  });
});

describe("SocialOutcomeProposer", () => {
  test("does not bypass hard rejection", async () => {
    const proposer = new SocialOutcomeProposer();
    const hardOutcome = makeHardOutcome("rejected");
    const primitives = [makePrimitive("communicate", "researcher_wei")];
    const context = makeSocialContext();

    const result = await proposer.propose(hardOutcome, primitives, context);

    assert.equal(result.status, "rejected", "must not change rejected status");
    assert.equal(result.social_outcomes.length, 0);
  });

  test("NPC rejection changes accepted to partial", async () => {
    const proposer = new SocialOutcomeProposer();
    const hardOutcome = makeHardOutcome("accepted");
    const primitives = [makePrimitive("communicate", "unknown_npc")];
    const context = makeSocialContext();

    const result = await proposer.propose(hardOutcome, primitives, context);

    assert.equal(result.status, "partial");
    assert.ok(result.summary.includes("NPC rejected"));
    assert.ok(result.social_outcomes.some((o) => o.outcome_class === "npc_rejected"));
  });

  test("misunderstanding changes accepted to partial", async () => {
    const proposer = new SocialOutcomeProposer();
    const hardOutcome = makeHardOutcome("accepted");
    const primitives = [makePrimitive("communicate", "researcher_wei")];
    const context = makeSocialContext({
      environmental_factors: [
        { factor_id: "noise_1", kind: "noise", severity: "major", description: "Loud alarm" },
      ],
    });

    const result = await proposer.propose(hardOutcome, primitives, context);

    assert.equal(result.status, "partial");
    assert.ok(result.summary.includes("misunderstood"));
    assert.ok(result.social_outcomes.some((o) => o.outcome_class === "misunderstanding"));
  });

  test("side effects are added to proposed_effects", async () => {
    const proposer = new SocialOutcomeProposer();
    const hardOutcome = makeHardOutcome("accepted");
    const primitives = [makePrimitive("move", "lab")];
    const context = makeSocialContext({
      environmental_factors: [
        { factor_id: "opp_1", kind: "opportunity", severity: "major", description: "Discovery" },
      ],
    });

    const result = await proposer.propose(hardOutcome, primitives, context);

    assert.ok(
      result.proposed_effects.some((e) => e.kind === "opportunity_discovered"),
      "should include side effect in proposed_effects",
    );
  });

  test("preserves hard outcome data", async () => {
    const proposer = new SocialOutcomeProposer();
    const hardOutcome = makeHardOutcome("accepted");
    const primitives = [makePrimitive("observe", "specimen")];
    const context = makeSocialContext();

    const result = await proposer.propose(hardOutcome, primitives, context);

    assert.equal(result.outcome_id, hardOutcome.outcome_id);
    assert.equal(result.action_proposal_id, hardOutcome.action_proposal_id);
    assert.equal(result.actor_id, hardOutcome.actor_id);
    assert.equal(result.source_closure_hash, hardOutcome.source_closure_hash);
    assert.ok(result.social_proposer_version);
  });
});

describe("StubSocialOutcomeProposer", () => {
  test("returns hardOutcome with default outcomes", async () => {
    const proposer = new StubSocialOutcomeProposer();
    const hardOutcome = makeHardOutcome("accepted");
    const primitives = [makePrimitive("move", "lab")];
    const context = makeSocialContext();

    const result = await proposer.propose(hardOutcome, primitives, context);

    assert.equal(result.status, "accepted");
    assert.equal(result.social_outcomes.length, 0);
  });

  test("can inject custom outcomes for testing", async () => {
    const proposer = new StubSocialOutcomeProposer([
      {
        outcome_class: "npc_accepted",
        description: "Test NPC accepted",
        modified_effects: [],
        side_effects: [],
        source_refs: [],
      },
    ]);
    const hardOutcome = makeHardOutcome("accepted");
    const primitives = [makePrimitive("communicate", "anyone")];
    const context = makeSocialContext();

    const result = await proposer.propose(hardOutcome, primitives, context);

    assert.equal(result.social_outcomes.length, 1);
    assert.equal(result.social_outcomes[0].outcome_class, "npc_accepted");
  });
});

describe("docs/16 compliance", () => {
  test("social outcomes cannot bypass hard adjudication (rejected stays rejected)", async () => {
    const proposer = new SocialOutcomeProposer();
    const hardOutcome = makeHardOutcome("rejected");
    hardOutcome.hard_constraint_classes = ["location", "capability"];
    const primitives = [makePrimitive("move", "forbidden_area")];
    const context = makeSocialContext({
      npcs: new Map([["friendly_npc", makeNPC({ disposition: "cooperative" })]]),
    });

    const result = await proposer.propose(hardOutcome, primitives, context);

    assert.equal(result.status, "rejected");
    assert.deepEqual(result.hard_constraint_classes, ["location", "capability"]);
    assert.equal(result.social_outcomes.length, 0);
  });

  test("NPC choice respects availability states", async () => {
    const availableNPC = makeNPC({ npc_id: "npc_a", availability: "available" });
    const busyNPC = makeNPC({ npc_id: "npc_b", availability: "busy", disposition: "neutral" });
    const unavailableNPC = makeNPC({ npc_id: "npc_c", availability: "unavailable" });

    const context = makeSocialContext({
      npcs: new Map([
        ["npc_a", availableNPC],
        ["npc_b", busyNPC],
        ["npc_c", unavailableNPC],
      ]),
    });

    const resultA = evaluateNPCChoice(makePrimitive("communicate", "npc_a"), availableNPC, context);
    const resultB = evaluateNPCChoice(makePrimitive("communicate", "npc_b"), busyNPC, context);
    const resultC = evaluateNPCChoice(makePrimitive("communicate", "npc_c"), unavailableNPC, context);

    assert.equal(resultA.choice, "accept");
    assert.equal(resultB.choice, "reject");
    assert.equal(resultC.choice, "reject");
  });

  test("source-constrained: all outcomes reference source_refs", async () => {
    const proposer = new SocialOutcomeProposer();
    const hardOutcome = makeHardOutcome("accepted");
    const primitives = [makePrimitive("communicate", "researcher_wei")];
    const context = makeSocialContext({
      source_refs: [
        { source_type: "event", source_id: "evt_source" },
        { source_type: "message", source_id: "msg_source" },
      ],
    });

    const result = await proposer.propose(hardOutcome, primitives, context);

    for (const outcome of result.social_outcomes) {
      assert.ok(outcome.source_refs.length > 0, "each outcome must have source_refs");
    }
  });
});
