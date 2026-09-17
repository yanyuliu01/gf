import type { WorkingSelfV1 } from "../../generated/agentPipelineTypes.js";
import type { PromptContext } from "../../prompts/assembler.js";
import type { LifeEventRow } from "./runtime.js";

/** Rendering metadata, not another authoritative conversation store. */
export interface LifeConversationItem {
  eventId: string;
  role: "user" | "assistant";
  content: string;
  occurredAt: string;
  current: boolean;
  ledgerOrder?: number;
}

const speechPrefix = "你拟好了一条给博士的消息，已进入发送队列，尚未确认送达：";

/** Only render text already admitted to this Working Self by Perception.
 * Caller supplies processed history or the frozen current batch, never pending arrivals.
 */
export function projectLifeConversation(ws: WorkingSelfV1, rows: readonly LifeEventRow[]): LifeConversationItem[] {
  const sources = new Set(ws.input_closure.source_refs.filter(s => s.source_type === "event").map(s => s.source_id));
  const current = new Set(ws.evidence.filter(e => e.role === "current_input").flatMap(e => e.source_refs.filter(s => s.source_type === "event").map(s => s.source_id)));
  const seen = new Set<string>();
  return rows.flatMap(row => {
    if (!sources.has(row.event_id) || seen.has(row.event_id)) return [];
    seen.add(row.event_id);
    const summary: unknown = JSON.parse(row.payload_json).summary;
    if (typeof summary !== "string") return [];
    const role = row.origin === "user" ? "user" : row.kind === "life.speech.staged" ? "assistant" : null;
    if (!role || (role === "assistant" && !summary.startsWith(speechPrefix))) return [];
    return [{ eventId: row.event_id, role, content: role === "user" ? summary : summary.slice(speechPrefix.length),
      ledgerOrder: row.ledger_order, occurredAt: row.occurred_at, current: current.has(row.event_id) } satisfies LifeConversationItem];
  }).sort((a,b) => Number(a.current)-Number(b.current) || a.occurredAt.localeCompare(b.occurredAt) || (a.ledgerOrder ?? 0)-(b.ledgerOrder ?? 0) || a.eventId.localeCompare(b.eventId));
}

export function appendLifeConversation(messages: PromptContext["messages"], items: readonly LifeConversationItem[], ws: WorkingSelfV1): void {
  for (const item of items.filter(i => !i.current)) messages.push({ role: item.role, content: item.content });
  // Trusted control metadata contains no user-authored text. History alone is never new input.
  messages.push({ role: "system", content: JSON.stringify({
    context_type: "turn_boundary", episode_id: ws.episode_id, now: ws.assembled_at,
    trigger: ws.evidence.some(e => e.role === "current_input") ? "new_user_input" : "world_event",
    history: items.filter(i => !i.current).map(i => ({ event_id: i.eventId, role: i.role, occurred_at: i.occurredAt })),
    current_input_ids: items.filter(i => i.current).map(i => i.eventId),
    note: "边界前是历史；只有边界后的 user 消息是本轮新输入。assistant 是已拟定原话，投递结果另见回执，不表示已读。世界事件不重新提交历史问题。",
  }) });
  for (const item of items.filter(i => i.current)) messages.push({ role: "user", content: item.content });
}
