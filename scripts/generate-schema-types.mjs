#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = join(root, "schemas", "cognitive-runtime.schema.json");
const commonPath = join(root, "schemas", "common.schema.json");
const outputPath = join(root, "src", "gf", "generated", "cognitiveRuntimeTypes.ts");

const cognitive = JSON.parse(readFileSync(schemaPath, "utf8"));
const common = JSON.parse(readFileSync(commonPath, "utf8"));

const localNames = new Map([
  ["id", "Id"],
  ["timestamp", "Timestamp"],
  ["sourceRef", "SourceRef"],
  ["sourceRefs", "SourceRefs"],
  ["hash", "Sha256Hash"],
  ["purpose", "CognitivePurpose"],
  ["accessClass", "CognitiveAccessClass"],
]);

function refName(ref) {
  const [file, fragment = ""] = ref.split("#");
  const name = fragment.split("/").at(-1);
  if (!name) {
    throw new Error(`unsupported schema reference: ${ref}`);
  }
  if (file === "common.schema.json") {
    return { id: "Id", timestamp: "Timestamp", sourceRef: "SourceRef" }[name] ?? name;
  }
  if (file === "" || file === undefined) {
    return localNames.get(name) ?? name;
  }
  throw new Error(`unsupported schema reference: ${ref}`);
}

function literal(value) {
  return JSON.stringify(value);
}

function parenthesizeForArray(value) {
  return value.includes(" | ") ? `(${value})` : value;
}

function toType(schema, indent = "") {
  if (schema.$ref) {
    return refName(schema.$ref);
  }
  if (Object.hasOwn(schema, "const")) {
    return literal(schema.const);
  }
  if (schema.enum) {
    return schema.enum.map(literal).join(" | ");
  }
  if (schema.anyOf) {
    return schema.anyOf.map((part) => toType(part, indent)).join(" | ");
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => toType({ type }, indent)).join(" | ");
  }
  if (schema.type === "array") {
    return `${parenthesizeForArray(toType(schema.items ?? {}, indent))}[]`;
  }
  if (schema.type === "object") {
    const required = new Set(schema.required ?? []);
    const properties = Object.entries(schema.properties ?? {}).map(([name, child]) => {
      const optional = required.has(name) ? "" : "?";
      return `${indent}  ${JSON.stringify(name)}${optional}: ${toType(child, `${indent}  `)};`;
    });
    return `{\n${properties.join("\n")}\n${indent}}`;
  }
  if (schema.type === "string") return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "null") return "null";
  return "unknown";
}

function declaration(name, schema) {
  const type = toType(schema);
  if (schema.type === "object") {
    return `export interface ${name} ${type}`;
  }
  return `export type ${name} = ${type};`;
}

const declarations = [
  "export type Id = string;",
  "export type Timestamp = string;",
  declaration("SourceRef", common.$defs.sourceRef),
  ...Object.entries(cognitive.$defs).map(([rawName, schema]) =>
    declaration(localNames.get(rawName) ?? rawName, schema),
  ),
];

const output = [
  "/**",
  " * GENERATED FILE. DO NOT EDIT.",
  " * Source: schemas/cognitive-runtime.schema.json and schemas/common.schema.json",
  " * Regenerate with: npm run generate:types",
  " */",
  "",
  ...declarations.flatMap((value) => [value, ""]),
].join("\n");

if (process.argv.includes("--check")) {
  let current;
  try {
    current = readFileSync(outputPath, "utf8");
  } catch {
    current = "";
  }
  if (current !== output) {
    process.stderr.write("Generated cognitive runtime types are stale. Run npm run generate:types.\n");
    process.exitCode = 1;
  }
} else {
  writeFileSync(outputPath, output, "utf8");
}
