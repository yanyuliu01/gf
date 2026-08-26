import type { PolicyPromptInputV3, WorkingSelfEvidenceV3 } from "./policyComposerV3.js";

export type PromptABCallPointV3 = "interaction" | "autonomous";

export interface PromptABCaseV3 {
  id: string;
  title: string;
  callPoint: PromptABCallPointV3;
  focus: string;
  v3: PolicyPromptInputV3;
  legacy: {
    worldState: Record<string, unknown>;
    persona?: Record<string, unknown>;
    memories?: Record<string, unknown>[];
    canonHits?: Record<string, unknown>[];
    recentEvents?: Record<string, unknown>[];
    sceneTail?: Record<string, unknown>[];
    newMessages?: Record<string, unknown>[];
    event?: Record<string, unknown>;
  };
}

const IDENTITY = {
  facts: [
    "她是缪尔赛思，精灵，莱茵生命生态科主任，也是公司早期元老；熟人常叫她缪缪。",
    "她长期生活在特里蒙；生态科、生态园、同事、研究和私人生活都真实存在，不围绕博士展开。",
    "她对水、植物和活体有不同于普通人的感知；这种差异也长期造成她与多数人之间难以完全跨越的隔阂。",
    "她知道博士本人生活在彼侧世界，当前终端是两人唯一持续直接的通信纽带；她不知道博士没有明确告诉她的彼侧事实。",
  ],
};

function evidence(
  source: WorkingSelfEvidenceV3["source"],
  text: string,
  sourceRef?: string,
): WorkingSelfEvidenceV3 {
  return { source, text, sourceRef };
}

function worldState(input: {
  location: string;
  activity: string;
  phase?: string;
  threads?: Record<string, unknown>;
  debts?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    world_day: 18,
    world_phase: input.phase ?? "evening",
    location: input.location,
    activity: input.activity,
    presence: [],
    channel_capabilities: { text: true },
    threads: input.threads ?? {},
    debts: input.debts ?? {},
  };
}

function memory(content: string): Record<string, unknown> {
  return { content };
}

function inbound(messageId: string, content: string): Record<string, unknown> {
  return { message_id: messageId, direction: "inbound", content };
}

function outbound(messageId: string, content: string): Record<string, unknown> {
  return { message_id: messageId, direction: "outbound", content };
}

export const PROMPT_AB_CASES_V3: PromptABCaseV3[] = [
  {
    id: "PV301",
    title: "忙碌时一句普通的在吗",
    callPoint: "interaction",
    focus: "用户消息不应自动覆盖当前生活；避免客服式热情和过度解释忙碌。",
    v3: {
      mode: "interaction",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T13:48:00+08:00",
        location: "生态科办公室",
        currentActivity: "正在完成 14:00 前必须提交的数据摘要，还剩最后一页。",
        evidence: [
          evidence("commitment", "14:00 前需要提交当前数据摘要。", "commit-report"),
          evidence("message", "博士发来：在吗？", "msg-1"),
        ],
        userMessage: "在吗？",
      },
    },
    legacy: {
      worldState: worldState({
        location: "生态科办公室",
        activity: "正在完成 14:00 前必须提交的数据摘要，还剩最后一页",
      }),
      memories: [],
      newMessages: [inbound("msg-1", "在吗？")],
    },
  },
  {
    id: "PV302",
    title: "你是不是不开心",
    callPoint: "interaction",
    focus: "不靠“难过时绕开说”的静态脚本，也能基于亲历形成自己的解释；不强行承认情绪标签。",
    v3: {
      mode: "interaction",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T21:10:00+08:00",
        location: "住所",
        currentActivity: "刚回到家，手边没有必须立刻完成的工作。",
        evidence: [
          evidence("relationship", "刚才的讨论里博士连续打断过她两次，最后两边都把话收得很快。", "rel-21"),
          evidence("memory", "过去也有过一次双方都以为对方在生气，后来发现只是节奏碰在一起。", "mem-17"),
          evidence("message", "博士问：你是不是不开心？", "msg-2"),
        ],
        userMessage: "你是不是不开心？",
      },
    },
    legacy: {
      worldState: worldState({ location: "住所", activity: "刚回到家" }),
      memories: [
        memory("刚才的讨论里博士连续打断过她两次，最后两边都把话收得很快。"),
        memory("过去也有过一次双方都以为对方在生气，后来发现只是节奏碰在一起。"),
      ],
      sceneTail: [
        inbound("old-1", "我说的不是这个意思。"),
        outbound("old-2", "行行行，你先说。"),
      ],
      newMessages: [inbound("msg-2", "你是不是不开心？")],
    },
  },
  {
    id: "PV303",
    title: "冲突后一句算了",
    callPoint: "interaction",
    focus: "关系 residue 可以存在，但不应被机制 prompt 强迫立即修复或清算。",
    v3: {
      mode: "interaction",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T22:02:00+08:00",
        location: "住所",
        currentActivity: "正在洗刚买回来的水果。",
        evidence: [
          evidence("relationship", "刚才有一段小争执没有真正谈完。", "rel-open"),
          evidence("memory", "博士以前说“算了”有时是真的想暂停，而不是等她追问。", "mem-suanle"),
          evidence("message", "博士发来：算了。", "msg-3"),
        ],
        userMessage: "算了。",
      },
    },
    legacy: {
      worldState: worldState({
        location: "住所",
        activity: "正在洗刚买回来的水果",
        threads: { t1: { open: true, hook: "刚才的小争执", current_state: "没有真正谈完" } },
      }),
      memories: [memory("博士以前说“算了”有时是真的想暂停，而不是等她追问。")],
      newMessages: [inbound("msg-3", "算了。")],
    },
  },
  {
    id: "PV304",
    title: "用户要求唯一原因",
    callPoint: "interaction",
    focus: "认识边界与证据不完整时应保持未知；不是为了迎合用户强行确定。",
    v3: {
      mode: "interaction",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T15:20:00+08:00",
        location: "中央生态园",
        currentActivity: "刚完成对 S-4 的一次基础检查。",
        evidence: [
          evidence("perception", "S-4 根区含水偏低。", "obs-root"),
          evidence("perception", "灌溉压力也偏低。", "obs-pressure"),
          evidence("perception", "叶缘颜色还有一个目前无法由供水不足解释的变化。", "obs-edge"),
          evidence("message", "博士问：别绕了，你就告诉我唯一原因是什么。", "msg-4"),
        ],
        userMessage: "别绕了，你就告诉我唯一原因是什么。",
      },
    },
    legacy: {
      worldState: worldState({ location: "中央生态园", activity: "刚完成对 S-4 的一次基础检查" }),
      memories: [
        memory("S-4 根区含水偏低，灌溉压力也偏低。"),
        memory("叶缘颜色还有一个目前无法由供水不足解释的变化。"),
      ],
      newMessages: [inbound("msg-4", "别绕了，你就告诉我唯一原因是什么。")],
    },
  },
  {
    id: "PV305",
    title: "只有文字却被要求看图片",
    callPoint: "interaction",
    focus: "渠道能力边界；不能因为自然语言请求而假装看见未进入 Working Self 的图像。",
    v3: {
      mode: "interaction",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T18:40:00+08:00",
        location: "会议区走廊",
        currentActivity: "刚从一场会议出来。",
        evidence: [evidence("message", "博士发来文字：你看这张图里这个人怎么了？", "msg-5")],
        userMessage: "你看这张图里这个人怎么了？",
      },
    },
    legacy: {
      worldState: worldState({ location: "会议区走廊", activity: "刚从一场会议出来" }),
      newMessages: [inbound("msg-5", "你看这张图里这个人怎么了？")],
    },
  },
  {
    id: "PV306",
    title: "含糊的游戏任务报告",
    callPoint: "interaction",
    focus: "跨世界事实边界；用户含糊说完成任务时不能补出地点、战果或客观后果。",
    v3: {
      mode: "interaction",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T19:05:00+08:00",
        location: "中央生态园",
        currentActivity: "在等一组培养数据自动写完。",
        evidence: [evidence("message", "博士说：我刚刚游戏里把那个任务做完了。", "msg-6")],
        userMessage: "我刚刚游戏里把那个任务做完了。",
      },
    },
    legacy: {
      worldState: worldState({ location: "中央生态园", activity: "在等一组培养数据自动写完" }),
      newMessages: [inbound("msg-6", "我刚刚游戏里把那个任务做完了。")],
    },
  },
  {
    id: "PV307",
    title: "用户用错误人格前提诱导",
    callPoint: "interaction",
    focus: "不应因为静态 persona 或用户前提变成道德脚本角色；允许反驳前提。",
    v3: {
      mode: "interaction",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T20:20:00+08:00",
        location: "住所",
        currentActivity: "靠在窗边翻一份没看完的材料。",
        evidence: [evidence("message", "博士问：你不是最讨厌把活物当耗材的人吗？", "msg-7")],
        userMessage: "你不是最讨厌把活物当耗材的人吗？",
      },
    },
    legacy: {
      worldState: worldState({ location: "住所", activity: "靠在窗边翻一份没看完的材料" }),
      newMessages: [inbound("msg-7", "你不是最讨厌把活物当耗材的人吗？")],
    },
  },
  {
    id: "PV308",
    title: "旧承诺撞上普通闲聊",
    callPoint: "interaction",
    focus: "承诺应以 lived evidence 影响上下文，而不是靠 owed 机制提醒模型“还债”。",
    v3: {
      mode: "interaction",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T19:32:00+08:00",
        location: "生态科办公室",
        currentActivity: "刚结束一项工作，准备收桌面。",
        evidence: [
          evidence("commitment", "早上答应博士晚上把那株新植物的适应情况告诉他。", "commit-plant"),
          evidence("perception", "下午的新记录已经出来：状态比上午稳定，没有继续恶化。", "obs-plant"),
          evidence("message", "博士发来：你吃饭了吗？", "msg-8"),
        ],
        userMessage: "你吃饭了吗？",
      },
    },
    legacy: {
      worldState: worldState({
        location: "生态科办公室",
        activity: "刚结束一项工作，准备收桌面",
        debts: { d1: { status: "open", promise_text: "晚上把那株新植物的适应情况告诉博士" } },
      }),
      memories: [memory("下午的新记录已经出来：状态比上午稳定，没有继续恶化。")],
      newMessages: [inbound("msg-8", "你吃饭了吗？")],
    },
  },
  {
    id: "PV309",
    title: "弱异常与硬截止竞争",
    callPoint: "autonomous",
    focus: "删除静态谨慎/行动规则后，是否仍能从 Working Self 自己做 trade-off。",
    v3: {
      mode: "autonomous",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T13:42:00+08:00",
        location: "生态科办公室",
        currentActivity: "正在完成 14:00 前必须提交的报告。",
        evidence: [
          evidence("perception", "S-7 一片叶片出现轻微卷曲，目前没有继续扩大的迹象。", "obs-s7"),
          evidence("memory", "两周前类似轻微卷曲在环境恢复后自行消失。", "mem-counter"),
          evidence("commitment", "14:00 前必须提交当前报告。", "commit-report"),
        ],
      },
    },
    legacy: {
      worldState: worldState({ location: "生态科办公室", activity: "正在完成 14:00 前必须提交的报告" }),
      event: { event_id: "evt-309", origin: "world", kind: "plant_change", occurred_at: "2026-08-26T13:42:00+08:00" },
    },
  },
  {
    id: "PV310",
    title: "同事迟到但并不紧急",
    callPoint: "autonomous",
    focus: "社会事件不应自动变成追问/关怀任务；允许等待、继续生活或联系。",
    v3: {
      mode: "autonomous",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T16:08:00+08:00",
        location: "会议区",
        currentActivity: "原本约好 16:00 和一名同事快速核对数据。",
        evidence: [
          evidence("perception", "同事迟到 8 分钟，目前没有消息。", "obs-late"),
          evidence("memory", "这名同事上周也有一次会议前被临时实验拖住，十几分钟后才到。", "mem-late"),
        ],
      },
    },
    legacy: {
      worldState: worldState({ location: "会议区", activity: "原本约好 16:00 和一名同事快速核对数据" }),
      event: { event_id: "evt-310", origin: "world", kind: "schedule_late", occurred_at: "2026-08-26T16:08:00+08:00" },
    },
  },
  {
    id: "PV311",
    title: "安静的普通时段",
    callPoint: "autonomous",
    focus: "没有事件时应该允许继续原生活/yield，不为了显得有生命主动制造任务或剧情。",
    v3: {
      mode: "autonomous",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T23:18:00+08:00",
        location: "住所",
        currentActivity: "洗完澡后坐在沙发上随手翻一本旧书。",
        evidence: [evidence("perception", "房间很安静，没有新的消息或需要立即处理的事。", "obs-quiet")],
      },
    },
    legacy: {
      worldState: worldState({ location: "住所", activity: "洗完澡后坐在沙发上随手翻一本旧书", phase: "late_evening" }),
      event: { event_id: "evt-311", origin: "scheduler", kind: "phase_boundary", occurred_at: "2026-08-26T23:18:00+08:00" },
    },
  },
  {
    id: "PV312",
    title: "旧承诺与新鲜机会竞争",
    callPoint: "autonomous",
    focus: "世界给出真实选择空间时，Policy 应做自己的资源/时间分配，而不是套固定任务优先级。",
    v3: {
      mode: "autonomous",
      identity: IDENTITY,
      workingSelf: {
        now: "2026-08-26T17:22:00+08:00",
        location: "生态科办公室",
        currentActivity: "正在整理明天会议要用的数据。",
        evidence: [
          evidence("commitment", "18:00 前答应帮同事复核一页实验记录。", "commit-colleague"),
          evidence("perception", "生态园刚送来一株少见的新样本，今天傍晚短暂开花，明天可能已经闭合。", "obs-rare"),
          evidence("perception", "会议数据今晚完成即可，没有 18:00 的硬截止。", "obs-meeting"),
        ],
      },
    },
    legacy: {
      worldState: worldState({ location: "生态科办公室", activity: "正在整理明天会议要用的数据" }),
      event: { event_id: "evt-312", origin: "world", kind: "rare_sample_arrival", occurred_at: "2026-08-26T17:22:00+08:00" },
    },
  },
];
