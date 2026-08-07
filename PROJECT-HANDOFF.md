# GF Project Handoff

Status snapshot: **2026-08-07**
Primary implementation language: **TypeScript**
Operational backlog: [`TODO.md`](TODO.md)
Owner input workbook: [`docs/owner/14-owner-input-workbook-v1.md`](docs/owner/14-owner-input-workbook-v1.md)

This is the stable handoff entrypoint for a new model, developer, or product
collaborator. It explains the whole project and its current state, but does not
replace the authority order in `docs/README.md` or machine contracts in
`schemas/` and `migrations/`.

---

## 1. What The Product Is

GF is a single-user, world-centered long-term companion Agent. The first
instance is Muelsyse from Arknights.

The product is not a chatbot that waits in an empty room. She is modeled as a
resident of a persistent world with her own time, activities, obligations,
relationships, memories, mistakes, and changes. The Doctor's messages are a
high-priority external event, not the only source of her life.

The intended feeling is:

- she was doing something before the user arrived;
- world events affect what she later notices and wants to talk about;
- unfinished commitments, conflicts, and feelings survive across sessions;
- she may misunderstand, hesitate, fail, repair, or choose not to act;
- actions produce durable world and social consequences;
- her initiative comes from living in the world, not from a reminder to send a
  proactive message.

The system must not simulate aliveness by maximizing contact frequency,
retention, dependency, payment, or emotional pressure.

## 2. Product Relationship And Cross-World Model

The Doctor's person and body remain in the other world. The current IM channel
is the only persistent, direct, bidirectional connection between the Doctor and
Muelsyse.

The Doctor may affect Terra through sourced game tasks or choices. The Doctor
seen in sourced game/canon scenes is the same person's embodied action mapping,
not a second agent, duplicate personality, autonomous NPC, or physical crossing.

The Doctor's ordinary real-world life can change what Muelsyse believes about
the Doctor, but cannot automatically change Terra. Terra facts require an
explicit Doctor report or a verified bridge event with valid provenance.

The complete semantic authority is
`docs/product/10-crossworld-protocol-v1.md`. Prompts and examples cannot weaken it.

## 3. The Core Product Thesis

Prompt quality and memory are necessary but not sufficient for a human-like
companion. The decisive additional mechanisms are:

1. **An independent world** that generates obligations, encounters, limits,
   opportunities, and consequences without waiting for the user.
2. **Subjective continuity** in which beliefs, unresolved meanings, commitments,
   and emotional residue influence later attention and interpretation.
3. **Open semantic action generation** instead of selecting from a behavior
   tree or finite semantic candidate list.
4. **World adjudication** that separates "what she tries" from "what actually
   happens".
5. **Persistent causal consequences** committed through an auditable,
   replayable state pipeline.
6. **Cognitive scarcity** in which accepted model input, deliberation, and
   expression consume a recoverable character resource without exposing token
   counters or operator billing to the character.

### Pending OWN-001 Direction: Computable World Kernel

The current Owner-review proposal is
`docs/world/16-computable-world-model-draft-v1.md`. It corrects the earlier
interaction-only draft by defining the world as a hybrid discrete-event,
stock-flow, and production-process system. Resources, capacity reservations,
process queues, ecology, physiology, organization work, and bounded external
drivers advance in deterministic TypeScript from versioned parameters and a
seed. LLMs propose open actions and interpret committed outcomes; they do not
calculate production, inventory, duration, failures, or world facts.

Review this direction with the two maintained diagrams: the
[computable world composition](computable-world-architecture-v1.png) shows the
encodable state and process model, while the
[world interaction and write-authority structure](world-interaction-structure-v1.png)
shows event routing, the no-LLM world path, open action adjudication, and the
single `StateManager` fact writer. SVG and Mermaid sources share each diagram's
base name.

This direction is not frozen until the Owner signs `OWN-001`. The retained
`docs/world/15-world-runtime-interaction-rules-draft-v1.md` describes the
open-action adjudication interface, not the world kernel itself. The next Owner
input is a resource/endowment table and 3-5 production recipes, not Prompt or
Affect Utility tuning.

## 4. Frozen Architectural Decisions

The following decisions should be treated as constraints unless the Owner
explicitly records a replacement decision:

- `WorldEvent` is the common envelope for user, system, scheduled, impulse,
  genesis, and admin inputs.
- The event ledger and reducer state own objective facts.
- Memory owns subjective experience and retrieval, never objective authority.
- Commitments have a dedicated lifecycle; communication `debt` is only one
  specialized commitment type.
- Model output is always a proposal.
- `StateManager` is the only authoritative writer and uses revision CAS,
  source closure validation, and atomic transactions.
- Speech is staged and committed before delivery; outbox is the only external
  side-effect path.
- Persona changes require sources, rate limits, and causal events.
- Relationship is evidence and history, not intimacy or loyalty meters.
- Affect Utility does not choose actions.
- The LLM directly proposes an open semantic action.
- `WorldAdjudicator` evaluates hard feasibility, resources, NPC agency, and
  social/environmental outcomes before facts are committed.
- Historical documents, schemas, migrations, and diagrams remain available for
  rollback. New incompatible work receives a new version.

## 5. Target Runtime Flow

```text
World Drivers
  schedule / commitments / NPC / environment / trusted bridge / user
      |
      v
WorldEvent Ledger -> Perception Projector -> subjective Observation
      |                                      |
      |                                      v
      |                         Memory + Beliefs + Open Loops
      |                                      |
      |                    Facts + Commitments + Persona
      |                                      |
      |                                      v
      |                              Working Self
      |                         (+ optional Affect fragment)
      |                                      |
      |                                      v
      |                         Open Generative Policy
      |                                      |
      |                                      v
      |                              Action Proposal
      |                                      |
      +--------------------------> World Adjudicator
                                             |
                                             v
                                      Outcome Proposal
                                             |
                                             v
                                        Validators
                                             |
                                             v
                                        StateManager
                                      /       |       \
                               Ledger     State/Memory  Outbox
```

Initiative must have at least three independent sources:

- due schedules, commitments, and ongoing activities;
- NPC and environment events not created by the protagonist's thoughts;
- memory association that changes attention but does not fabricate facts.

Association alone is not a living world. It can decide what becomes salient,
but cannot be the only producer of events.

The arrow from committed world change to cognition is a first-class,
versioned component, not prompt prose. `ChangeAggregator -> Perception ->
CognitiveGate` records `ignore / accumulate / wake` for every meaningful
candidate. Non-wake decisions go to a derived audit store, never back into the
objective WorldEvent ledger.

On `wake`, the runtime reserves cognitive energy before the model call and
settles actual experienced semantic input, deliberation, and expression tokens
afterward. The hidden account produces an engine-only capacity envelope that
limits optional context, deliberation, tools, and expression. Policy sees lived
evidence, not counters, envelope fields, or authored fatigue tiers; it may
jointly propose an optional free-form self-experience with the open action. The
current contract is in `docs/cognition/18-emergent-cognitive-experience-v2.md`; docs/17 is
retained as the superseded qualitative-projector design.

## 6. Detachable Affect Architecture

The approved hybrid design is documented in
`docs/cognition/13-memory-affect-hybrid-architecture-v1.md`.

```text
Observation + relevant memories + open natural-language concerns
  -> LLM Appraisal Proposal
  -> deterministic/versioned Affect Model
  -> source-linked derived Affect Snapshot
  -> optional Working Self contribution
```

Modes:

| Mode | Derive Affect | Persist audit | Influence Policy |
|---|---:|---:|---:|
| `off` | no | no | no |
| `shadow` | yes | yes | no |
| `active` | yes | yes | yes |

The Affect module has no direct dependency on delivery, outbox, authoritative
reducers, or action execution. Its tables are derived and rebuildable. Turning
it off or deleting derived state must leave the rest of the runtime operational.

For v1, prefer `valence / arousal / dominance + source-linked residues`.
`approach_avoidance` is deferred because it can become a hidden behavioral
steering variable. The Owner supplies concern meanings and examples, not
weights, decay constants, or formulas.

## 7. Stable Contracts Between Modules

M2 implementation should stabilize these versioned contracts before expanding
prompts:

1. `WorldEventV1`: immutable sourced external or world input.
2. `ObservationV1`: what this agent could actually perceive.
3. `MemoryBundleV1`: retrieved subjective evidence plus counter-evidence.
4. `CommitmentV1`: executable obligation lifecycle.
5. `WorkingSelfV1`: read-only call context with an optional Affect fragment.
6. `OpenActionProposalV1`: intent and open plan, not an outcome.
7. `WorldOutcomeProposalV1`: attempted, completed, failed, partial, and side
   effects with sources and state revision.
8. `SurfaceMessageV1`: committed text communication plan and bubbles.
9. `WakeCandidateV1` / `WakeDecisionV1`: meaningful perceptible change and its
   versioned cognitive-admission audit, including non-wake outcomes.
10. `InferenceUsageReceiptV1`: immutable raw provider/local-tokenizer usage and
    attempt status; it does not decide what the character experienced.
11. `ExperiencedUsageBreakdownV1`: versioned prompt-segment classification,
    source closure, and experienced/non-experienced evidence.
12. `CognitiveEnergyReservationV1` / `SettlementV1`: pre-call capacity lease
    and post-call usage settlement through StateManager.
13. `CognitiveCapacityEnvelopeV2`: engine-only limits for semantic input,
    deliberation, tools, and expression; it is forbidden from Policy input.
14. `CognitiveEpisodeEvidenceV2`: source-linked record of accepted reading,
    deliberation, or expression without token counts, load scores, or fatigue
    labels; it can serve as lived evidence.
15. `SelfExperienceProposalV2`: optional source-linked free-form subjective
    interpretation jointly produced by Open Policy, never an objective fact or
    energy-account writer.

Finite execution primitives such as `communicate`, `move`, `observe`,
`interact`, `use_object`, and `wait` are runtime capabilities. They are not a
finite set of semantic behavior choices. An action compiler may decompose an
open plan into primitives after Policy generation.

## 8. TypeScript Technical Direction

The MVP should remain a modular monolith:

| Area | Choice | Reason |
|---|---|---|
| Runtime | Node.js 22+, strict TypeScript, ESM/NodeNext | Matches the current code and keeps one primary language |
| Persistence | SQLite WAL through `node:sqlite` | Appropriate for one user, transactions, replay, and local operation |
| Contracts | JSON Schema 2020-12 + Ajv | Existing machine authority and fail-closed validation |
| TS types | Generated/derived from JSON Schema | Prevents schema/interface drift |
| LLM integration | Thin async provider adapters over official SDKs | Replaceable models without framework-owned state |
| Orchestration | Explicit event pipeline | Makes authority, retries, and replay visible |
| Memory retrieval | Structured filters + SQLite FTS5 first | Source-aware and inspectable; no early vector dependency |
| Embeddings | Optional reranker after FTS baseline | Add only when longitudinal evaluation proves value |
| Affect | Pure deterministic TypeScript model | Versionable, replayable, testable, and removable |
| Wake / cognitive energy | Pure TypeScript gate, recovery, reservation, usage accounting, engine-only capacity limiter | Makes cognition scarce without pre-authoring how scarcity must feel |
| Tests | `node:test` plus property/replay fixtures | Existing toolchain with deterministic invariants |
| Logging | Structured JSON, later OpenTelemetry export | Audit model/input/version/source decisions |

Do not introduce LangChain, CrewAI, a graph-agent framework, Redis, Kafka,
Postgres, or a hosted vector database for the single-user baseline. Those tools
hide or distribute the state ownership this project needs to keep explicit.

Model calls must be asynchronous and occur outside SQLite transactions. The
proposal records `base_state_revision`; `StateManager` rejects it if state
changed while the model was running.

## 9. Suggested TypeScript Module Boundaries

```text
src/gf/
  domain/                versioned domain types generated from schemas
  adapters/              CLI, Feishu, later IM adapters
  gateway/               auth, dedupe, commands, inbound normalization
  orchestration/         event loop and call sequencing only
  perception/            visibility projection into observations
  memory/                subjective records, filters, FTS, counter-evidence
  commitments/           lifecycle, due events, conflicts, fulfillment
  cognition/             Wake gate, energy accounting/limiter, Working Self, open Policy
  affect/                optional appraisal, deterministic model, derived store
  world/drivers/          schedule, obligation, NPC, environment event sources
  world/adjudication/     action compiler, hard rules, social outcome proposal
  inference/             provider-neutral async ports, usage receipts, provider adapters
  validation/            schema, source closure, policy, semantic guards
  state/                 StateManager, reducers, migrations, repositories
  delivery/              surface renderer, outbox, receipts
  observability/         structured logs, replay, probes, ablation reports
```

Dependencies point inward toward domain contracts. `affect/` may contribute a
`WorkingSelfFragment` but `cognition/` must not import a concrete Affect model.
World drivers propose events; they do not directly mutate world state.

## 10. Current Repository State

The older README text described the runtime as not yet implemented. The actual
code snapshot is further along:

### Implemented

- strict TypeScript/NodeNext project skeleton;
- CLI and gateway with command isolation and message debounce;
- SQLite migration runner and initial event/state schema;
- `WorldEvent` ingestion and persisted event queue;
- single-writer `StateManager`, revision CAS, schema/policy validation;
- speech + outbox atomic commit and delivery recovery path;
- scheduled phase events and no-speech M1 tick;
- scene creation/settlement skeleton;
- deterministic stub inference client;
- contract, gateway, state, engine, recovery, and diagram tests.

### Not Implemented Or Not Production-Ready

- real asynchronous LLM provider adapter;
- actual per-call source closure;
- `PerceptionProjector` and agent-specific visibility;
- memory write/retrieval pipeline used by `Engine`;
- general commitment contract and scheduler;
- `WorkingSelf` builder;
- open action proposal and world outcome contracts;
- action compiler and `WorldAdjudicator`;
- independent NPC/environment world drivers;
- Affect appraisal/store/model in any mode;
- unified active/passive communication Policy and renderer;
- Feishu adapter, dry-run tooling, 200-round simulation, and 7-day run.

### Known Baseline Failures At 2026-08-06

- `pnpm test`: 15/19 pass. Four fast-reply tests fail because the assembler
  regex assumes LF while `prompts/10-fast-reply.md` uses CRLF.
- `tests/validate_contracts.py`: passes.
- Markdown, manifest-path, obsolete-term, and six-diagram checks: pass.
- Full project audit stops because canon file bytes differ from the committed
  manifest hash under Windows EOL conversion.
- `closureFromDb()` currently makes all stored events/messages/claims legal
  sources instead of only the actual assembled call closure.
- scheduler world phases use UTC rather than a configured world timezone.

The backlog IDs for these issues are in `TODO.md`.

## 11. Correct Implementation Order

The order below supersedes the older implementation-order wording in docs/13;
it does not silently rewrite historical documents.

### Phase PM: Specification Sync

- mark finite semantic candidate arbitration as historical M1 text;
- align PRD, framework, checklist, and active tick Prompt with open Policy;
- clarify that memory retrieves commitments but does not own their state.

### Phase M1.1: Portable Green Baseline

- fix Prompt EOL parsing, canon byte normalization, actual source closure, and
  world timezone;
- convert inference and orchestration ports to async interfaces;
- make every existing M1 check green before M2 changes behavior.

### Phase M2.0: Final `off` Baseline

- freeze observation, memory bundle, commitment, Working Self, open action, and
  outcome contracts;
- freeze WakeCandidate/Decision, raw usage receipt, experienced usage
  breakdown, cognitive-energy reservation/settlement, engine-only capacity
  envelope, and optional open self-experience contracts;
- implement change aggregation, Perception, versioned Cognitive Gate with
  non-wake audit, cognitive-energy recovery/reservation/settlement, memory
  retrieval, commitment reads, Working Self, open Policy, action compilation,
  and world adjudication;
- prove provider pricing, caching discounts, transport retries, and runtime
  repair do not create character fatigue or leak counters into character input;
- route both user and world events through the same cognitive Policy while
  preserving fast surface rendering where latency matters;
- run with `affect_mode=off` only.

### Phase M2.1: World Autonomy

- add schedule/commitment, NPC, and environment drivers;
- aggregate background time rather than simulating every minute;
- prove the world can create ordinary obligations and consequences without a
  user message or protagonist memory association.

### Phase M2.2: Shadow Affect

- add appraisal/affect schemas and derived tables;
- persist source-linked appraisals and deterministic snapshots;
- prove Policy prompt/input hashes remain equivalent to `off`.

### Phase M2.3: Active Affect

- add the optional Working Self contribution;
- affect retrieval salience without suppressing counter-evidence;
- compare `off / shadow / active` under equal model, context, and token budgets.

### Phase M3: Longitudinal Proof

- run frozen replay fixtures, 200-round simulation, and 7-day 1:1 operation;
- evaluate causal continuity, commitments, ordinary-life autonomy, stability,
  non-manipulation, and cross-model portability;
- delete or disable Affect if active cannot beat off for reasons beyond extra
  tokens.

Multimodal expression, second platforms, complex NPC society, gifts, avatars,
and Doctor world entry remain later work.

## 12. Owner Versus Engineering Responsibility

The Owner should decide semantic truth and desired experience:

- world runtime rules and acceptable kinds of ordinary life;
- character concerns and genuine internal tensions;
- Doctor voice and final A7 dialogue examples;
- event calibration examples and longitudinal acceptance scenarios;
- product ethics, boundaries, and final subjective evaluation.

Engineering should decide implementation mechanics:

- Utility math, decay constants, normalization, and parameter versioning;
- prompts derived from approved assets and schemas;
- database layout, indexes, migrations, generated TS types;
- provider SDK integration, retries, budgets, and observability;
- test harnesses and ablation reports.

The Owner should not need to invent numeric Utility weights or author database
schemas. Use `docs/owner/14-owner-input-workbook-v1.md` for the required inputs.

## 13. How To Start A Work Session

```powershell
pnpm install
pnpm test
& '<python>' tests\validate_contracts.py
& '<python>' scripts\validate_project.py
```

Then:

1. read `AGENTS.md` and this document;
2. select one unblocked `TODO.md` task;
3. read its authority and acceptance criteria;
4. update its status before implementation;
5. implement in TypeScript unless the task is an existing Python audit tool;
6. attach tests and evidence to the task row;
7. commit the task independently.

Do not regenerate canon manifests merely to hide a cross-platform hash defect.
First define and test the intended normalized-byte policy.

## 14. Definition Of A Good Handoff

A handoff is complete only when the next contributor can answer:

- What user-visible or architectural outcome is being pursued?
- Which `TODO` task ID owns it?
- Which document/schema has authority?
- Which state is authoritative and which artifacts are derived?
- What changed, which tests ran, and what failed?
- Can the change be disabled or reverted without data loss?
- Does any remaining decision require the Owner rather than engineering?

Record those answers in the task evidence or commit/PR description. Do not rely
on chat history as the only project record.

## 15. Navigation

- Five-minute overview: `PROJECT-OVERVIEW.md`
- Active project backlog: `TODO.md`
- Document authority: `docs/README.md`
- Product requirements: `docs/product/01-prd-v0.1.md`
- M1 mechanism baseline: `docs/cognition/02-framework-v3.5.md`
- Cross-world authority: `docs/product/10-crossworld-protocol-v1.md`
- M1 repair plan: `docs/history/11-repair-plan-v1.md`
- M2 hybrid architecture: `docs/cognition/13-memory-affect-hybrid-architecture-v1.md`
- Owner input workbook: `docs/owner/14-owner-input-workbook-v1.md`
- Machine schemas: `schemas/README.md`
- Persistence rules: `migrations/README.md`
- Prompt assembly: `prompts/manifest.yaml`
