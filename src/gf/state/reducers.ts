/**
 * Deterministic state reducers and hashing.
 *
 * The StateManager applies patch ops to in-memory copies of the state
 * documents (`world_state`, `persona`, `inventory`), then persists the new
 * documents and a state hash. Reducers are pure functions: same documents +
 * same ops in the same order always produce the same result.
 */

import { createHash } from "node:crypto";

export type StateDocument = Record<string, unknown>;
export type Documents = Record<string, StateDocument>;

export interface PatchOp {
  op_id: string;
  target: "world_state" | "thread" | "persona" | "inventory" | "debt";
  path: string;
  op: "add" | "replace" | "retire" | "close";
  value?: unknown;
  claim_ids?: string[];
  source_refs?: unknown[];
  cause_event_ids?: string[];
  expected_state_revision: number;
  reason?: string;
}

export const EMPTY_STATE_DOCUMENTS: Documents = {
  world_state: {
    revision: 0,
    world_day: 1,
    world_phase: "dawn",
    location: "特里蒙·莱茵生命生态科",
    activity: "整理今日的实验记录",
    presence: [],
    channel_capabilities: {
      text: true,
      image: false,
      audio: false,
      files: false,
      reaction: false,
      realtime: false,
    },
    threads: {},
    debts: {},
  },
  persona: { statements: {} },
  inventory: {},
};

function splitPath(path: string): string[] {
  const parts = path.split(".");
  if (parts.length === 0 || parts.some((part) => part.length === 0)) {
    throw new Error(`invalid patch path: ${path}`);
  }
  return parts;
}

function getNested(
  root: Record<string, unknown>,
  parts: string[],
): { parent: Record<string, unknown>; key: string } {
  let node: unknown = root;
  for (const part of parts.slice(0, -1)) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      throw new Error(`missing path segment ${part}`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "object" || node === null) {
    throw new Error("invalid patch path");
  }
  return { parent: node as Record<string, unknown>, key: parts.at(-1)! };
}

function applyLeaf(
  parent: Record<string, unknown>,
  key: string,
  operation: PatchOp["op"],
  value: unknown,
): void {
  switch (operation) {
    case "add":
      if (key in parent) {
        throw new Error(`add on existing key ${key}; use replace`);
      }
      parent[key] = value;
      return;
    case "replace":
      if (!(key in parent)) {
        throw new Error(`replace on missing key ${key}`);
      }
      parent[key] = value;
      return;
    case "retire":
      if (!(key in parent)) {
        throw new Error(`retire on missing key ${key}`);
      }
      delete parent[key];
      return;
    case "close":
      if (!(key in parent)) {
        throw new Error(`close on missing key ${key}`);
      }
      parent[key] = value;
      return;
  }
}

export function applyOps(
  documents: Documents,
  ops: PatchOp[],
): Documents {
  const result = structuredClone(documents);
  for (const op of ops) {
    applyOne(result, op);
  }
  return result;
}

export function applyOne(
  documents: Documents,
  op: PatchOp,
): void {
  const { target, path, op: operation, value } = op;

  if (target === "thread") {
    const doc = (documents.world_state.threads ??= {}) as Record<
      string,
      Record<string, unknown>
    >;
    const parts = splitPath(path);
    if (operation === "close") {
      const threadId = parts[0];
      const thread = doc[threadId];
      if (!thread) {
        throw new Error(`unknown thread ${threadId}`);
      }
      thread.status = value;
      thread.open = value !== "resolved" && value !== "retired";
      return;
    }
    const { parent, key } = getNested(doc, parts);
    applyLeaf(parent, key, operation, value);
    return;
  }

  if (target === "debt") {
    const doc = (documents.world_state.debts ??= {}) as Record<
      string,
      Record<string, unknown>
    >;
    const parts = splitPath(path);
    if (operation === "close") {
      const debtId = parts[0];
      const debt = doc[debtId];
      if (!debt) {
        throw new Error(`unknown debt ${debtId}`);
      }
      debt.status = value;
      return;
    }
    const { parent, key } = getNested(doc, parts);
    applyLeaf(parent, key, operation, value);
    return;
  }

  if (target === "persona") {
    const doc = (documents.persona.statements ??= {}) as Record<
      string,
      Record<string, unknown>
    >;
    const parts = splitPath(path);
    if (operation === "add" && parts.length === 1) {
      if (typeof value !== "object" || value === null) {
        throw new Error("persona add requires an object value");
      }
      doc[parts[0]] = value as Record<string, unknown>;
      return;
    }
    const { parent, key } = getNested(doc, parts);
    applyLeaf(parent, key, operation, value);
    return;
  }

  if (target === "world_state") {
    const parts = splitPath(path);
    const { parent, key } = getNested(documents.world_state, parts);
    applyLeaf(parent, key, operation, value);
    return;
  }

  if (target === "inventory") {
    const parts = splitPath(path);
    const { parent, key } = getNested(documents.inventory, parts);
    applyLeaf(parent, key, operation, value);
    return;
  }

  throw new Error(`unknown patch target ${target}`);
}

export function computeStateHash(documents: Documents): string {
  const payload = JSON.stringify(
    Object.fromEntries(
      Object.keys(documents)
        .sort()
        .map((key) => [key, documents[key]]),
    ),
  );
  return createHash("sha256").update(payload).digest("hex");
}
