/**
 * SQLite connection management over the built-in `node:sqlite` driver.
 *
 * Every connection runs with `PRAGMA foreign_keys = ON` (per
 * migrations/README.md) and WAL mode; the single-writer StateManager relies on
 * `BEGIN IMMEDIATE` to serialize writers.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function connect(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 30000");
  db.exec("PRAGMA journal_mode = WAL");
  const row = db.prepare("PRAGMA foreign_keys").get() as {
    foreign_keys: number;
  };
  if (row.foreign_keys !== 1) {
    throw new Error("PRAGMA foreign_keys could not be enabled");
  }
  return db;
}
