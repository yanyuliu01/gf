#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootFlag = process.argv.indexOf("--root");
const root = rootFlag >= 0
  ? resolve(process.argv[rootFlag + 1])
  : dirname(dirname(fileURLToPath(import.meta.url)));
const commonPath = join(root, "schemas", "common.schema.json");
const common = JSON.parse(readFileSync(commonPath, "utf8"));
const targets = [
  {
    schemaName: "cognitive-runtime.schema.json",
    outputName: "cognitiveRuntimeTypes.ts",
  },
  {
    schemaName: "agent-pipeline.schema.json",
    outputName: "agentPipelineTypes.ts",
  },
];

const localNames = new Map([
  ["id", "Id"],
  ["timestamp", "Timestamp"],
  ["sourceRef", "SourceRef"],
  ["eventSourceRef", "EventSourceRef"],
  ["privacyScope", "PrivacyScope"],
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
    return localNames.get(name) ?? name;
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

function render(schema, schemaName) {
  const declarations = [
    "export type Id = string;",
    "export type Timestamp = string;",
    declaration("PrivacyScope", common.$defs.privacyScope),
    declaration("SourceRef", common.$defs.sourceRef),
    declaration("EventSourceRef", common.$defs.eventSourceRef),
    ...Object.entries(schema.$defs).map(([rawName, definition]) =>
      declaration(localNames.get(rawName) ?? rawName, definition),
    ),
  ];
  return [
    "/**",
    " * GENERATED FILE. DO NOT EDIT.",
    ` * Source: schemas/${schemaName} and schemas/common.schema.json`,
    " * Regenerate with: npm run generate:types",
    " */",
    "",
    ...declarations.flatMap((value) => [value, ""]),
  ].join("\n");
}

for (const target of targets) {
  const schemaPath = join(root, "schemas", target.schemaName);
  const outputPath = join(root, "src", "gf", "generated", target.outputName);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const output = render(schema, target.schemaName);
  if (process.argv.includes("--check")) {
    let current;
    try {
      current = readFileSync(outputPath, "utf8");
    } catch {
      current = "";
    }
    if (current !== output) {
      process.stderr.write(
        `Generated types for ${target.schemaName} are stale. Run npm run generate:types.\n`,
      );
      process.exitCode = 1;
    }
  } else {
    writeFileSync(outputPath, output, "utf8");
  }
}
