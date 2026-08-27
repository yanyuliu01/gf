import assert from "node:assert/strict";
import test from "node:test";

import type {
  CommitmentReaderPort,
  MemoryRetrieverPort,
  OpenPolicyPort,
  PerceptionPort,
  WorkingSelfBuilderPort,
} from "../cognition/ports.js";
import type {
  ActionCompilerPort,
  WorldAdjudicatorPort,
} from "../world/actionPorts.js";

test("pipeline ports keep pure transforms sync and I/O/model boundaries async", async () => {
  const perception: PerceptionPort<{ visible: string[] }, { observations: string[] }> = {
    project: ({ visible }) => ({ observations: [...visible] }),
  };
  const workingSelf: WorkingSelfBuilderPort<
    { observations: string[]; memories: string[] },
    { livedEvidence: string[] }
  > = {
    build: ({ observations, memories }) => ({
      livedEvidence: [...observations, ...memories],
    }),
  };
  const compiler: ActionCompilerPort<
    { intent: string },
    { capabilities: string[] },
    { commands: string[]; capabilityGap: string | null }
  > = {
    compile: ({ intent }, { capabilities }) =>
      capabilities.includes("observe")
        ? { commands: [`observe:${intent}`], capabilityGap: null }
        : { commands: [], capabilityGap: intent },
  };

  const projected = perception.project({ visible: ["S-4 reading"] });
  assert.equal(projected instanceof Promise, false);
  const assembled = workingSelf.build({
    observations: [...projected.observations],
    memories: ["prior S-4 check"],
  });
  assert.equal(assembled instanceof Promise, false);
  const compiled = compiler.compile(
    { intent: "inspect S-4" },
    { capabilities: ["observe"] },
  );
  assert.equal(compiled instanceof Promise, false);

  const memory: MemoryRetrieverPort<{ subjectId: string }, { evidence: string[] }> = {
    retrieve: async () => ({ evidence: ["support", "counter"] }),
  };
  const commitments: CommitmentReaderPort<
    { subjectId: string },
    { derivedProjection: string[] }
  > = {
    read: async () => ({ derivedProjection: ["audit-only"] }),
  };
  const policy: OpenPolicyPort<{ livedEvidence: string[] }, { intent: string }> = {
    propose: async () => ({ intent: "inspect S-4" }),
  };
  const adjudicator: WorldAdjudicatorPort<
    { commands: string[]; capabilityGap: string | null },
    { baseRevision: number },
    { status: string; baseRevision: number }
  > = {
    adjudicate: async (_compilation, { baseRevision }) => ({
      status: "proposed",
      baseRevision,
    }),
  };

  const memoryPromise = memory.retrieve({ subjectId: "muelsyse" });
  const commitmentPromise = commitments.read({ subjectId: "muelsyse" });
  const policyPromise = policy.propose(assembled);
  const outcomePromise = adjudicator.adjudicate(compiled, { baseRevision: 7 });
  for (const promise of [
    memoryPromise,
    commitmentPromise,
    policyPromise,
    outcomePromise,
  ]) {
    assert.ok(promise instanceof Promise);
  }

  assert.deepEqual(await memoryPromise, { evidence: ["support", "counter"] });
  assert.deepEqual(await commitmentPromise, {
    derivedProjection: ["audit-only"],
  });
  assert.deepEqual(await policyPromise, { intent: "inspect S-4" });
  assert.deepEqual(await outcomePromise, {
    status: "proposed",
    baseRevision: 7,
  });
});

test("compiler reports unsupported open semantics instead of substituting", () => {
  const compiler: ActionCompilerPort<
    { intent: string },
    { capabilities: string[] },
    { commands: string[]; capabilityGap: string | null }
  > = {
    compile: ({ intent }) => ({ commands: [], capabilityGap: intent }),
  };

  assert.deepEqual(
    compiler.compile(
      { intent: "become rain around the whole city" },
      { capabilities: ["observe", "move"] },
    ),
    {
      commands: [],
      capabilityGap: "become rain around the whole city",
    },
  );
});
