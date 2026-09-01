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

export interface PromptRunStarted {
  runId: string;
  promptName: string;
  promptVersion: string;
  promptManifestHash: string;
  inputHash: string;
  modelId: string;
  startedAt: string;
}

export interface PromptRunFinished {
  runId: string;
  status: "validated" | "rejected" | "failed";
  outputHash?: string | null;
  errorCode?: string | null;
  finishedAt: string;
}

export interface PromptRunAuditSink {
  recordPromptRunStarted(run: PromptRunStarted): void;
  recordPromptRunFinished(run: PromptRunFinished): void;
}

export interface InferenceClient {
  modelId: string;
  fastReply(context: PromptContext): Promise<FastReplyOutput>;
  tick(context: PromptContext): Promise<Record<string, unknown>>;
  sceneSettle(context: PromptContext): Promise<Record<string, unknown>>;
}
