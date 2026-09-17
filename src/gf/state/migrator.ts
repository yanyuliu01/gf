/**
 * Versioned SQL migration runner.
 *
 * Migrations are applied in numeric filename-prefix order, exactly once each,
 * and recorded in `schema_migrations`. Each file is executed with `exec`
 * (files may contain their own transaction boundaries); the version is then
 * recorded if the file did not already do so.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class MigrationRunner {
  constructor(
    private readonly db: DatabaseSync,
    private readonly migrationsDir: string,
  ) {}

  private appliedVersions(): Set<string> {
    try {
      const rows = this.db
        .prepare("SELECT version FROM schema_migrations")
        .all() as { version: string }[];
      return new Set(rows.map((row) => row.version));
    } catch {
      return new Set();
    }
  }

  pending(): { version: string; path: string }[] {
    const applied = this.appliedVersions();
    const files = readdirSync(this.migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const found: { version: string; path: string }[] = [];
    for (const name of files) {
      const match = /^(\d+)_/.exec(name);
      if (!match) {
        continue;
      }
      const version = match[1];
      if (applied.has(version)) {
        continue;
      }
      found.push({ version, path: join(this.migrationsDir, name) });
    }
    return found;
  }

  currentVersion(): string | null {
    const applied = this.appliedVersions();
    return applied.size > 0
      ? [...applied].sort((a, b) => Number(a) - Number(b)).at(-1)!
      : null;
  }

  apply(upTo?: string): string[] {
    const appliedHere: string[] = [];
    for (const { version, path } of this.pending()) {
      if (upTo !== undefined && Number(version) > Number(upTo)) {
        break;
      }
      const sql = readFileSync(path, "utf-8");
      this.db.exec(sql);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO schema_migrations(version, description) VALUES (?, ?)",
        )
        .run(version, `Migration ${path}`);
      appliedHere.push(version);
    }
    return appliedHere;
  }
}
