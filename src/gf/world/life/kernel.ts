import { createHash } from "node:crypto";
import type {
  LifeStateV1,
  LifeCommandV1,
} from "../../generated/lifeRuntimeTypes.js";

export const LIFE_RULES_VERSION = "s4-life.v1";
export const SAMPLE_MS = 2 * 3600_000;
export interface LifeChange {
  id: string;
  at: string;
  kind: string;
  summary: string;
  salience: number;
  location?: string;
  device?: boolean;
}
export interface LifeTransition {
  state: LifeStateV1;
  changes: LifeChange[];
}
export const lifeId = (prefix: string, value: unknown) =>
  `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;
const iso = (ms: number) => new Date(ms).toISOString();
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const locations: Record<string, string> = {
  garden: "生态园",
  office: "生态科办公室",
  home: "住所",
};
export function seedLife(at: string): LifeStateV1 {
  return {
    version: LIFE_RULES_VERSION,
    at,
    nextSampleAt: iso(Date.parse(at) + SAMPLE_MS),
    location: "garden",
    activity: null,
    water: 20,
    energy: 50,
    waterUsed: 0,
    energyUsed: 0,
    waterSupplied: 20,
    energySupplied: 50,
    moisture: 0.65,
    pumpHealth: 0.9,
    sampleNumber: 0,
    dayNumber: 0,
  };
}
export function change(
  at: string,
  kind: string,
  summary: string,
  salience = 0.5,
  extra: Partial<LifeChange> = {},
): LifeChange {
  return {
    id: lifeId("life-event", { at, kind, summary }),
    at,
    kind,
    summary,
    salience,
    ...extra,
  };
}
/** Fixed absolute boundaries make restart/catch-up and stepwise execution equivalent. */
export function stepLife(
  initial: LifeStateV1,
  until: string,
  maxBoundaries = 1000,
): LifeTransition {
  const state = structuredClone(initial);
  const changes: LifeChange[] = [];
  if (
    !Number.isFinite(Date.parse(until)) ||
    Date.parse(until) < Date.parse(state.at)
  )
    throw new Error("world_clock_not_monotonic");
  for (let i = 0; i < maxBoundaries; i++) {
    const sample = Date.parse(state.nextSampleAt),
      end = state.activity ? Date.parse(state.activity.endsAt) : Infinity;
    const next = Math.min(sample, end);
    if (next > Date.parse(until)) break;
    // Integrate only at deterministic boundaries. No speculative wall-clock state.
    const hours = (next - Date.parse(state.at)) / 3600_000;
    const demand = round(hours * 0.5);
    const supply = Math.min(demand, state.water, state.energy / 0.4);
    state.water = round(state.water - supply);
    state.waterUsed = round(state.waterUsed + supply);
    state.energy = round(state.energy - supply * 0.4);
    state.energyUsed = round(state.energyUsed + supply * 0.4);
    state.moisture = round(
      Math.max(
        0,
        Math.min(
          1,
          state.moisture - hours * 0.02 + supply * state.pumpHealth * 0.03,
        ),
      ),
    );
    state.pumpHealth = round(Math.max(0, state.pumpHealth - hours * 0.001));
    state.at = iso(next);
    if (end === next && state.activity) {
      const a = state.activity;
      let summary = `完成了先前的活动：${a.intent}`;
      if (a.primitive === "move") {
        state.location = a.target as LifeStateV1["location"];
        summary = `已到达${locations[a.target]}。`;
      }
      if (a.primitive === "use_object" && a.target === "pump") {
        state.pumpHealth = 1;
        summary = "循环泵维护工序结束，设备恢复正常运行。";
      }
      if (a.primitive === "use_object" && a.target === "S-4") {
        state.moisture = round(Math.min(1, state.moisture + 0.2));
        summary = "S-4 手动补水工序结束。";
      }
      if (a.primitive === "observe")
        summary = `完成 S-4 现场检查，湿度读数约 ${Math.round(state.moisture * 100)}%，泵运行读数约 ${Math.round(state.pumpHealth * 100)}%。`;
      changes.push(
        change(state.at, "life.activity.completed", summary, 1, {
          location: state.location,
        }),
      );
      state.activity = null;
    }
    if (sample === next) {
      state.sampleNumber++;
      state.nextSampleAt = iso(sample + SAMPLE_MS);
      if (state.sampleNumber % 12 === 0) {
        // Versioned trial endowments: visible deliveries, never silent stock resets.
        state.dayNumber++;
        state.water = round(state.water + 12);
        state.waterSupplied += 12;
        state.energy = round(state.energy + 10);
        state.energySupplied += 10;
        changes.push(
          change(
            state.at,
            "life.supply.arrived",
            "生态园例行补给到账：水 12 升、设备能源 10 单位。",
            0.2,
            { device: true },
          ),
        );
      }
      const urgent =
        state.moisture < 0.35 || state.pumpHealth < 0.6 || state.water < 2;
      changes.push(
        change(
          state.at,
          "life.sensor.sample",
          `生态园 S-4 定时仪器记录：湿度约 ${Math.round(state.moisture * 100)}%，循环泵运行读数约 ${Math.round(state.pumpHealth * 100)}%。`,
          urgent ? 1 : 0.25,
          { device: true },
        ),
      );
    }
  }
  return { state, changes };
}
/** Low-level execution only, invoked after open semantic Policy generation. */
export function adjudicateLife(
  initial: LifeStateV1,
  command: LifeCommandV1,
  intent: string,
  at: string,
): LifeTransition {
  const state = structuredClone(initial);
  const changes: LifeChange[] = [];
  const reject = (reason: string, cls: string) => ({
    state,
    changes: [
      change(
        at,
        "life.action.rejected",
        `尝试「${intent}」未执行：${reason}（${cls}）。`,
        0.2,
        { location: state.location },
      ),
    ],
  });
  if (command.primitive === "capability_gap")
    return reject(command.detail, "capability");
  if (command.primitive === "communicate")
    return command.target === "doctor" && command.text.trim()
      ? { state, changes }
      : reject("收件人或消息内容不符合文字通道约束", "permission");
  if (state.activity)
    return reject("当前主活动尚未结束；新行动没有取消原活动", "time");
  if (command.primitive === "move" && !(command.target in locations))
    return reject("地点不在当前可达范围", "location");
  if (
    ["observe", "use_object"].includes(command.primitive) &&
    state.location !== "garden"
  )
    return reject("需要先到生态园现场", "location");
  if (command.primitive === "observe" && command.target !== "S-4")
    return reject("没有该对象的观察接口", "knowledge");
  if (
    command.primitive === "use_object" &&
    !["pump", "S-4"].includes(command.target)
  )
    return reject("对象操作未开放", "permission");
  const water =
    command.primitive === "use_object" && command.target === "S-4" ? 1 : 0;
  const energy = command.primitive === "use_object" ? 1 : 0;
  if (state.water < water || state.energy < energy)
    return reject("材料或设备能源不足", "resource");
  state.water = round(state.water - water);
  state.waterUsed = round(state.waterUsed + water);
  state.energy = round(state.energy - energy);
  state.energyUsed = round(state.energyUsed + energy);
  const minutes =
    command.primitive === "move"
      ? 10
      : command.primitive === "observe"
        ? 5
        : command.primitive === "use_object"
          ? 30
          : 60;
  state.activity = {
    id: lifeId("activity", { intent, at, command }),
    intent,
    primitive: command.primitive,
    target: command.target,
    startedAt: at,
    endsAt: iso(Date.parse(at) + minutes * 60000),
  };
  changes.push(
    change(
      at,
      "life.activity.started",
      `开始活动：${intent}。预计 ${minutes} 分钟后到达完成节点，目前尚未完成。`,
      0.1,
      { location: state.location },
    ),
  );
  return { state, changes };
}
