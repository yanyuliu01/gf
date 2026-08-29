import { createHash } from "node:crypto";

import type { SourceRef } from "../generated/agentPipelineTypes.js";

/** Stable, duplicate-free source order used by every derived artifact. */
export function normalizeSourceRefs(values: readonly SourceRef[]): SourceRef[] {
  const refs = new Map<string, SourceRef>();
  for (const value of values) {
    const normalized: SourceRef = {
      source_type: value.source_type,
      source_id: value.source_id,
      ...(value.quote_hash === undefined ? {} : { quote_hash: value.quote_hash }),
      ...(value.observed_at === undefined ? {} : { observed_at: value.observed_at }),
    };
    const key = sourceKey(normalized);
    const prior = refs.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) {
      throw new Error(`conflicting metadata for input source ${key}`);
    }
    refs.set(key, normalized);
  }
  return [...refs.values()].sort((left, right) =>
    sourceKey(left).localeCompare(sourceKey(right))
    || JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

/** Hash the exact call-input roots; recursively reachable provenance is legal but not implicit input. */
export function computeInputClosureHash(
  baseStateRevision: number,
  values: readonly SourceRef[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      contract: "gf.derived-input-closure.v1",
      base_state_revision: baseStateRevision,
      source_refs: normalizeSourceRefs(values),
    }))
    .digest("hex");
}

function sourceKey(source: SourceRef): string {
  return `${source.source_type}:${source.source_id}`;
}
