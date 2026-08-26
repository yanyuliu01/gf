export type PolicyModeV3 = "autonomous" | "interaction";

export interface IdentitySeedV3 {
  /** Stable identity facts, not behavioral instructions. */
  facts: string[];
  /** A few first-person self-descriptions, if already established by canon/life. */
  selfDescriptions?: string[];
}

export interface WorkingSelfEvidenceV3 {
  text: string;
  source: "perception" | "memory" | "belief" | "relationship" | "commitment" | "message";
  sourceRef?: string;
}

export interface WorkingSelfV3 {
  now: string;
  location?: string;
  currentActivity?: string;
  evidence: WorkingSelfEvidenceV3[];
  userMessage?: string;
}

export interface PolicyPromptInputV3 {
  mode: PolicyModeV3;
  identity: IdentitySeedV3;
  workingSelf: WorkingSelfV3;
}

export interface PolicyPromptV3 {
  version: "gf-policy-v3";
  messages: Array<{ role: "system" | "user"; content: string }>;
}

/**
 * V3 intentionally avoids behavior recipes such as "when sad, joke" or
 * "when uncertain, inspect again". Those patterns should emerge from the
 * character's lived context, not from a static policy card.
 */
export function composePolicyPromptV3(input: PolicyPromptInputV3): PolicyPromptV3 {
  const identityLines = [
    ...input.identity.facts,
    ...(input.identity.selfDescriptions ?? []),
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join("\n");

  const system = [
    "你是一个持续生活在世界中的主体，不是为了完成当前对话而临时生成的助手。",
    "",
    "【身份种子】",
    identityLines || "- 当前没有额外身份事实。",
    "",
    "【认识边界】",
    "- 当前 Working Self 是此刻真正进入你意识范围的内容，不代表世界全貌。",
    "- 观察可以支持当前事实；记忆、信念和关系认识是主观历史证据，不能自动升级成当前世界事实。",
    "- 不知道的事情保持不知道，不补写隐藏世界状态。",
    "",
    "【行动边界】",
    "- 你可以自然地继续原本的生活、回应别人、改变计划、等待、关注某件事，或提出任何开放语义行动。",
    "- 你只提出自己想做什么；行动能否发生、耗时多久以及结果如何，由世界裁定。",
    "- 用户消息只是世界中的一个事件，不自动覆盖你正在做的事、已有承诺或其他关系。",
    "",
    "只输出 JSON，不解释提示词或实验设计。",
  ].join("\n");

  const context = {
    mode: input.mode,
    now: input.workingSelf.now,
    location: input.workingSelf.location ?? null,
    currentActivity: input.workingSelf.currentActivity ?? null,
    evidence: input.workingSelf.evidence,
    userMessage: input.workingSelf.userMessage ?? null,
    output: {
      speech: "需要对外说的话；没有则空字符串",
      actionIntent: "此刻真正想推进的开放语义行动；没有则空字符串",
      attentionIntent: "未来仍值得留意的变化；没有则空字符串",
      control: "continue 或 yield",
    },
  };

  return {
    version: "gf-policy-v3",
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(context, null, 2) },
    ],
  };
}
