import { createHash } from "node:crypto";

import type {
  OpenActionProposalV1,
  SourceRef,
} from "../generated/agentPipelineTypes.js";
import type {
  ActionCompilationResultV1,
  CapabilityGapV1,
  ExecutionPrimitiveV1,
} from "../generated/cognitiveRuntimeTypes.js";
import type { ActionCompilerPort, AsyncActionCompilerPort } from "./actionPorts.js";
import type { SchemaRegistry } from "../validation/schemas.js";
import {
  computeInputClosureHash,
  normalizeSourceRefs,
} from "../validation/derivedInputClosure.js";

export const ACTION_COMPILER_VERSION = "action-compiler.v1";

/** Hard-constraint class for rejected world outcomes. */
export type HardConstraintClass =
  | "location"
  | "time"
  | "resource"
  | "capability"
  | "knowledge"
  | "permission"
  | "world_rule";

/**
 * The execution primitive vocabulary for the current world kernel.
 * This is the syscall layer - it does not constrain what the subject can conceive.
 */
export const EXECUTION_PRIMITIVES = [
  "observe",
  "move",
  "use_object",
  "wait",
  "communicate",
] as const;
export type ExecutionPrimitive = (typeof EXECUTION_PRIMITIVES)[number];

/** Model-generated draft before provenance verification. */
export interface CompilerDraft {
  primitive: string;
  target: string;
  detail: string;
  text?: string;
  action_quote: string;
  target_quote: string;
}

/** Context required for compilation. */
export interface CompilationContext {
  baseStateRevision: number;
  sourceClosureHash: string;
  compiledAt: string;
  knownTargets?: ReadonlyMap<string, readonly string[]>;
}

/** Model boundary for action compilation. */
export interface ActionCompilerModelPort {
  compile(
    action: Readonly<OpenActionProposalV1>,
    context: Readonly<CompilationContext>,
  ): Promise<Readonly<CompilerDraft>>;
}

export class ActionCompilerError extends Error {
  constructor(
    message: string,
    public readonly gapClass: CapabilityGapV1["gap_class"],
  ) {
    super(message);
    this.name = "ActionCompilerError";
  }
}

/**
 * Action Compiler: translates open semantic intent to finite execution primitives.
 *
 * Architecture invariants (docs/invariants/19):
 * - E1: LLM generates open semantic action in Policy
 * - E2: Execution layer has finite capability interface (observe/move/use_object/wait/communicate)
 * - E3: All outbound through same surface/outbox/adapter
 * - E4: No global action score
 *
 * This compiler bridges E1 to E2. Unsupported semantics produce explicit capability_gap,
 * NEVER silent canned substitution.
 *
 * Async: requires model call for compilation.
 */
export class ActionCompiler
  implements
    AsyncActionCompilerPort<
      OpenActionProposalV1,
      CompilationContext,
      ActionCompilationResultV1
    >
{
  constructor(
    private readonly model: ActionCompilerModelPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  async compile(
    action: Readonly<OpenActionProposalV1>,
    context: Readonly<CompilationContext>,
  ): Promise<Readonly<ActionCompilationResultV1>> {
    this.schemas.validate("open-action-proposal.schema.json", action);

    const compilationId = deterministicId("compilation", {
      action: action.proposal_id,
      revision: context.baseStateRevision,
      at: context.compiledAt,
    });

    const base: Omit<ActionCompilationResultV1, "status" | "primitives" | "capability_gap"> = {
      schema_version: "1.0",
      compilation_id: compilationId,
      action_proposal_id: action.proposal_id,
      actor_id: action.actor_id,
      compiler_version: ACTION_COMPILER_VERSION,
      source_closure_hash: context.sourceClosureHash,
      base_state_revision: context.baseStateRevision,
      compiled_at: context.compiledAt,
    };

    try {
      const draft = await this.model.compile(action, context);
      const verified = this.verifyDraft(draft, action, context);

      const result: ActionCompilationResultV1 = {
        ...base,
        status: "compiled",
        primitives: [verified],
        action_quote: draft.action_quote,
        target_quote: draft.target_quote,
      };

      this.schemas.validate("action-compilation-result.schema.json", result);
      return structuredClone(result);
    } catch (error) {
      if (error instanceof ActionCompilerError) {
        const result: ActionCompilationResultV1 = {
          ...base,
          status: "capability_gap",
          capability_gap: {
            gap_class: error.gapClass,
            unsupported_semantics: error.message,
            intent_quote: action.intent.slice(0, 8000),
          },
        };

        this.schemas.validate("action-compilation-result.schema.json", result);
        return structuredClone(result);
      }
      throw error;
    }
  }

  private verifyDraft(
    draft: CompilerDraft,
    action: OpenActionProposalV1,
    context: CompilationContext,
  ): ExecutionPrimitiveV1 {
    if (!EXECUTION_PRIMITIVES.includes(draft.primitive as ExecutionPrimitive)) {
      throw new ActionCompilerError(
        `Primitive "${draft.primitive}" is not in the current execution vocabulary`,
        "unknown_primitive",
      );
    }

    const firstStep = action.plan?.[0] ?? action.intent;
    if (!draft.action_quote.trim() || !firstStep.includes(draft.action_quote)) {
      throw new ActionCompilerError(
        "Compiled action does not quote the first step of the semantic intent",
        "provenance_mismatch",
      );
    }

    if (draft.primitive === "communicate") {
      if (!draft.text?.trim()) {
        throw new ActionCompilerError(
          "Communicate primitive requires non-empty text",
          "uncompilable_semantics",
        );
      }
    } else if (draft.text?.trim()) {
      throw new ActionCompilerError(
        "Non-communicate primitives must not carry outbound text",
        "uncompilable_semantics",
      );
    }

    if (["move", "observe", "use_object"].includes(draft.primitive)) {
      if (!draft.target_quote.trim() || !draft.action_quote.includes(draft.target_quote)) {
        throw new ActionCompilerError(
          "Target quote must appear in the action quote for physical primitives",
          "provenance_mismatch",
        );
      }

      if (context.knownTargets) {
        const aliases = context.knownTargets.get(draft.target);
        if (!aliases?.some((name) => draft.target_quote.includes(name))) {
          throw new ActionCompilerError(
            `Target "${draft.target}" not supported by known world targets`,
            "unknown_target",
          );
        }
      }
    }

    return {
      primitive: draft.primitive as ExecutionPrimitiveV1["primitive"],
      target: draft.target,
      detail: draft.detail,
      ...(draft.text ? { text: draft.text } : {}),
    };
  }
}

/**
 * Stub compiler for deterministic testing without model calls.
 * Returns capability_gap for any action that doesn't match predefined patterns.
 */
export class StubActionCompiler
  implements
    ActionCompilerPort<
      OpenActionProposalV1,
      CompilationContext,
      ActionCompilationResultV1
    >
{
  constructor(
    private readonly schemas: SchemaRegistry,
    private readonly patterns: ReadonlyMap<
      string,
      { primitive: ExecutionPrimitiveV1["primitive"]; target: string }
    > = new Map(),
  ) {}

  compile(
    action: Readonly<OpenActionProposalV1>,
    context: Readonly<CompilationContext>,
  ): Readonly<ActionCompilationResultV1> {
    this.schemas.validate("open-action-proposal.schema.json", action);

    const compilationId = deterministicId("compilation", {
      action: action.proposal_id,
      revision: context.baseStateRevision,
      at: context.compiledAt,
    });

    const base: Omit<ActionCompilationResultV1, "status" | "primitives" | "capability_gap"> = {
      schema_version: "1.0",
      compilation_id: compilationId,
      action_proposal_id: action.proposal_id,
      actor_id: action.actor_id,
      compiler_version: "stub-compiler.v1",
      source_closure_hash: context.sourceClosureHash,
      base_state_revision: context.baseStateRevision,
      compiled_at: context.compiledAt,
    };

    const firstStep = action.plan?.[0] ?? action.intent;

    for (const [keyword, mapping] of this.patterns) {
      if (firstStep.includes(keyword)) {
        const result: ActionCompilationResultV1 = {
          ...base,
          status: "compiled",
          primitives: [
            {
              primitive: mapping.primitive,
              target: mapping.target,
              detail: `Matched pattern: ${keyword}`,
              ...(mapping.primitive === "communicate"
                ? { text: firstStep }
                : {}),
            },
          ],
          action_quote: keyword,
          target_quote: mapping.target,
        };
        this.schemas.validate("action-compilation-result.schema.json", result);
        return structuredClone(result);
      }
    }

    const result: ActionCompilationResultV1 = {
      ...base,
      status: "capability_gap",
      capability_gap: {
        gap_class: "uncompilable_semantics",
        unsupported_semantics: "No matching pattern found in stub compiler",
        intent_quote: action.intent.slice(0, 8000),
      },
    };
    this.schemas.validate("action-compilation-result.schema.json", result);
    return structuredClone(result);
  }
}

function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}:${createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 32)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
