import { createHash } from "node:crypto";

import type {
  ObservationV1,
  PrivacyScope,
  SourceRef,
} from "../../generated/agentPipelineTypes.js";
import type { PerceptionPort } from "../ports.js";
import {
  computeInputClosureHash,
  normalizeSourceRefs,
} from "../../validation/derivedInputClosure.js";

export type PerceptionTrust =
  | "authenticated"
  | "attested"
  | "verified"
  | "generated"
  | "inferred";

export type PerceptionProvenanceKind =
  | "world_event"
  | "message"
  | "report"
  | "record";

export interface PerceptionProvenance {
  kind: PerceptionProvenanceKind;
  principal_id: string;
  trust: PerceptionTrust;
}

export type CandidateVisibility =
  | { kind: "hidden" }
  | { kind: "co_located"; location_id: string }
  | {
      kind: "direct_message";
      channel_id: string;
      recipient_actor_ids: readonly string[];
    }
  | { kind: "public_channel"; channel_id: string }
  | { kind: "device_feed"; feed_id: string; location_id?: string | null }
  | { kind: "npc_report"; recipient_actor_ids: readonly string[] }
  | { kind: "authorized_record"; record_id: string };

/**
 * A committed fact offered to Perception for subject-specific projection.
 *
 * The candidate is not an Observation yet. Its explicit visibility path and
 * provenance must both agree with the actor's grants before any content or
 * source can cross the boundary.
 */
export interface PerceptionCandidate {
  summary: string;
  occurred_at: string;
  privacy_scope: PrivacyScope;
  subject_ids?: readonly string[];
  source_refs: readonly SourceRef[];
  provenance: Readonly<PerceptionProvenance>;
  visibility: Readonly<CandidateVisibility>;
}

export interface PerceptionProjectionInput {
  actor_id: string;
  actor_location_id: string | null;
  private_channel_ids: readonly string[];
  public_channel_ids: readonly string[];
  device_feed_ids: readonly string[];
  authorized_record_ids: readonly string[];
  candidates: readonly Readonly<PerceptionCandidate>[];
  projected_at: string;
  projection_version: string;
  base_state_revision: number;
}

export interface PerceptionProjectionResult {
  observations: readonly ObservationV1[];
  source_refs: readonly SourceRef[];
  input_closure_hash: string;
  base_state_revision: number;
}

type SensingBasis = ObservationV1["sensing_basis"];

interface VisibleCandidate {
  candidate: Readonly<PerceptionCandidate>;
  sensingBasis: SensingBasis;
  locationId: string | null;
}

/** Pure, deterministic Perception projection over a committed snapshot. */
export class PerceptionProjector
  implements PerceptionPort<PerceptionProjectionInput, PerceptionProjectionResult>
{
  project(
    input: Readonly<PerceptionProjectionInput>,
  ): Readonly<PerceptionProjectionResult> {
    const visible = input.candidates
      .map((candidate) => this.authorize(input, candidate))
      .filter((candidate): candidate is VisibleCandidate => candidate !== null)
      .sort(compareVisibleCandidates);

    const closureSources = normalizeSourceRefs(
      visible.flatMap(({ candidate }) => candidate.source_refs),
    );
    const closureHash = computeInputClosureHash(
      input.base_state_revision,
      closureSources,
    );

    const observations = visible.map(({ candidate, sensingBasis, locationId }) => {
      const sourceRefs = normalizeSourceRefs(candidate.source_refs);
      const observationId = `obs:${hashJson({
        contract: "gf.perception.observation-id.v1",
        actor_id: input.actor_id,
        projection_version: input.projection_version,
        base_state_revision: input.base_state_revision,
        sensing_basis: sensingBasis,
        summary: candidate.summary,
        occurred_at: candidate.occurred_at,
        projected_at: input.projected_at,
        source_refs: sourceRefs,
      })}`;

      const observation: ObservationV1 = {
        schema_version: "1.0",
        observation_id: observationId,
        actor_id: input.actor_id,
        summary: candidate.summary,
        sensing_basis: sensingBasis,
        subject_ids: uniqueSortedStrings(candidate.subject_ids ?? []),
        location_id: locationId,
        privacy_scope: candidate.privacy_scope,
        source_refs: sourceRefs,
        observed_at: input.projected_at,
        projection_version: input.projection_version,
        base_state_revision: input.base_state_revision,
        input_closure_hash: closureHash,
      };
      return observation;
    });

    return {
      observations,
      source_refs: closureSources,
      input_closure_hash: closureHash,
      base_state_revision: input.base_state_revision,
    };
  }

  private authorize(
    input: Readonly<PerceptionProjectionInput>,
    candidate: Readonly<PerceptionCandidate>,
  ): VisibleCandidate | null {
    if (
      candidate.summary.trim().length === 0
      || candidate.source_refs.length === 0
      || !provenanceMatchesSources(candidate)
    ) {
      return null;
    }

    const visibility = candidate.visibility;
    switch (visibility.kind) {
      case "hidden":
        return null;
      case "co_located":
        return input.actor_location_id === visibility.location_id
          ? {
              candidate,
              sensingBasis: "co_located",
              locationId: visibility.location_id,
            }
          : null;
      case "direct_message":
        return visibility.recipient_actor_ids.includes(input.actor_id)
          && input.private_channel_ids.includes(visibility.channel_id)
          ? { candidate, sensingBasis: "direct_message", locationId: null }
          : null;
      case "public_channel":
        return input.public_channel_ids.includes(visibility.channel_id)
          ? { candidate, sensingBasis: "public_channel", locationId: null }
          : null;
      case "device_feed":
        return input.device_feed_ids.includes(visibility.feed_id)
          ? {
              candidate,
              sensingBasis: "device_feed",
              locationId: visibility.location_id ?? null,
            }
          : null;
      case "npc_report":
        return visibility.recipient_actor_ids.includes(input.actor_id)
          ? { candidate, sensingBasis: "npc_report", locationId: null }
          : null;
      case "authorized_record":
        return input.authorized_record_ids.includes(visibility.record_id)
          ? { candidate, sensingBasis: "authorized_record", locationId: null }
          : null;
    }
  }
}

function provenanceMatchesSources(
  candidate: Readonly<PerceptionCandidate>,
): boolean {
  if (candidate.provenance.principal_id.trim().length === 0) {
    return false;
  }
  const types = new Set(candidate.source_refs.map((source) => source.source_type));
  switch (candidate.provenance.kind) {
    case "world_event":
      return types.has("event")
        && (candidate.visibility.kind === "co_located"
          || candidate.visibility.kind === "public_channel"
          || candidate.visibility.kind === "device_feed");
    case "message":
      return types.has("message")
        && (candidate.visibility.kind === "direct_message"
          || candidate.visibility.kind === "public_channel");
    case "report":
      return (types.has("message") || types.has("event"))
        && candidate.visibility.kind === "npc_report";
    case "record":
      return candidate.visibility.kind === "authorized_record"
        && [...types].every((type) =>
          type === "event"
          || type === "claim"
          || type === "external_action"
          || type === "canon"
        );
  }
}

function compareVisibleCandidates(
  left: VisibleCandidate,
  right: VisibleCandidate,
): number {
  return left.candidate.occurred_at.localeCompare(right.candidate.occurred_at)
    || sourceKey(left.candidate.source_refs[0]).localeCompare(
      sourceKey(right.candidate.source_refs[0]),
    )
    || left.candidate.summary.localeCompare(right.candidate.summary);
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sourceKey(source: SourceRef): string {
  return `${source.source_type}:${source.source_id}`;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
