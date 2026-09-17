import type { DatabaseSync } from "node:sqlite";

import type {
  MemoryIndexDocumentV1,
  PrivacyScope,
} from "../../generated/agentPipelineTypes.js";

export type MemoryEpistemicStatus = MemoryIndexDocumentV1["epistemic_status"];
export type MemoryKind = MemoryIndexDocumentV1["memory_kind"];
export type OutcomeStatus = NonNullable<
  MemoryIndexDocumentV1["action_outcome"]
>["outcome_status"];
export type HardConstraintClass = NonNullable<
  MemoryIndexDocumentV1["action_outcome"]
>["hard_constraint_classes"][number];

export interface StructuredMemoryQuery {
  actorId: string;
  visiblePrivacyScopes: readonly PrivacyScope[];
  entityIds?: readonly string[];
  relationshipIds?: readonly string[];
  commitmentIds?: readonly string[];
  epistemicStatuses?: readonly MemoryEpistemicStatus[];
  memoryKinds?: readonly MemoryKind[];
  occurredFrom?: string;
  occurredTo?: string;
  maxBaseStateRevision?: number;
  outcomeStatuses?: readonly OutcomeStatus[];
  hardConstraintClasses?: readonly HardConstraintClass[];
  text?: string;
  candidateLimit?: number;
  limit?: number;
}

export interface StructuredMemoryHit {
  document: MemoryIndexDocumentV1;
  ftsRank: number | null;
}

export class StructuredMemorySearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredMemorySearchError";
  }
}

/**
 * Structured filters define the legal candidate set. FTS5 only reranks that
 * set and therefore cannot erase a non-lexical match such as a shared
 * adjudication outcome shape.
 */
export class StructuredMemorySearch {
  constructor(private readonly connFactory: () => DatabaseSync) {}

  async search(
    query: Readonly<StructuredMemoryQuery>,
  ): Promise<readonly StructuredMemoryHit[]> {
    const limit = query.limit ?? 20;
    const candidateLimit = query.candidateLimit ?? Math.max(limit, 200);
    validateQuery(query, limit, candidateLimit);

    const db = this.connFactory();
    try {
      const where = ["document.actor_id = ?"];
      const params: Array<string | number> = [query.actorId];
      addInClause(
        where,
        params,
        "document.visibility_scope",
        query.visiblePrivacyScopes,
      );
      addInClause(where, params, "document.epistemic_status", query.epistemicStatuses);
      addInClause(where, params, "document.memory_kind", query.memoryKinds);
      addInClause(where, params, "document.outcome_status", query.outcomeStatuses);
      addExistenceFilter(
        where,
        params,
        "memory_index_entities",
        "entity_id",
        query.entityIds,
      );
      addExistenceFilter(
        where,
        params,
        "memory_index_relationships",
        "relationship_id",
        query.relationshipIds,
      );
      addExistenceFilter(
        where,
        params,
        "memory_index_commitments",
        "commitment_id",
        query.commitmentIds,
      );
      addExistenceFilter(
        where,
        params,
        "memory_index_outcome_constraints",
        "hard_constraint_class",
        query.hardConstraintClasses,
      );
      if (query.occurredFrom) {
        where.push("julianday(document.occurred_at) >= julianday(?)");
        params.push(query.occurredFrom);
      }
      if (query.occurredTo) {
        where.push("julianday(document.occurred_at) <= julianday(?)");
        params.push(query.occurredTo);
      }
      if (query.maxBaseStateRevision !== undefined) {
        where.push("document.base_state_revision <= ?");
        params.push(query.maxBaseStateRevision);
      }

      const rows = db.prepare(
        `
        SELECT document.document_id, document.payload_json,
               document.occurred_at
        FROM memory_index_documents AS document
        WHERE ${where.join(" AND ")}
        ORDER BY julianday(document.occurred_at) DESC, document.document_id
        LIMIT ?
        `,
      ).all(...params, candidateLimit) as {
        document_id: string;
        payload_json: string;
        occurred_at: string;
      }[];

      const ranks = this.ftsRanks(db, rows.map((row) => row.document_id), query.text);
      return rows
        .map((row) => ({
          document: JSON.parse(row.payload_json) as MemoryIndexDocumentV1,
          ftsRank: ranks.get(row.document_id) ?? null,
        }))
        .sort(compareHits)
        .slice(0, limit);
    } finally {
      db.close();
    }
  }

  private ftsRanks(
    db: DatabaseSync,
    documentIds: readonly string[],
    text: string | undefined,
  ): Map<string, number> {
    const expression = toFtsExpression(text);
    if (!expression || documentIds.length === 0) {
      return new Map();
    }
    const placeholders = documentIds.map(() => "?").join(", ");
    const rows = db.prepare(
      `
      SELECT document_id,
             bm25(memory_index_fts, 0.0, 1.0, 0.7, 0.7) AS rank
      FROM memory_index_fts
      WHERE memory_index_fts MATCH ?
        AND document_id IN (${placeholders})
      `,
    ).all(expression, ...documentIds) as {
      document_id: string;
      rank: number;
    }[];
    return new Map(rows.map((row) => [row.document_id, Number(row.rank)]));
  }
}

function validateQuery(
  query: Readonly<StructuredMemoryQuery>,
  limit: number,
  candidateLimit: number,
): void {
  if (query.actorId.trim().length === 0) {
    throw new StructuredMemorySearchError("actorId is required");
  }
  if (query.visiblePrivacyScopes.length === 0) {
    throw new StructuredMemorySearchError(
      "at least one visible privacy scope is required",
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 128) {
    throw new StructuredMemorySearchError("limit must be an integer from 1 to 128");
  }
  if (
    !Number.isInteger(candidateLimit)
    || candidateLimit < limit
    || candidateLimit > 1000
  ) {
    throw new StructuredMemorySearchError(
      "candidateLimit must be an integer between limit and 1000",
    );
  }
  for (const [label, value] of [
    ["occurredFrom", query.occurredFrom],
    ["occurredTo", query.occurredTo],
  ] as const) {
    if (value !== undefined && Number.isNaN(Date.parse(value))) {
      throw new StructuredMemorySearchError(`${label} must be an ISO timestamp`);
    }
  }
  if (
    query.maxBaseStateRevision !== undefined
    && (!Number.isInteger(query.maxBaseStateRevision)
      || query.maxBaseStateRevision < 0)
  ) {
    throw new StructuredMemorySearchError(
      "maxBaseStateRevision must be a non-negative integer",
    );
  }
}

function addInClause<T extends string>(
  where: string[],
  params: Array<string | number>,
  column: string,
  values: readonly T[] | undefined,
): void {
  const unique = uniqueStrings(values);
  if (unique.length === 0) {
    return;
  }
  where.push(`${column} IN (${unique.map(() => "?").join(", ")})`);
  params.push(...unique);
}

function addExistenceFilter<T extends string>(
  where: string[],
  params: Array<string | number>,
  table: string,
  column: string,
  values: readonly T[] | undefined,
): void {
  const unique = uniqueStrings(values);
  if (unique.length === 0) {
    return;
  }
  where.push(
    `EXISTS (
      SELECT 1 FROM ${table} AS filter
      WHERE filter.document_id = document.document_id
        AND filter.${column} IN (${unique.map(() => "?").join(", ")})
    )`,
  );
  params.push(...unique);
}

function uniqueStrings<T extends string>(values: readonly T[] | undefined): T[] {
  return [...new Set(values ?? [])].sort() as T[];
}

function toFtsExpression(text: string | undefined): string | null {
  const terms = (text ?? "")
    .trim()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 32);
  if (terms.length === 0) {
    return null;
  }
  return terms
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
}

function compareHits(left: StructuredMemoryHit, right: StructuredMemoryHit): number {
  if (left.ftsRank !== null && right.ftsRank === null) return -1;
  if (left.ftsRank === null && right.ftsRank !== null) return 1;
  if (left.ftsRank !== null && right.ftsRank !== null) {
    const rankOrder = left.ftsRank - right.ftsRank;
    if (rankOrder !== 0) return rankOrder;
  }
  return Date.parse(right.document.occurred_at) - Date.parse(left.document.occurred_at)
    || left.document.document_id.localeCompare(right.document.document_id);
}
