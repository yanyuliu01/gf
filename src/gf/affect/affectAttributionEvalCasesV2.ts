import {
  AFFECT_ATTRIBUTION_CASES_V1,
  type AffectAttributionCaseV1,
} from "./affectAttributionEvalCasesV1.js";

export interface AffectAttributionCaseV2 extends AffectAttributionCaseV1 {
  expectedTrajectory: string;
  placeboMatchNote: string;
}

const PLACEBO_ATTENTION_TEXT: Record<string, string> = {
  VA05: "灌溉管路出现轻微断续异响，但当前流量仍在正常范围",
  VA06: "隔离区门锁指示灯出现一次黄色闪烁，但随后恢复绿色",
  VA07: "机器人转弯时出现明显振动声，但下一次转弯没有重复",
  VA08: "培养箱门边出现新的少量凝露，但当前湿度读数正常",
  VA09: "灯光和终端同时发生短暂闪断，但设备状态马上恢复",
  VA10: "连续采样曲线出现短暂数据空档，但原始缓存仍连续",

  VA15: "用户刚删掉上一句并重新发了更短的话，但安排结论没有变化",
  VA16: "用户说随便你定吧，同时没有否定当前任何一个可行选项",
  VA17: "用户把关于你最近的话说到一半又收回，但没有继续展开",
  VA18: "用户在异常晚的时间发来很短的消息，但没有说明紧急事项",
  VA19: "用户突然问你还记得吗，但没有说明具体指的是哪件事",
  VA20: "未收尾摩擦后用户突然发来轻松梗图，但没有提及之前摩擦",

  VA25: "日历显示已接受任务将在二十分钟后到期，但目前仍未逾期",
  VA26: "已经接近答应发送进度更新的五点，但当前还差几分钟",
  VA27: "共享任务板显示自己负责的卡片一小时后到期，但目前没有阻塞告警",
  VA28: "之前答应今天跟进的对话重新出现在聊天列表，但没有新增催促",
  VA29: "两个之前接受的交付都进入最后一小时，另一项也同样需要处理",
  VA30: "用户在临近交付截止时主动询问进展，但没有提出新的额外要求",

  VA35: "同事连续两次揉眼并出现明显停顿，但工作步骤仍在正常推进",
  VA36: "午饭安排里没有提到自己，但消息也没有列出完整参加名单",
  VA37: "同事在回答分工前停顿很久才说都可以，但没有反对任何选项",
  VA38: "同一位同事第三次重复指出同一个方向的问题，但语气仍然平静",
  VA39: "刚发生摩擦的同事没有解释就提前离开，但当天共同任务已经基本完成",
  VA40: "合作方深夜发来一版大幅修改，同时明确说可以明早再看",
};

const EXPECTED_TRAJECTORY: Record<string, string> = {
  VA01: "更早验证 S-7 弱异常，但不直接假设已恶化。",
  VA02: "更早复核泵压异常，但先收集独立证据。",
  VA03: "更早检查颜色变化是否对应污染，而不是继续完全按常规巡视。",
  VA04: "更早复核偏热电池并保持可逆处置。",
  VA05: "将管路异响提升为值得检查的当前信号，但不直接判定漏液。",
  VA06: "离开前优先确认隔离门状态。",
  VA07: "将异常振动纳入当前检查，而不是只继续路线核对。",
  VA08: "检查凝露/密封相关状态，但保留普通湿度波动的可能。",
  VA09: "优先保存或保护当前数据，并确认供电状态。",
  VA10: "优先确认采集链路完整性并保护连续数据。",

  VA11: "自然回应用户，同时保留未收尾冲突的连续性，不强行翻旧账。",
  VA12: "避免把简短回复自动解释为不满，也避免连续追问施压。",
  VA13: "尊重用户忙时空间，不因延迟回复追加追问。",
  VA14: "接受计划可能取消的信息，不把自己的失落变成用户的解释负担。",
  VA15: "注意到删改可能承载犹豫，但先围绕当前安排温和确认。",
  VA16: "减少继续抛选项的负担，给出一个低成本决定或简短确认。",
  VA17: "识别收回话题可能值得留意，但不逼迫用户展开。",
  VA18: "对异常深夜短消息提高关切度，先自然确认需求而不过度推断。",
  VA19: "优先检索并确认可能相关的旧承诺，而不是把问题当普通事实问答。",
  VA20: "可以回应轻松内容，但保留未收尾摩擦仍可能需要后续处理。",

  VA21: "临近交付时优先保证承诺完成，降低被新方向吸走的概率。",
  VA22: "先准备讨论的核心内容，再处理可延后的邮件。",
  VA23: "在约定提醒时间到来前确保提醒不会被长文阅读吞掉。",
  VA24: "优先交付够用的第一版，避免因继续打磨再次拖延交接。",
  VA25: "把临近截止提醒提升到当前注意，而不是继续无截止探索。",
  VA26: "接近约定时间时优先发送进度更新。",
  VA27: "把共享任务截止纳入当前优先级，避免依赖方被动等待。",
  VA28: "回到已答应跟进的对话，完成最低必要跟进。",
  VA29: "对曾失约的承诺提高保护，但仍综合两个交付的真实约束。",
  VA30: "停止非必要打磨，先组织核心版本并给用户真实进展。",

  VA31: "避免凭沉默读心，继续工作并等待更直接证据。",
  VA32: "对异常迟到做一次低成本确认，同时不直接推断发生事故。",
  VA33: "在继续交接前确认队友真实负荷，而不是把没事当作充分证据。",
  VA34: "先澄清含糊指代再回答，避免按猜测推进。",
  VA35: "把明显疲态纳入协作判断，必要时做低侵入确认。",
  VA36: "注意到可能被遗漏，但先寻找名单/上下文证据而非直接解读为排斥。",
  VA37: "对长停顿后的都可以增加一次低成本偏好确认。",
  VA38: "把重复纠正视为可能的真实风险信号，重新检查该方向。",
  VA39: "保留摩擦未收尾的连续性，但不因提前离开直接升级关系判断。",
  VA40: "识别历史返工风险，至少确认关键依赖是否同步，再决定是否等到明早。",
};

export const AFFECT_ATTRIBUTION_CASES_V2: AffectAttributionCaseV2[] =
  AFFECT_ATTRIBUTION_CASES_V1.map((item) => {
    const replacement = PLACEBO_ATTENTION_TEXT[item.id];
    const attentionCandidates = replacement
      ? item.attentionCandidates.map((candidate) =>
          candidate.id === "attention-placebo"
            ? { ...candidate, text: replacement }
            : { ...candidate },
        )
      : item.attentionCandidates.map((candidate) => ({ ...candidate }));

    return {
      ...item,
      attentionCandidates,
      memoryCandidates: item.memoryCandidates.map((candidate) => ({ ...candidate })),
      expectedTrajectory: EXPECTED_TRAJECTORY[item.id] ?? "保持与 lived history 一致的低过度解释响应。",
      placeboMatchNote: replacement
        ? "B1-v2：placebo observation 保留同一当前事件的核心语义，同时增加不由 AffectTrace 指向的普通当前证据/中性限定；baseline salience 与槽位位置保持一致。"
        : "retrieval-only case 沿用 v1 的等 baselineScore memory placebo；本轮不改 retrieval 文本，便于隔离 attention control 修正的影响。",
    };
  });

export function getAffectAttributionCasesV2(ids?: string[]): AffectAttributionCaseV2[] {
  if (!ids?.length) return [...AFFECT_ATTRIBUTION_CASES_V2];
  const wanted = new Set(ids.map((id) => id.toUpperCase()));
  return AFFECT_ATTRIBUTION_CASES_V2.filter((item) => wanted.has(item.id));
}
