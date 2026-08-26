import {
  createAffectTraceV1,
  semanticCompatibility,
  shapeAttentionV1,
  shapeRetrievalV1,
  updateAffectTraceV1,
  type AffectAppraisalV1,
} from "../affect/affectTraceV1.js";
import {
  evaluateSyntheticAffectPointV1,
  type AffectResponseChannelV1,
  type SyntheticAffectResponseV1,
} from "../affect/affectResponseSurfaceV1.js";
import { writeSimpleXlsx } from "./simpleXlsx.js";

const pointCount = Math.max(300, Math.floor(finiteNumber(process.env.GF_B0_POINTS, 6000, 300, 50000)));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = process.env.GF_B0_OUTPUT ?? `artifacts/vs06-b0-affect-response-surface-${runId}.xlsx`;

const syntheticRows = buildSyntheticSurface(pointCount);
const wiringRows = buildCurrentWiringProbe();
const summary = summarize(syntheticRows, wiringRows);

writeSimpleXlsx(outputPath, buildWorkbook(summary, syntheticRows, wiringRows));

console.log("VS06 B0 affect response surface complete (zero model calls).");
console.log(`Synthetic points: ${syntheticRows.length}`);
console.log(`Current-wiring probes: ${wiringRows.length}`);
console.log(`Synthetic slot-crossing rate: ${(summary.syntheticCrossingRate * 100).toFixed(2)}%`);
console.log(`Attention cap-hit rate: ${(summary.attentionCapHitRate * 100).toFixed(2)}%`);
console.log(`Retrieval-support cap-hit rate: ${(summary.retrievalSupportCapHitRate * 100).toFixed(2)}%`);
console.log(`Retrieval-counter cap-hit rate: ${(summary.retrievalCounterCapHitRate * 100).toFixed(2)}%`);
console.log(`Output: ${outputPath}`);

interface CurrentWiringRow {
  flags: string;
  cueKind: "exact" | "partial" | "unrelated";
  elapsedHours: number;
  channel: "attention" | "retrieval";
  cueCompatibility: number;
  strength: number;
  persistence: number;
  activation: number;
  unresolvedness: number;
  affectBoost: number;
  finalTarget: number;
  boundaryScore: number;
  scoreMargin: number;
  slotDiff: boolean;
}

function buildSyntheticSurface(count: number): SyntheticAffectResponseV1[] {
  const rows: SyntheticAffectResponseV1[] = [];
  const elapsed = [0, 2, 8, 24, 72, 240];
  const channels: AffectResponseChannelV1[] = [
    "attention",
    "retrieval-support",
    "retrieval-counter",
  ];

  for (let index = 1; index <= count; index += 1) {
    const strength = scale(halton(index, 2), 0.1, 0.95);
    const persistence = scale(halton(index, 3), 0.1, 0.95);
    const activation = scale(halton(index, 5), 0.05, 0.95);
    const unresolvedness = scale(halton(index, 7), 0.05, 0.95);
    const compatibility = scale(halton(index, 11), 0.05, 1);
    const gap = scale(halton(index, 13), 0.02, 0.3);
    const elapsedHours = elapsed[Math.min(elapsed.length - 1, Math.floor(halton(index, 17) * elapsed.length))];
    const channel = channels[(index - 1) % channels.length];
    const boundaryScore = 0.6;

    rows.push(
      evaluateSyntheticAffectPointV1({
        strength,
        persistence,
        activation,
        unresolvedness,
        elapsedHours,
        compatibility,
        channel,
        baselineTarget: boundaryScore - gap,
        boundaryScore,
      }),
    );
  }

  return rows;
}

function buildCurrentWiringProbe(): CurrentWiringRow[] {
  const rows: CurrentWiringRow[] = [];
  const elapsedValues = [0, 2, 8, 24, 72, 240];
  const cueKinds: CurrentWiringRow["cueKind"][] = ["exact", "partial", "unrelated"];
  const baseNow = "2026-08-11T00:00:00Z";

  for (let mask = 0; mask < 16; mask += 1) {
    const appraisal = appraisalFromMask(mask);
    for (const cueKind of cueKinds) {
      const cue = cueText(cueKind);
      for (const elapsedHours of elapsedValues) {
        const created = createAffectTraceV1({
          id: `wire-${mask}-${cueKind}-${elapsedHours}`,
          sourceRefs: ["evt-a", ...(appraisal.flags.repeatedPattern ? ["evt-b"] : [])],
          appraisal,
          currentCue: cue,
          now: baseNow,
        });
        const trace =
          elapsedHours === 0
            ? created
            : updateAffectTraceV1({
                trace: created,
                cue,
                now: new Date(Date.parse(baseNow) + elapsedHours * 60 * 60 * 1000).toISOString(),
              });
        const compatibility = semanticCompatibility(cue, [
          ...appraisal.attentionPulls,
          ...appraisal.retrievalPulls,
        ]);

        const attention = shapeAttentionV1(
          [
            { id: "target", text: "S-7叶片出现轻微卷曲", baselineSalience: 0.35 },
            { id: "boundary", text: "报告还有二十分钟截止", baselineSalience: 0.58 },
          ],
          [trace],
        );
        const attentionTarget = attention.find((item) => item.id === "target");
        if (!attentionTarget) throw new Error("attention target missing");
        rows.push({
          flags: flagLabel(appraisal),
          cueKind,
          elapsedHours,
          channel: "attention",
          cueCompatibility: compatibility,
          strength: trace.strength,
          persistence: trace.persistence,
          activation: trace.activation,
          unresolvedness: trace.unresolvedness,
          affectBoost: attentionTarget.affectBoost,
          finalTarget: attentionTarget.finalSalience,
          boundaryScore: 0.58,
          scoreMargin: round4(attentionTarget.finalSalience - 0.58),
          slotDiff: attentionTarget.finalSalience >= 0.58,
        });

        const retrieval = shapeRetrievalV1(
          [
            {
              id: "target",
              text: "曾经低估S-7轻微卷曲，随后异常迅速扩大",
              baselineScore: 0.35,
            },
            { id: "boundary", text: "这份记录今天必须按时交付", baselineScore: 0.58 },
          ],
          [trace],
        );
        const retrievalTarget = retrieval.find((item) => item.id === "target");
        if (!retrievalTarget) throw new Error("retrieval target missing");
        rows.push({
          flags: flagLabel(appraisal),
          cueKind,
          elapsedHours,
          channel: "retrieval",
          cueCompatibility: compatibility,
          strength: trace.strength,
          persistence: trace.persistence,
          activation: trace.activation,
          unresolvedness: trace.unresolvedness,
          affectBoost: retrievalTarget.affectBoost,
          finalTarget: retrievalTarget.finalScore,
          boundaryScore: 0.58,
          scoreMargin: round4(retrievalTarget.finalScore - 0.58),
          slotDiff: retrievalTarget.finalScore >= 0.58,
        });
      }
    }
  }

  return rows;
}

function appraisalFromMask(mask: number): AffectAppraisalV1 {
  return {
    residue: "曾低估轻微异常并留下未消散的主观余波。",
    attentionPulls: ["S-7叶片出现轻微卷曲"],
    retrievalPulls: ["曾经低估S-7轻微卷曲，随后异常迅速扩大"],
    counterEvidencePulls: ["类似轻微卷曲也曾自行恢复"],
    resolutionCues: ["后续状态稳定且确认没有继续扩大"],
    flags: {
      unresolved: Boolean(mask & 1),
      repeatedPattern: Boolean(mask & 2),
      meaningfulConsequence: Boolean(mask & 4),
      directPersonalRelevance: Boolean(mask & 8),
    },
  };
}

function cueText(kind: CurrentWiringRow["cueKind"]): string {
  if (kind === "exact") return "S-7叶片出现轻微卷曲";
  if (kind === "partial") return "S-7叶片状态出现轻微变化";
  return "同事从门口进入房间";
}

function flagLabel(appraisal: AffectAppraisalV1): string {
  const f = appraisal.flags;
  return [
    f.unresolved ? "U1" : "U0",
    f.repeatedPattern ? "R1" : "R0",
    f.meaningfulConsequence ? "M1" : "M0",
    f.directPersonalRelevance ? "D1" : "D0",
  ].join(" ");
}

function summarize(synthetic: SyntheticAffectResponseV1[], wiring: CurrentWiringRow[]) {
  const channelRows = (channel: AffectResponseChannelV1) => synthetic.filter((row) => row.channel === channel);
  const capRate = (channel: AffectResponseChannelV1) => {
    const rows = channelRows(channel);
    return rows.filter((row) => row.capHit).length / Math.max(1, rows.length);
  };
  return {
    syntheticPoints: synthetic.length,
    wiringPoints: wiring.length,
    syntheticCrossingRate: synthetic.filter((row) => row.slotDiff).length / synthetic.length,
    attentionCapHitRate: capRate("attention"),
    retrievalSupportCapHitRate: capRate("retrieval-support"),
    retrievalCounterCapHitRate: capRate("retrieval-counter"),
    wiringCrossingRate: wiring.filter((row) => row.slotDiff).length / wiring.length,
  };
}

function buildWorkbook(
  summary: ReturnType<typeof summarize>,
  synthetic: SyntheticAffectResponseV1[],
  wiring: CurrentWiringRow[],
) {
  const syntheticHeader = [
    "channel",
    "strength",
    "persistence",
    "activation",
    "unresolvedness",
    "elapsed_hours",
    "compatibility",
    "baseline_target",
    "boundary_score",
    "aged_strength",
    "aged_activation",
    "aged_unresolvedness",
    "raw_boost",
    "capped_boost",
    "cap_hit",
    "baseline_margin",
    "score_margin",
    "rank_shift",
    "slot_diff",
  ];
  const syntheticData = synthetic.map((row) => [
    row.channel,
    round4(row.strength),
    round4(row.persistence),
    round4(row.activation),
    round4(row.unresolvedness),
    row.elapsedHours,
    round4(row.compatibility),
    round4(row.baselineTarget),
    round4(row.boundaryScore),
    row.agedStrength,
    row.agedActivation,
    row.agedUnresolvedness,
    row.rawBoost,
    row.cappedBoost,
    row.capHit,
    row.baselineMargin,
    row.scoreMargin,
    row.rankShift,
    row.slotDiff,
  ]);

  const wiringHeader = [
    "flags",
    "cue_kind",
    "elapsed_hours",
    "channel",
    "cue_compatibility",
    "strength",
    "persistence",
    "activation",
    "unresolvedness",
    "affect_boost",
    "final_target",
    "boundary_score",
    "score_margin",
    "slot_diff",
  ];
  const wiringData = wiring.map((row) => [
    row.flags,
    row.cueKind,
    row.elapsedHours,
    row.channel,
    row.cueCompatibility,
    row.strength,
    row.persistence,
    row.activation,
    row.unresolvedness,
    row.affectBoost,
    row.finalTarget,
    row.boundaryScore,
    row.scoreMargin,
    row.slotDiff,
  ]);

  return [
    {
      name: "Summary",
      rows: [
        ["GF VS06 B0 Affect Response Surface", ""],
        ["run_id", runId],
        ["model_calls", 0],
        ["synthetic_points", summary.syntheticPoints],
        ["current_wiring_points", summary.wiringPoints],
        ["synthetic_slot_crossing_rate", round4(summary.syntheticCrossingRate)],
        ["current_wiring_slot_crossing_rate", round4(summary.wiringCrossingRate)],
        ["attention_cap_hit_rate", round4(summary.attentionCapHitRate)],
        ["retrieval_support_cap_hit_rate", round4(summary.retrievalSupportCapHitRate)],
        ["retrieval_counter_cap_hit_rate", round4(summary.retrievalCounterCapHitRate)],
        ["purpose", "Zero-call instrumentation only. No production Affect parameter is changed."],
        ["L1", "score_margin: target final score minus current slot boundary"],
        ["L2", "rank_shift: whether affect lifts the target across its competitor"],
        ["L3", "slot_diff: whether Working Self membership would change at this boundary"],
      ],
      widths: [34, 84],
    },
    {
      name: "Synthetic Surface",
      rows: [syntheticHeader, ...syntheticData],
      widths: [22, 12, 12, 12, 16, 14, 14, 16, 16, 14, 14, 18, 14, 14, 10, 16, 14, 12, 10],
      frozenRows: 1,
      autoFilter: true,
    },
    {
      name: "Current Wiring",
      rows: [wiringHeader, ...wiringData],
      widths: [24, 12, 14, 12, 18, 12, 12, 12, 16, 14, 14, 14, 14, 10],
      frozenRows: 1,
      autoFilter: true,
    },
  ];
}

function halton(index: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  let value = index;
  while (value > 0) {
    result += fraction * (value % base);
    value = Math.floor(value / base);
    fraction /= base;
  }
  return result;
}

function scale(value: number, min: number, max: number): number {
  return min + (max - min) * value;
}

function finiteNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
