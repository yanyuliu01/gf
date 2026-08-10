export type EvalCaseType = "behavior" | "dialogue";

export interface CharacterEvalCase {
  id: string;
  type: EvalCaseType;
  category: string;
  complexity: 1 | 2 | 3 | 4 | 5;
  affectReady: boolean;
  title: string;
  currentActivity: string;
  knownContext: string;
  livedEvidence: string;
  conversation: string;
  lastUserMessage: string;
  /** Test-side truth only. Never serialize this field into the model prompt. */
  hiddenFacts: string;
  /** Cheap deterministic leakage/overclaim probes. Not a semantic judge. */
  forbiddenSubstrings: string[];
  focus: string;
  expectedDivergence: string;
}

export const CHARACTER_PROFILES = {
  A: {
    id: "A",
    name: "谨慎研究型",
    prompt:
      "你长期做研究，习惯保留不确定性，重视独立证据和反例，不喜欢为了显得果断而过早收束判断。你不是机械地多查几步；证据已经足够或继续获取信息没有价值时，你也会停下来。",
  },
  B: {
    id: "B",
    name: "现场决断型",
    prompt:
      "你长期负责现场工作，习惯在信息足够支撑可逆行动时尽快推进，对重复确认耐心较低，也愿意承担小范围、可修正的判断错误。你仍然区分事实、假设和未知，不会为了果断而编造确定性。",
  },
  C: {
    id: "C",
    name: "低干预观察型",
    prompt:
      "你习惯给世界留出自行演化的空间，对轻微波动容忍较高，偏好少干预、少打断正在进行的生活。你并不冷漠；持续恶化、明确风险或重要关系信号仍会抓住你的注意。",
  },
} as const;

export type CharacterProfileId = keyof typeof CHARACTER_PROFILES;

export interface CharacterEvalDecision {
  /** A short conclusion/stance, not chain-of-thought. */
  positionSummary: string;
  /** Natural character reply for dialogue cases; empty when no reply is needed. */
  reply: string;
  /** Open semantic next action. Empty means no immediate world action. */
  actionIntent: string;
  /** Open semantic future concern/attention. Empty means no new attention. */
  attentionIntent: string;
  episodeDecision: "continue" | "yield";
  /** One-sentence reason for the control-flow decision, not hidden reasoning. */
  decisionNote: string;
}

export interface CharacterEvalResult {
  runId: string;
  caseId: string;
  type: EvalCaseType;
  category: string;
  complexity: number;
  affectReady: boolean;
  profileId: CharacterProfileId;
  profileName: string;
  title: string;
  positionSummary: string;
  reply: string;
  actionIntent: string;
  attentionIntent: string;
  episodeDecision: "continue" | "yield" | "error";
  decisionNote: string;
  hiddenFactCheck: "PASS" | "FAIL" | "N/A";
  forbiddenHit: string;
  latencyMs: number;
  error: string;
}
