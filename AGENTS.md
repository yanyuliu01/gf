# GF Repository Instructions

This file is the operational entrypoint for coding agents and new contributors.
It does not replace product, world, or machine-contract authority.

## Read Before Working

Read these files in order:

1. `PROJECT-HANDOFF.md` for the product, architecture, current state, and handoff rules.
2. `TODO.md` for task IDs, status, dependencies, owners, and acceptance criteria.
3. `docs/README.md` for subject-matter authority and document precedence.
4. The task-specific authoritative document and machine schemas.

Do not start from `docs/08-implementation-gap-checklist.md` alone. Some older
documents still describe the historical finite-candidate M1/M2 design; task
`PM-001` in `TODO.md` owns that specification cleanup.

## Non-Negotiable Architecture Rules

- World facts are committed `WorldEvent` and reducer state. Model output,
  memories, appraisals, and affect snapshots are proposals or derived state.
- `StateManager` is the only authoritative state writer. No model, adapter,
  memory component, or Affect component may write world facts directly.
- Every outbound message uses the same speech/surface, outbox, and adapter path.
- Facts, subjective beliefs, and executable commitments remain separate.
- The LLM generates an open-ended semantic action. Do not reintroduce a fixed
  or temporary finite semantic action candidate set.
- Affect Utility models event impact on concerns and continuous affect. It does
  not rank or select actions and never sends messages directly.
- Accepted semantic model input, deliberation, and expression consume the
  actor's versioned cognitive-energy resource. Raw token counts, balances,
  percentages, provider prices, and billing limits never enter character
  prompts or surfaces; operator billing cannot masquerade as fatigue.
- Cognitive energy constrains engine-side context, deliberation, tool, and
  expression capacity. Do not map account ranges to authored fatigue labels,
  capability prose, dialogue, or actions. Open Policy may derive an optional,
  source-linked free-form self-experience from lived evidence; it may be absent,
  uncertain, or mistaken and never writes the energy account.
- Cognitive wake decisions are versioned and audited, including non-wake
  outcomes. Audit rows are derived records, not objective WorldEvents.
- `WorldAdjudicator` determines what actually happens. An action proposal may
  not declare its own success.
- Cross-world facts obey `docs/10-crossworld-protocol-v1.md`. The Doctor's
  ordinary real-world life does not automatically change Terra.
- Do not optimize character behavior for retention, response rate, payment, or
  emotional pressure.

## Detachability Rules

The target cognitive pipeline must run in all three modes:

- `off`: memory/state -> Working Self -> open Policy, with no Affect calls.
- `shadow`: Affect derives and records state, but Policy input is identical to
  `off` except for audit metadata outside the prompt.
- `active`: Affect contributes an optional, source-linked Working Self fragment.

Deleting Affect-derived tables or switching to `off` must not damage the event
ledger, reducer state, commitments, memory sources, speech, or outbox.

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
`WAITING_OWNER` and point to `docs/14-owner-input-workbook-v1.md`.

## Known Baseline At 2026-08-06

- Contract validation passes.
- M1 runtime tests pass 15/19; four fast-reply tests fail because the assembler
  assumes LF while `prompts/10-fast-reply.md` is CRLF.
- Full project audit stops at a Windows EOL/canon manifest hash mismatch.
- Actual source closure is broader than the documented per-call input closure.
- Scheduler phases currently use UTC rather than configured world time.
- The inference interface is synchronous and `Engine` depends on `StubClient`.

These are tracked as M1.1 tasks. Do not hide them by weakening tests.
