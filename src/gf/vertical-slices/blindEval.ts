import { createHash, randomBytes } from "node:crypto";
import type {
  CharacterEvalCase,
  CharacterEvalResult,
  CharacterProfileId,
} from "./characterEvalTypes.js";

export const BLIND_LABELS = ["1", "2", "3"] as const;
export type BlindLabel = (typeof BLIND_LABELS)[number];

export function createBlindSeed(): string {
  return randomBytes(16).toString("hex");
}

export function orderProfilesForCase(
  seed: string,
  caseId: string,
  profileIds: readonly CharacterProfileId[],
): CharacterProfileId[] {
  return [...profileIds].sort((left, right) =>
    blindHash(seed, `candidate:${caseId}:${left}`).localeCompare(
      blindHash(seed, `candidate:${caseId}:${right}`),
    ),
  );
}

export function orderCases(
  seed: string,
  cases: readonly CharacterEvalCase[],
): CharacterEvalCase[] {
  return [...cases].sort((left, right) =>
    blindHash(seed, `case:${left.id}`).localeCompare(
      blindHash(seed, `case:${right.id}`),
    ),
  );
}

export function formatBlindCandidate(result: CharacterEvalResult): string {
  if (result.error) {
    return `生成失败：${result.error}`;
  }

  return [
    result.reply ? `回复：${result.reply}` : "",
    result.positionSummary ? `当前理解：${result.positionSummary}` : "",
    result.actionIntent ? `下一步行动：${result.actionIntent}` : "",
    result.attentionIntent ? `后续关注：${result.attentionIntent}` : "",
    `认知结束：${result.episodeDecision}${
      result.decisionNote ? ` — ${result.decisionNote}` : ""
    }`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function blindHash(seed: string, value: string): string {
  return createHash("sha256").update(`${seed}|${value}`).digest("hex");
}
