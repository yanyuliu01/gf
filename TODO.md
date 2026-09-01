# GF Project Backlog

Snapshot: **2026-08-28**
Project handoff: [`PROJECT-HANDOFF.md`](PROJECT-HANDOFF.md)
Owner workbook: [`docs/owner/14-owner-input-workbook-v1.md`](docs/owner/14-owner-input-workbook-v1.md)

This is the operational project board. It tracks work but does not override the
subject authority in `docs/README.md`, JSON Schema, or migrations.

## Status Legend

| Status | Meaning |
|---|---|
| `DONE` | Acceptance criteria met with repository evidence |
| `IN_PROGRESS` | One assignee is actively working on it |
| `READY` | Dependencies satisfied; engineering may start |
| `WAITING_OWNER` | Requires a product/character decision from the Owner |
| `BLOCKED` | Depends on another task or external state |
| `LATER` | Intentionally outside the current milestone |
| `CANCELLED` | Retained for history with a reason |
| `RECURRING` | Repeated project-health task |

## Identifier Legend

Short IDs in this repository belong to different namespaces. The canonical
cross-repository explanation is in [`CONTEXT.md`](CONTEXT.md#repository-identifier-namespaces).

| Form | Meaning | Read it as |
|---|---|---|
| `PM-001` | project/specification-management task | PM task 001 |
| `OWN-001` | Owner decision/input task | Owner task 001 |
| `M11-003` | engineering task in M1.1 | M1.1 task 003 |
| `M20-015` | engineering task in M2.0 | M2.0 task 015 |
| `M21-*` / `M22-*` / `M23-*` | M2.1 / M2.2 / M2.3 engineering tasks | milestone + stable task ID |
| `M30-*` | M3 evaluation/release tasks | M3 task |
| `L40-*` | later-work backlog outside the current critical path | later task |
| `Seed A1`–`Seed A9` | Day-0 character/world seed assets | **not** architecture invariants |
| `Prompt S1`–`Prompt S9` | prompt assembly slots | **not** milestones or world objects |
| `Invariant A1`–`Invariant I3` | frozen architecture clauses in `docs/invariants/19` | architecture rule |
| `docs/01`–`docs/20` | stable document IDs | directory carries the topic; number is not reading order |

Preferred prose style: qualify ambiguous short IDs. Write `Seed A7`, `Prompt S3`,
`Invariant C1`, and on first mention `M2.0 / M20-015`. Existing IDs are stable;
do not renumber them just to make them prettier.

Task IDs are stable. Do not delete completed or cancelled rows. Update status,
acceptance evidence, and the snapshot date when project state changes.

## Current Critical Path

```text
PM-001 specification sync
        +
M1.1 / M11-001..006 portable baseline
        +
OWN-001 world runtime decisions
        +
OWN-002 concern/tension seed
        |
        v
M2.0 / M20 contracts -> Wake/energy baseline -> final off pipeline -> M2.1 / M21 world autonomy -> M21-012 first Feishu message
        |
        v
M2.2 / M22 shadow Affect -> M2.3 / M23 active Affect -> M3 / M30 longitudinal proof
```

Owner work and M1.1 engineering can proceed in parallel. `OWN-003` Seed A7 can
also proceed in parallel, but active character-facing evaluation cannot finish
without it. `OWN-008` lived sequences proceed in parallel and gate M3 / M30
blind evaluation, not the v2 account, envelope, or Policy contracts.

## Recommended Next Ten Tasks

| Order | Task | Who | Why now |
|---:|---|---|---|
| 1 | `OWN-001` | Owner | Defines what the world can independently do and how outcomes are judged |
| 2 | `M11-001` | Engineering | Restores four failing fast-reply tests |
| 3 | `M11-002` | Engineering | Makes canon validation portable instead of machine-specific |
| 4 | `M11-003` | Engineering | Prevents M2 proposals from citing unseen history |
| 5 | `M11-004` | Engineering | Aligns world time with the configured setting |
| 6 | `M11-005` | Engineering | Makes real and replaceable LLM clients possible |
| 7 | `PM-001` | Engineering + Owner review | Removes finite-candidate ambiguity from active M2 instructions |
| 8 | `OWN-002` | Owner | Supplies open concern meanings without numeric weights |
| 9 | `OWN-003` | Owner | Freezes Doctor/Muelsyse chat voice examples |
| 10 | `OWN-008` | Owner | Supplies lived sequences and blind judgments without defining fatigue states |

---

## PM: Project And Specification Management

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `PM-001` | `DONE` | ENG + OWNER review | none | Mark finite semantic action candidate/local arbitration sections in PRD, docs/02, docs/08, and active tick Prompt as M1 history or replace them with open Policy wording. Search shows no active instruction to generate/rank semantic candidates. Association sampling terminology remains clearly distinct. Completed 2026-08-28. |
| `PM-002` | `DONE` | ENG | none | Add `PROJECT-HANDOFF.md`, this board, `AGENTS.md`, Owner workbook, and repository navigation. Evidence: project-management documentation commit. |
| `PM-003` | `RECURRING` | current assignee | every task | Update task status, dependencies, acceptance evidence, and dated project snapshot in the same commit as material work. |
| `PM-004` | `READY` | ENG | `PM-002` | Add a lightweight decision-log/ADR convention for architecture changes that replace an existing decision. Historical docs remain intact. The convention must satisfy `docs/invariants/19` §2: an ADR names the entry it overturns, the runtime evidence, and the cost; the superseded entry is retained and marked, never deleted. |
| `PM-006` | `READY` | ENG + OWNER review | none | Triage the unprocessed findings listed in `docs/history/README.md` — four from `12-...-v2` §6 (thread status enum regression, seed never loaded, `contact_reason` missing, observability vacuous), fourteen spec/contract divergences, and three blocking runtime defects (debounce never fires on a single line, validation failure silently consumes the user message and kills the REPL, outbox rows stuck in `sending` are never retried). Each becomes a task, is folded into an existing task, or is closed with a written reason. **The three runtime defects pass all 19 current tests**, so `M11-007` green is not evidence against them. |
| `PM-005` | `LATER` | ENG | first multi-person sprint | Add GitHub issue templates mapping issue title/body to Task ID, authority, acceptance, rollback, and test evidence. |

### PM-001 Notes

This is a specification consistency task, not a behavior implementation. It
must preserve docs/12 and old diagrams as historical records. The M1 event,
StateManager, source, transaction, Prompt assembly, and outbox contracts remain
unchanged.

```text
Outcome: Replaced docs/02 finite action-candidate filtering/local arbitration with Working Self -> Open Policy -> Action Compiler -> World Adjudicator -> StateManager. Updated active tick Prompt to generate one open semantic action without a candidate menu or action Utility, and versioned the contract as tick.v0.3. Clarified PRD association sampling as object-salience input only. Preserved docs/history/08 and marked its candidate-arbitration language historical.
Authority read: AGENTS.md; CONTEXT.md; docs/README.md; docs/invariants/19 section 3; docs/product/01; docs/cognition/02; docs/cognition/13; docs/world/15; prompts/README.md; prompts/20-tick.md; prompts/manifest.yaml; docs/history/08.
Files changed: TODO.md; docs/product/01-prd-v0.1.md; docs/cognition/02-framework-v3.5.md; docs/history/08-implementation-gap-checklist.md; prompts/20-tick.md; prompts/manifest.yaml.
Checks: pnpm test (62/62); full project audit including contract validation, 2758 canon entries, and 10 diagrams; active-doc search finds candidate language only in an explicit retired-history sentence or a prohibition; association sampling is explicitly non-action and non-factual; git diff --check.
Known residual risk: prompts/20-tick remains the M1 proposal contract until M20-025 replaces its orchestration role; tick.v0.3 changes semantics without changing the frozen tick-proposal v1 output shape.
Rollback: Revert the PM-001 specification-sync commit; no schema, migration, or runtime code changes.
Owner decision still needed: None for this sync. The user directed continuation through M20-026 on 2026-08-28; OWN-001 world-parameter sign-off remains separate.
```

---

## OWN: Owner Inputs

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `OWN-001` | `DONE` | OWNER | none | Accepted the computable world kernel v1 direction: resource/process world stepping, committed-change -> Perception -> Cognitive Admission -> open action -> adjudication -> commit, WorldX-informed execution seams, Activity/Process continuity, and the S-4-to-first-Feishu acceptance trace. A0/A1 accepted; A2-A5 and S-4 seed use docs/16 engineering defaults for the first versioned trial. Signed 2026-08-29 in docs/14. |
| `OWN-002` | `WAITING_OWNER` | OWNER | none | Approve/edit 5-8 open natural-language concerns and 3-5 genuine tension pairs. Each has a source and supporting/harming examples, but no numeric weight or behavior rule. |
| `OWN-003` | `WAITING_OWNER` | OWNER | none | Finalize Seed A7: fill Doctor placeholders, rewrite spoken/canon lines into believable typing, approve disagreement/debt/proactive examples, remove editor annotations, and sign off runtime Prompt S3 text. |
| `OWN-004` | `WAITING_OWNER` | OWNER | `OWN-002` | Label 15-20 calibration events by affected concern, direction, small/medium/large impact, persistence expectation, and unacceptable interpretation. No decimal Utility values. |
| `OWN-005` | `WAITING_OWNER` | OWNER | `OWN-001`, `OWN-002`, `OWN-003` | Approve 8-10 longitudinal golden scenarios with initial state, event sequence, expected continuity after hours/days, and prohibited outcomes. |
| `OWN-006` | `READY` | OWNER | none | Confirm or replace the PRD north-star metric. It must remain an audit measure and must never feed character strategy or contact frequency. |
| `OWN-007` | `LATER` | OWNER | M30 results | Review 7-day logs and decide whether active Affect creates meaningful continuity, only more dramatic language, or harmful behavioral pressure. |
| `OWN-008` | `WAITING_OWNER` | OWNER | none | Provide 6-10 lived cognitive sequences and blind evaluation notes in [`docs/owner/14-owner-input-workbook-v1.md`](docs/owner/14-owner-input-workbook-v1.md). Do not define fatigue levels, account-to-feeling mappings, capability prose, token counts, or conversion coefficients. Judge whether the open self-experience/action is source-grounded, character-consistent, and free of system-cost excuses. |

### OWN-001 Draft Review Evidence (2026-08-28)

```text
Outcome: Extended docs/16 with a WorldX seam audit and an executable life-cycle protocol from deterministic world stepping through commit, legal Perception, Cognitive Admission, open action, adjudication, subjective memory, and the unified message outlet. Added S-4-to-first-Feishu deterministic/live acceptance layers. Corrected four active architecture diagrams and the handoff so Affect only biases retrieval salience/soft attention and never injects a state label into Working Self.
Authority read: AGENTS.md; CONTEXT.md; docs/README.md; docs/invariants/19 section 3; docs/world/15; docs/world/16; docs/cognition/13; docs/cognition/20; docs/product/03; docs/owner/14; WorldX SimulationEngine, Perceiver, ActionMenuBuilder, and ActionExecutor.
Files changed: docs/world/16; docs/README; docs/owner/14; PROJECT-HANDOFF.md; TODO.md; computable-world, world-interaction, memory-affect-hybrid, and memory-affect-runtime-loop Mermaid/SVG/PNG artifacts.
Checks: pnpm test (62/62); contract validation (12 schemas, 9 positive fixtures, 12 negative contracts); full project audit (2758 canon entries, 10 diagrams); visual inspection of four regenerated diagrams; git diff --check.
Known residual risk: World/resource/process/Activity schemas and the Feishu adapter do not exist yet; the design is not runtime evidence. Real-Policy silence remains a valid result and cannot be optimized away merely to satisfy first-message delivery.
Rollback: Revert the OWN-001 design-review commit; no deployed schema, migration, Prompt, or runtime behavior changes.
Owner decision still needed: Fill docs/14 A0-A5 and explicitly sign off OWN-001 before M21 schemas freeze.
```

Owner responses belong in `docs/owner/14-owner-input-workbook-v1.md`. Engineering
must not block M1.1 fixes on these items. `OWN-008` also does not block the M2
engine-side capacity implementation; it supplies later blind-evaluation fixtures.

### OWN-001 Completion Evidence (2026-08-29)

```text
Outcome: Owner accepted the docs/16 v1 semantic direction through the requested continuation after the explicit confirmation text: A0/A1 defaults are accepted; A2-A5 action, NPC, ordinary-day, and failure semantics plus the S-4 seed begin with the docs/16 engineering defaults. Parameters and seeds remain versioned calibration inputs, not immutable canon. The authoritative signature is recorded in docs/14; docs/16 and PROJECT-HANDOFF only point to that decision and describe its implementation scope.
Authority read: AGENTS.md; CONTEXT.md; TODO.md; docs/invariants/19; docs/owner/14 section A and H; docs/world/16 sections 0-16; PROJECT-HANDOFF.md.
Files changed: docs/owner/14-owner-input-workbook-v1.md; docs/world/16-computable-world-model-draft-v1.md; docs/README.md; PROJECT-HANDOFF.md; TODO.md.
Checks: full project audit including contract validation, 2758 canon entries, and 10 diagrams; git diff --check.
Known residual risk: Numerical endowments, production recipes, timings, and S-4 calibration have not yet earned runtime evidence. M21-007 through M21-011 must version them and demonstrate deterministic replay; ordinary Policy silence remains valid.
Rollback: Revert the OWN-001 sign-off commit and restore dependent tasks to BLOCKED; no schema, migration, runtime behavior, provider call, world fact, or outbound message changes.
Owner decision still needed: None for OWN-001. OWN-003 remains a separate gate for M20-020.
```

---

## M1.1 (M11): Portable Green Baseline

Exit gate: all existing tests and the full project audit pass on Windows without
weakening schemas, hashes, provenance, or recovery assertions.

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M11-001` | `DONE` | ENG | none | Make Prompt template parsing EOL-agnostic. All 19 runtime tests pass; add LF and CRLF fixture coverage. Do not normalize user content. |
| `M11-002` | `DONE` | ENG | none | Define canon byte/EOL normalization before hashing and apply it consistently in build/audit. Full audit passes without regenerating a machine-specific manifest. |
| `M11-003` | `DONE` | ENG | none | Replace database-global `closureFromDb()` legality with the exact sources assembled for the call plus recursively legal referenced sources. Add negative tests for unseen but stored events/messages/claims. |
| `M11-004` | `DONE` | ENG | none | Introduce a world `Clock`/timezone configuration. Phase/day functions use configured world time and deterministic tests cover UTC/Shanghai boundary cases. |
| `M11-005` | `DONE` | ENG | none | Make `InferenceClient` methods async and inject the interface into `Engine`, not `StubClient`. No database transaction remains open across a model call. Stub tests stay deterministic. |
| `M11-006` | `DONE` | ENG | `M11-005` | Add one real provider adapter behind the neutral interface with pinned model ID, timeout, retry budget, structured output, and prompt-run audit. Provider choice must not leak into domain modules. DeepSeek request model `deepseek-v4-flash` and `DEEPSEEK_API_KEY` were approved, implemented, and verified by a synthetic live smoke on 2026-09-01. |
| `M11-007` | `READY` | ENG | `M11-001..006` | Run and record build, 19 runtime tests, contract validation, canon audit, Markdown/diagram validation, and recovery smoke test. Update this snapshot only when all are green. |

```text
Task: M11-001
Assignee: Codex
Started / completed: 2026-08-26 / 2026-08-27
Outcome: Fast-reply System-template extraction and optional S3 removal accept LF and CRLF; mixed-EOL user text remains unchanged in its native user role.
Authority read: AGENTS.md; TODO.md; docs/README.md; prompts/README.md; prompts/manifest.yaml; prompts/10-fast-reply.md.
Files changed: TODO.md; src/gf/prompts/assembler.ts; src/gf/tests/promptsAssembler.test.ts.
Checks: npm test (50/50); git diff --check.
Known residual risk: Bare-CR legacy files are intentionally unsupported; the repository contract covers LF and CRLF.
Rollback: Revert the M11-001 task commit.
Owner decision still needed: None.
```

```text
Task: M11-002
Assignee: Codex
Started / completed: 2026-08-27 / 2026-08-27
Outcome: Canon manifest hashes now use one shared CRLF/CR-to-LF byte contract in build and audit; all other bytes remain significant, and manifest build contract v3 records the rule.
Authority read: AGENTS.md; TODO.md; docs/README.md; docs/character/05-seed-config-v1.md; docs/character/06-muelsyse-seed-draft-v1.md; corpus/README.md; corpus/canon/README.md.
Files changed: TODO.md; corpus/README.md; corpus/canon/README.md; corpus/canon/manifest.json; corpus/scripts/canonical_bytes.py; corpus/scripts/build_canon.py; corpus/scripts/audit_canon.py; corpus/tests/test_canonical_bytes.py.
Checks: pnpm test (50/50); Python canon tests (3/3); canon audit (2758 entries); contract validation; full project audit; git diff --check.
Known residual risk: The shared contract is for manifest-listed text files; a future binary artifact needs an explicit binary hash mode rather than this newline normalization.
Rollback: Revert the M11-002 task commit; the tracked v2 manifest and raw-byte audit return together.
Owner decision still needed: None.
```

```text
Task: M11-003
Assignee: Codex
Started / completed: 2026-08-27 / 2026-08-27
Outcome: Source legality is now built from the trigger and source-bearing inputs actually assembled for each call; stored history is not globally visible, claims and causal events expand recorded provenance recursively, and claim causal-action refs are validated too.
Authority read: AGENTS.md; TODO.md; docs/README.md; docs/invariants/19-architecture-invariants-v1.md section 3; docs/cognition/02-framework-v3.5.md; prompts/README.md.
Files changed: TODO.md; src/gf/validation/sourceClosure.ts; src/gf/state/stateManager.ts; src/gf/prompts/assembler.ts; src/gf/orchestration/engine.ts; src/gf/tests/stateManager.test.ts; src/gf/tests/promptsAssembler.test.ts.
Checks: pnpm test (57/57); contract validation; full project audit including 2758 canon entries; git diff --check.
Known residual risk: StateManager trusts its in-process caller to pass the assembler-produced inputSources unchanged; M2 versioned call-input contracts and replay hashes remain future work.
Rollback: Revert the M11-003 task commit; database-global closure behavior and its visibility leak return together.
Owner decision still needed: None.
```

```text
Task: M11-004
Assignee: Codex
Started / completed: 2026-08-27 / 2026-08-27
Outcome: Added an injectable wall Clock and one configured IANA world-time projection for local date, world day, and six-phase time. Scheduler events now derive their UTC timestamps and world coordinates from one clock sample; CLI/env configuration selects timezone and epoch. The boundary follows WorldX's separated time/config/event-coordinate architecture while preserving GF's 1:1 wall time and UTC ledger instants.
Authority read: AGENTS.md; TODO.md; docs/README.md; docs/invariants/19-architecture-invariants-v1.md section 3; docs/cognition/02-framework-v3.5.md section 3.5; docs/world/15-world-runtime-interaction-rules-draft-v1.md; WorldX WorldManager, GameTime/SceneConfig, SimulationEngine, and EventStore.
Files changed: TODO.md; src/gf/world/clock.ts; src/gf/scheduler/scheduler.ts; src/gf/cli.ts; src/gf/tests/worldClock.test.ts; src/gf/tests/engine.test.ts.
Checks: pnpm test (61/61); contract validation; full project audit including 2758 canon entries; git diff --check.
Known residual risk: Timezone and epoch are startup configuration rather than versioned persisted world metadata; changing them for an existing database can reinterpret later day/phase boundaries. Persisted WorldX-compatible timeline configuration belongs in the future world-runtime milestone.
Rollback: Revert the M11-004 task commit; Scheduler returns to fixed UTC phase/day calculation.
Owner decision still needed: None.
```

```text
Task: M11-005
Assignee: Codex
Started / completed: 2026-08-28 / 2026-08-28
Outcome: InferenceClient is now a provider-neutral asynchronous port injected into Engine. StubClient remains deterministic, CLI model work is serialized without delaying synchronous inbound persistence, and tick/settlement calls freeze their base revision before awaiting the model so stale proposals fail StateManager CAS. A blocking-model test proves a concurrent BEGIN IMMEDIATE succeeds while inference is suspended.
Authority read: AGENTS.md; TODO.md; docs/README.md; docs/invariants/19-architecture-invariants-v1.md section 3; PROJECT-HANDOFF.md; docs/product/03-interaction-v1.md; docs/cognition/02-framework-v3.5.md.
Files changed: TODO.md; src/gf/inference/base.ts; src/gf/inference/stub.ts; src/gf/orchestration/engine.ts; src/gf/cli.ts; src/gf/tests/engine.test.ts.
Checks: pnpm test (62/62); contract validation; full project audit including 2758 canon entries; git diff --check.
Known residual risk: SurfaceMessage v1 has no base-state revision, so reply model calls must remain engine-serialized until the M2 call lifecycle adds an explicit reservation/CAS contract. Outbox Adapter is still synchronous; a real network delivery port belongs to the Feishu adapter task.
Rollback: Revert the M11-005 task commit; inference and Engine return to synchronous StubClient coupling.
Owner decision still needed: Provider choice and credential source for M11-006.
```

```text
Task: M11-006
Assignee: Codex
Started / completed: 2026-08-31 / 2026-09-01
Outcome: Added a provider-neutral DeepSeek Responses API client pinned to request model `deepseek-v4-flash`, with an explicit opt-in CLI switch, local credential loading, timeout and bounded retry, plain-text fast replies, self-contained JSON Schema output for tick/settlement, local validation, and StateManager-owned prompt-run audit. The default CLI provider remains Stub. A synthetic live request returned one valid bubble and a validated prompt-run record without reading real conversation, world, or memory data.
Authority read: AGENTS.md; TODO.md; docs/README.md; docs/invariants/19-architecture-invariants-v1.md section 3; CONTEXT.md; docs/owner/14-owner-input-workbook-v1.md section H; prompts/manifest.yaml; official DeepSeek Responses API documentation.
Files changed: .gitignore; TODO.md; docs/owner/14-owner-input-workbook-v1.md; src/gf/cli.ts; src/gf/inference/base.ts; src/gf/inference/deepseekResponses.ts; src/gf/orchestration/engine.ts; src/gf/prompts/assembler.ts; src/gf/prompts/manifest.ts; src/gf/state/stateManager.ts; src/gf/validation/schemas.ts; src/gf/tests/deepseekResponses.test.ts.
Checks: pnpm test (115/115); contract validation (34 schemas, 29 positive samples, 31 negative contracts, migrations 001-004); full project audit including 2758 canon entries and 10 diagrams; synthetic DeepSeek live smoke (one bubble, validated audit, output hash present); git diff --check.
Known residual risk: `deepseek-v4-flash` is a provider rolling request alias rather than an immutable model snapshot. Prompt runs stop at `validated` and remain operation-unlinked until M20-018 completes the reserve/infer/commit/settle lifecycle; provider usage receipts are M20-017.
Rollback: Revert the M11-006 task commit; CLI defaults to Stub and no migration or committed world fact depends on the provider adapter.
Owner decision still needed: None.
```

---

## M2.0 (M20): Final Affect-Off Cognitive Baseline

Exit gate: user and world events can use the final cognitive/action pipeline
with `affect_mode=off`; no Affect tables, appraisals, or prompt fields are
required for correct operation.

### Contracts And Persistence

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M20-001` | `DONE` | ENG | `PM-001`, `OWN-001` | Freeze versioned schemas for Observation, MemoryBundle/input closure, WorkingSelf, OpenActionProposal, and WorldOutcomeProposal. JSON Schema is authority; TS types are generated. Completed 2026-08-29. |
| `M20-002` | `DONE` | ENG | `OWN-001` | Freeze `CommitmentV1` with subject, object, content, condition/due time, status, sources, and fulfillment/broken/released events. `debt` remains the reply-specific subtype. **It is a projection derived from the ledger, not an authoritative object** (`docs/invariants/19` B2–B3): the ledger utterance is the fact, `status` is recomputed rather than written by any proposer, World Adjudicator and audit may read it, Working Self and Open Policy may not. Two agents may hold inconsistent understandings of the same interaction; that is a required property, not a defect to reconcile. Completed 2026-08-29. |
| `M20-003` | `DONE` | ENG | `M20-001`, `M20-002` | Add migration `002_*` for observations, beliefs/open loops as needed, commitments, action/outcome audit, and derived-input hashes. Do not modify `001_initial.sql`. Completed 2026-08-29. |
| `M20-004` | `DONE` | ENG | `M11-005` | Define TypeScript ports for Perception, MemoryRetriever, CommitmentReader, WorkingSelfBuilder, OpenPolicy, ActionCompiler, and WorldAdjudicator. Ports use async boundaries where I/O/model calls occur. Completed 2026-08-28. |
| `M20-005` | `DONE` | ENG | `M20-001` | Add schema-to-TypeScript generation/check so CI fails when generated types drift from JSON Schema. Completed 2026-08-29. |
| `M20-006` | `DONE` | ENG | `M11-005` | Freeze versioned JSON Schemas for WakeCandidate/Decision, source-linked `AttentionIntent` / compiled `AttentionSubscription`, raw InferenceUsageReceipt, ExperiencedUsageBreakdown, CognitiveEnergyAccount/Reservation/Settlement, engine-only CognitiveCapacityEnvelope, source-linked nonnumeric CognitiveEpisodeEvidence, and optional free-form SelfExperienceProposal. No fatigue enum or account-to-feeling mapping; TS types are generated. Completed 2026-08-29. |
| `M20-007` | `DONE` | ENG | `M20-003`, `M20-006` | Add an additive migration for AttentionIntent/subscription lifecycle, numeric cognitive-energy accounts, reservations, settlements, immutable usage receipts/segment classification, nonnumeric cognitive episodes, subjective experience records, accumulated salience, and derived Wake audit including `wake=false`. Derived rows are not WorldEvents; do not modify deployed migrations. Completed 2026-08-29. |

### M20-003 Evidence (2026-08-29)

```text
Outcome: Added migration 002 without modifying migration 001. It creates separate source-linked persistence for observations, belief proposals, open-loop history, ledger-derived commitment projections, immutable open-action/world-outcome audit, and exact derived-input closures. All versioned payloads retain their raw JSON plus query columns, revision, closure hash, and normalized sources. SQLite rejects unsupported commitment terminal states, accepted outcomes without effects, rejected outcomes without hard-constraint classes, missing closure parents, and audit mutation.
Authority read: AGENTS.md; TODO.md; docs/invariants/19 A1-A3, B1-B3, C1-C4, E1-E3; M20-001/M20-002 schemas; migrations/001_initial.sql; src/gf/state/migrator.ts.
Files changed: TODO.md; migrations/002_agent_pipeline.sql; src/gf/tests/agentPipelineMigration.test.ts; tests/validate_contracts.py.
Checks: pnpm test (76/76); contract validation (32 schemas, 27 positive samples, 29 negative contracts, migrations 001-002); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: Migration 002 supplies storage and database invariants but no repository writes. StateManager wiring, source-closure validation, CAS, and atomic outcome commit remain M20-011 and M20-024 work. Belief proposals and open-loop history intentionally retain raw versioned payloads pending their later dedicated schemas.
Rollback: Revert the M20-003 commit before applying migration 002. On an already migrated development database, preserve rows and use a new forward migration; never edit or silently remove deployed migration 002.
Owner decision still needed: None.
```

### M20-007 Evidence (2026-08-29)

```text
Outcome: Added forward-only migration 003 for source-linked AttentionIntent and append-only subscription lifecycle records; numeric energy accounts, leases, immutable raw usage/classification/settlement; Wake candidates and complete decision audit with explicit wake=0; accumulated salience; nonnumeric cognitive episodes; and source-linked subjective experience. Derived rows remain outside WorldEvent. SQLite enforces perception-only subscriptions, off/shadow non-contribution, account bounds, cache-count bounds, non-wake consistency, immutable receipts/audit, and no hidden counters in subjective table columns.
Authority read: AGENTS.md; TODO.md; docs/invariants/19 C1-C4, D4-D6, F1-F2, H3; docs/cognition/18 sections 1-7; docs/cognition/20 sections 2-12; M20-006 schemas; migrations/001-002.
Files changed: TODO.md; migrations/003_cognitive_runtime.sql; src/gf/tests/agentPipelineMigration.test.ts; src/gf/tests/cognitiveRuntimeMigration.test.ts; tests/validate_contracts.py.
Checks: pnpm test (78/78); contract validation (32 schemas, 27 positive samples, 29 negative contracts, migrations 001-003); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: Migration 003 provides constraints and audit history but not StateManager transaction orchestration. Conservation across account/reservation/settlement, lease expiry, retry idempotency, and exact source closure remain M20-016 through M20-019.
Rollback: Revert the M20-007 commit before applying migration 003. For an already migrated development database, preserve history and use a new forward migration; never edit migrations 001-003.
Owner decision still needed: None.
```
| `M20-008` | `DONE` | ENG | `M11-005`, `M20-006` | Define injectable TypeScript ports for ChangeAggregator, CognitiveGate, AttentionCompiler, AttentionContextProvider, CognitiveBudgetPlanner, CognitiveCapacityLimiter, CognitiveEnergyEngine, UsageClassifier, and UsageSettlement. There is no fatigue projector. Pure decision functions perform no writes or model calls. Completed 2026-08-29. |

### M20-001 Evidence (2026-08-29)

```text
Outcome: Froze strict v1 entry schemas for subject-specific Observation, source-closed MemoryBundle, evidence-array WorkingSelf, open-text OpenActionProposal, and adjudication-only WorldOutcomeProposal. Working Self carries source-linked evidence roles rather than fixed psychological slots and cannot accept energy, token, provider, Affect, fatigue, capability prose, suggested behavior, or Commitment projection fields. OpenAction has no finite action type or claimed result. Accepted/partial outcomes require proposed effects; rejected outcomes require a hard-constraint class. Generated TypeScript now covers both cognitive runtime and final agent pipeline contracts.
Authority read: AGENTS.md; CONTEXT.md; TODO.md; docs/README.md; docs/invariants/19 section 3; docs/cognition/13 sections 1-8; docs/world/15 sections 14-17; docs/world/16 sections 11-16; docs/owner/14 OWN-001 signature.
Files changed: TODO.md; schemas/agent-pipeline.schema.json and five entry schemas; scripts/generate-schema-types.mjs; src/gf/generated/agentPipelineTypes.ts; src/gf/generated/cognitiveRuntimeTypes.ts; src/gf/tests/agentPipelineContracts.test.ts; tests/contracts/agent-pipeline.valid.json; tests/validate_contracts.py.
Checks: pnpm test (73/73, including generated-type drift check); contract validation (31 schemas, 26 positive samples, 24 negative contracts); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: Schema validates payload shape while cross-row source closure, base-revision CAS, authoritative effect commits, and replay remain StateManager work in M20-003/M20-024. Working Self role names are machine evidence categories, not required fixed slots; M20-014 must assemble only the roles actually supported by the episode.
Rollback: Revert the M20-001 commit; no migration, database row, provider call, committed world fact, or outbound message changes.
Owner decision still needed: None.
```

### M20-002 Evidence (2026-08-29)

```text
Outcome: Froze CommitmentV1 as an explicitly ledger-derived, adjudication/audit-only projection with subject, object, open content and condition, due time, status, evidence, optional reply-debt link, and fulfillment/broken/released event references. Active projections cannot carry terminal events; every terminal status requires its matching committed event. The schema cannot claim authoritative fact status or become a Working Self input. Generated TypeScript and positive/negative contract coverage were updated.
Authority read: AGENTS.md; CONTEXT.md; TODO.md; docs/invariants/19 B1-B3 and C2; docs/cognition/13 sections 3 and 6; docs/world/15 sections 14-17; M20-001 pipeline contracts.
Files changed: TODO.md; schemas/agent-pipeline.schema.json; schemas/commitment.schema.json; scripts/generate-schema-types.mjs; src/gf/generated/agentPipelineTypes.ts; src/gf/generated/cognitiveRuntimeTypes.ts; src/gf/tests/agentPipelineContracts.test.ts; tests/contracts/agent-pipeline.valid.json; tests/validate_contracts.py.
Checks: pnpm test (74/74); contract validation (32 schemas, 27 positive samples, 29 negative contracts); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: Schema proves projection shape and event support, but only M20-003 persistence plus the reducer can prove statuses are recomputed from ledger history rather than accepted from a proposer. Different agents' subjective understandings remain separate memory/belief records by design.
Rollback: Revert the M20-002 commit; no migration, database row, provider call, committed world fact, or outbound message changes.
Owner decision still needed: None.
```

### M20-005 Evidence (2026-08-29)

```text
Outcome: Made schema-derived TypeScript drift checking a fail-closed part of the normal test/CI command for both cognitive-runtime and agent-pipeline contract families. Added an isolated temporary-root replay that first proves a clean generated tree passes, then mutates one generated file and proves the checker exits nonzero with the owning schema named.
Authority read: AGENTS.md; TODO.md; schemas/README.md; M20-001 and M20-006 schema families; package.json test command.
Files changed: TODO.md; scripts/generate-schema-types.mjs; src/gf/tests/schemaGeneration.test.ts.
Checks: pnpm test (74/74, including an induced generated-file drift failure); contract validation (31 schemas, 26 positive samples, 24 negative contracts); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: The generator deliberately supports the JSON Schema subset used by the two generated contract definition graphs. Adding unsupported composition keywords to a generated graph must extend the generator and its drift test in the same task.
Rollback: Revert the M20-005 commit; schemas and already generated files remain usable, but CI no longer proves they agree.
Owner decision still needed: None.
```

### M20-008 Evidence (2026-08-29)

```text
Outcome: Added injectable ports for ChangeAggregator, CognitiveGate, AttentionCompiler, AttentionContextProvider, CognitiveBudgetPlanner, CognitiveCapacityLimiter, CognitiveEnergyEngine, UsageClassifier, and UsageSettlement. Every deterministic decision/accounting operation is synchronous and returns only a proposal or derived snapshot; AttentionContextProvider is the sole asynchronous read boundary. The ports consume M20-006 generated contract types, CapacityLimiter can only return an engine-only envelope, and no state-label projector exists.
Authority read: AGENTS.md; TODO.md; docs/invariants/19 section 3; docs/cognition/18 sections 1-7; docs/cognition/20 sections 2-13; M20-006 generated contracts.
Files changed: TODO.md; src/gf/cognition/runtimePorts.ts; src/gf/tests/cognitiveRuntimePorts.test.ts.
Checks: pnpm test (70/70); contract validation (25 schemas, 21 positive samples, 17 negative contracts); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: These are dependency-injection boundaries, not implementations. Conservation, expiry, idempotency, admission semantics, and StateManager commit authority remain runtime acceptance work in M20-015 through M20-019.
Rollback: Revert the M20-008 commit; no schema, migration, database, provider, world fact, or outbound message changes.
Owner decision still needed: None.
```

### M20-006 Evidence (2026-08-29)

```text
Outcome: Froze 12 strict runtime entry schemas backed by one shared cognitive definition graph: WakeCandidate/Decision, source-linked AttentionIntent and perception-only compiled AttentionSubscription, raw usage receipt and experienced segment breakdown, numeric energy account/reservation/settlement, engine-only CapacityEnvelope, nonnumeric source-linked CognitiveEpisodeEvidence, and optional open-text SelfExperienceProposal. Added deterministic schema-derived TypeScript generation plus drift checking in the normal test command. Contract tests reject hidden-fact subscription fields, non-perceptual subscriptions, prompt-visible envelopes, fatigue enums, and numeric account leakage into lived evidence.
Authority read: AGENTS.md; CONTEXT.md; TODO.md; docs/README.md; docs/invariants/19 section 3; docs/cognition/18 sections 1-7; docs/cognition/20 sections 2-13; docs/history/17 sections 3-4 for retained v1 accounting shapes.
Files changed: TODO.md; package.json; schemas/cognitive-runtime.schema.json and 12 cognitive entry schemas; scripts/generate-schema-types.mjs; src/gf/generated/cognitiveRuntimeTypes.ts; src/gf/tests/cognitiveRuntimeContracts.test.ts; tests/contracts/cognitive-runtime.valid.json; tests/validate_contracts.py.
Checks: npm test (67/67, including generated-type drift check); contract validation (25 schemas, 21 positive samples, 17 negative contracts); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: JSON Schema constrains individual payload shape, not cross-row conservation, lease idempotency, expiry ordering, or cached-input arithmetic. Those runtime properties remain owned by M20-016 through M20-019. Provider/model identifiers remain raw audit fields in InferenceUsageReceipt and are forbidden from subjective evidence and Policy input.
Rollback: Revert the M20-006 commit; no migration, database row, world fact, provider call, or outbound message is changed.
Owner decision still needed: None.
```

### M20-004 Evidence (2026-08-28)

```text
Outcome: Added generic TypeScript ports for Perception, MemoryRetriever, CommitmentReader, WorkingSelfBuilder, OpenPolicy, ActionCompiler, and WorldAdjudicator. Pure snapshot projection, Working Self assembly, and action compilation are synchronous; memory/commitment I/O, model Policy, and complete adjudication are explicit Promise boundaries. CommitmentReader is documented as adjudication/audit-only, Compiler returns capability gaps without canned substitution, and Adjudicator returns proposals without write authority.
Authority read: AGENTS.md; CONTEXT.md; TODO.md; docs/README.md; docs/invariants/19 section 3; docs/cognition/13 sections 3.1-3.7; docs/world/15 section 16; src/gf/inference/base.ts.
Files changed: TODO.md; src/gf/cognition/ports.ts; src/gf/world/actionPorts.ts; src/gf/tests/pipelinePorts.test.ts.
Checks: pnpm test (64/64); contract validation; full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: Port payloads intentionally remain generic until M20-001 freezes JSON Schemas and M20-005 generates authoritative TypeScript types. The async WorldAdjudicator is the outer orchestration boundary; M20-022 deterministic hard checks must remain pure synchronous internals.
Rollback: Revert the M20-004 commit; no schema, migration, database, or runtime wiring changes.
Owner decision still needed: None.
```

### Perception, Memory, And Working Self

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M20-010` | `DONE` | ENG | `M20-001`, `M11-003` | Implement `PerceptionProjector`: agent sees only events/entities allowed by location, channel, visibility, and provenance. Tests prove stored-but-unseen events do not enter observation or source closure. Completed 2026-08-29. |
| `M20-011` | `DONE` | ENG | `M20-003`, `M20-010` | Persist subjective episodic observations and belief proposals with sources. Objective ledger rows are never copied as a new source of truth. Completed 2026-08-29. |
| `M20-012` | `DONE` | ENG | `M20-003` | Implement structured memory filters for entity, visibility, time, relationship, commitment, epistemic status, and **action-to-adjudication-outcome**; then SQLite FTS5 reranking. No vector database. The outcome dimension persists `what was proposed -> what the adjudicator returned -> which hard-constraint class caused a rejection`, reusing the `M20-022` classes (location / time / resource / capability / knowledge / permission / world rule). Tests prove that episodes sharing an outcome shape but no lexical overlap are retrievable together. Completed 2026-08-29. |
| `M20-013` | `DONE` | ENG | `M20-012` | Retrieve supporting and counter-evidence under a fixed context budget. Tests prevent mood/current hypothesis from suppressing relevant contradiction. Completed 2026-08-30. |
| `M20-014` | `DONE` | ENG | `M20-002`, `M20-013`, `M20-016` | Build read-only Working Self from current facts, recent cognitive episodes, activity, sleep/physiology, commitments, memories, beliefs, open loops, persona, and optional contributors. It contains lived evidence but no energy counters, capacity envelope, fatigue labels, suggested behavior, provider, or price fields, **and no affect state label**. Affect reaches the model only by biasing which lived evidence is retrieved (`docs/invariants/19` D2–D3); the events that moved her state enter as ordinary facts and she interprets them herself. Completed 2026-08-30. |
| `M20-015` | `DONE` | ENG | `M20-007`, `M20-008`, `M20-010` | Implement `ChangeAggregator -> PerceptionProjector -> CognitiveGate` before full Working Self construction, following `docs/20`. Gate inputs are legal Perception, current Activity, runtime hard interrupts, active AttentionSubscriptions, and accumulated weak signals. Every meaningful candidate deterministically produces `ignore / accumulate / wake`, priority, reason codes, input hash, and versioned audit, including non-wake outcomes. Tests prove hidden world facts cannot alter WakeDecision through Attention. Completed 2026-08-30. |
| `M20-016` | `DONE` | ENG | `M20-007`, `M20-008` | Implement pure TypeScript recovery, pre-reservation, protected reply reserve, and engine-only CognitiveCapacityEnvelope. Capacity reduction removes optional breadth before current message, safety, commitments, or counter-evidence. No projection from account ranges to subjective prose or behavior. Completed 2026-08-29. |
| `M20-017` | `READY` | ENG | `M11-006`, `M20-007`, `M20-008` | Integrate provider/local usage receipts and versioned segment classification. Accepted semantic input, deliberation, and expression consume energy; runtime/schema/tooling tokens, infrastructure retries, price, and cache discounts do not. Cached semantic input still counts as experienced load. |
| `M20-018` | `BLOCKED` | ENG | `M20-015..017` | Implement the call lifecycle: StateManager reserves before inference; an engine-only CapacityEnvelope constrains assembly/provider capabilities; model execution runs outside database transactions; StateManager then validates source closure and settles actual usage or releases the lease. Autonomous cognition cannot consume the protected reply reserve. |
| `M20-019` | `BLOCKED` | ENG | `M20-018` | Add replay/property tests for conservation, idempotent settlement, failure/retry semantics, model-tokenizer normalization, raw-counter/envelope non-leakage, mandatory-source preservation, absence of fatigue enums/mappings, optional source-linked self-experience, complete non-wake audit, AttentionIntent expiry/cancel/dedup, no hidden-fact wake side channel, no recursive wake from gate bookkeeping, and identical Wake/energy results in Affect `off` versus `shadow`. |

### M20-010 Evidence (2026-08-29)

```text
Task: M20-010
Assignee: Codex
Started / completed: 2026-08-29 / 2026-08-29
Outcome: Implemented a pure deterministic PerceptionProjector over caller-supplied committed candidates. Location, direct/private channel membership, public-channel membership, device-feed authorization, NPC-report recipient, record authorization, and provenance/source-path compatibility are checked before content or source refs cross the boundary. Output ObservationV1 records and the batch source closure are deterministically ordered and hashed. Hidden, unauthorized, empty, and provenance-mismatched candidates produce no placeholder or side-channel artifact.
Authority read: AGENTS.md; TODO.md; docs/README.md; docs/invariants/19 section 3 C1; docs/cognition/13 Agent Memory and Working Self boundaries; docs/world/16 perception/cognition integration; docs/product/03 interaction channels; docs/product/04 inbound provenance and privacy boundary; schemas/observation.schema.json; schemas/agent-pipeline.schema.json; src/gf/validation/sourceClosure.ts; M20-004 PerceptionPort.
Files changed: TODO.md; src/gf/cognition/perception/perceptionProjector.ts; src/gf/tests/perceptionProjector.test.ts.
Checks: pnpm test (86/86); contract validation (32 schemas, 27 positive samples, 29 negative contracts, migrations 001-003); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: This task deliberately keeps projection pure and trusts its repository caller to assemble candidates from one committed snapshot. M20-011 adds StateManager-owned subjective persistence; M20-015 binds the projector to ChangeAggregator and proves hidden facts cannot affect WakeDecision.
Rollback: Revert the M20-010 commit; no migration, database row, provider call, committed world fact, or outbound message changes.
Owner decision still needed: None.
```

### M20-011 Evidence (2026-08-29)

```text
Task: M20-011
Assignee: Codex
Started / completed: 2026-08-29 / 2026-08-29
Outcome: Added an additive BeliefProposalV1 machine contract and a StateManager-only cognitive artifact transaction. Legal ObservationV1 and new proposed beliefs are schema-validated, revision-checked, checked against the exact call-scoped source closure, and atomically stored with both their direct sources and the normalized input roots/hash used to derive them. Identical batches replay idempotently; mixed, stale, forged-hash, accepted-on-entry, or hidden-source batches fail closed. Subjective writes neither create WorldEvents/claims/operations nor advance authoritative reducer revision.
Authority read: AGENTS.md; TODO.md; docs/README.md; docs/invariants/19 A1-A4, B1, C1; docs/cognition/13 Agent Memory, Working Self, belief proposals, and StateManager boundary; schemas/agent-pipeline.schema.json; migrations/002_agent_pipeline.sql; src/gf/validation/sourceClosure.ts; M20-010 PerceptionProjector.
Files changed: TODO.md; schemas/agent-pipeline.schema.json; schemas/belief-proposal.schema.json; src/gf/generated/agentPipelineTypes.ts; src/gf/cognition/perception/perceptionProjector.ts; src/gf/state/stateManager.ts; src/gf/validation/derivedInputClosure.ts; src/gf/validation/sourceClosure.ts; src/gf/tests/agentPipelineContracts.test.ts; src/gf/tests/cognitiveArtifactPersistence.test.ts; tests/contracts/agent-pipeline.valid.json; tests/validate_contracts.py.
Checks: pnpm test (89/89); contract validation (33 schemas, 28 positive samples, 30 negative contracts, migrations 001-003); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: This task persists only initial belief proposals; later accepted/rejected/superseded belief history and retrieval semantics remain M20-012 through M20-014. Repository assembly must still supply one committed snapshot and the exact Perception roots; M20-015 binds that path to cognitive admission.
Rollback: Revert the M20-011 commit; migration 002 remains harmlessly unused and all subjective tables can be deleted without affecting ledger, reducer state, messages, speech, or outbox.
Owner decision still needed: None.
```

### M20-012 Evidence (2026-08-29)

```text
Task: M20-012
Assignee: Codex
Started / completed: 2026-08-29 / 2026-08-29
Outcome: Added forward migration 004, an additive MemoryIndexDocumentV1 contract, StateManager-only rebuildable index writes, and asynchronous StructuredMemorySearch. The index supports actor-scoped visibility, entity, relationship, commitment, epistemic, time, kind, outcome-status, and hard-constraint filters. Action-outcome documents persist the exact proposed intent, adjudicator return, and location/time/resource/capability/knowledge/permission/world_rule rejection classes; StateManager compares every shape field against immutable action/outcome audit before indexing. Structured filtering defines the candidate set and SQLite FTS5 only reranks it, so lexical mismatch cannot suppress a shared result shape. No vector store or vector field was added.
Authority read: AGENTS.md; TODO.md; docs/README.md; docs/invariants/19 A1-A4, B1, C1, C5, G1-G2; docs/cognition/13 Agent Memory and structured retrieval order; migrations/001-003; M20-001/M20-011 generated contracts and source-closure write path.
Files changed: TODO.md; migrations/004_memory_search.sql; schemas/agent-pipeline.schema.json; schemas/memory-index-document.schema.json; src/gf/generated/agentPipelineTypes.ts; src/gf/state/stateManager.ts; src/gf/cognition/memory/structuredMemorySearch.ts; src/gf/tests/agentPipelineContracts.test.ts; src/gf/tests/cognitiveRuntimeMigration.test.ts; src/gf/tests/structuredMemorySearch.test.ts; tests/contracts/agent-pipeline.valid.json; tests/validate_contracts.py.
Checks: pnpm test (93/93); contract validation (34 schemas, 29 positive samples, 31 negative contracts, migrations 001-004); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: FTS5 uses the bundled SQLite unicode61 tokenizer and a bounded recent structured candidate pool; domain-specific segmentation or embeddings remain deliberately absent until measured retrieval failures justify L40-006. M20-013 still owns fixed-budget support/counter balancing, and M20-024 owns production action/outcome audit commits.
Rollback: Revert the M20-012 commit before applying migration 004. For an already migrated development database, preserve migration history and remove/rebuild only the detachable memory_index_* tables in a new forward migration; ledger, reducer state, observations, beliefs, messages, speech, and outbox are unaffected.
Owner decision still needed: None.
```

### M20-013 Evidence (2026-08-30)

```text
Task: M20-013
Assignee: Codex
Started / completed: 2026-08-29 / 2026-08-30
Outcome: Added asynchronous dual-lane balanced memory retrieval over M20-012 structured search. Supporting and counter-evidence receive explicit fixed-budget reserves; counter-evidence is selected first and wins overlap, so an abundant or changing favored hypothesis cannot erase relevant contradiction. Both lanes are pinned to the same base state revision and visibility scope. The returned MemoryBundleV1 contains only selected evidence and its exact normalized source closure. Mandatory evidence fails closed when item, semantic-unit, or 128-source contract capacity cannot fit.
Authority read: AGENTS.md; TODO.md; docs/README.md; docs/invariants/19 C4-C5, G1-G2; docs/cognition/13 Agent Memory, structured retrieval, counter-evidence, and Working Self boundaries; M20-001 MemoryBundleV1 contract; M20-012 StructuredMemorySearch.
Files changed: TODO.md; src/gf/cognition/memory/structuredMemorySearch.ts; src/gf/cognition/memory/balancedMemoryRetriever.ts; src/gf/tests/balancedMemoryRetriever.test.ts.
Checks: pnpm test (97/97); contract validation (34 schemas, 29 positive samples, 31 negative contracts, migrations 001-004); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: The caller still supplies the two explicit structured query plans; evaluating which claims belong in each lane is Working Self/Policy assembly work rather than retrieval authority. The deterministic semantic-unit estimate is an engine context budget, not a provider billing-token counter. M20-014 consumes the resulting bundle.
Rollback: Revert the M20-013 commit. No schema or migration was added; the M20-012 structured memory index remains independently usable.
Owner decision still needed: None.
```

### M20-014 Evidence (2026-08-30)

```text
Task: M20-014
Assignee: Codex
Started / completed: 2026-08-30 / 2026-08-30
Outcome: Added a synchronous, read-only WorkingSelfBuilder that merges one flat evidence stream rather than filling fixed psychological slots. It accepts source-linked current input, safety, current facts, recent cognitive episodes, activity, physiology, original commitment evidence, beliefs, open loops, persona, lived evidence, M20-013 memory bundles, and optional contributors. Current input, safety, current facts, activity/physiology, commitment evidence, and retrieved counter-evidence are mandatory; optional breadth is dropped under the engine-only M20-016 capacity envelope. Output contains only selected narrative evidence and its exact normalized source closure. Capacity/energy, fatigue, Affect state, suggested behavior, provider, and price fields are never serialized. Actor/revision mismatches, forged memory closure, missing mandatory roots, duplicate evidence, and capacity overflow fail closed.
Authority read: AGENTS.md; CONTEXT.md; TODO.md; docs/README.md; docs/invariants/19 B1-B3, C1-C5, D2-D6, F1-F3, G1-G2; docs/cognition/13 Working Self Builder, memory boundary, detachability, and capacity degradation; M20-001 WorkingSelfV1 contract; M20-013 MemoryBundleV1 producer; M20-016 CognitiveCapacityEnvelopeV2.
Files changed: TODO.md; src/gf/cognition/workingSelf/workingSelfBuilder.ts; src/gf/tests/workingSelfBuilder.test.ts.
Checks: pnpm test (101/101); contract validation (34 schemas, 29 positive samples, 31 negative contracts, migrations 001-004); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: Upstream assembly must still supply legal Perception-derived current facts and original commitment utterance/action evidence; this pure builder cannot independently query the ledger or authenticate a narrative. The deterministic semantic-unit estimate is an engine selection budget, not provider token accounting. M20-015 binds admission to legal Perception, while M20-020 consumes this view in Open Policy after its remaining dependencies and Owner gate clear.
Rollback: Revert the M20-014 commit. No schema, migration, database row, world fact, model call, or outbound message is added; M20-013 retrieval and M20-016 capacity remain independently usable.
Owner decision still needed: None.
```

### M20-015 Evidence (2026-08-30)

```text
Task: M20-015
Assignee: Codex
Started / completed: 2026-08-30 / 2026-08-30
Outcome: Added a pure ChangeAggregator, CognitiveGate, and CognitiveAdmissionPipeline implementing ChangeAggregator -> PerceptionProjector -> CognitiveGate. Pre-perception aggregation canonicalizes and deduplicates a committed time window but deliberately never merges visibility paths. Each change is projected independently, and only resulting legal Observations can contribute salience, AttentionSubscription matching, accumulated weak signals, activity boundaries, or runtime hard interrupts. Every legal candidate produces deterministic WakeCandidateV1 and versioned WakeDecisionV1 audit payloads for ignore/accumulate/wake, with queue lane, reason codes, matched rule IDs, exact source closure, and base revision. Direct authenticated user messages retain the reply lane; visible safety interrupts receive the safety lane; internal bookkeeping produces a non-recursive ignore decision.
Authority read: AGENTS.md; CONTEXT.md; TODO.md; docs/README.md; docs/invariants/19 C1-C5, D1-D3, F1-F3, G1-G2, H2-H4; docs/cognition/20 Cognitive Admission, Perception-before-Attention, weak-signal aggregation, hard interrupts, and property tests; M20-006 Wake/Attention contracts; M20-008 runtime ports; M20-010 PerceptionProjector.
Files changed: TODO.md; src/gf/cognition/admission/cognitiveAdmission.ts; src/gf/tests/cognitiveAdmission.test.ts.
Checks: pnpm test (106/106); contract validation (34 schemas, 29 positive samples, 31 negative contracts, migrations 001-004); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: This task emits complete versioned candidate/decision audit payloads but does not commit them; StateManager-owned atomic persistence, salience-accumulation lifecycle rows, lease binding, and crash recovery remain M20-018/M20-019. AttentionIntent compilation and lifecycle persistence also remain in that downstream lifecycle work. Threshold parameters are versioned injected configuration and require longitudinal calibration rather than hard-coded product meaning.
Rollback: Revert the M20-015 commit. No schema, migration, database row, world fact, model call, or outbound message is added; M20-010 Perception remains independently usable.
Owner decision still needed: None.
```

### M20-016 Evidence (2026-08-29)

```text
Outcome: Implemented pure deterministic cognitive-energy recovery, access-class-aware budget planning, account reservation/settlement proposals, and engine-only CapacityEnvelope derivation. Autonomous reservations cannot enter the protected reply reserve; reply/safety work may use it. Recovery is lazy and capped around active leases. Capacity reduction removes optional semantic breadth, then extra deliberation/expression, while mandatory sources and minimum complete expression are preserved or the planner fails closed. Envelope IDs are deterministic hashes and no account range produces subjective prose or behavior.
Authority read: AGENTS.md; TODO.md; docs/invariants/19 C3-C4, D4-D6, F2, H3; docs/cognition/18 sections 1-7; retained accounting semantics from docs/history/17 sections 2 and 4; M20-006 generated contracts and M20-008 ports.
Files changed: TODO.md; src/gf/cognition/energy/energyEngine.ts; src/gf/tests/cognitiveEnergy.test.ts.
Checks: pnpm test (83/83); contract validation (32 schemas, 27 positive samples, 29 negative contracts, migrations 001-003); full project audit including 2758 canon entries and 10 diagrams; git diff --check.
Known residual risk: The current accounting version treats one reserved normalized unit as one energy unit; M20-017 supplies model/tokenizer normalization and M20-018 atomically binds the proposals to persisted leases. Provider hard-limit capability degradation remains an adapter concern and must not be inferred from the envelope alone.
Rollback: Revert the M20-016 commit; no schema, migration, database row, provider call, committed world fact, or outbound message changes.
Owner decision still needed: None.
```

### Open Policy And World Adjudication

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M20-020` | `BLOCKED` | ENG | `M20-001`, `M20-014`, `M20-018`, `OWN-003` | Implement open generative Policy. From lived evidence under actual capacity limits it produces one open semantic intent/plan plus optional free-form SelfExperienceProposal and optional source-linked AttentionIntent. AttentionIntent expresses what future perceptible change should matter; it does not contain runtime watcher rules. Policy receives no counters, envelope, fatigue tiers, capability prose, or finite action list. |
| `M20-021` | `BLOCKED` | ENG | `M20-020`, `OWN-001` | Implement action compiler from open plan to finite execution primitives. Unsupported semantics produce a capability-gap result, not silent replacement with a canned action. |
| `M20-022` | `BLOCKED` | ENG | `M20-021`, `OWN-001` | Implement deterministic hard adjudication for location, time, resource, capability, knowledge, permission, and immutable world rules. |
| `M20-023` | `BLOCKED` | ENG | `M20-022` | Implement source-constrained social/environmental outcome proposal for NPC choice, partial success, misunderstanding, and side effects. It cannot bypass hard adjudication. |
| `M20-024` | `BLOCKED` | ENG | `M20-003`, `M20-023` | Validate and atomically commit outcomes through StateManager with base revision, source closure, idempotency, and replay tests. |
| `M20-025` | `BLOCKED` | ENG | `M20-015`, `M20-018`, `M20-020`, `M20-024` | Route user and non-user events through the same Cognitive Admission / Working Self / Open Policy pipeline. Preserve the existing user-message response contract and a low-latency surface-rendering path, but not a second personality or decision system. |
| `M20-026` | `BLOCKED` | ENG | `M20-025` | Route proactive and reactive text through the same SurfaceMessage/StateManager/outbox path. Proactive delivery stays feature-disabled until safety tests pass. |

---

## M2.1 (M21): Independent World Life

Exit gate: a deterministic resource/process kernel advances an ordinary closed
life loop without a user message or LLM-authored world event. Obligations,
ecology, production, NPC capacity, and external boundaries produce sourced
consequences; protagonist association only changes attention.

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M21-007` | `READY` | ENG | `OWN-001`, `M20-001` | Freeze versioned ResourceType, Account, Reservation, ProcessDefinition/Instance, ActivityRecord, WorldCommand, and WorldStep schemas from docs/16. Activity/process statuses and resource laws are machine execution semantics, not semantic action candidates; TS types are generated. |
| `M21-008` | `BLOCKED` | ENG | `M21-007`, `M20-003` | Add resource/process persistence and a deterministic ledger with balanced transfers, non-negative stocks, interval capacity reservations, source closure, revision CAS, and property tests. |
| `M21-009` | `BLOCKED` | ENG | `M21-008` | Implement the pure TypeScript discrete-event stepper, process queues, bounded seeded distributions, completion/failure/rework, and next-event calculation. Same state/commands/rules/seed is byte-stable. No model calls occur inside the stepper. |
| `M21-010` | `BLOCKED` | ENG + OWNER | `M21-009` | Implement and calibrate one closed fixture: physiology + manifestation load + ecology-garden water/energy/pump + S-4 cultivation/observation. It traverses WorldClock -> pure WorldStep proposal -> StateManager commit -> legal Perception -> CognitiveGate; accepted Activity/Process work advances without continuous Policy calls. Offline and stepwise execution match. |
| `M21-011` | `BLOCKED` | ENG + OWNER | `M21-009` | Add ecology-department staff/instrument/budget/procurement queues plus bounded Trimounts transport, supplier, weather, and service boundary nodes. Macro-economy remains outside scope. |
| `M21-012` | `BLOCKED` | ENG + OWNER | `M20-026`, `M21-010` | Implement the Feishu private-text adapter and deliver the first source-grounded autonomous message. The adapter declares/version-controls its capabilities and has idempotent receipts, retry recovery, and explicit failure events. Deterministic evidence uses a frozen Policy fixture to prove: no inbound user message -> committed S-4 change -> legal Perception -> WakeDecision -> communicate proposal -> atomic speech/outbox -> adapter receipt, with `/mute` blocking delivery and retry never duplicating the message. Live evidence then runs an Owner-authorized closed S-4 scene with the real Open Policy and captures the first delivered message plus its full source chain. A silent real-Policy episode is valid but does not complete live-delivery evidence; do not tune contact pressure or manufacture events to force speech. |
| `M21-001` | `BLOCKED` | ENG | `M20-002`, `M21-009` | Commitment/schedule driver converts accepted obligations into due production demand and emits conflict, overdue, fulfilled, broken, or released events with stable idempotency. |
| `M21-002` | `BLOCKED` | ENG | `M20-010`, `M21-009` | NPC driver supplies role capacity and advances accepted routine work without continuous LLM calls; acceptance, refusal, negotiation, and risk decisions use limited-knowledge focus Policy. |
| `M21-003` | `BLOCKED` | ENG | `M20-010`, `M21-009` | Environment driver advances configured stock/flow and exogenous processes such as weather, equipment condition, location access, and bounded failures without manufacturing drama. |
| `M21-004` | `BLOCKED` | ENG | `M21-001..003`, `M21-009` | Offline aggregation advances to meaningful event boundaries rather than simulating each minute. Same state/clock/seed produces replayable event proposals and matches stepwise execution. |
| `M21-005` | `BLOCKED` | ENG | `M20-013`, `M21-004` | Association sampler biases attention toward one concrete object but has no authority to assert that an external event occurred. |
| `M21-006` | `BLOCKED` | ENG | `M21-001..005`, `M21-010..011` | Simulation fixture proves: coupled resource/process pressure + NPC request + prior commitment -> open action -> cost/partial outcome -> later memory/contact effect, with all facts, conservation, commands, and sources replayable. |

---

## M2.2 (M22): Shadow Affect

Exit gate: Affect is source-linked, deterministic after appraisal, rebuildable,
and has zero influence on Policy input/output outside audit logging.

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M22-001` | `BLOCKED` | ENG | `OWN-002`, `OWN-004`, `M20-001` | Freeze Concern, AppraisalProposal, AffectState, Residue, and Reappraisal schemas. Concern is open text with identity/lifecycle, not a universal drive enum. |
| `M22-002` | `BLOCKED` | ENG | `M22-001` | Add derived appraisal/affect tables with source event, input closure hash, model/prompt version, formula/parameter version, base revision, and supersedes links. Deleting tables preserves authoritative runtime. |
| `M22-003` | `BLOCKED` | ENG | `M22-001`, `M11-006` | Implement appraisal provider with multiple interpretations, confidence, concern effects, agency, controllability, certainty, and unexpectedness. Persist accepted proposal before affect replay. |
| `M22-004` | `BLOCKED` | ENG | `M22-002`, `M22-003` | Implement deterministic AffectModel v1 using valence/arousal/dominance and source-linked residues. Same state/appraisal/time/version replays exactly. |
| `M22-005` | `BLOCKED` | ENG | `M22-004` | Implement reappraisal: new evidence can weaken, strengthen, transform, or supersede residue without rewriting historical appraisal. |
| `M22-006` | `BLOCKED` | ENG | `M22-004`, `M20-025` | Implement `shadow` mode. Off and shadow Wake decisions, energy recovery/reservation/settlement, Policy inputs, and resulting action distributions are equal under deterministic fixtures; only Affect audit artifacts differ. |
| `M22-007` | `BLOCKED` | ENG | `M22-006` | Run Owner calibration set, report systematic appraisal/decay errors, and version parameter changes. Do not tune on desired dialogue wording alone. |

---

## M2.3 (M23): Active Affect

Exit gate: active mode shows longitudinal causal benefit without becoming an
action selector, contact-frequency driver, or dramatic-language amplifier.

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M23-001` | `BLOCKED` | ENG | `M22-006`, `M20-014` | Affect implements a bounded retrieval-salience / soft-attention provider; cognition imports only that port, never an Affect state fragment, and runs identically to `off` when the provider is absent. |
| `M23-002` | `BLOCKED` | ENG | `M23-001`, `M20-013` | Affect may rerank relevant memories within bounded influence while mandatory counter-evidence and commitments remain present. |
| `M23-003` | `BLOCKED` | ENG | `M23-001` | Implement config/admin events for `off/shadow/active`; mode, version, and effective time are audited and replayable. |
| `M23-004` | `BLOCKED` | ENG | `M23-001..003`, `OWN-005` | Run equal-budget off/shadow/active longitudinal suite for persistence, counterfactual sensitivity, paraphrase stability, no-dialogue life, and model portability. |
| `M23-005` | `BLOCKED` | ENG | `M23-004` | Run non-manipulation checks: negative affect, user silence, and low reciprocity must not increase proactive contact pressure. |
| `M23-006` | `BLOCKED` | OWNER | `M23-004`, `M23-005` | Approve active, keep shadow only, or remove Affect according to evidence. Decision is recorded without rewriting old results. |

---

## M3 (M30): Evaluation, Operations, And Release

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M30-001` | `BLOCKED` | ENG + OWNER | `OWN-005`, `OWN-008`, `M20-025` | Freeze blind longitudinal and lived-cognition fixtures plus rubrics before tuning the evaluated version. Owner examples remain evaluation data and are not converted into fatigue states or behavior rules. |
| `M30-002` | `BLOCKED` | ENG | `M21-006`, `M30-001` | Run 200-round accelerated simulation; report fact conflicts, commitment closure, event diversity, self-reference, empty/ordinary turns, costs, and failures. No target forces artificial drama. |
| `M30-003` | `BLOCKED` | ENG + OWNER | `M30-002`, text adapter | Run 7-day 1:1 pilot with private logs, explicit stop control, and daily Owner annotations. |
| `M30-004` | `BLOCKED` | ENG | `M30-003` | Run model swap with frozen assets/input budget and report behavior displacement, invalid contracts, continuity, latency, and cost. |
| `M30-005` | `BLOCKED` | ENG | `M30-003` | Produce rollback rehearsal: disable Affect, replay from ledger, recover outbox, and verify no duplicate delivery or lost authoritative state. |
| `M30-006` | `BLOCKED` | OWNER | `M30-003..005` | Sign off release, continue shadow, or return to off baseline. |

---

## Later Work (L40)

These items must not add current schema fields or block M1.1/M2.

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `L40-001` | `CANCELLED` | ENG | superseded by `M21-012` | Former post-M30 Feishu text-adapter task. Owner reprioritized the first Feishu message as the completion surface for the initial independent-life slice; implementation and delivery evidence now belong to `M21-012`. ID retained for history. |
| `L40-002` | `LATER` | ENG | stable text surface | Versioned multimodal communication plan and text/audio/image renderers with semantic conservation. |
| `L40-003` | `LATER` | ENG + OWNER | M30 evidence | Expand the approved local resource/process kernel beyond the ecology department into more organizations, industries, and NPC roles without all-NPC continuous LLM calls. |
| `L40-004` | `LATER` | ENG + OWNER | explicit capability event | Cross-world gifts/shared assets with consent, provenance, asset state, and synchronized adjudication. |
| `L40-005` | `LATER` | ENG + OWNER | explicit capability event | Restricted Doctor avatar/entry with location, permission, visibility, action, and no second personality. |
| `L40-006` | `LATER` | ENG | retrieval evidence | Optional embeddings/vector reranker if FTS baseline demonstrably misses relevant memory. |

---

## Repository Checks

Run checks relevant to every changed contract or runtime path:

```powershell
pnpm test
& '<python>' tests\validate_contracts.py
& '<python>' scripts\validate_project.py
git diff --check
```

For a failed check, record whether it is:

- introduced by the current task;
- an already tracked baseline failure with its Task ID;
- blocked by missing Owner input or an external service.

Do not mark a task `DONE` merely because the code compiles. Acceptance,
negative tests, replay, and rollback behavior are part of completion.

## Task Evidence Template

Append evidence near the task or in its commit/PR body:

```text
Task: Mxx-xxx
Assignee:
Started / completed:
Outcome:
Authority read:
Files changed:
Checks:
Known residual risk:
Rollback:
Owner decision still needed:
```
