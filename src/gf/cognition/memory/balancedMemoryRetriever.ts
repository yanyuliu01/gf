import { createHash } from "node:crypto";

import type {
  MemoryBundleV1,
  MemoryEvidenceV1,
  PrivacyScope,
} from "../../generated/agentPipelineTypes.js";
import {
  computeInputClosureHash,
  normalizeSourceRefs,
} from "../../validation/derivedInputClosure.js";
import type { MemoryRetrieverPort } from "../ports.js";
import type {
  StructuredMemoryHit,
  StructuredMemoryQuery,
} from "./structuredMemorySearch.js";

export type EvidenceRoleQuery = Omit<
  StructuredMemoryQuery,
  "actorId" | "visiblePrivacyScopes" | "limit" | "maxBaseStateRevision"
>;

export interface MemoryContextBudget {
  maxItems: number;
  maxUnits: number;
  minSupportingItems: number;
  minCounterItems: number;
  searchLimit?: number;
}

export interface BalancedMemoryQuery {
  actorId: string;
  visiblePrivacyScopes: readonly PrivacyScope[];
  baseStateRevision: number;
  supporting: Readonly<EvidenceRoleQuery>;
  counter: Readonly<EvidenceRoleQuery>;
  budget: Readonly<MemoryContextBudget>;
  retrievalVersion: string;
  retrievedAt: string;
}

export class MemoryBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryBudgetError";
  }
}

export interface StructuredMemorySearchPort {
  search(
    query: Readonly<StructuredMemoryQuery>,
  ): Promise<readonly StructuredMemoryHit[]>;
}

/** Dual-lane retrieval with non-negotiable support and contradiction reserves. */
export class BalancedMemoryRetriever
  implements MemoryRetrieverPort<BalancedMemoryQuery, MemoryBundleV1>
{
  constructor(private readonly search: StructuredMemorySearchPort) {}

  async retrieve(
    query: Readonly<BalancedMemoryQuery>,
  ): Promise<Readonly<MemoryBundleV1>> {
    validateBudget(query);
    const searchLimit = query.budget.searchLimit ?? 64;
    const common = {
      actorId: query.actorId,
      visiblePrivacyScopes: query.visiblePrivacyScopes,
      maxBaseStateRevision: query.baseStateRevision,
      limit: searchLimit,
    };
    const [supportHits, counterHits] = await Promise.all([
      this.search.search({ ...query.supporting, ...common }),
      this.search.search({ ...query.counter, ...common }),
    ]);

    const counter = uniqueHits(counterHits);
    const counterIds = new Set(counter.map((hit) => hit.document.document_id));
    const supporting = uniqueHits(supportHits).filter(
      (hit) => !counterIds.has(hit.document.document_id),
    );
    const selection = selectUnderBudget(supporting, counter, query.budget);
    if (selection.items.length === 0) {
      throw new MemoryBudgetError("no source-linked memory fits the retrieval query");
    }

    const evidence = selection.items.map(({ hit }) => toEvidence(hit));
    const inputSources = normalizeSourceRefs(
      evidence.flatMap((item) => item.source_refs),
    );
    const closureHash = computeInputClosureHash(
      query.baseStateRevision,
      inputSources,
    );
    const supportingIds = selection.items
      .filter((item) => item.role === "supporting")
      .map((item) => item.hit.document.document_id);
    const counterIdsSelected = selection.items
      .filter((item) => item.role === "counter")
      .map((item) => item.hit.document.document_id);
    const bundleId = `memory-bundle:${hashJson({
      contract: "gf.balanced-memory-bundle.v1",
      actor_id: query.actorId,
      base_state_revision: query.baseStateRevision,
      evidence_ids: evidence.map((item) => item.memory_id),
      supporting_ids: supportingIds,
      counter_ids: counterIdsSelected,
      closure_hash: closureHash,
      retrieval_version: query.retrievalVersion,
      retrieved_at: query.retrievedAt,
    })}`;

    return {
      schema_version: "1.0",
      bundle_id: bundleId,
      actor_id: query.actorId,
      evidence,
      supporting_memory_ids: supportingIds,
      counter_memory_ids: counterIdsSelected,
      input_closure: {
        source_refs: inputSources,
        closure_hash: closureHash,
        base_state_revision: query.baseStateRevision,
      },
      retrieval_version: query.retrievalVersion,
      retrieved_at: query.retrievedAt,
    };
  }
}

type SelectedRole = "supporting" | "counter";

interface SelectedMemory {
  role: SelectedRole;
  hit: StructuredMemoryHit;
  units: number;
}

function selectUnderBudget(
  supporting: readonly StructuredMemoryHit[],
  counter: readonly StructuredMemoryHit[],
  budget: Readonly<MemoryContextBudget>,
): { items: SelectedMemory[]; usedUnits: number } {
  const selected: SelectedMemory[] = [];
  const selectedIds = new Set<string>();
  const selectedSourceKeys = new Set<string>();
  let usedUnits = 0;

  const add = (
    hit: StructuredMemoryHit,
    role: SelectedRole,
    required: boolean,
  ): boolean => {
    if (selectedIds.has(hit.document.document_id)) return true;
    const units = estimateUnits(hit.document.content);
    const newSourceKeys = hit.document.source_refs
      .map((source) => `${source.source_type}:${source.source_id}`)
      .filter((key) => !selectedSourceKeys.has(key));
    const fits = selected.length < budget.maxItems
      && usedUnits + units <= budget.maxUnits
      && selectedSourceKeys.size + newSourceKeys.length <= 128;
    if (!fits && required) {
      throw new MemoryBudgetError(
        `mandatory ${role} evidence ${hit.document.document_id} does not fit fixed context budget`,
      );
    }
    if (!fits) return false;
    selected.push({ role, hit, units });
    selectedIds.add(hit.document.document_id);
    for (const key of newSourceKeys) selectedSourceKeys.add(key);
    usedUnits += units;
    return true;
  };

  const requiredCounters = Math.min(budget.minCounterItems, counter.length);
  for (let index = 0; index < requiredCounters; index += 1) {
    add(counter[index], "counter", true);
  }
  const requiredSupporting = Math.min(
    budget.minSupportingItems,
    supporting.length,
  );
  for (let index = 0; index < requiredSupporting; index += 1) {
    add(supporting[index], "supporting", true);
  }

  let supportIndex = requiredSupporting;
  let counterIndex = requiredCounters;
  while (
    selected.length < budget.maxItems
    && (supportIndex < supporting.length || counterIndex < counter.length)
  ) {
    let progressed = false;
    if (supportIndex < supporting.length) {
      progressed = add(supporting[supportIndex], "supporting", false) || progressed;
      supportIndex += 1;
    }
    if (counterIndex < counter.length && selected.length < budget.maxItems) {
      progressed = add(counter[counterIndex], "counter", false) || progressed;
      counterIndex += 1;
    }
    if (!progressed && usedUnits >= budget.maxUnits) break;
  }
  return { items: selected, usedUnits };
}

function validateBudget(query: Readonly<BalancedMemoryQuery>): void {
  const budget = query.budget;
  for (const [name, value] of [
    ["maxItems", budget.maxItems],
    ["maxUnits", budget.maxUnits],
    ["minSupportingItems", budget.minSupportingItems],
    ["minCounterItems", budget.minCounterItems],
  ] as const) {
    if (!Number.isInteger(value) || value < (name.startsWith("max") ? 1 : 0)) {
      throw new MemoryBudgetError(`${name} has an invalid fixed budget value`);
    }
  }
  if (budget.maxItems > 128) {
    throw new MemoryBudgetError("maxItems exceeds MemoryBundleV1 capacity");
  }
  if (budget.minSupportingItems + budget.minCounterItems > budget.maxItems) {
    throw new MemoryBudgetError("mandatory evidence slots exceed maxItems");
  }
  const searchLimit = budget.searchLimit ?? 64;
  if (!Number.isInteger(searchLimit) || searchLimit < 1 || searchLimit > 128) {
    throw new MemoryBudgetError("searchLimit must be an integer from 1 to 128");
  }
  if (!Number.isInteger(query.baseStateRevision) || query.baseStateRevision < 0) {
    throw new MemoryBudgetError("baseStateRevision must be non-negative");
  }
}

function uniqueHits(hits: readonly StructuredMemoryHit[]): StructuredMemoryHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const id = hit.document.document_id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function toEvidence(hit: StructuredMemoryHit): MemoryEvidenceV1 {
  const kind = hit.document.memory_kind === "action_outcome"
    ? "episodic"
    : hit.document.memory_kind;
  return {
    memory_id: hit.document.document_id,
    kind,
    summary: hit.document.content,
    source_refs: normalizeSourceRefs(hit.document.source_refs),
    as_of: hit.document.occurred_at,
  };
}

function estimateUnits(content: string): number {
  return Math.max(1, Math.ceil(Array.from(content).length / 4));
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
