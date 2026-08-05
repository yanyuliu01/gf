/**
 * Identifier and timestamp helpers.
 *
 * All runtime IDs follow the machine-contract pattern
 * `^[A-Za-z0-9][A-Za-z0-9._:-]*$` (see schemas/common.schema.json `$defs/id`).
 */

import { randomUUID } from "node:crypto";

export function newId(prefix: string, length = 8): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, length)}`;
}

export function utcnowIso(): string {
  return new Date().toISOString().replace("Z", "000Z");
}

/** Parse an ISO-8601 timestamp produced by {@link utcnowIso}. */
export function parseIso(value: string): Date {
  const normalized = value.endsWith("Z")
    ? value
    : `${value}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid ISO timestamp: ${value}`);
  }
  return parsed;
}
