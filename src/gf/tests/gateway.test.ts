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
