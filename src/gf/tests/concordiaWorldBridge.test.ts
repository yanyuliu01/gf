import assert from "node:assert/strict";
import test from "node:test";

import { ConcordiaWorldBridge } from "../world/concordiaBridge.js";

test("Concordia bridge keeps world operations behind observe/resolve/advance", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });

    if (url.endsWith("/v1/observe")) {
      return Response.json({
        actorId: "muelsyse",
        worldTime: "2026-08-26T18:00:00+08:00",
        cursor: "evt-2",
        observations: [],
      });
    }
    if (url.endsWith("/v1/resolve")) {
      return Response.json({
        actionId: "act-1",
        actorId: "muelsyse",
        status: "accepted",
        happened: "她开始向生态园东侧走去。",
        committedEventIds: ["evt-3"],
        observations: [],
      });
    }
    return Response.json({
      from: "2026-08-26T18:00:00+08:00",
      to: "2026-08-26T18:10:00+08:00",
      committedEventIds: [],
    });
  };

  const world = new ConcordiaWorldBridge({
    baseUrl: "http://127.0.0.1:8765/",
    fetchImpl,
  });

  await world.observe("muelsyse", "evt-1");
  await world.resolve({
    id: "act-1",
    actorId: "muelsyse",
    proposedAt: "2026-08-26T18:00:00+08:00",
    intent: "去生态园东侧看看刚才的异常。",
  });
  await world.advance({ to: "2026-08-26T18:10:00+08:00" });

  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.endsWith("/v1/observe"));
  assert.ok(calls[1].url.endsWith("/v1/resolve"));
  assert.ok(calls[2].url.endsWith("/v1/advance"));
  assert.deepEqual(calls[1].body, {
    id: "act-1",
    actorId: "muelsyse",
    proposedAt: "2026-08-26T18:00:00+08:00",
    intent: "去生态园东侧看看刚才的异常。",
  });
});
