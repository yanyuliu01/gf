# GF Project Backlog

Snapshot: **2026-08-07**
Project handoff: [`PROJECT-HANDOFF.md`](PROJECT-HANDOFF.md)
Owner workbook: [`docs/14-owner-input-workbook-v1.md`](docs/14-owner-input-workbook-v1.md)

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

Task IDs are stable. Do not delete completed or cancelled rows. Update status,
acceptance evidence, and the snapshot date when project state changes.

## Current Critical Path

```text
PM-001 specification sync
        +
M11-001..006 portable M1.1 baseline
        +
OWN-001 world runtime decisions
        +
OWN-002 concern/tension seed
        |
        v
M20 contracts -> Wake/energy baseline -> M20 final off pipeline -> M21 world autonomy
        |
        v
M22 shadow Affect -> M23 active Affect -> M30 longitudinal proof
```

Owner work and M1.1 engineering can proceed in parallel. `OWN-003` A7 can also
proceed in parallel, but active character-facing evaluation cannot finish
without it. `OWN-008` lived sequences proceed in parallel and gate M30 blind
evaluation, not the v2 account, envelope, or Policy contracts.

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
| `PM-001` | `READY` | ENG + OWNER review | none | Mark finite semantic action candidate/local arbitration sections in PRD, docs/02, docs/08, and active tick Prompt as M1 history or replace them with open Policy wording. Search shows no active instruction to generate/rank semantic candidates. Association sampling terminology remains clearly distinct. |
| `PM-002` | `DONE` | ENG | none | Add `PROJECT-HANDOFF.md`, this board, `AGENTS.md`, Owner workbook, and repository navigation. Evidence: project-management documentation commit. |
| `PM-003` | `RECURRING` | current assignee | every task | Update task status, dependencies, acceptance evidence, and dated project snapshot in the same commit as material work. |
| `PM-004` | `READY` | ENG | `PM-002` | Add a lightweight decision-log/ADR convention for architecture changes that replace an existing decision. Historical docs remain intact. |
| `PM-005` | `LATER` | ENG | first multi-person sprint | Add GitHub issue templates mapping issue title/body to Task ID, authority, acceptance, rollback, and test evidence. |

### PM-001 Notes

This is a specification consistency task, not a behavior implementation. It
must preserve docs/12 and old diagrams as historical records. The M1 event,
StateManager, source, transaction, Prompt assembly, and outbox contracts remain
unchanged.

---

## OWN: Owner Inputs

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `OWN-001` | `WAITING_OWNER` | OWNER | none | Review the computable world kernel in [`docs/16-computable-world-model-draft-v1.md`](docs/16-computable-world-model-draft-v1.md): resource endowments, stock-flow conservation, process recipes, capacity allocation, ecology/physiology, organization queues, exogenous drivers, and deterministic stepping. [`docs/15-world-runtime-interaction-rules-draft-v1.md`](docs/15-world-runtime-interaction-rules-draft-v1.md) is retained only as the open-action adjudication layer. Sign-off belongs in docs/14; draft existence is not approval. |
| `OWN-002` | `WAITING_OWNER` | OWNER | none | Approve/edit 5-8 open natural-language concerns and 3-5 genuine tension pairs. Each has a source and supporting/harming examples, but no numeric weight or behavior rule. |
| `OWN-003` | `WAITING_OWNER` | OWNER | none | Finalize A7: fill Doctor placeholders, rewrite spoken/canon lines into believable typing, approve disagreement/debt/proactive examples, remove editor annotations, and sign off runtime S3 text. |
| `OWN-004` | `WAITING_OWNER` | OWNER | `OWN-002` | Label 15-20 calibration events by affected concern, direction, small/medium/large impact, persistence expectation, and unacceptable interpretation. No decimal Utility values. |
| `OWN-005` | `WAITING_OWNER` | OWNER | `OWN-001`, `OWN-002`, `OWN-003` | Approve 8-10 longitudinal golden scenarios with initial state, event sequence, expected continuity after hours/days, and prohibited outcomes. |
| `OWN-006` | `READY` | OWNER | none | Confirm or replace the PRD north-star metric. It must remain an audit measure and must never feed character strategy or contact frequency. |
| `OWN-007` | `LATER` | OWNER | M30 results | Review 7-day logs and decide whether active Affect creates meaningful continuity, only more dramatic language, or harmful behavioral pressure. |
| `OWN-008` | `WAITING_OWNER` | OWNER | none | Provide 6-10 lived cognitive sequences and blind evaluation notes in [`docs/14-owner-input-workbook-v1.md`](docs/14-owner-input-workbook-v1.md). Do not define fatigue levels, account-to-feeling mappings, capability prose, token counts, or conversion coefficients. Judge whether the open self-experience/action is source-grounded, character-consistent, and free of system-cost excuses. |

Owner responses belong in `docs/14-owner-input-workbook-v1.md`. Engineering
must not block M1.1 fixes on these items. `OWN-008` also does not block the M2
engine-side capacity implementation; it supplies later blind-evaluation fixtures.

---

## M1.1: Portable Green Baseline

Exit gate: all existing tests and the full project audit pass on Windows without
weakening schemas, hashes, provenance, or recovery assertions.

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M11-001` | `READY` | ENG | none | Make Prompt template parsing EOL-agnostic. All 19 runtime tests pass; add LF and CRLF fixture coverage. Do not normalize user content. |
| `M11-002` | `READY` | ENG | none | Define canon byte/EOL normalization before hashing and apply it consistently in build/audit. Full audit passes without regenerating a machine-specific manifest. |
| `M11-003` | `READY` | ENG | none | Replace database-global `closureFromDb()` legality with the exact sources assembled for the call plus recursively legal referenced sources. Add negative tests for unseen but stored events/messages/claims. |
| `M11-004` | `READY` | ENG | none | Introduce a world `Clock`/timezone configuration. Phase/day functions use configured world time and deterministic tests cover UTC/Shanghai boundary cases. |
| `M11-005` | `READY` | ENG | none | Make `InferenceClient` methods async and inject the interface into `Engine`, not `StubClient`. No database transaction remains open across a model call. Stub tests stay deterministic. |
| `M11-006` | `BLOCKED` | ENG | `M11-005` | Add one real provider adapter behind the neutral interface with pinned model ID, timeout, retry budget, structured output, and prompt-run audit. Provider choice must not leak into domain modules. |
| `M11-007` | `BLOCKED` | ENG | `M11-001..005` | Run and record build, 19 runtime tests, contract validation, canon audit, Markdown/diagram validation, and recovery smoke test. Update this snapshot only when all are green. |

---

## M2.0: Final Affect-Off Cognitive Baseline

Exit gate: user and world events can use the final cognitive/action pipeline
with `affect_mode=off`; no Affect tables, appraisals, or prompt fields are
required for correct operation.

### Contracts And Persistence

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M20-001` | `BLOCKED` | ENG | `PM-001`, `OWN-001` | Freeze versioned schemas for Observation, MemoryBundle/input closure, WorkingSelf, OpenActionProposal, and WorldOutcomeProposal. JSON Schema is authority; TS types are generated. |
| `M20-002` | `BLOCKED` | ENG | `OWN-001` | Freeze `CommitmentV1` with subject, object, content, condition/due time, status, sources, and fulfillment/broken/released events. `debt` remains the reply-specific subtype. |
| `M20-003` | `BLOCKED` | ENG | `M20-001`, `M20-002` | Add migration `002_*` for observations, beliefs/open loops as needed, commitments, action/outcome audit, and derived-input hashes. Do not modify `001_initial.sql`. |
| `M20-004` | `BLOCKED` | ENG | `M11-005` | Define TypeScript ports for Perception, MemoryRetriever, CommitmentReader, WorkingSelfBuilder, OpenPolicy, ActionCompiler, and WorldAdjudicator. Ports use async boundaries where I/O/model calls occur. |
| `M20-005` | `BLOCKED` | ENG | `M20-001` | Add schema-to-TypeScript generation/check so CI fails when generated types drift from JSON Schema. |
| `M20-006` | `BLOCKED` | ENG | `M11-005` | Freeze versioned JSON Schemas for WakeCandidate/Decision, raw InferenceUsageReceipt, ExperiencedUsageBreakdown, CognitiveEnergyAccount/Reservation/Settlement, engine-only CognitiveCapacityEnvelope, source-linked nonnumeric CognitiveEpisodeEvidence, and optional free-form SelfExperienceProposal. No fatigue enum or account-to-feeling mapping; TS types are generated. |
| `M20-007` | `BLOCKED` | ENG | `M20-003`, `M20-006` | Add an additive migration for numeric cognitive-energy accounts, reservations, settlements, immutable usage receipts/segment classification, nonnumeric cognitive episodes, subjective experience records, accumulated salience, and derived Wake audit including `wake=false`. Derived rows are not WorldEvents; do not modify deployed migrations. |
| `M20-008` | `BLOCKED` | ENG | `M11-005`, `M20-006` | Define injectable TypeScript ports for ChangeAggregator, CognitiveGate, CognitiveBudgetPlanner, CognitiveCapacityLimiter, CognitiveEnergyEngine, UsageClassifier, and UsageSettlement. There is no fatigue projector. Pure decision functions perform no writes or model calls. |

### Perception, Memory, And Working Self

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M20-010` | `BLOCKED` | ENG | `M20-001`, `M11-003` | Implement `PerceptionProjector`: agent sees only events/entities allowed by location, channel, visibility, and provenance. Tests prove stored-but-unseen events do not enter observation or source closure. |
| `M20-011` | `BLOCKED` | ENG | `M20-003`, `M20-010` | Persist subjective episodic observations and belief proposals with sources. Objective ledger rows are never copied as a new source of truth. |
| `M20-012` | `BLOCKED` | ENG | `M20-003` | Implement structured memory filters for entity, visibility, time, relationship, commitment, and epistemic status; then SQLite FTS5 reranking. No vector database. |
| `M20-013` | `BLOCKED` | ENG | `M20-012` | Retrieve supporting and counter-evidence under a fixed context budget. Tests prevent mood/current hypothesis from suppressing relevant contradiction. |
| `M20-014` | `BLOCKED` | ENG | `M20-002`, `M20-013`, `M20-016` | Build read-only Working Self from current facts, recent cognitive episodes, activity, sleep/physiology, commitments, memories, beliefs, open loops, persona, and optional contributors. It contains lived evidence but no energy counters, capacity envelope, fatigue labels, suggested behavior, provider, or price fields. |
| `M20-015` | `BLOCKED` | ENG | `M20-007`, `M20-008`, `M20-010` | Implement `ChangeAggregator -> PerceptionProjector -> CognitiveGate` before full Working Self construction. Every meaningful candidate deterministically produces `ignore / accumulate / wake`, priority, reason codes, input hash, and versioned audit, including non-wake outcomes. |
| `M20-016` | `BLOCKED` | ENG | `M20-007`, `M20-008` | Implement pure TypeScript recovery, pre-reservation, protected reply reserve, and engine-only CognitiveCapacityEnvelope. Capacity reduction removes optional breadth before current message, safety, commitments, or counter-evidence. No projection from account ranges to subjective prose or behavior. |
| `M20-017` | `BLOCKED` | ENG | `M11-006`, `M20-007`, `M20-008` | Integrate provider/local usage receipts and versioned segment classification. Accepted semantic input, deliberation, and expression consume energy; runtime/schema/tooling tokens, infrastructure retries, price, and cache discounts do not. Cached semantic input still counts as experienced load. |
| `M20-018` | `BLOCKED` | ENG | `M20-015..017` | Implement the call lifecycle: StateManager reserves before inference; an engine-only CapacityEnvelope constrains assembly/provider capabilities; model execution runs outside database transactions; StateManager then validates source closure and settles actual usage or releases the lease. Autonomous cognition cannot consume the protected reply reserve. |
| `M20-019` | `BLOCKED` | ENG | `M20-018` | Add replay/property tests for conservation, idempotent settlement, failure/retry semantics, model-tokenizer normalization, raw-counter/envelope non-leakage, mandatory-source preservation, absence of fatigue enums/mappings, optional source-linked self-experience, complete non-wake audit, and identical Wake/energy results in Affect `off` versus `shadow`. |

### Open Policy And World Adjudication

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M20-020` | `BLOCKED` | ENG | `M20-001`, `M20-014`, `M20-018`, `OWN-003` | Implement open generative Policy. From lived evidence under actual capacity limits it jointly produces one open semantic intent/plan and an optional free-form SelfExperienceProposal. It receives no counters, envelope, fatigue tiers, capability prose, or finite action list. |
| `M20-021` | `BLOCKED` | ENG | `M20-020`, `OWN-001` | Implement action compiler from open plan to finite execution primitives. Unsupported semantics produce a capability-gap result, not silent replacement with a canned action. |
| `M20-022` | `BLOCKED` | ENG | `M20-021`, `OWN-001` | Implement deterministic hard adjudication for location, time, resource, capability, knowledge, permission, and immutable world rules. |
| `M20-023` | `BLOCKED` | ENG | `M20-022` | Implement source-constrained social/environmental outcome proposal for NPC choice, partial success, misunderstanding, and side effects. It cannot bypass hard adjudication. |
| `M20-024` | `BLOCKED` | ENG | `M20-003`, `M20-023` | Validate and atomically commit outcomes through StateManager with base revision, source closure, idempotency, and replay tests. |
| `M20-025` | `BLOCKED` | ENG | `M20-015`, `M20-018`, `M20-020`, `M20-024` | Route user and non-user events through the same Wake/Working Self/Open Policy pipeline. Preserve a low-latency surface-rendering path, but not a second personality or decision system. |
| `M20-026` | `BLOCKED` | ENG | `M20-025` | Route proactive and reactive text through the same SurfaceMessage/StateManager/outbox path. Proactive delivery stays feature-disabled until safety tests pass. |

---

## M2.1: Independent World Life

Exit gate: a deterministic resource/process kernel advances an ordinary closed
life loop without a user message or LLM-authored world event. Obligations,
ecology, production, NPC capacity, and external boundaries produce sourced
consequences; protagonist association only changes attention.

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M21-007` | `BLOCKED` | ENG | `OWN-001`, `M20-001` | Freeze versioned ResourceType, Account, Reservation, ProcessDefinition/Instance, WorldCommand, and WorldStep schemas from docs/16. Resource laws are machine semantics, not semantic action candidates; TS types are generated. |
| `M21-008` | `BLOCKED` | ENG | `M21-007`, `M20-003` | Add resource/process persistence and a deterministic ledger with balanced transfers, non-negative stocks, interval capacity reservations, source closure, revision CAS, and property tests. |
| `M21-009` | `BLOCKED` | ENG | `M21-008` | Implement the pure TypeScript discrete-event stepper, process queues, bounded seeded distributions, completion/failure/rework, and next-event calculation. Same state/commands/rules/seed is byte-stable. No model calls occur inside the stepper. |
| `M21-010` | `BLOCKED` | ENG + OWNER | `M21-009` | Implement and calibrate one closed fixture: physiology + manifestation load + ecology-garden water/energy/pump + S-4 cultivation/observation. Offline and stepwise execution match. |
| `M21-011` | `BLOCKED` | ENG + OWNER | `M21-009` | Add ecology-department staff/instrument/budget/procurement queues plus bounded Trimounts transport, supplier, weather, and service boundary nodes. Macro-economy remains outside scope. |
| `M21-001` | `BLOCKED` | ENG | `M20-002`, `M21-009` | Commitment/schedule driver converts accepted obligations into due production demand and emits conflict, overdue, fulfilled, broken, or released events with stable idempotency. |
| `M21-002` | `BLOCKED` | ENG | `M20-010`, `M21-009` | NPC driver supplies role capacity and advances accepted routine work without continuous LLM calls; acceptance, refusal, negotiation, and risk decisions use limited-knowledge focus Policy. |
| `M21-003` | `BLOCKED` | ENG | `M20-010`, `M21-009` | Environment driver advances configured stock/flow and exogenous processes such as weather, equipment condition, location access, and bounded failures without manufacturing drama. |
| `M21-004` | `BLOCKED` | ENG | `M21-001..003`, `M21-009` | Offline aggregation advances to meaningful event boundaries rather than simulating each minute. Same state/clock/seed produces replayable event proposals and matches stepwise execution. |
| `M21-005` | `BLOCKED` | ENG | `M20-013`, `M21-004` | Association sampler biases attention toward one concrete object but has no authority to assert that an external event occurred. |
| `M21-006` | `BLOCKED` | ENG | `M21-001..005`, `M21-010..011` | Simulation fixture proves: coupled resource/process pressure + NPC request + prior commitment -> open action -> cost/partial outcome -> later memory/contact effect, with all facts, conservation, commands, and sources replayable. |

---

## M2.2: Shadow Affect

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

## M2.3: Active Affect

Exit gate: active mode shows longitudinal causal benefit without becoming an
action selector, contact-frequency driver, or dramatic-language amplifier.

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M23-001` | `BLOCKED` | ENG | `M22-006`, `M20-014` | Affect implements optional `WorkingSelfContributor`; cognition imports only the port and runs identically when contribution is null. |
| `M23-002` | `BLOCKED` | ENG | `M23-001`, `M20-013` | Affect may rerank relevant memories within bounded influence while mandatory counter-evidence and commitments remain present. |
| `M23-003` | `BLOCKED` | ENG | `M23-001` | Implement config/admin events for `off/shadow/active`; mode, version, and effective time are audited and replayable. |
| `M23-004` | `BLOCKED` | ENG | `M23-001..003`, `OWN-005` | Run equal-budget off/shadow/active longitudinal suite for persistence, counterfactual sensitivity, paraphrase stability, no-dialogue life, and model portability. |
| `M23-005` | `BLOCKED` | ENG | `M23-004` | Run non-manipulation checks: negative affect, user silence, and low reciprocity must not increase proactive contact pressure. |
| `M23-006` | `BLOCKED` | OWNER | `M23-004`, `M23-005` | Approve active, keep shadow only, or remove Affect according to evidence. Decision is recorded without rewriting old results. |

---

## M3: Evaluation, Operations, And Release

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `M30-001` | `BLOCKED` | ENG + OWNER | `OWN-005`, `OWN-008`, `M20-025` | Freeze blind longitudinal and lived-cognition fixtures plus rubrics before tuning the evaluated version. Owner examples remain evaluation data and are not converted into fatigue states or behavior rules. |
| `M30-002` | `BLOCKED` | ENG | `M21-006`, `M30-001` | Run 200-round accelerated simulation; report fact conflicts, commitment closure, event diversity, self-reference, empty/ordinary turns, costs, and failures. No target forces artificial drama. |
| `M30-003` | `BLOCKED` | ENG + OWNER | `M30-002`, text adapter | Run 7-day 1:1 pilot with private logs, explicit stop control, and daily Owner annotations. |
| `M30-004` | `BLOCKED` | ENG | `M30-003` | Run model swap with frozen assets/input budget and report behavior displacement, invalid contracts, continuity, latency, and cost. |
| `M30-005` | `BLOCKED` | ENG | `M30-003` | Produce rollback rehearsal: disable Affect, replay from ledger, recover outbox, and verify no duplicate delivery or lost authoritative state. |
| `M30-006` | `BLOCKED` | OWNER | `M30-003..005` | Sign off release, continue shadow, or return to off baseline. |

---

## Later Work

These items must not add current schema fields or block M1.1/M2.

| ID | Status | Owner | Depends on | Deliverable and acceptance |
|---|---|---|---|---|
| `L40-001` | `LATER` | ENG | M30 release | Feishu text adapter with idempotency, receipts, retries, and capability events. |
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
