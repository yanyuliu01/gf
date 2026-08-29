import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BalancedMemoryRetriever,
  MemoryBudgetError,
  type BalancedMemoryQuery,
  type StructuredMemorySearchPort,
} from "../cognition/memory/balancedMemoryRetriever.js";
import type {
  MemoryIndexDocumentV1,
  SourceRef,
} from "../generated/agentPipelineTypes.js";
import type {
  StructuredMemoryHit,
  StructuredMemoryQuery,
} from "../cognition/memory/structuredMemorySearch.js";
import { SchemaRegistry } from "../validation/schemas.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function document(
  id: string,
  content: string,
  entityId: string,
  sourceId: string,
): MemoryIndexDocumentV1 {
  return {
    schema_version: "1.0",
    document_id: id,
    actor_id: "muelsyse",
    memory_kind: "episodic",
    content,
    visibility_scope: "internal",
    epistemic_status: "inferred",
    entity_ids: [entityId],
    relationship_ids: [],
    commitment_ids: [],
    action_outcome: null,
    source_artifact_kind: "observation",
    source_artifact_id: `observation-${id}`,
    source_refs: [{ source_type: "event", source_id: sourceId }],
    occurred_at: "2026-08-30T08:00:00+08:00",
    index_version: "memory-index.v1",
    base_state_revision: 4,
    input_closure_hash: "a".repeat(64),
  };
}

function hit(item: MemoryIndexDocumentV1, ftsRank: number): StructuredMemoryHit {
  return { document: item, ftsRank };
}

class RecordingSearch implements StructuredMemorySearchPort {
  readonly calls: StructuredMemoryQuery[] = [];

  constructor(
    private readonly supporting: readonly StructuredMemoryHit[],
    private readonly counter: readonly StructuredMemoryHit[],
  ) {}

  async search(
    query: Readonly<StructuredMemoryQuery>,
  ): Promise<readonly StructuredMemoryHit[]> {
    this.calls.push(structuredClone(query));
    return query.entityIds?.includes("counter-lane")
      ? this.counter
      : this.supporting;
  }
}

function query(overrides: Partial<BalancedMemoryQuery> = {}): BalancedMemoryQuery {
  return {
    actorId: "muelsyse",
    visiblePrivacyScopes: ["internal"],
    baseStateRevision: 4,
    supporting: { entityIds: ["support-lane"], text: "pump" },
    counter: { entityIds: ["counter-lane"], text: "sensor" },
    budget: {
      maxItems: 2,
      maxUnits: 30,
      minSupportingItems: 1,
      minCounterItems: 1,
      searchLimit: 16,
    },
    retrievalVersion: "balanced-memory.v1",
    retrievedAt: "2026-08-30T08:05:00+08:00",
    ...overrides,
  };
}

test("fixed budget reserves counter-evidence before abundant support", async () => {
  const counter = hit(
    document(
      "memory-counter",
      "A delayed sensor once produced the same apparent warning.",
      "counter-lane",
      "evt-counter",
    ),
    -8,
  );
  const supports = [1, 2, 3, 4].map((index) => hit(
    document(
      `memory-support-${index}`,
      `Pump evidence ${index}`,
      "support-lane",
      `evt-support-${index}`,
    ),
    -20 + index,
  ));
  const search = new RecordingSearch([...supports, counter], [counter]);
  const retriever = new BalancedMemoryRetriever(search);

  const bundle = await retriever.retrieve(query());
  assert.deepEqual(bundle.counter_memory_ids, ["memory-counter"]);
  assert.deepEqual(bundle.supporting_memory_ids, ["memory-support-1"]);
  assert.equal(bundle.evidence.length, 2);
  assert.equal(bundle.input_closure.base_state_revision, 4);
  assert.deepEqual(
    new Set(bundle.input_closure.source_refs.map(sourceKey)),
    new Set(["event:evt-counter", "event:evt-support-1"]),
  );
  assert.equal(search.calls.length, 2);
  assert.equal(search.calls.every((call) => call.maxBaseStateRevision === 4), true);

  const registry = new SchemaRegistry(join(ROOT, "schemas"));
  registry.validate("memory-bundle.schema.json", bundle);
});

test("changing the current supporting hypothesis cannot remove counter lane", async () => {
  const counter = hit(
    document(
      "memory-counter-stable",
      "A prior reading was contradicted by a direct manual check.",
      "counter-lane",
      "evt-counter-stable",
    ),
    -3,
  );
  const support = hit(
    document(
      "memory-support-current",
      "The current pattern resembles a water-flow interruption.",
      "support-lane",
      "evt-support-current",
    ),
    -30,
  );
  const search = new RecordingSearch([support], [counter]);
  const retriever = new BalancedMemoryRetriever(search);

  const first = await retriever.retrieve(query());
  const changed = await retriever.retrieve(query({
    supporting: {
      entityIds: ["support-lane"],
      text: "a completely different favored explanation",
    },
  }));
  assert.deepEqual(first.counter_memory_ids, ["memory-counter-stable"]);
  assert.deepEqual(changed.counter_memory_ids, first.counter_memory_ids);
  assert.deepEqual(changed.input_closure.source_refs, first.input_closure.source_refs);
});

test("mandatory contradiction fails closed when it cannot fit", async () => {
  const counter = hit(
    document(
      "memory-counter-too-large",
      "x".repeat(120),
      "counter-lane",
      "evt-counter-large",
    ),
    -1,
  );
  const support = hit(
    document(
      "memory-support-small",
      "small support",
      "support-lane",
      "evt-support-small",
    ),
    -10,
  );
  const retriever = new BalancedMemoryRetriever(
    new RecordingSearch([support], [counter]),
  );
  await assert.rejects(
    retriever.retrieve(query({
      budget: {
        maxItems: 2,
        maxUnits: 10,
        minSupportingItems: 1,
        minCounterItems: 1,
      },
    })),
    MemoryBudgetError,
  );
});

test("mandatory evidence fails closed when its combined source closure is too large", async () => {
  const counterDocument = document(
    "memory-counter-many-sources",
    "counter",
    "counter-lane",
    "evt-counter-0",
  );
  counterDocument.source_refs = Array.from({ length: 70 }, (_, index) => ({
    source_type: "event" as const,
    source_id: `evt-counter-${index}`,
  }));
  const supportDocument = document(
    "memory-support-many-sources",
    "support",
    "support-lane",
    "evt-support-0",
  );
  supportDocument.source_refs = Array.from({ length: 70 }, (_, index) => ({
    source_type: "event" as const,
    source_id: `evt-support-${index}`,
  }));
  const retriever = new BalancedMemoryRetriever(
    new RecordingSearch(
      [hit(supportDocument, -2)],
      [hit(counterDocument, -1)],
    ),
  );

  await assert.rejects(
    retriever.retrieve(query({
      budget: {
        maxItems: 2,
        maxUnits: 100,
        minSupportingItems: 1,
        minCounterItems: 1,
      },
    })),
    MemoryBudgetError,
  );
});

function sourceKey(source: SourceRef): string {
  return `${source.source_type}:${source.source_id}`;
}
