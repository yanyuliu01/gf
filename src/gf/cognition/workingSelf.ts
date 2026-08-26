import type {
  WorkingSelfEvidenceV3,
  WorkingSelfV3,
} from "../prompts/policyComposerV3.js";

export type WorkingSelfSourceV1 = WorkingSelfEvidenceV3["source"];

export interface LivedEvidenceV1 {
  source: WorkingSelfSourceV1;
  /** Canonical GF source id. Production Working Self evidence must be traceable. */
  sourceRef: string;
  text: string;
}

export interface MandatoryMessageV1 {
  sourceRef: string;
  text: string;
}

export interface WorkingSelfBuildInputV1 {
  now: string;
  location?: string;
  currentActivity?: string;
  /** Evidence already admitted/retrieved by upstream cognition modules. */
  evidence?: LivedEvidenceV1[];
  /** Current user message when the episode is interaction-driven. */
  mandatoryMessage?: MandatoryMessageV1;
}

/**
 * Minimal production seam for Working Self.
 *
 * This builder does not retrieve memories, score salience, run Affect, decide
 * Cognitive Admission, or fabricate summaries. Upstream modules hand it only
 * evidence that is already legal for this cognitive episode; it validates,
 * de-duplicates, and presents that evidence to Policy.
 */
export class WorkingSelfBuilderV1 {
  build(input: WorkingSelfBuildInputV1): WorkingSelfV3 {
    if (!input.now.trim()) {
      throw new Error("Working Self requires a current timestamp");
    }

    const evidence: LivedEvidenceV1[] = [];
    const seen = new Set<string>();
    for (const item of input.evidence ?? []) {
      this.pushEvidence(evidence, seen, item);
    }

    let userMessage: string | undefined;
    if (input.mandatoryMessage) {
      userMessage = input.mandatoryMessage.text.trim();
      if (!userMessage) {
        throw new Error("mandatory message cannot be empty");
      }
      this.pushEvidence(evidence, seen, {
        source: "message",
        sourceRef: input.mandatoryMessage.sourceRef,
        text: userMessage,
      });
    }

    return {
      now: input.now,
      location: cleanOptional(input.location),
      currentActivity: cleanOptional(input.currentActivity),
      evidence: evidence.map((item) => ({ ...item })),
      userMessage,
    };
  }

  private pushEvidence(
    target: LivedEvidenceV1[],
    seen: Set<string>,
    item: LivedEvidenceV1,
  ): void {
    const sourceRef = item.sourceRef.trim();
    const text = item.text.trim();
    if (!sourceRef) {
      throw new Error(`Working Self ${item.source} evidence requires sourceRef`);
    }
    if (!text) {
      return;
    }
    const key = `${item.source}\u0000${sourceRef}\u0000${text}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    target.push({ source: item.source, sourceRef, text });
  }
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}
