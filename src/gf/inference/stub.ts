/**
 * Deterministic stub client for M1 dry-run and tests.
 *
 * The stub never claims to be the real character: it produces a neutral ack
 * for replies and empty (no-speech) structured proposals for ticks and
 * settlements. Tests inject their own functions where behavior matters.
 */

import { newId } from "../domain/ids.js";
import type { PromptContext } from "../prompts/assembler.js";
import type { FastReplyOutput, InferenceClient } from "./base.js";

export class StubClient implements InferenceClient {
  readonly modelId = "stub-v0";

  constructor(
    private readonly overrides: Partial<InferenceClient> = {},
  ) {}

  fastReply(context: PromptContext): FastReplyOutput {
    if (this.overrides.fastReply) {
      return this.overrides.fastReply(context);
    }
    return { bubbles: ["嗯，听到了。"] };
  }

  tick(context: PromptContext): Record<string, unknown> {
    if (this.overrides.tick) {
      return this.overrides.tick(context);
    }
    return {
      schema_version: "1.0",
      operation_id: newId("op"),
      trigger_event_id: payloadValue(context, "event_id"),
      base_state_revision: 0,
      happened: "世界照常运转，没有特别的事。",
      channels: {
        act: null,
        monologue: null,
        communication_intent: null,
        speech_seed: null,
        express: null,
      },
      claims: [],
      patch_ops: [],
      salience_self: 0.0,
      valence: 0.0,
      intensity: 0.0,
      involves: [],
    };
  }

  sceneSettle(context: PromptContext): Record<string, unknown> {
    if (this.overrides.sceneSettle) {
      return this.overrides.sceneSettle(context);
    }
    return {
      schema_version: "1.0",
      operation_id: newId("op"),
      scene_id: payloadValue(context, "scene_id"),
      batch_id: newId("batch"),
      base_state_revision: 0,
      processed_message_ids: payloadValue(context, "processed_message_ids") ?? [],
      scene_summary: "一场普通对话，没有需要长期记忆的事。",
      claims: [],
      patch_ops: [],
      debts_add: [],
      valence: 0.0,
      intensity: 0.0,
      involves: [],
    };
  }
}

function payloadData(context: PromptContext): Record<string, unknown> {
  for (const message of [...context.messages].reverse()) {
    if (message.role === "user") {
      const separator = message.content.indexOf("：\n");
      const raw =
        separator >= 0
          ? message.content.slice(separator + 2)
          : message.content;
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
  }
  return {};
}

function payloadValue(context: PromptContext, key: string): unknown {
  const data = payloadData(context);
  if (key === "event_id") {
    const event = data.event as Record<string, unknown> | undefined;
    return event?.event_id ?? "evt_unknown";
  }
  return data[key];
}
