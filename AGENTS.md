# GF Repository Instructions

This file is the operational entrypoint for coding agents and new contributors.
It does not replace product, world, or machine-contract authority.

## Read Before Working

Read these files in order:

1. **`docs/invariants/19-architecture-invariants-v1.md`** — the frozen constraint layer. It outranks every other document, prompt, schema, and implementation. Overturning any entry requires an ADR (see its §2).
2. `PROJECT-HANDOFF.md` for the product, architecture, current state, and handoff rules.
3. `TODO.md` for task IDs, status, dependencies, owners, and acceptance criteria.
4. `docs/README.md` for subject-matter authority and document precedence.
5. The task-specific authoritative document and machine schemas.

`docs/` numbers are **stable IDs, not a reading order**; directories carry the topic. A document keeps its number when it moves or retires, because prose across the repo cites `docs/02`, `docs/10` and so on.

Do not start from `docs/history/08-implementation-gap-checklist.md` alone. Some older
documents still describe the historical finite-candidate M1/M2 design; task
`PM-001` in `TODO.md` owns that specification cleanup.

## Non-Negotiable Architecture Rules

**The authoritative list lives in `docs/invariants/19-architecture-invariants-v1.md` §3.**
It is frozen; this file no longer restates it, so the two cannot drift. Read §3
before any change that touches module boundaries, visibility, or who may write
what. The groups are:

| Group | Covers |
|---|---|
| A | Facts and write authority — `StateManager` is the only authoritative writer |
| B | Facts / beliefs / commitments separated; commitments are derived projections |
| C | Perception projection, Working Self, capacity limits, mandatory content |
| D | Affect does not select actions; emotion enters via lived evidence, not labels |
| E | Open semantic action; no finite candidate set; single outbound path |
| F | Detachability — `off` / `shadow` / `active`, side-inputs only, deletion criteria |
| G | Disposition changes through retrieval, not distilled rules |
| H | No retention/response-rate optimization; operating cost is never fatigue |
| I | Cross-world facts and the membrane boundary |

If a task description, an older document, a prompt, or existing code conflicts
with §3, §3 wins and the other artifact is the thing to fix. If you believe an
entry is wrong, write an ADR per §2 — do not work around it.

## Detachability Rules

The target cognitive pipeline must run in all three modes:

- `off`: memory/state -> Working Self -> open Policy, with no Affect calls.
- `shadow`: Affect derives and records state, but Policy input is identical to
  `off` except for audit metadata outside the prompt.
- `active`: Affect biases retrieval salience and attention. It does **not**
  contribute an affect state label to Working Self — the events that moved her
  state enter as ordinary lived evidence and she interprets them herself
  (`docs/invariants/19` D2-D3).

Deleting Affect-derived tables or switching to `off` must not damage the event
ledger, reducer state, commitments, memory sources, speech, or outbox.

A detachable module may only be a **side input** to the main chain, never a stage
in it. Test: after removing it, is the chain still connected? Every detachable
module also needs a deletion criterion (`19` F3-F4).

Build the final `off` pipeline before implementing `shadow`, and activate Affect
only after controlled ablation tests. Do not follow the older
`shadow -> active-memory -> open-policy` implementation order.

## Engineering Conventions

- Prefer strict TypeScript for runtime and tooling. Keep NodeNext/ESM imports.
- Keep a modular monolith and SQLite for the single-user MVP.
- Use JSON Schema + Ajv as the runtime contract. Generate or derive TS types
  from schemas; do not maintain a second hand-written contract.
- Add versioned schemas and migrations. Never edit a deployed migration or add
  required fields to a frozen v1 payload.
- Keep model calls asynchronous and outside database transactions.
- Inject interfaces, not concrete stubs or provider SDK clients, into engines.
- Persist exact input closure, model/prompt version, parameter version, and
  hashes for replayable model-derived artifacts.
- Prefer structured filters and SQLite FTS5 before adding a vector database.
- Preserve user-authored changes and historical documents. New designs are
  additive and versioned unless the Owner explicitly retires a version.

## Task Workflow

1. Select one `TODO.md` task whose dependencies are satisfied.
2. Set it to `IN_PROGRESS` and record the assignee/date in the task evidence.
3. Read every authority and contract named by that task.
4. Make the smallest implementation that satisfies its acceptance criteria.
5. Add tests proportional to the state, contract, or user-facing risk.
6. Run the task checks plus the repository checks listed in `TODO.md`.
7. Update status and add commit/test evidence before handoff.
8. Commit only files belonging to the selected task ID.

If a task requires an Owner decision, do not invent one. Mark it
`WAITING_OWNER` and point to `docs/owner/14-owner-input-workbook-v1.md`.

## Known Baseline At 2026-08-06

- Contract validation passes.
- M1 runtime tests pass 15/19; four fast-reply tests fail because the assembler
  assumes LF while `prompts/10-fast-reply.md` is CRLF.
- Full project audit stops at a Windows EOL/canon manifest hash mismatch.
- Actual source closure is broader than the documented per-call input closure.
- Scheduler phases currently use UTC rather than configured world time.
- The inference interface is synchronous and `Engine` depends on `StubClient`.

These are tracked as M1.1 tasks. Do not hide them by weakening tests.
