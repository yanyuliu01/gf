/**
 * Open-action execution ports.
 *
 * Payloads remain generic until the owning JSON Schemas generate their
 * TypeScript types. Neither port owns authoritative state writes.
 */

/**
 * Pure compiler from open semantics to finite execution primitives or an
 * explicit capability-gap result. It never substitutes a canned action.
 *
 * Synchronous: for deterministic compilation without model calls.
 */
export interface ActionCompilerPort<TOpenAction, TContext, TCompilationResult> {
  compile(
    action: Readonly<TOpenAction>,
    context: Readonly<TContext>,
  ): Readonly<TCompilationResult>;
}

/**
 * Async compiler from open semantics to finite execution primitives.
 *
 * Used when compilation requires a model call. Still never substitutes
 * a canned action - unsupported semantics return explicit capability gaps.
 */
export interface AsyncActionCompilerPort<TOpenAction, TContext, TCompilationResult> {
  compile(
    action: Readonly<TOpenAction>,
    context: Readonly<TContext>,
  ): Promise<Readonly<TCompilationResult>>;
}

/**
 * Async outcome-proposal boundary.
 *
 * Deterministic hard checks can remain synchronous internal functions. This
 * outer port is async because complete adjudication may consult I/O-backed NPC
 * state or a source-constrained social outcome provider. It returns a proposal;
 * StateManager remains the only authoritative writer.
 */
export interface WorldAdjudicatorPort<
  TCompilationResult,
  TContext,
  TWorldOutcomeProposal,
> {
  adjudicate(
    compilation: Readonly<TCompilationResult>,
    context: Readonly<TContext>,
  ): Promise<Readonly<TWorldOutcomeProposal>>;
}
