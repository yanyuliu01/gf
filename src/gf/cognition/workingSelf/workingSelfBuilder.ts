import { createHash } from "node:crypto";

import type {
  MemoryBundleV1,
  MemoryEvidenceV1,
  SourceRef,
  WorkingSelfEvidenceV1,
  WorkingSelfV1,
} from "../../generated/agentPipelineTypes.js";
import type { CognitiveCapacityEnvelopeV2 } from "../../generated/cognitiveRuntimeTypes.js";
import {
  computeInputClosureHash,
  normalizeSourceRefs,
} from "../../validation/derivedInputClosure.js";
import type { WorkingSelfBuilderPort } from "../ports.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_EVIDENCE = 256;
const MAX_SOURCES = 128;

export type WorkingSelfEvidenceOrigin =
  | "current_input"
  | "safety"
  | "current_fact"
  | "recent_cognitive_episode"
  | "activity"
  | "physiology"
  | "commitment_source"
  | "belief"
  | "open_loop"
  | "persona"
  | "lived_evidence";

export interface WorkingSelfCandidate {
  evidenceId: string;
  origin: WorkingSelfEvidenceOrigin;
  narrative: string;
  sourceRefs: readonly SourceRef[];
  asOf?: string | null;
}

export type OptionalWorkingSelfOrigin = Extract<
  WorkingSelfEvidenceOrigin,
  | "recent_cognitive_episode"
  | "belief"
  | "open_loop"
  | "persona"
  | "lived_evidence"
>;

export interface OptionalWorkingSelfContribution
  extends Omit<WorkingSelfCandidate, "origin"> {
  origin: OptionalWorkingSelfOrigin;
}

export interface WorkingSelfBuildInput {
  episodeId: string;
  actorId: string;
  baseStateRevision: number;
  evidence: readonly WorkingSelfCandidate[];
  memoryBundle?: Readonly<MemoryBundleV1>;
  optionalContributions?: readonly OptionalWorkingSelfContribution[];
  capacityEnvelope: Readonly<CognitiveCapacityEnvelopeV2>;
  assemblerVersion: string;
  assembledAt: string;
}

export class WorkingSelfBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkingSelfBuildError";
  }
}

interface PreparedEvidence {
  evidence: WorkingSelfEvidenceV1;
  required: boolean;
  units: number;
}

/** Pure assembly of one source-closed, capacity-bounded cognitive view. */
export class WorkingSelfBuilder
  implements WorkingSelfBuilderPort<WorkingSelfBuildInput, WorkingSelfV1>
{
  build(input: Readonly<WorkingSelfBuildInput>): Readonly<WorkingSelfV1> {
    validateBuildInput(input);
    const prepared = [
      ...input.evidence.map(prepareCandidate),
      ...prepareMemory(input.memoryBundle),
      ...(input.optionalContributions ?? []).map((candidate) => ({
        ...prepareCandidate(candidate),
        required: false,
      })),
    ];
    assertUniqueEvidence(prepared);

    const required = prepared.filter((item) => item.required);
    const optional = prepared.filter((item) => !item.required);
    const selected: PreparedEvidence[] = [];
    const selectedSources = new Map<string, SourceRef>();
    let usedUnits = 0;

    const add = (item: PreparedEvidence, failIfMissing: boolean): boolean => {
      const newSources = normalizeSourceRefs(item.evidence.source_refs).filter(
        (source) => !selectedSources.has(sourceKey(source)),
      );
      const fits = selected.length < MAX_EVIDENCE
        && usedUnits + item.units <= input.capacityEnvelope.max_semantic_input_units
        && selectedSources.size + newSources.length <= MAX_SOURCES;
      if (!fits && failIfMissing) {
        throw new WorkingSelfBuildError(
          `mandatory evidence ${item.evidence.evidence_id} does not fit Working Self capacity`,
        );
      }
      if (!fits) return false;
      selected.push(item);
      usedUnits += item.units;
      for (const source of newSources) selectedSources.set(sourceKey(source), source);
      return true;
    };

    for (const item of required) add(item, true);
    assertMandatoryClosure(input.capacityEnvelope.mandatory_source_refs, selectedSources);
    for (const item of optional) add(item, false);
    if (selected.length === 0) {
      throw new WorkingSelfBuildError("Working Self cannot be empty");
    }

    const evidence = selected.map((item) => item.evidence);
    const sourceRefs = normalizeSourceRefs(
      evidence.flatMap((item) => item.source_refs),
    );
    const closureHash = computeInputClosureHash(
      input.baseStateRevision,
      sourceRefs,
    );
    const workingSelfId = `working-self:${hashJson({
      contract: "gf.working-self-builder.v1",
      episode_id: input.episodeId,
      actor_id: input.actorId,
      base_state_revision: input.baseStateRevision,
      evidence,
      closure_hash: closureHash,
      assembler_version: input.assemblerVersion,
      assembled_at: input.assembledAt,
    })}`;

    return {
      schema_version: "1.0",
      working_self_id: workingSelfId,
      episode_id: input.episodeId,
      actor_id: input.actorId,
      evidence,
      input_closure: {
        source_refs: sourceRefs,
        closure_hash: closureHash,
        base_state_revision: input.baseStateRevision,
      },
      assembler_version: input.assemblerVersion,
      assembled_at: input.assembledAt,
    };
  }
}

function prepareCandidate(
  candidate: Readonly<WorkingSelfCandidate>,
): PreparedEvidence {
  validateId(candidate.evidenceId, "evidenceId");
  validateNarrative(candidate.narrative, candidate.evidenceId);
  validateTimestamp(candidate.asOf, `asOf for ${candidate.evidenceId}`, true);
  const sourceRefs = validateSources(candidate.sourceRefs, candidate.evidenceId);
  const role = roleForOrigin(candidate.origin);
  return {
    evidence: {
      evidence_id: candidate.evidenceId,
      role,
      narrative: candidate.narrative,
      source_refs: sourceRefs,
      ...(candidate.asOf === undefined ? {} : { as_of: candidate.asOf }),
    },
    required: isRequiredOrigin(candidate.origin),
    units: estimateUnits(candidate.narrative),
  };
}

function prepareMemory(
  bundle: Readonly<MemoryBundleV1> | undefined,
): PreparedEvidence[] {
  if (!bundle) return [];
  validateMemoryBundle(bundle);
  const counterIds = new Set(bundle.counter_memory_ids);
  return bundle.evidence.map((memory) => {
    const role = counterIds.has(memory.memory_id)
      ? "counter_evidence"
      : roleForMemory(memory);
    return {
      evidence: {
        evidence_id: memory.memory_id,
        role,
        narrative: memory.summary,
        source_refs: normalizeSourceRefs(memory.source_refs),
        as_of: memory.as_of,
      },
      required: role === "counter_evidence",
      units: estimateUnits(memory.summary),
    };
  });
}

function validateBuildInput(input: Readonly<WorkingSelfBuildInput>): void {
  validateId(input.episodeId, "episodeId");
  validateId(input.actorId, "actorId");
  validateId(input.assemblerVersion, "assemblerVersion");
  validateTimestamp(input.assembledAt, "assembledAt");
  if (!Number.isInteger(input.baseStateRevision) || input.baseStateRevision < 0) {
    throw new WorkingSelfBuildError("baseStateRevision must be non-negative");
  }
  const envelope = input.capacityEnvelope;
  if (
    envelope.schema_version !== "2.0"
    || envelope.visibility !== "engine_only"
    || envelope.actor_id !== input.actorId
    || envelope.base_state_revision !== input.baseStateRevision
  ) {
    throw new WorkingSelfBuildError(
      "capacity envelope must be engine-only and match actor/revision",
    );
  }
  if (
    !Number.isInteger(envelope.max_semantic_input_units)
    || envelope.max_semantic_input_units < 0
  ) {
    throw new WorkingSelfBuildError("capacity envelope has invalid semantic limit");
  }
  validateSources(envelope.mandatory_source_refs, "capacity envelope");
  if (input.memoryBundle) {
    if (
      input.memoryBundle.actor_id !== input.actorId
      || input.memoryBundle.input_closure.base_state_revision !== input.baseStateRevision
    ) {
      throw new WorkingSelfBuildError(
        "memory bundle must match Working Self actor/revision",
      );
    }
  }
}

function validateMemoryBundle(bundle: Readonly<MemoryBundleV1>): void {
  const closureSources = normalizeSourceRefs(bundle.input_closure.source_refs);
  const expectedHash = computeInputClosureHash(
    bundle.input_closure.base_state_revision,
    closureSources,
  );
  if (bundle.input_closure.closure_hash !== expectedHash) {
    throw new WorkingSelfBuildError("memory bundle has a forged input closure");
  }
  const evidenceIds = new Set(bundle.evidence.map((item) => item.memory_id));
  const supporting = new Set(bundle.supporting_memory_ids);
  for (const id of [...supporting, ...bundle.counter_memory_ids]) {
    if (!evidenceIds.has(id)) {
      throw new WorkingSelfBuildError(`memory role references missing evidence ${id}`);
    }
  }
  for (const id of bundle.counter_memory_ids) {
    if (supporting.has(id)) {
      throw new WorkingSelfBuildError(`memory evidence ${id} has conflicting roles`);
    }
  }
  const closureKeys = new Set(closureSources.map(sourceKey));
  for (const memory of bundle.evidence) {
    validateId(memory.memory_id, "memoryId");
    validateNarrative(memory.summary, memory.memory_id);
    validateTimestamp(memory.as_of, `asOf for ${memory.memory_id}`);
    for (const source of validateSources(memory.source_refs, memory.memory_id)) {
      if (!closureKeys.has(sourceKey(source))) {
        throw new WorkingSelfBuildError(
          `memory ${memory.memory_id} escapes its input closure`,
        );
      }
    }
  }
}

function roleForOrigin(
  origin: WorkingSelfEvidenceOrigin,
): WorkingSelfEvidenceV1["role"] {
  switch (origin) {
    case "current_input": return "current_input";
    case "safety": return "safety";
    case "current_fact":
    case "physiology": return "current_fact";
    case "recent_cognitive_episode":
    case "lived_evidence": return "lived_evidence";
    case "activity": return "activity";
    case "commitment_source": return "commitment_evidence";
    case "belief": return "belief";
    case "open_loop": return "open_loop";
    case "persona": return "persona";
  }
}

function roleForMemory(memory: Readonly<MemoryEvidenceV1>): WorkingSelfEvidenceV1["role"] {
  switch (memory.kind) {
    case "belief": return "belief";
    case "open_loop": return "open_loop";
    case "self_statement": return "persona";
    case "cognitive_episode": return "lived_evidence";
    case "episodic":
    case "relationship_evidence": return "memory";
  }
}

function isRequiredOrigin(origin: WorkingSelfEvidenceOrigin): boolean {
  return origin === "current_input"
    || origin === "safety"
    || origin === "current_fact"
    || origin === "activity"
    || origin === "physiology"
    || origin === "commitment_source";
}

function assertUniqueEvidence(items: readonly PreparedEvidence[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.evidence.evidence_id)) {
      throw new WorkingSelfBuildError(
        `duplicate Working Self evidence ${item.evidence.evidence_id}`,
      );
    }
    seen.add(item.evidence.evidence_id);
  }
}

function assertMandatoryClosure(
  mandatory: readonly SourceRef[],
  selectedSources: ReadonlyMap<string, SourceRef>,
): void {
  for (const source of normalizeSourceRefs(mandatory)) {
    if (!selectedSources.has(sourceKey(source))) {
      throw new WorkingSelfBuildError(
        `mandatory source ${sourceKey(source)} has no mandatory Working Self evidence`,
      );
    }
  }
}

function validateSources(
  sources: readonly SourceRef[],
  label: string,
): SourceRef[] {
  const normalized = normalizeSourceRefs(sources);
  if (normalized.length === 0 || normalized.length > MAX_SOURCES) {
    throw new WorkingSelfBuildError(`${label} must have 1-${MAX_SOURCES} sources`);
  }
  for (const source of normalized) {
    if (!["message", "event", "claim", "external_action", "canon"].includes(
      source.source_type,
    )) {
      throw new WorkingSelfBuildError(`${label} contains an invalid source type`);
    }
    validateId(source.source_id, `${label} source id`);
    if (
      source.quote_hash !== undefined
      && source.quote_hash !== null
      && !/^[A-Fa-f0-9]{64}$/.test(source.quote_hash)
    ) {
      throw new WorkingSelfBuildError(`${label} contains an invalid quote hash`);
    }
    validateTimestamp(source.observed_at, `${label} observedAt`, true);
  }
  return normalized;
}

function validateId(value: string, label: string): void {
  if (value.length < 1 || value.length > 128 || !ID_PATTERN.test(value)) {
    throw new WorkingSelfBuildError(`${label} is not a valid id`);
  }
}

function validateNarrative(value: string, label: string): void {
  if (value.length < 1 || value.length > 4000) {
    throw new WorkingSelfBuildError(`${label} narrative must contain 1-4000 characters`);
  }
}

function validateTimestamp(
  value: string | null | undefined,
  label: string,
  allowNull = false,
): void {
  if ((value === undefined || value === null) && allowNull) return;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new WorkingSelfBuildError(`${label} must be an ISO timestamp`);
  }
}

function estimateUnits(narrative: string): number {
  return Math.max(1, Math.ceil(Array.from(narrative).length / 4));
}

function sourceKey(source: SourceRef): string {
  return `${source.source_type}:${source.source_id}`;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
