/**
 * Cognitive pipeline ports.
 *
 * Domain payloads stay generic until their versioned JSON Schemas are frozen
 * and generated as TypeScript types. These interfaces fix ownership and
 * sync/async boundaries without creating a second hand-written contract.
 */

/** Pure projection over a caller-supplied committed world snapshot. */
export interface PerceptionPort<TInput, TPerception> {
  project(input: Readonly<TInput>): Readonly<TPerception>;
}

/**
 * I/O boundary for subjective memory retrieval.
 *
 * Implementations must preserve the query's source/visibility closure and
 * return supporting and counter-evidence required by the frozen contract.
 */
export interface MemoryRetrieverPort<TQuery, TMemoryBundle> {
  retrieve(query: Readonly<TQuery>): Promise<Readonly<TMemoryBundle>>;
}

/**
 * I/O boundary for a rebuildable commitment projection.
 *
 * This projection is for adjudication and audit. It is not authoritative world
 * state and must not be wired into Working Self or Open Policy as truth.
 */
export interface CommitmentReaderPort<TQuery, TCommitmentProjection> {
  read(query: Readonly<TQuery>): Promise<Readonly<TCommitmentProjection>>;
}

/** Pure assembly over already-loaded, source-constrained cognitive inputs. */
export interface WorkingSelfBuilderPort<TInput, TWorkingSelf> {
  build(input: Readonly<TInput>): Readonly<TWorkingSelf>;
}

/** Async model boundary that proposes one open semantic action. */
export interface OpenPolicyPort<TWorkingSelf, TOpenActionProposal> {
  propose(
    workingSelf: Readonly<TWorkingSelf>,
  ): Promise<Readonly<TOpenActionProposal>>;
}
