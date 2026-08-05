/**
 * Draft 2020-12 JSON Schema loading and validation.
 *
 * All machine contracts live in `schemas/*.schema.json`. Schemas reference each
 * other through relative `$ref` values resolved against their `$id` base URIs
 * (e.g. `common.schema.json#/$defs/id`). Ajv resolves the graph when every
 * schema is registered under its `$id`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class SchemaRegistry {
  private readonly documents = new Map<string, unknown>();
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly ajv: Ajv2020;

  constructor(schemasDir: string) {
    this.ajv = new Ajv2020({
      strict: false,
      allErrors: true,
    });
    addFormats(this.ajv);

    for (const name of readdirSync(schemasDir).sort()) {
      if (!name.endsWith(".schema.json")) {
        continue;
      }
      const doc = JSON.parse(readFileSync(join(schemasDir, name), "utf-8")) as {
        $id?: string;
      };
      if (!doc.$id) {
        throw new Error(`schema without $id: ${name}`);
      }
      this.documents.set(name, doc);
    }
    for (const [name, doc] of this.documents) {
      try {
        this.ajv.addSchema(doc as object, name);
      } catch (error) {
        throw new Error(`failed to register schema ${name}: ${String(error)}`);
      }
    }
  }

  get names(): string[] {
    return [...this.documents.keys()].sort();
  }

  validate(schemaName: string, value: unknown): void {
    let validator = this.validators.get(schemaName);
    if (!validator) {
      const doc = this.documents.get(schemaName);
      if (!doc) {
        throw new Error(`unknown schema ${schemaName}`);
      }
      validator = this.ajv.compile(doc as object);
      this.validators.set(schemaName, validator);
    }
    const valid = validator(value);
    if (!valid && validator.errors?.length) {
      const first = validator.errors[0];
      const path =
        first.instancePath && first.instancePath.length > 0
          ? first.instancePath
          : "$";
      throw new ValidationError(
        `${schemaName}: ${path}: ${first.message}`,
      );
    }
  }

  isValid(schemaName: string, value: unknown): boolean {
    try {
      this.validate(schemaName, value);
      return true;
    } catch {
      return false;
    }
  }
}
