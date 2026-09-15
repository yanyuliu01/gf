import { createHash } from "node:crypto";
import * as lark from "@larksuiteoapi/node-sdk";
import type { StateManager } from "../state/stateManager.js";
export interface FeishuTransport {
  send(recipient: string, text: string, key: string): Promise<string>;
}
export interface FeishuMessage {
  sender?: { sender_type?: string; sender_id?: { open_id?: string } };
  message?: {
    message_id?: string;
    message_type?: string;
    chat_type?: string;
    content?: string;
    create_time?: string;
  };
}
/** Runs only behind the official authenticated WebSocket dispatcher. */
export function acceptFeishuMessage(
  data: FeishuMessage,
  owner: string,
  state: StateManager,
  at = new Date().toISOString(),
): boolean {
  const m = data.message;
  if (
    data.sender?.sender_type !== "user" ||
    data.sender.sender_id?.open_id !== owner ||
    m?.chat_type !== "p2p" ||
    m.message_type !== "text" ||
    !m.message_id
  )
    return false;
  let content: unknown;
  try {
    content = JSON.parse(m.content ?? "");
  } catch {
    return false;
  }
  const text = (content as { text?: unknown })?.text;
  if (typeof text !== "string" || !text.trim() || text.length > 6000)
    return false;
  // Durable accept completes before ACK; inference is never awaited in the event handler.
  return state.acceptLifeInput(m.message_id, text, owner, at);
}
export class FeishuTextTransport implements FeishuTransport {
  constructor(
    private readonly client: lark.Client,
    private readonly owner: string,
  ) {}
  async send(recipient: string, text: string, key: string): Promise<string> {
    if (recipient !== this.owner) throw new Error("recipient_not_authorized");
    const uuid = createHash("sha256").update(key).digest("hex").slice(0, 32);
    const r = await this.client.im.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: recipient,
        msg_type: "text",
        content: JSON.stringify({ text }),
        uuid,
      },
    });
    if (r.code !== 0 || !r.data?.message_id)
      throw new Error("feishu_send_failed");
    return r.data.message_id;
  }
}
export class LifeOutboxWorker {
  private busy = false;
  constructor(
    private readonly state: StateManager,
    private readonly transport: FeishuTransport,
  ) {}
  async dispatch(at = new Date().toISOString()): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const row = this.state.claimLifeDelivery(at);
      if (!row) return false;
      let receipt: string | null = null;
      try {
        receipt = await this.transport.send(row.recipient, row.text, row.key);
      } catch {
        /* No provider payload or credential-bearing errors in logs. */
      }
      this.state.finishLifeDelivery(
        row.outboxId,
        receipt,
        new Date().toISOString(),
      );
      return receipt !== null;
    } finally {
      this.busy = false;
    }
  }
}
export function createFeishuConnection(
  appId: string,
  appSecret: string,
  owner: string,
  state: StateManager,
) {
  // Avoid SDK request/error logs that may contain authorization headers.
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {
      console.warn("[feishu] connection warning");
    },
    error: () => {
      console.error("[feishu] connection error");
    },
    trace: () => {},
  };
  const http = lark.defaultHttpInstance.create({ timeout: 15000 });
  http.interceptors.response.use((response) => response.data);
  const client = new lark.Client({
    appId,
    appSecret,
    domain: lark.Domain.Feishu,
    logger,
    loggerLevel: lark.LoggerLevel.error,
    httpInstance: http as unknown as lark.HttpInstance,
  });
  const ws = new lark.WSClient({
    appId,
    appSecret,
    domain: lark.Domain.Feishu,
    logger,
    loggerLevel: lark.LoggerLevel.error,
  });
  const dispatcher = new lark.EventDispatcher({ logger }).register({
    "im.message.receive_v1": async (data) => {
      acceptFeishuMessage(data, owner, state);
    },
  });
  return {
    transport: new FeishuTextTransport(client, owner),
    start: () => ws.start({ eventDispatcher: dispatcher }),
    close: () => ws.close({ force: true }),
  };
}
