import { createHash } from "node:crypto";

import type {
  AttentionIntentV1,
  AttentionSubscriptionV1,
  ObservableFilterV1,
} from "../../generated/cognitiveRuntimeTypes.js";
import type { AttentionCompilerPort } from "../runtimePorts.js";
import { normalizeSourceRefs } from "../../validation/derivedInputClosure.js";

export interface AttentionCompilationContextV1 {
  observableFilter: ObservableFilterV1;
  compilerVersion: string;
  createdAt: string;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizeFilter(filter: Readonly<ObservableFilterV1>): ObservableFilterV1 {
  const normalized = {
    event_kinds: sortedUnique(filter.event_kinds),
    entity_ids: sortedUnique(filter.entity_ids),
    location_ids: sortedUnique(filter.location_ids),
    match_mode: filter.match_mode,
  };
  if (
    normalized.event_kinds.length === 0
    && normalized.entity_ids.length === 0
    && normalized.location_ids.length === 0
  ) {
    throw new Error("attention subscription requires an observable filter");
  }
  return normalized;
}

function fingerprint(
  actorId: string,
  filter: Readonly<ObservableFilterV1>,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ actor_id: actorId, filter: normalizeFilter(filter) }))
    .digest("hex");
}

/** Compiles open attention semantics only from an already adjudicated filter. */
export class AttentionCompiler
  implements AttentionCompilerPort<AttentionCompilationContextV1>
{
  compile(
    intent: Readonly<AttentionIntentV1>,
    context: Readonly<AttentionCompilationContextV1>,
  ): AttentionSubscriptionV1 {
    const filter = normalizeFilter(context.observableFilter);
    const digest = fingerprint(intent.actor_id, filter);
    return {
      schema_version: "1.0",
      subscription_id: `attention_subscription:${digest.slice(0, 32)}`,
      intent_id: intent.intent_id,
      actor_id: intent.actor_id,
      status: intent.lifecycle,
      observable_filter: filter,
      perception_only: true,
      evidence_refs: normalizeSourceRefs(intent.evidence_refs),
      compiler_version: context.compilerVersion,
      base_state_revision: intent.base_state_revision,
      created_at: context.createdAt,
      ...(intent.scope.valid_until === undefined
        ? {}
        : { expires_at: intent.scope.valid_until }),
    };
  }
}

/** Latest-record, expiry-aware, semantic deduplication for Gate input. */
export function activeAttentionSubscriptions(
  records: readonly Readonly<AttentionSubscriptionV1>[],
  now: string,
): AttentionSubscriptionV1[] {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw new Error("attention evaluation time is invalid");
  }
  const latestById = new Map<string, Readonly<AttentionSubscriptionV1>>();
  for (const record of records) {
    const prior = latestById.get(record.subscription_id);
    if (
      !prior
      || record.base_state_revision > prior.base_state_revision
      || (
        record.base_state_revision === prior.base_state_revision
        && record.created_at > prior.created_at
      )
    ) {
      latestById.set(record.subscription_id, record);
    }
  }
  const latestBySemanticFilter = new Map<
    string,
    Readonly<AttentionSubscriptionV1>
  >();
  for (const record of latestById.values()) {
    const expired = record.expires_at !== undefined
      && record.expires_at !== null
      && Date.parse(record.expires_at) <= nowMs;
    if (record.status !== "active" || expired) {
      continue;
    }
    const key = fingerprint(record.actor_id, record.observable_filter);
    const prior = latestBySemanticFilter.get(key);
    if (
      !prior
      || record.base_state_revision > prior.base_state_revision
      || (
        record.base_state_revision === prior.base_state_revision
        && record.created_at > prior.created_at
      )
    ) {
      latestBySemanticFilter.set(key, record);
    }
  }
  return [...latestBySemanticFilter.values()]
    .sort((left, right) => left.subscription_id.localeCompare(right.subscription_id))
    .map((record) => structuredClone(record));
}
