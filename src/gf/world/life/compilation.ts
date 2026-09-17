import type { LifeCommandV1, LifeCompilationV2 } from "../../generated/lifeRuntimeTypes.js";
import type { OpenPolicyResultV1 } from "../../cognition/policy/openGenerativePolicy.js";

/** Ground syscall operands in the first proposed step, never in ambient memory.
 * This verifies provenance and operand binding, not full semantic equivalence. */
export function groundLifeCompilation(draft: LifeCompilationV2, policy: OpenPolicyResultV1): LifeCommandV1 {
  const command = draft.command;
  if (command.primitive === "capability_gap") return { ...command, text: "" };
  const first = policy.action.plan?.[0] ?? policy.action.intent;
  const gap = (detail: string): LifeCommandV1 => ({ primitive: "capability_gap", target: command.target, detail, text: "" });
  if (!draft.action_quote.trim() || !first.includes(draft.action_quote))
    return gap("编译动作没有逐字对应首项意图；未执行替代行为。");
  if (command.primitive !== "communicate" && command.text.trim())
    return gap("非沟通动作带有发送文字；未执行。");
  if (["move", "observe", "use_object"].includes(command.primitive)) {
    const aliases: Record<string, readonly string[]> = {
      garden: ["garden", "生态园"], office: ["office", "办公室"],
      home: ["home", "住所", "家"], "S-4": ["S-4"], pump: ["pump", "循环泵", "水泵", "泵"],
    };
    if (!draft.target_quote.trim() || !draft.action_quote.includes(draft.target_quote)
      || !(aliases[command.target] ?? []).some((name) => draft.target_quote.includes(name)))
      return gap("首项意图未明确支持该物理对象或目的地；未执行近似映射。");
  }
  return command;
}
