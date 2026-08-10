# GF Domain Language

This file is the canonical vocabulary for agent-facing design and engineering docs. It standardizes names; it does **not** override product or architecture authority. Architecture constraints remain in `docs/invariants/19-architecture-invariants-v1.md`.

## Core terms

| Term | Use it for | Do not use it to mean |
|---|---|---|
| `WorldEvent` | An immutable, sourced event accepted into the objective event ledger | A belief, memory, gate audit, or model proposal |
| `Perception` | The projection of world facts this subject can legally observe | The full world state |
| `Fact` | What the objective ledger/reducer says happened | What a subject thinks happened |
| `Belief` | A subject's source-linked interpretation of the world | Objective truth |
| `Commitment evidence` | The sourced utterance/action that can support an obligation | A globally authoritative commitment object |
| `Commitment projection` | A derived operational view for adjudication/audit | Something injected into Working Self as truth |
| `Working Self` | The read-only context assembled for one cognitive episode | A persistent truth store or fixed slot template |
| `Cognitive Admission` | The runtime decision to start a costly cognitive episode | Biological waking from sleep |
| `WakeCandidate` / `WakeDecision` | Current machine-contract names for cognitive-admission input/audit | Physical sleep state |
| `CognitiveGate` | Runtime-owned admission gate producing `ignore / accumulate / wake` | A rule set the character can directly edit |
| `AttentionIntent` | A source-linked, scoped, revocable request authored by Open Policy about what future perceptible change should matter | A hard runtime rule or new sensing capability |
| `AttentionSubscription` | Runtime-compiled watcher derived from an `AttentionIntent` | A character belief or action policy |
| `Accumulation` | Background aggregation of weak perceptible changes until they become decision-relevant | A hidden world fact leaking into cognition |
| `Plan` | A subject's open future intention | A deterministic world process |
| `Activity` | What the subject is currently doing in the world, including sleep | A continuous LLM loop |
| `Process` | A world process that can continue without cognition once accepted | A new decision made by the scheduler |
| `Open Policy` | The model call that interprets Working Self and proposes open semantic intent | A finite action selector |
| `Open Action` | Open semantic action/plan proposed by Policy | An outcome or successful world change |
| `World Adjudicator` | The component that evaluates what an attempted action actually causes | A character decision-maker |
| `StateManager` | The only authoritative commit boundary | A generic service name for every reducer/helper |
| `Affect` | A detachable mechanism that can bias retrieval salience and attention | An action scorer or state label injected into Working Self |
| `Affect Utility` | The local impact of an event on a current concern inside appraisal/Affect dynamics | A global action score or action-ranking function |
| `Cognitive Energy` | Experimental engine-side capacity accounting | Attention, wake relevance, API budget, or subjective fatigue |

## Repository identifier namespaces

Several short IDs coexist in this repository. They are **different namespaces**, not one global numbering system.

| Written form | Meaning | Preferred reference in prose |
|---|---|---|
| `PM-001` | Project/specification-management task | `PM-001` |
| `OWN-001` | Owner decision or input task | `OWN-001` |
| `M11-003`, `M20-015` | Engineering task inside a milestone; `M11 = M1.1`, `M20 = M2.0`, `M21 = M2.1`, etc. | first mention: `M2.0 / M20-015`; later: `M20-015` |
| `L40-001` | Later-work backlog item, outside the current committed critical path | `L40-001` |
| `01`–`20` in doc filenames | Stable document IDs; directory names carry the topic and the number does not imply priority or reading order | `docs/cognition/20` or the full path |
| `A1`–`I3` in `invariants/19` | Frozen architecture clauses | **`Invariant C1`**, never bare `C1` when context is ambiguous |
| `A1`–`A9` in character seed docs | Day-0 seed asset classes | **`Seed A7`**, never bare `A7` outside the seed document |
| `S1`–`S9` in `prompts/` | Prompt assembly slots | **`Prompt S7`**, never bare `S7` outside prompt docs |
| `Q*` / `QE*` | Open product or evaluation questions | keep the full question ID |
| names such as `S-4` | In-world object/sample labels | quote or qualify the object name; they are not Prompt slots |

### Milestone task prefixes

| Prefix | Human milestone | Scope |
|---|---|---|
| `M11-*` | M1.1 | Portable green baseline |
| `M20-*` | M2.0 | Final Affect-off cognitive baseline |
| `M21-*` | M2.1 | Independent world life |
| `M22-*` | M2.2 | Shadow Affect |
| `M23-*` | M2.3 | Active Affect |
| `M30-*` | M3 | Evaluation, operations, and release |

Existing IDs are stable and should not be renumbered merely for readability. Improve readability by qualifying the namespace (`Invariant`, `Seed`, `Prompt`) and by writing the human milestone next to an `Mxx-*` ID on first mention.

## Ambiguous words to qualify

- **wake / awake**: use `Cognitive Admission` for cognition. Use `sleeping`, `physically awake`, or `sleep state` for world physiology.
- **attention**: say `AttentionIntent`, `AttentionSubscription`, `retrieval salience`, or `attention capacity`; avoid bare `attention` when the layer matters.
- **state**: qualify it as world state, reducer state, Affect state, subjective record, or runtime state.
- **Utility**: use the qualified term `Affect Utility` for event-to-concern appraisal and `resource cost` for world economics. Do not use bare `Utility` when the layer is unclear, and never use action Utility as a decision score.
- **candidate**: qualify it. `WakeCandidate` is current machine terminology. Semantic action candidates are historical and not part of Open Policy.
- **wake rule**: prefer `runtime hard interrupt` for system-owned conditions and `AttentionIntent` for character-authored future attention.

## Authority pointers

- **Architecture boundary**: `docs/invariants/19-architecture-invariants-v1.md`.
- **Cognitive admission and self-authored attention**: `docs/cognition/20-cognitive-admission-attention-v1.md`.
- **Memory and Affect**: `docs/cognition/13-memory-affect-hybrid-architecture-v1.md`.
- **Cognitive energy / self-experience**: `docs/cognition/18-emergent-cognitive-experience-v2.md`.
- **World processes and adjudication**: `docs/world/16-computable-world-model-draft-v1.md` and `docs/world/15-world-runtime-interaction-rules-draft-v1.md`.
- **Cross-world ontology**: `docs/product/10-crossworld-protocol-v1.md`.

When a term changes meaning, update this file and the authoritative design document in the same change. Do not redefine the term independently in handoff, TODO, prompt, or example files.
