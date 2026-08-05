/**
 * Deterministic policy invariants (machine layer only).
 *
 * The project explicitly separates machine invariants (JSON Schema, explicit
 * predicates, allowlists) from semantic character checks (which belong to a
 * separate semantic guard / regeneration layer). This module implements only
 * the machine layer.
 */

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export class PatchPolicyError extends PolicyError {
  constructor(message: string) {
    super(message);
    this.name = "PatchPolicyError";
  }
}

export interface Claim {
  claim_id: string;
  scope: string;
  kind: string;
  text: string;
  epistemic_status: string;
  lands_in_terra: boolean;
  privacy_scope: string;
  source_refs: { source_type: string; source_id: string }[];
  causal_action_ref?: {
    source_type: string;
    source_id: string;
  } | null;
}

interface ClaimRule {
  scope: Set<string>;
  epistemic_status: Set<string>;
  lands_in_terra: boolean;
  causal_required: boolean;
  causal_type?: Set<string>;
}

const CLAIM_KIND_INVARIANTS: Record<string, ClaimRule> = {
  doctor_disclosure: {
    scope: new Set(["doctor_world", "relationship"]),
    epistemic_status: new Set(["reported"]),
    lands_in_terra: false,
    causal_required: false,
  },
  doctor_attestation: {
    scope: new Set(["terra"]),
    epistemic_status: new Set(["attested", "verified"]),
    lands_in_terra: true,
    causal_required: true,
  },
  terra_effect: {
    scope: new Set(["terra"]),
    epistemic_status: new Set(["verified"]),
    lands_in_terra: true,
    causal_required: true,
  },
  capability_change: {
    scope: new Set(["channel"]),
    epistemic_status: new Set(["verified"]),
    lands_in_terra: false,
    causal_required: true,
    causal_type: new Set(["event"]),
  },
};

const PATCH_PATH_PATTERNS: Record<string, RegExp[]> = {
  world_state: [
    /^(location|activity|presence)$/,
    /^(world_day|world_phase)$/,
    /^flags\.[A-Za-z0-9_]+$/,
    /^threads\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/,
    /^debts\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/,
  ],
  thread: [/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/, /^[A-Za-z0-9_]+$/],
  persona: [/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/],
  inventory: [/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/],
  debt: [/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/],
};

export interface PatchOpLike {
  op_id: string;
  target: string;
  path: string;
  op: string;
  value?: unknown;
  expected_state_revision: number;
}

export class Policy {
  checkClaim(claim: Claim): void {
    const rule = CLAIM_KIND_INVARIANTS[claim.kind];
    if (!rule) {
      throw new PolicyError(`unknown claim kind ${claim.kind}`);
    }
    if (!rule.scope.has(claim.scope)) {
      throw new PolicyError(
        `claim ${claim.claim_id}: kind ${claim.kind} scope ${claim.scope} invalid`,
      );
    }
    if (!rule.epistemic_status.has(claim.epistemic_status)) {
      throw new PolicyError(
        `claim ${claim.claim_id}: kind ${claim.kind} requires epistemic_status in ${[
          ...rule.epistemic_status,
        ].join(",")}`,
      );
    }
    if (Boolean(claim.lands_in_terra) !== rule.lands_in_terra) {
      throw new PolicyError(
        `claim ${claim.claim_id}: kind ${claim.kind} requires lands_in_terra=${rule.lands_in_terra}`,
      );
    }
    const causal = claim.causal_action_ref ?? null;
    if (rule.causal_required && !causal) {
      throw new PolicyError(
        `claim ${claim.claim_id}: kind ${claim.kind} requires causal_action_ref`,
      );
    }
    if (!rule.causal_required && causal) {
      throw new PolicyError(
        `claim ${claim.claim_id}: kind ${claim.kind} forbids causal_action_ref`,
      );
    }
    if (causal) {
      const allowed = rule.causal_type ?? new Set(["event", "external_action"]);
      if (!allowed.has(causal.source_type)) {
        throw new PolicyError(
          `claim ${claim.claim_id}: causal_action_ref source_type ${causal.source_type} not allowed`,
        );
      }
    }
  }

  checkPatchPath(op: PatchOpLike): void {
    const patterns = PATCH_PATH_PATTERNS[op.target];
    if (!patterns) {
      throw new PatchPolicyError(`unknown patch target ${op.target}`);
    }
    if (!patterns.some((pattern) => pattern.test(op.path))) {
      throw new PatchPolicyError(
        `patch ${op.op_id}: path ${op.path} not in allowed ${op.target} paths`,
      );
    }
  }

  checkPatchShape(op: PatchOpLike): void {
    if (["add", "replace", "close"].includes(op.op) && !("value" in op)) {
      throw new PatchPolicyError(`patch ${op.op_id}: op ${op.op} requires value`);
    }
    if (op.op === "retire" && op.value !== null && op.value !== undefined) {
      throw new PatchPolicyError(`patch ${op.op_id}: retire must carry null value`);
    }
    if (
      op.op === "close" &&
      !["repaid", "cancelled", "expired", "resolved"].includes(
        op.value as string,
      )
    ) {
      throw new PatchPolicyError(
        `patch ${op.op_id}: close value must be one of repaid/cancelled/expired/resolved`,
      );
    }
  }

  checkExpectedRevision(op: PatchOpLike, baseRevision: number): void {
    if (op.expected_state_revision !== baseRevision) {
      throw new PatchPolicyError(
        `patch ${op.op_id}: expected_state_revision ${op.expected_state_revision} != base ${baseRevision}`,
      );
    }
  }

  checkCrossworld(
    claim: Claim,
    options: {
      hasExplicitUserReport: boolean;
      hasVerifiedSystemEvidence: boolean;
    },
  ): void {
    if (claim.lands_in_terra) {
      if (
        !options.hasExplicitUserReport &&
        !options.hasVerifiedSystemEvidence
      ) {
        throw new PolicyError(
          `claim ${claim.claim_id}: lands_in_terra without explicit doctor report or verified system evidence`,
        );
      }
    }
  }
}
