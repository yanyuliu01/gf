import { test } from "node:test";
import assert from "node:assert/strict";
import { Gateway } from "../gateway/gateway.js";

test("unknown principal is dropped before reaching the world", () => {
  const gateway = new Gateway({ whitelist: new Set(["doctor"]) });
  const result = gateway.handleLine("hello", "stranger");
  assert.equal(result.dropped, true);
  assert.equal(result.events.length, 0);
});

test("debounce 0 flushes every line as its own event", () => {
  const gateway = new Gateway({ debounceSeconds: 0 });
  const first = gateway.handleLine("第一条");
  const second = gateway.handleLine("第二条");
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 1);
  const payload = first.events[0].payload as { content: unknown[] };
  assert.equal(payload.content.length, 1);
});

test("debounce window aggregates lines into one event", () => {
  let now = Date.parse("2026-08-05T12:00:00Z");
  const gateway = new Gateway({
    debounceSeconds: 10,
    now: () => new Date(now),
  });
  const first = gateway.handleLine("第一条");
  assert.equal(first.events.length, 0);
  now += 3000;
  const second = gateway.handleLine("第二条");
  assert.equal(second.events.length, 0);
  const flushed = gateway.flush();
  assert.equal(flushed.length, 1);
  const payload = flushed[0].payload as {
    content: { text: string }[];
  };
  assert.deepEqual(
    payload.content.map((part) => part.text),
    ["第一条", "第二条"],
  );
});

test("meta commands never enter the world", () => {
  const gateway = new Gateway({ debounceSeconds: 0 });
  const result = gateway.handleLine("/status");
  assert.equal(result.events.length, 0);
  assert.deepEqual(result.meta, { name: "status", args: [] });
});

test("unknown meta command is dropped with meta payload", () => {
  const gateway = new Gateway({ debounceSeconds: 0 });
  const result = gateway.handleLine("/nope 1");
  assert.equal(result.dropped, true);
  assert.equal(result.events.length, 0);
  assert.deepEqual(result.meta, { name: "nope", args: ["1"] });
});

test("single-line message flushes via checkFlush after debounce timeout", () => {
  let now = Date.parse("2026-08-05T12:00:00Z");
  const gateway = new Gateway({
    debounceSeconds: 5,
    now: () => new Date(now),
  });

  const result = gateway.handleLine("单条消息");
  assert.equal(result.events.length, 0, "should not flush immediately");
  assert.ok(result.flushDueInMs !== undefined && result.flushDueInMs > 0, "should indicate flush pending");

  now += 3000;
  const early = gateway.checkFlush();
  assert.equal(early.length, 0, "should not flush before timeout");

  now += 3000;
  const flushed = gateway.checkFlush();
  assert.equal(flushed.length, 1, "should flush after timeout");
  const payload = flushed[0].payload as { content: { text: string }[] };
  assert.equal(payload.content[0].text, "单条消息");
});

test("msUntilFlush returns time remaining until debounce expires", () => {
  let now = Date.parse("2026-08-05T12:00:00Z");
  const gateway = new Gateway({
    debounceSeconds: 10,
    now: () => new Date(now),
  });

  assert.equal(gateway.msUntilFlush(), null, "no pending flush when empty");

  gateway.handleLine("测试");
  const remaining = gateway.msUntilFlush();
  assert.ok(remaining !== null && remaining > 0, "should have time remaining");

  now += 5000;
  const halfRemaining = gateway.msUntilFlush();
  assert.ok(halfRemaining !== null && halfRemaining <= 5000, "should have less time remaining");

  now += 6000;
  const expired = gateway.msUntilFlush();
  assert.equal(expired, 0, "should be ready to flush");
});

test("message arriving after window flushes previous batch separately", () => {
  let now = Date.parse("2026-08-05T12:00:00Z");
  const gateway = new Gateway({
    debounceSeconds: 5,
    now: () => new Date(now),
  });

  gateway.handleLine("第一条");
  now += 2000;
  gateway.handleLine("第二条");
  now += 6000;
  const result = gateway.handleLine("第三条");

  assert.equal(result.events.length, 1, "should flush previous batch");
  const payload = result.events[0].payload as { content: { text: string }[] };
  assert.deepEqual(
    payload.content.map((p) => p.text),
    ["第一条", "第二条"],
    "should contain first two lines"
  );

  const finalFlush = gateway.flush();
  assert.equal(finalFlush.length, 1, "should have pending third line");
  const finalPayload = finalFlush[0].payload as { content: { text: string }[] };
  assert.equal(finalPayload.content[0].text, "第三条");
});
