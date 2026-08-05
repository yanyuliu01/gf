/**
 * Inference client interface.
 *
 * The interface is deliberately narrow: the model is always asked to produce a
 * proposal, never to write state or deliver messages directly. Clients must pin
 * a concrete model version (never `latest`) for reproducibility.
 */

import type { PromptContext } from "../prompts/assembler.js";

export interface FastReplyOutput {
  bubbles: string[];
}

export interface InferenceClient {
  modelId: string;
  fastReply(context: PromptContext): FastReplyOutput;
  tick(context: PromptContext): Record<string, unknown>;
  sceneSettle(context: PromptContext): Record<string, unknown>;
}
