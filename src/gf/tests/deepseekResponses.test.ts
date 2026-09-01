import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEEPSEEK_V4_FLASH_MODEL_ID,
  DeepSeekInferenceError,
  DeepSeekResponsesClient,
  loadDeepSeekApiKey,
} from "../inference/deepseekResponses.js";
import type { FastReplyOutput } from "../inference/base.js";
import type { PromptContext } from "../prompts/assembler.js";
import { SchemaRegistry } from "../validation/schemas.js";
import { setupRuntime, tickProposal } from "./helpers.js";
import { connect } from "../state/db.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function context(
  callPoint: string,
  promptVersion: string,
): PromptContext {
  return {
    callPoint,
    promptVersion,
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "payload" },
    ],
    promptHash: "a".repeat(64),
    manifestHash: "b".repeat(64),
    slotCharCounts: {},
    modelId: "must-not-control-provider",
    inputSources: [],
  };
}

function response(outputText: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      id: "resp_test",
      model: "deepseek-v4-flash",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: outputText }],
        },
      ],
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function createClient(
  fetchImpl: NonNullable<
    ConstructorParameters<typeof DeepSeekResponsesClient>[0]["fetchImpl"]
  >,
  overrides: Partial<
    ConstructorParameters<typeof DeepSeekResponsesClient>[0]
  > = {},
) {
  const rt = setupRuntime();
  const schemas = new SchemaRegistry(join(ROOT, "schemas"));
  const client = new DeepSeekResponsesClient({
    apiKey: "test-secret-never-persist",
    schemas,
    audit: rt.stateManager,
    fetchImpl,
    sleep: async () => undefined,
    ...overrides,
  });
  return { rt, client };
}

function hasRef(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasRef);
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return "$ref" in record || Object.values(record).some(hasRef);
}

test("local DeepSeek key loader prefers env and accepts raw or assignment files", () => {
  const dir = mkdtempSync(join(tmpdir(), "gf-deepseek-key-"));
  try {
    const rawPath = join(dir, "raw.txt");
    const assignmentPath = join(dir, "assignment.txt");
    writeFileSync(rawPath, "raw-test-key\n", "utf-8");
    writeFileSync(
      assignmentPath,
      'DEEPSEEK_API_KEY="assignment-test-key"\n',
      "utf-8",
    );
    assert.equal(
      loadDeepSeekApiKey({
        env: { DEEPSEEK_API_KEY: "env-test-key" },
        keyFile: rawPath,
      }),
      "env-test-key",
    );
    assert.equal(
      loadDeepSeekApiKey({ env: {}, keyFile: rawPath }),
      "raw-test-key",
    );
    assert.equal(
      loadDeepSeekApiKey({ env: {}, keyFile: assignmentPath }),
      "assignment-test-key",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fast reply uses pinned model and records a validated prompt run", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const { rt, client } = createClient(async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return response("第一段\n---\n第二段");
  });
  try {
    const output = await client.fastReply(
      context("fast_reply", "fast_reply.v0.2"),
    );
    assert.equal(client.modelId, DEEPSEEK_V4_FLASH_MODEL_ID);
    assert.deepEqual(output.bubbles, ["第一段", "第二段"]);
    assert.equal(capturedUrl, "https://api.deepseek.com/responses");
    const body = JSON.parse(String(capturedInit?.body)) as {
      model: string;
      text: { format: { type: string } };
      reasoning: { effort: string };
    };
    assert.equal(body.model, "deepseek-v4-flash");
    assert.equal(body.text.format.type, "text");
    assert.equal(body.reasoning.effort, "none");
    assert.equal(
      (capturedInit?.headers as Record<string, string>).Authorization,
      "Bearer test-secret-never-persist",
    );
    const run = rt.db.prepare("SELECT * FROM prompt_runs").get() as {
      prompt_name: string;
      prompt_version: string;
      model_id: string;
      input_hash: string;
      output_hash: string;
      status: string;
    };
    assert.equal(run.prompt_name, "fast_reply");
    assert.equal(run.prompt_version, "fast_reply.v0.2");
    assert.equal(run.model_id, "deepseek-v4-flash");
    assert.equal(run.input_hash.length, 64);
    assert.equal(run.input_hash.includes("test-secret"), false);
    assert.equal(run.output_hash.length, 64);
    assert.equal(run.status, "validated");
  } finally {
    rt.cleanup();
  }
});

test("tick requests self-contained JSON Schema and validates output", async () => {
  const proposal = tickProposal("evt_provider_test", 0);
  let requestBody: Record<string, unknown> = {};
  const { rt, client } = createClient(async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return response(JSON.stringify(proposal));
  });
  try {
    assert.deepEqual(
      await client.tick(context("tick", "tick.v0.3")),
      proposal,
    );
    const text = requestBody.text as {
      format: { type: string; schema: unknown };
    };
    assert.equal(text.format.type, "json_schema");
    assert.equal(hasRef(text.format.schema), false);
  } finally {
    rt.cleanup();
  }
});

test("scene settlement uses its own structured contract", async () => {
  const proposal = {
    schema_version: "1.0",
    operation_id: "op_scene_test",
    scene_id: "scene_test",
    batch_id: "batch_test",
    base_state_revision: 0,
    processed_message_ids: ["msg_test"],
    scene_summary: "普通的一次对话。",
    claims: [],
    patch_ops: [],
    debts_add: [],
    valence: 0,
    intensity: 0,
    involves: [],
  };
  const { rt, client } = createClient(async () =>
    response(JSON.stringify(proposal)));
  try {
    assert.deepEqual(
      await client.sceneSettle(
        context("scene_settle", "scene_settle.v0.2"),
      ),
      proposal,
    );
  } finally {
    rt.cleanup();
  }
});

test("429 and server failures consume only the bounded retry budget", async () => {
  let calls = 0;
  const delays: number[] = [];
  const { rt, client } = createClient(
    async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("", { status: 429 });
      }
      if (calls === 2) {
        return new Response("", { status: 503 });
      }
      return response("重试后成功。");
    },
    {
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    },
  );
  try {
    assert.deepEqual(
      await client.fastReply(
        context("fast_reply", "fast_reply.v0.2"),
      ),
      { bubbles: ["重试后成功。"] },
    );
    assert.equal(calls, 3);
    assert.deepEqual(delays, [100, 200]);
  } finally {
    rt.cleanup();
  }
});

test("non-retryable HTTP failure is audited without exposing response body", async () => {
  let calls = 0;
  const { rt, client } = createClient(async () => {
    calls += 1;
    return new Response("provider-private-error-body", { status: 400 });
  });
  try {
    await assert.rejects(
      client.fastReply(context("fast_reply", "fast_reply.v0.2")),
      (error: unknown) =>
        error instanceof DeepSeekInferenceError
        && error.code === "http_rejected"
        && !error.message.includes("provider-private-error-body"),
    );
    assert.equal(calls, 1);
    const run = rt.db.prepare("SELECT * FROM prompt_runs").get() as {
      status: string;
      error_code: string;
    };
    assert.equal(run.status, "failed");
    assert.equal(run.error_code, "http_rejected");
  } finally {
    rt.cleanup();
  }
});

test("invalid structured output is rejected and hashed in audit", async () => {
  const { rt, client } = createClient(async () =>
    response(JSON.stringify({ schema_version: "1.0" })));
  try {
    await assert.rejects(
      client.tick(context("tick", "tick.v0.3")),
      (error: unknown) =>
        error instanceof DeepSeekInferenceError
        && error.code === "schema_invalid",
    );
    const run = rt.db.prepare("SELECT * FROM prompt_runs").get() as {
      status: string;
      error_code: string;
      output_hash: string;
    };
    assert.equal(run.status, "rejected");
    assert.equal(run.error_code, "schema_invalid");
    assert.equal(run.output_hash.length, 64);
  } finally {
    rt.cleanup();
  }
});

test("timeout aborts the request and records one failed run", async () => {
  const { rt, client } = createClient(
    async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    { timeoutMs: 5, maxAttempts: 1 },
  );
  try {
    await assert.rejects(
      client.fastReply(context("fast_reply", "fast_reply.v0.2")),
      (error: unknown) =>
        error instanceof DeepSeekInferenceError
        && error.code === "timeout",
    );
    const run = rt.db.prepare("SELECT * FROM prompt_runs").get() as {
      status: string;
      error_code: string;
    };
    assert.equal(run.status, "failed");
    assert.equal(run.error_code, "timeout");
  } finally {
    rt.cleanup();
  }
});

test("prompt audit closes its write transaction before awaiting DeepSeek", async () => {
  let entered!: () => void;
  let release!: () => void;
  const requestEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { rt, client } = createClient(async () => {
    entered();
    await released;
    return response("事务外返回。");
  });
  let call: Promise<FastReplyOutput> | undefined;
  try {
    call = client.fastReply(context("fast_reply", "fast_reply.v0.2"));
    await requestEntered;
    const concurrentWriter = connect(rt.dbPath);
    try {
      assert.doesNotThrow(() => {
        concurrentWriter.exec("BEGIN IMMEDIATE");
        concurrentWriter.exec("ROLLBACK");
      });
    } finally {
      concurrentWriter.close();
    }
    release();
    assert.deepEqual(await call, { bubbles: ["事务外返回。"] });
  } finally {
    release();
    await call?.catch(() => undefined);
    rt.cleanup();
  }
});
