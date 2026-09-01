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
import { Ajv2020 } from "ajv/dist/2020.js";
import * as AjvFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv/dist/2020.js";

type AjvInstance = InstanceType<typeof Ajv2020>;
const addFormats = (
  AjvFormatsModule as unknown as {
    default?: (ajv: AjvInstance) => void;
  }
).default!;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class SchemaRegistry {
  private readonly documents = new Map<string, unknown>();
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly ajv: AjvInstance;

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

  document(schemaName: string): Record<string, unknown> {
    const document = this.documents.get(schemaName);
    if (!document) {
      throw new Error(`unknown schema ${schemaName}`);
    }
    return structuredClone(document) as Record<string, unknown>;
  }

  inlineDocument(schemaName: string): Record<string, unknown> {
    const root = this.document(schemaName);
    return this.resolveReferences(root, schemaName, []) as Record<
      string,
      unknown
    >;
  }

  private resolveReferences(
    value: unknown,
    currentDocumentName: string,
    stack: string[],
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item) =>
        this.resolveReferences(item, currentDocumentName, stack));
    }
    if (typeof value !== "object" || value === null) {
      return value;
    }
    const record = value as Record<string, unknown>;
    const reference = record.$ref;
    if (typeof reference === "string") {
      const [documentName, fragment = ""] = reference.split("#", 2);
      const targetName = documentName || currentDocumentName;
      const qualifiedReference = `${targetName}#${fragment}`;
      if (stack.includes(qualifiedReference)) {
        throw new Error(`cyclic schema reference ${reference}`);
      }
      const targetDocument = this.documents.get(targetName);
      if (!targetDocument) {
        throw new Error(`unknown schema reference ${reference}`);
      }
      let target: unknown = targetDocument;
      if (fragment) {
        if (!fragment.startsWith("/")) {
          throw new Error(`unsupported schema fragment ${reference}`);
        }
        for (const token of fragment.slice(1).split("/")) {
          const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
          if (typeof target !== "object" || target === null || !(key in target)) {
            throw new Error(`unknown schema fragment ${reference}`);
          }
          target = (target as Record<string, unknown>)[key];
        }
      }
      const siblings = Object.fromEntries(
        Object.entries(record).filter(([key]) => key !== "$ref"),
      );
      const resolved = this.resolveReferences(
        structuredClone(target),
        targetName,
        [...stack, qualifiedReference],
      );
      if (Object.keys(siblings).length === 0) {
        return resolved;
      }
      if (
        typeof resolved !== "object"
        || resolved === null
        || Array.isArray(resolved)
      ) {
        throw new Error(
          `cannot merge schema reference siblings for ${reference}`,
        );
      }
      return {
        ...(resolved as Record<string, unknown>),
        ...(this.resolveReferences(
          siblings,
          currentDocumentName,
          stack,
        ) as Record<string, unknown>),
      };
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        this.resolveReferences(item, currentDocumentName, stack),
      ]),
    );
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
