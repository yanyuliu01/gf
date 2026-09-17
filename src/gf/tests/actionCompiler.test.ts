import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import { join } from "node:path";

import type { OpenActionProposalV1 } from "../generated/agentPipelineTypes.js";
import type { ActionCompilationResultV1 } from "../generated/cognitiveRuntimeTypes.js";
import {
  ActionCompiler,
  StubActionCompiler,
  ActionCompilerError,
  ACTION_COMPILER_VERSION,
  EXECUTION_PRIMITIVES,
  type CompilationContext,
  type CompilerDraft,
} from "../world/actionCompiler.js";
import { SchemaRegistry } from "../validation/schemas.js";
import { computeInputClosureHash } from "../validation/derivedInputClosure.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SCHEMAS_DIR = join(ROOT, "schemas");

function makeAction(
  intent: string,
  plan?: string[],
): OpenActionProposalV1 {
  const sourceRefs = [{ source_type: "event" as const, source_id: "e1" }];
  return {
    schema_version: "1.0",
    proposal_id: "action:test",
    actor_id: "muelsyse",
    policy_run_id: "run:test",
    intent,
    ...(plan ? { plan } : {}),
    source_refs: sourceRefs,
    source_closure_hash: computeInputClosureHash(1, sourceRefs),
    base_state_revision: 1,
    proposed_at: "2026-09-17T10:00:00Z",
  };
}

function makeContext(): CompilationContext {
  return {
    baseStateRevision: 1,
    sourceClosureHash: computeInputClosureHash(1, [
      { source_type: "event", source_id: "e1" },
    ]),
    compiledAt: "2026-09-17T10:01:00Z",
    knownTargets: new Map([
      ["garden", ["garden", "生态园"]],
      ["office", ["office", "办公室"]],
      ["home", ["home", "住所"]],
      ["S-4", ["S-4"]],
      ["pump", ["pump", "循环泵", "泵"]],
      ["doctor", ["doctor", "博士"]],
    ]),
  };
}

describe("ActionCompiler", () => {
  let schemas: SchemaRegistry;

  beforeEach(() => {
    schemas = new SchemaRegistry(SCHEMAS_DIR);
  });

  describe("contract validation", () => {
    it("validates action proposal input schema", () => {
      const invalidAction = { schema_version: "1.0" };
      const compiler = new StubActionCompiler(schemas);
      assert.throws(
        () => compiler.compile(invalidAction as any, makeContext()),
        /ValidationError/,
      );
    });

    it("produces valid ActionCompilationResultV1 on success", () => {
      const patterns = new Map([["去生态园", { primitive: "move" as const, target: "garden" }]]);
      const compiler = new StubActionCompiler(schemas, patterns);
      const action = makeAction("我想去生态园看看 S-4 的状况", ["去生态园"]);
      const result = compiler.compile(action, makeContext());

      assert.equal(result.schema_version, "1.0");
      assert.equal(result.status, "compiled");
      assert.ok(result.primitives);
      assert.equal(result.primitives.length, 1);
      assert.equal(result.primitives[0].primitive, "move");
      assert.equal(result.primitives[0].target, "garden");
    });

    it("produces valid ActionCompilationResultV1 on capability gap", () => {
      const compiler = new StubActionCompiler(schemas);
      const action = makeAction("召唤一条龙来帮我浇水");
      const result = compiler.compile(action, makeContext());

      assert.equal(result.status, "capability_gap");
      assert.ok(result.capability_gap);
      assert.equal(result.capability_gap.gap_class, "uncompilable_semantics");
      assert.ok(result.capability_gap.intent_quote.includes("召唤一条龙"));
    });
  });

  describe("execution primitive vocabulary", () => {
    it("contains exactly the five world kernel primitives", () => {
      assert.deepEqual(
        [...EXECUTION_PRIMITIVES].sort(),
        ["communicate", "move", "observe", "use_object", "wait"],
      );
    });

    it("rejects unknown primitives as capability gap", async () => {
      const model = {
        compile: async () =>
          ({
            primitive: "teleport",
            target: "mars",
            detail: "instant travel",
            action_quote: "瞬移",
            target_quote: "火星",
          }) as CompilerDraft,
      };
      const compiler = new ActionCompiler(model, schemas);
      const action = makeAction("我要瞬移到火星");
      const result = await compiler.compile(action, makeContext());

      assert.equal(result.status, "capability_gap");
      assert.equal(result.capability_gap?.gap_class, "unknown_primitive");
    });
  });

  describe("provenance verification", () => {
    it("requires action_quote to appear in first step", async () => {
      const model = {
        compile: async () =>
          ({
            primitive: "move",
            target: "garden",
            detail: "going to garden",
            action_quote: "完全不相关的引用",
            target_quote: "garden",
          }) as CompilerDraft,
      };
      const compiler = new ActionCompiler(model, schemas);
      const action = makeAction("去生态园检查 S-4");
      const result = await compiler.compile(action, makeContext());

      assert.equal(result.status, "capability_gap");
      assert.equal(result.capability_gap?.gap_class, "provenance_mismatch");
    });

    it("requires target_quote within action_quote for physical primitives", async () => {
      const model = {
        compile: async () =>
          ({
            primitive: "move",
            target: "garden",
            detail: "going to garden",
            action_quote: "去生态园",
            target_quote: "办公室", // doesn't appear in action_quote
          }) as CompilerDraft,
      };
      const compiler = new ActionCompiler(model, schemas);
      const action = makeAction("去生态园检查 S-4");
      const result = await compiler.compile(action, makeContext());

      assert.equal(result.status, "capability_gap");
      assert.equal(result.capability_gap?.gap_class, "provenance_mismatch");
    });

    it("verifies target against known world targets", async () => {
      const model = {
        compile: async () =>
          ({
            primitive: "move",
            target: "moon_base",
            detail: "going to moon",
            action_quote: "去月球基地",
            target_quote: "月球",
          }) as CompilerDraft,
      };
      const compiler = new ActionCompiler(model, schemas);
      const action = makeAction("去月球基地执行任务");
      const result = await compiler.compile(action, makeContext());

      assert.equal(result.status, "capability_gap");
      assert.equal(result.capability_gap?.gap_class, "unknown_target");
    });
  });

  describe("communicate primitive special handling", () => {
    it("requires non-empty text for communicate", async () => {
      const model = {
        compile: async () =>
          ({
            primitive: "communicate",
            target: "doctor",
            detail: "send message",
            text: "",
            action_quote: "告诉博士",
            target_quote: "博士",
          }) as CompilerDraft,
      };
      const compiler = new ActionCompiler(model, schemas);
      const action = makeAction("告诉博士最新进展");
      const result = await compiler.compile(action, makeContext());

      assert.equal(result.status, "capability_gap");
      assert.equal(result.capability_gap?.gap_class, "uncompilable_semantics");
    });

    it("rejects text on non-communicate primitives", async () => {
      const model = {
        compile: async () =>
          ({
            primitive: "observe",
            target: "S-4",
            detail: "observe plant",
            text: "不应该有文字",
            action_quote: "观察 S-4",
            target_quote: "S-4",
          }) as CompilerDraft,
      };
      const compiler = new ActionCompiler(model, schemas);
      const action = makeAction("观察 S-4 的状况");
      const result = await compiler.compile(action, makeContext());

      assert.equal(result.status, "capability_gap");
      assert.equal(result.capability_gap?.gap_class, "uncompilable_semantics");
    });

    it("accepts valid communicate with text", async () => {
      const model = {
        compile: async () =>
          ({
            primitive: "communicate",
            target: "doctor",
            detail: "inform about progress",
            text: "S-4 今天状态不错",
            action_quote: "告诉博士",
            target_quote: "博士",
          }) as CompilerDraft,
      };
      const compiler = new ActionCompiler(model, schemas);
      const action = makeAction("告诉博士 S-4 今天状态不错");
      const result = await compiler.compile(action, makeContext());

      assert.equal(result.status, "compiled");
      assert.equal(result.primitives?.[0].primitive, "communicate");
      assert.equal(result.primitives?.[0].text, "S-4 今天状态不错");
    });
  });

  describe("no silent canned substitution (invariant E1-E2)", () => {
    it("returns explicit capability_gap instead of substituting", async () => {
      const model = {
        compile: async () =>
          ({
            primitive: "fly",
            target: "sky",
            detail: "soar through clouds",
            action_quote: "飞翔",
            target_quote: "天空",
          }) as CompilerDraft,
      };
      const compiler = new ActionCompiler(model, schemas);
      const action = makeAction("我要飞翔到天空之上");
      const result = await compiler.compile(action, makeContext());

      assert.equal(result.status, "capability_gap");
      assert.ok(result.capability_gap);
      // Must NOT silently substitute with "move" or "wait"
      assert.ok(!result.primitives);
    });

    it("preserves intent quote in capability gap for debugging", async () => {
      const model = {
        compile: async () =>
          ({
            primitive: "quantum_leap",
            target: "parallel_universe",
            detail: "jump dimensions",
            action_quote: "量子跳跃",
            target_quote: "平行宇宙",
          }) as CompilerDraft,
      };
      const compiler = new ActionCompiler(model, schemas);
      const intent = "我要执行量子跳跃到达平行宇宙";
      const action = makeAction(intent);
      const result = await compiler.compile(action, makeContext());

      assert.equal(result.status, "capability_gap");
      assert.equal(result.capability_gap?.intent_quote, intent);
    });
  });

  describe("StubActionCompiler determinism", () => {
    it("returns same result for same input", () => {
      const patterns = new Map([
        ["观察", { primitive: "observe" as const, target: "S-4" }],
      ]);
      const compiler = new StubActionCompiler(schemas, patterns);
      const action = makeAction("观察 S-4");
      const context = makeContext();

      const result1 = compiler.compile(action, context);
      const result2 = compiler.compile(action, context);

      assert.deepEqual(result1, result2);
    });

    it("matches patterns in order", () => {
      const patterns = new Map([
        ["去", { primitive: "move" as const, target: "garden" }],
        ["观察", { primitive: "observe" as const, target: "S-4" }],
      ]);
      const compiler = new StubActionCompiler(schemas, patterns);
      const action = makeAction("去观察 S-4"); // contains both patterns

      const result = compiler.compile(action, makeContext());
      assert.equal(result.primitives?.[0].primitive, "move"); // first match wins
    });
  });

  describe("version tracking", () => {
    it("includes compiler version in result", async () => {
      const model = {
        compile: async () =>
          ({
            primitive: "observe",
            target: "S-4",
            detail: "observe",
            action_quote: "观察 S-4",
            target_quote: "S-4",
          }) as CompilerDraft,
      };
      const compiler = new ActionCompiler(model, schemas);
      const action = makeAction("观察 S-4 的状况");
      const result = await compiler.compile(action, makeContext());

      assert.equal(result.compiler_version, ACTION_COMPILER_VERSION);
    });

    it("stub compiler uses its own version", () => {
      const compiler = new StubActionCompiler(schemas);
      const action = makeAction("任意动作");
      const result = compiler.compile(action, makeContext());

      assert.equal(result.compiler_version, "stub-compiler.v1");
    });
  });
});
