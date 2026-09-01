import assert from "node:assert/strict";
import test from "node:test";

import type { InferenceUsageReceiptV1 } from "../generated/cognitiveRuntimeTypes.js";
import {
  USAGE_CLASSIFICATION_VERSION,
  VersionedUsageClassifier,
} from "../inference/usage/usageAccounting.js";
import { computeInputClosureHash } from "../validation/derivedInputClosure.js";
import { CommitRejected } from "../state/stateManager.js";
import { setupRuntime, userEvent } from "./helpers.js";

const RECEIVED_AT = "2026-09-02T10:00:00.000Z";

function completedReceipt(
  receiptId: string,
  cachedInputTokens: number,
): InferenceUsageReceiptV1 {
  return {
    schema_version: "1.0",
    receipt_id: receiptId,
    prompt_run_id: "run_usage_1",
    provider_request_id: `provider:${receiptId}`,
    model_id: "deepseek-v4-flash",
    tokenizer_version: "deepseek.responses.usage.v1",
    input_tokens: 100,
    cached_input_tokens: cachedInputTokens,
    output_tokens: 30,
    reasoning_tokens: 10,
    attempt_ordinal: receiptId.endsWith("cached") ? 1 : 2,
    completion_status: "completed",
    usage_source: "provider",
    received_at: RECEIVED_AT,
  };
}

test("versioned classification counts cached semantics but excludes runtime overhead", () => {
  const source = { source_type: "event" as const, source_id: "evt_usage_1" };
  const closureHash = computeInputClosureHash(0, [source]);
  const classifier = new VersionedUsageClassifier();
  const receipt = completedReceipt("usage_cached", 80);
  const context = {
    attemptClass: "accepted_semantic" as const,
    inputClosureHash: closureHash,
    inputSegments: [
      {
        segmentId: "segment_current_message",
        purpose: "current_message" as const,
        weight: 3,
        sourceRefs: [source],
      },
      {
        segmentId: "segment_schema",
        purpose: "runtime_overhead" as const,
        weight: 1,
        sourceRefs: [],
      },
    ],
    outputPurpose: "expression" as const,
  };

  const first = classifier.classify(receipt, context);
  const replay = classifier.classify(receipt, context);
  assert.deepEqual(replay, first);
  assert.equal(first.classification_version, USAGE_CLASSIFICATION_VERSION);
  const breakdownKeys = [
    ...Object.keys(first),
    ...first.segments.flatMap((segment) => Object.keys(segment)),
  ];
  assert.equal(
    breakdownKeys.some((key) =>
      /provider|model|tokenizer|cached|price|cost/i.test(key)),
    false,
    "provider and billing counters must not leak into experienced breakdowns",
  );
  assert.deepEqual(
    first.segments.map((segment) => ({
      purpose: segment.purpose,
      tokens: segment.token_count,
      experienced: segment.experienced,
    })),
    [
      { purpose: "current_message", tokens: 75, experienced: true },
      { purpose: "runtime_overhead", tokens: 25, experienced: false },
      { purpose: "deliberation", tokens: 10, experienced: true },
      { purpose: "expression", tokens: 20, experienced: true },
    ],
  );
  assert.equal(
    first.segments
      .filter((segment) => segment.experienced)
      .reduce((sum, segment) => sum + segment.token_count, 0),
    105,
  );

  const uncached = classifier.classify(
    completedReceipt("usage_uncached", 0),
    context,
  );
  assert.deepEqual(
    uncached.segments,
    first.segments,
    "billing cache discounts must not change experienced load",
  );
});

test("StateManager commits source-closed receipts and classifications idempotently", () => {
  const rt = setupRuntime();
  try {
    const event = userEvent("今天继续看 S-4。", {
      event_id: "evt_usage_1",
      idempotency_key: "usage-source-1",
    });
    rt.stateManager.ingestEvent(event);
    rt.stateManager.recordPromptRunStarted({
      runId: "run_usage_1",
      promptName: "fast_reply",
      promptVersion: "fast_reply.v0.2",
      promptManifestHash: "a".repeat(64),
      inputHash: "b".repeat(64),
      modelId: "deepseek-v4-flash",
      startedAt: RECEIVED_AT,
    });
    const receipt = completedReceipt("usage_cached", 80);
    rt.stateManager.recordInferenceUsageReceipt(receipt);
    rt.stateManager.recordInferenceUsageReceipt(receipt);

    const source = { source_type: "event" as const, source_id: "evt_usage_1" };
    const classifier = new VersionedUsageClassifier();
    const breakdown = classifier.classify(receipt, {
      attemptClass: "accepted_semantic",
      inputClosureHash: computeInputClosureHash(0, [source]),
      inputSegments: [
        {
          segmentId: "segment_current_message",
          purpose: "current_message",
          weight: 3,
          sourceRefs: [source],
        },
        {
          segmentId: "segment_runtime",
          purpose: "runtime_overhead",
          weight: 1,
          sourceRefs: [],
        },
      ],
      outputPurpose: "expression",
    });
    const options = {
      baseStateRevision: 0,
      inputSources: [source],
      classifiedAt: RECEIVED_AT,
    };
    rt.stateManager.recordExperiencedUsageBreakdown(breakdown, options);
    rt.stateManager.recordExperiencedUsageBreakdown(breakdown, options);

    assert.equal(
      (rt.db.prepare("SELECT count(*) AS n FROM inference_usage_receipts").get() as { n: number }).n,
      1,
    );
    assert.equal(
      (rt.db.prepare("SELECT count(*) AS n FROM experienced_usage_breakdowns").get() as { n: number }).n,
      1,
    );
    assert.equal(
      (rt.db.prepare("SELECT count(*) AS n FROM experienced_usage_segments").get() as { n: number }).n,
      4,
    );
    assert.equal(
      (rt.db.prepare(
        "SELECT sum(token_count) AS n FROM experienced_usage_segments WHERE experienced = 1",
      ).get() as { n: number }).n,
      105,
    );

    assert.throws(
      () => rt.stateManager.recordExperiencedUsageBreakdown(
        { ...breakdown, input_closure_hash: "f".repeat(64) },
        options,
      ),
      CommitRejected,
    );
  } finally {
    rt.cleanup();
  }
});

test("transport retries and runtime repairs never become experienced load", () => {
  const classifier = new VersionedUsageClassifier();
  const retry: InferenceUsageReceiptV1 = {
    schema_version: "1.0",
    receipt_id: "usage_retry",
    prompt_run_id: "run_retry",
    provider_request_id: "provider:retry",
    model_id: "deepseek-v4-flash",
    tokenizer_version: "provider.v1",
    input_tokens: 50,
    cached_input_tokens: 40,
    output_tokens: 10,
    reasoning_tokens: 5,
    attempt_ordinal: 1,
    completion_status: "transport_error",
    usage_source: "provider",
    received_at: RECEIVED_AT,
  };
  const breakdown = classifier.classify(retry, {
    attemptClass: "transport_retry",
    inputClosureHash: computeInputClosureHash(0, []),
    inputSegments: [],
    outputPurpose: "deliberation",
  });
  assert.deepEqual(breakdown.segments, [{
    segment_id: "segment_runtime_attempt",
    purpose: "runtime_overhead",
    token_count: 60,
    experienced: false,
    source_refs: [],
  }]);
  assert.throws(
    () => classifier.classify(
      { ...retry, completion_status: "completed" },
      {
        attemptClass: "transport_retry",
        inputClosureHash: computeInputClosureHash(0, []),
        inputSegments: [],
        outputPurpose: "deliberation",
      },
    ),
    /requires a failed or cancelled receipt/,
  );

  const completed = classifier.classify(
    { ...retry, completion_status: "completed" },
    {
      attemptClass: "accepted_semantic",
      inputClosureHash: computeInputClosureHash(0, [{
        source_type: "event",
        source_id: "evt_internal",
      }]),
      inputSegments: [{
        segmentId: "segment_world",
        purpose: "world_fact",
        weight: 1,
        sourceRefs: [{ source_type: "event", source_id: "evt_internal" }],
      }],
      outputPurpose: "deliberation",
    },
  );
  assert.equal(
    new Set(completed.segments.map((segment) => segment.segment_id)).size,
    completed.segments.length,
  );
  assert.deepEqual(
    completed.segments.slice(-2).map((segment) => segment.purpose),
    ["deliberation", "deliberation"],
  );
});
