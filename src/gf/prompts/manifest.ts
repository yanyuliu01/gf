/**
 * Load and validate `prompts/manifest.yaml`.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";

export class Manifest {
  readonly path: string;
  readonly raw: Record<string, unknown>;
  readonly manifestHash: string;

  constructor(manifestPath: string) {
    this.path = manifestPath;
    const content = readFileSync(manifestPath, "utf-8");
    this.raw = parseYaml(content) as Record<string, unknown>;
    this.manifestHash = createHash("sha256").update(content).digest("hex");
  }

  private roleAssetEntry(name: string): unknown {
    const assets = (this.raw.role_assets ?? {}) as Record<string, unknown>;
    return assets[name];
  }

  roleAssetPath(name: string): string | null {
    const entry = this.roleAssetEntry(name);
    if (entry === undefined || entry === null) {
      return null;
    }
    if (typeof entry === "string") {
      return join(dirname(this.path), entry);
    }
    const path = (entry as Record<string, unknown>).path;
    return typeof path === "string" ? join(dirname(this.path), path) : null;
  }

  roleAssetStatus(name: string): string | null {
    const entry = this.roleAssetEntry(name);
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const status = (entry as Record<string, unknown>).status;
    return typeof status === "string" ? status : null;
  }

  readSlot(name: string): string | null {
    const path = this.roleAssetPath(name);
    if (!path) {
      return null;
    }
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return null;
    }
  }
}
