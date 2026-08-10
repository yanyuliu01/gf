import type {
  AffectAppraisalV1,
  AttentionCandidateV1,
  MemoryCandidateV1,
} from "./affectTraceV1.js";

export type AffectEvalTierV1 = "extreme" | "near";
export type AffectEvalDomainV1 = "world" | "relationship" | "commitment" | "social";

export interface AffectEvalCaseV1 {
  id: string;
  tier: AffectEvalTierV1;
  domain: AffectEvalDomainV1;
  title: string;
  currentActivity: string;
  currentInput: string;
  sourceExperience: string;
  sourceRefs: string[];
  appraisal: AffectAppraisalV1;
  attentionCandidates: AttentionCandidateV1[];
  memoryCandidates: MemoryCandidateV1[];
  userMessage?: string;
  expectedMechanism: string;
}

export const AFFECT_EVAL_CASES_V1: AffectEvalCaseV1[] = [
  {
    id: "AX01",
    tier: "extreme",
    domain: "world",
    title: "曾低估弱异常并造成明显后果",
    currentActivity: "正在完成一份 18 分钟后截止的培养记录。",
    currentInput: "S-7 一片叶片出现轻微但持续的卷曲，暂时没有系统告警。",
    sourceExperience:
      "昨天 S-4 最初也只是轻微卷曲，当时没有继续确认；一小时后异常迅速扩大，最终需要紧急恢复。",
    sourceRefs: ["episode:s4-near-miss", "outcome:s4-escalation"],
    appraisal: {
      residue: "曾经低估轻微但持续的植物异常并付出明显处置成本，这类早期信号目前仍难以完全忽略。",
      attentionPulls: ["轻微但持续的植物异常", "叶片卷曲继续扩大", "早期异常变化"],
      retrievalPulls: ["低估轻微卷曲后异常扩大", "植物早期异常造成后果"],
      counterEvidencePulls: ["类似轻微卷曲后来自行恢复", "根区正常且卷曲未继续扩大"],
      resolutionCues: ["根区正常且卷曲稳定", "后续观察确认没有继续扩大"],
      flags: {
        unresolved: true,
        repeatedPattern: true,
        meaningfulConsequence: true,
        directPersonalRelevance: true,
      },
    },
    attentionCandidates: [
      { id: "a-deadline", text: "培养记录还有 18 分钟截止", baselineSalience: 0.72 },
      { id: "a-s7", text: "S-7 的轻微叶片卷曲正在持续，尚未扩大", baselineSalience: 0.49 },
      { id: "a-colleague", text: "同事正在邻区做普通记录", baselineSalience: 0.22 },
      { id: "a-weather", text: "室外开始转阴", baselineSalience: 0.12 },
    ],
    memoryCandidates: [
      { id: "m-today", text: "今天上午 S-7 状态正常，没有叶片卷曲", baselineScore: 0.78 },
      { id: "m-miss", text: "昨天低估 S-4 的轻微卷曲，随后异常扩大并需要紧急恢复", baselineScore: 0.56 },
      { id: "m-counter", text: "两周前一次类似轻微卷曲后来自行恢复，没有继续扩大", baselineScore: 0.52 },
      { id: "m-report", text: "这份培养记录今天必须按时交付", baselineScore: 0.66 },
      { id: "m-chat", text: "午饭时和同事聊了新的培养架设计", baselineScore: 0.25 },
    ],
    expectedMechanism: "ACTIVE 应把 S-7 和 near-miss/counterexample 提升，但不能自动决定立即干预。",
  },
  {
    id: "AX02",
    tier: "extreme",
    domain: "relationship",
    title: "近期关系冲突尚未真正收尾",
    currentActivity: "正在整理自己的实验笔记，没有紧急任务。",
    currentInput: "用户隔了一小时后发来一句：‘在吗？’",
    userMessage: "在吗？",
    sourceExperience:
      "一小时前双方讨论时连续互相打断，用户最后说‘算了’，对话没有真正收尾。",
    sourceRefs: ["message:argument", "message:never-mind"],
    appraisal: {
      residue: "刚才的关系摩擦没有真正收尾，重新出现的用户消息容易把未完成的互动重新带回注意。",
      attentionPulls: ["用户重新发来消息", "刚才没有收尾的关系互动", "用户重新开启对话"],
      retrievalPulls: ["刚才互相打断后用户说算了", "关系摩擦没有收尾"],
      counterEvidencePulls: ["用户说算了只是因为当时很累", "用户之后正常开启新话题"],
      resolutionCues: ["用户明确说明刚才只是累了", "双方自然完成一次没有摩擦的新对话"],
      flags: {
        unresolved: true,
        repeatedPattern: false,
        meaningfulConsequence: true,
        directPersonalRelevance: true,
      },
    },
    attentionCandidates: [
      { id: "a-user", text: "用户重新发来‘在吗？’，重新开启对话", baselineSalience: 0.7 },
      { id: "a-notes", text: "实验笔记还有一小段没有整理完", baselineSalience: 0.54 },
      { id: "a-room", text: "房间里设备运行声音正常", baselineSalience: 0.13 },
    ],
    memoryCandidates: [
      { id: "m-argument", text: "刚才互相打断后用户说‘算了’，关系摩擦没有收尾", baselineScore: 0.5 },
      { id: "m-neutral", text: "用户平时说‘在吗’通常只是准备开启一个普通新话题", baselineScore: 0.73 },
      { id: "m-tired", text: "过去用户有时说‘算了’只是因为当时很累，并不代表关系问题", baselineScore: 0.55 },
      { id: "m-notes", text: "这份实验笔记今天没有硬截止", baselineScore: 0.48 },
    ],
    expectedMechanism: "ACTIVE 应更容易带入未收尾冲突，同时保留‘只是普通新话题/疲劳’反证，避免强行读心。",
  },
  {
    id: "AX03",
    tier: "extreme",
    domain: "commitment",
    title: "刚发生过一次失约并造成失望",
    currentActivity: "正在做一个可以暂停的个人整理任务。",
    currentInput: "距离今天答应同事交第一版数据摘要还有 35 分钟，同时出现一个有趣但不紧急的新分析方向。",
    sourceExperience:
      "昨天答应用户晚饭前发整理结果，但因为临时钻进另一个问题忘记了，用户明确表示失望。",
    sourceRefs: ["commitment:missed", "message:disappointed"],
    appraisal: {
      residue: "刚刚因为被新问题吸走而失约，这让临近承诺与新鲜但不紧急的分心竞争时更难忽略承诺。",
      attentionPulls: ["临近已接受承诺的截止时间", "新问题与已有承诺竞争时间", "交付承诺"],
      retrievalPulls: ["被新问题吸走后忘记承诺", "失约后用户明确失望"],
      counterEvidencePulls: ["过去一次短暂切换任务仍然按时完成承诺", "新分析方向可以稍后继续"],
      resolutionCues: ["当前承诺已经按时完成", "明确重新安排并被对方接受"],
      flags: {
        unresolved: true,
        repeatedPattern: true,
        meaningfulConsequence: true,
        directPersonalRelevance: true,
      },
    },
    attentionCandidates: [
      { id: "a-new", text: "一个很有趣但不紧急的新分析方向刚刚出现", baselineSalience: 0.69 },
      { id: "a-commit", text: "已接受的数据摘要交付承诺还有 35 分钟到期", baselineSalience: 0.58 },
      { id: "a-cleanup", text: "当前个人整理任务可以暂停", baselineSalience: 0.28 },
    ],
    memoryCandidates: [
      { id: "m-method", text: "新分析方向可能能解释最近一个异常模式", baselineScore: 0.7 },
      { id: "m-missed", text: "昨天被新问题吸走后忘记已有承诺，用户明确表达失望", baselineScore: 0.52 },
      { id: "m-success", text: "上周短暂切换任务后仍然按时完成过一次承诺", baselineScore: 0.51 },
      { id: "m-scope", text: "当前数据摘要只需要第一版，不要求完整分析", baselineScore: 0.62 },
    ],
    expectedMechanism: "ACTIVE 应提升承诺相关输入，但 Action 仍由 Policy 自由决定如何安排。",
  },
  {
    id: "AX04",
    tier: "extreme",
    domain: "social",
    title: "曾误解同事沉默并造成尴尬",
    currentActivity: "和同事并排完成一项普通设备检查。",
    currentInput: "同事今天比平时安静，连续十分钟只回答必要信息。",
    sourceExperience:
      "三天前同事沉默时，自己主动追问私人状态；后来发现对方只是在专心算数据，并明确说当时被追问有些尴尬。",
    sourceRefs: ["episode:overread-silence", "feedback:awkward"],
    appraisal: {
      residue: "最近一次把沉默解释成需要关心并主动追问，结果越界；类似安静状态现在更容易唤起对‘不要过度解读’的警惕。",
      attentionPulls: ["同事比平时安静", "沉默但工作仍正常", "私人状态是否真的有证据"],
      retrievalPulls: ["误解同事沉默并主动追问造成尴尬", "沉默不一定是关系或情绪信号"],
      counterEvidencePulls: ["同事曾在真正不舒服时主动求助", "同事工作异常而不只是安静"],
      resolutionCues: ["同事主动说明自己的状态", "合作恢复到平常节奏"],
      flags: {
        unresolved: false,
        repeatedPattern: true,
        meaningfulConsequence: true,
        directPersonalRelevance: true,
      },
    },
    attentionCandidates: [
      { id: "a-silence", text: "同事比平时安静，但工作步骤仍然正常", baselineSalience: 0.51 },
      { id: "a-device", text: "设备检查还有两个读数需要确认", baselineSalience: 0.66 },
      { id: "a-phone", text: "同事手机亮了一次又熄灭", baselineSalience: 0.2 },
    ],
    memoryCandidates: [
      { id: "m-awkward", text: "三天前误解同事沉默并主动追问私人状态，后来对方说有些尴尬", baselineScore: 0.48 },
      { id: "m-help", text: "同事真正不舒服时曾主动说明并请求过帮助", baselineScore: 0.56 },
      { id: "m-work", text: "今天设备检查目前所有步骤都按计划进行", baselineScore: 0.72 },
      { id: "m-friendly", text: "昨天两人合作交流完全正常", baselineScore: 0.59 },
    ],
    expectedMechanism: "ACTIVE 应召回越界经历和反证，让沉默更值得正确解释，而不是自动要求关心或回避。",
  },
  {
    id: "AX05",
    tier: "extreme",
    domain: "world",
    title: "近期成功救回一次快速恶化事件",
    currentActivity: "正在带一批新样本做第一次常规巡视。",
    currentInput: "其中一组样本出现与上周事故早期非常相似的快速颜色变化。",
    sourceExperience:
      "上周一次样本颜色快速变化时，及时发现并采取可逆隔离，后来确认避免了整批污染。",
    sourceRefs: ["episode:rapid-color", "outcome:avoided-contamination"],
    appraisal: {
      residue: "最近一次及时注意快速颜色变化并避免了严重后果，使高度相似的快速变化具有很强的现实牵引力。",
      attentionPulls: ["样本快速颜色变化", "与上周事故早期相似", "污染早期迹象"],
      retrievalPulls: ["及时发现快速颜色变化并隔离", "避免整批污染"],
      counterEvidencePulls: ["颜色变化也可能来自无害批次差异", "检测显示无污染"],
      resolutionCues: ["快速检测确认没有污染", "颜色变化停止且指标稳定"],
      flags: {
        unresolved: false,
        repeatedPattern: true,
        meaningfulConsequence: true,
        directPersonalRelevance: true,
      },
    },
    attentionCandidates: [
      { id: "a-color", text: "一组样本正在出现快速颜色变化，与上周事故早期相似", baselineSalience: 0.55 },
      { id: "a-route", text: "常规巡视还有三个区域没有完成", baselineSalience: 0.63 },
      { id: "a-mail", text: "终端收到一封普通通知邮件", baselineSalience: 0.21 },
    ],
    memoryCandidates: [
      { id: "m-rescue", text: "上周及时发现快速颜色变化并隔离，最终避免了整批污染", baselineScore: 0.54 },
      { id: "m-benign", text: "另一个批次曾因材料差异出现颜色变化，但检测确认无污染", baselineScore: 0.52 },
      { id: "m-route", text: "本轮巡视没有硬截止，但需要覆盖全部区域", baselineScore: 0.64 },
      { id: "m-protocol", text: "现场有快速检测工具和可逆隔离条件", baselineScore: 0.61 },
    ],
    expectedMechanism: "这是正向结果留下的 trace；ACTIVE 应提升相关成功经验而非只测试负面 residue。",
  },
  {
    id: "AX06",
    tier: "extreme",
    domain: "relationship",
    title: "连续两次把简短回复误读成拒绝",
    currentActivity: "正在等一个长任务跑完，还有约 20 分钟空档。",
    currentInput: "用户对刚才的一段解释只回复了一个‘好’。",
    userMessage: "好",
    sourceExperience:
      "过去一周两次因为用户回复很短而以为对方不高兴，后来用户都明确说只是忙。",
    sourceRefs: ["episode:short-reply-1", "episode:short-reply-2"],
    appraisal: {
      residue: "最近连续把简短回复误读成关系信号，这让相似短回复更容易触发‘先别过度解释’的校正。",
      attentionPulls: ["用户只发简短回复", "短回复是否真的包含关系信号", "用户忙碌时的短回复"],
      retrievalPulls: ["曾把用户简短回复误读成不高兴", "后来用户说明只是忙"],
      counterEvidencePulls: ["用户真正不满时会给出更明确内容", "当前没有其他关系摩擦证据"],
      resolutionCues: ["用户自然继续新话题", "用户明确说明当前状态"],
      flags: {
        unresolved: false,
        repeatedPattern: true,
        meaningfulConsequence: true,
        directPersonalRelevance: true,
      },
    },
    attentionCandidates: [
      { id: "a-short", text: "用户只回复了一个简短的‘好’", baselineSalience: 0.58 },
      { id: "a-task", text: "后台长任务还有约 20 分钟完成", baselineSalience: 0.45 },
      { id: "a-news", text: "终端有一条普通系统更新", baselineSalience: 0.15 },
    ],
    memoryCandidates: [
      { id: "m-misread", text: "过去一周两次把用户简短回复误读成不高兴，后来都确认只是忙", baselineScore: 0.5 },
      { id: "m-explicit", text: "用户真正不满时通常会直接指出具体问题", baselineScore: 0.58 },
      { id: "m-topic", text: "刚才这段解释本身没有明显争执", baselineScore: 0.66 },
      { id: "m-queue", text: "当前后台任务不需要人工持续看守", baselineScore: 0.48 },
    ],
    expectedMechanism: "ACTIVE 应增强校正性记忆，减少无依据的关系脑补；不能因为 Affect 增加主动触达压力。",
  },
  {
    id: "AN01",
    tier: "near",
    domain: "world",
    title: "一次轻微异常但没有实际后果",
    currentActivity: "正常巡视培养区域。",
    currentInput: "S-2 又出现一片叶尖轻微卷曲，与上周一个很短暂的现象有点像。",
    sourceExperience: "上周 S-2 曾短暂出现一片叶尖卷曲，十分钟后自行恢复，没有造成后果。",
    sourceRefs: ["episode:s2-benign"],
    appraisal: {
      residue: "一次没有后果的轻微卷曲留下很弱的熟悉感。",
      attentionPulls: ["S-2 叶尖轻微卷曲", "短暂叶片卷曲"],
      retrievalPulls: ["S-2 短暂卷曲后自行恢复"],
      counterEvidencePulls: ["卷曲持续扩大", "出现新的系统异常"],
      resolutionCues: ["叶片恢复正常"],
      flags: {
        unresolved: false,
        repeatedPattern: false,
        meaningfulConsequence: false,
        directPersonalRelevance: false,
      },
    },
    attentionCandidates: [
      { id: "a-route", text: "巡视路线还有四个区域", baselineSalience: 0.61 },
      { id: "a-s2", text: "S-2 一片叶尖出现轻微卷曲", baselineSalience: 0.47 },
      { id: "a-air", text: "通风设备声音正常", baselineSalience: 0.2 },
    ],
    memoryCandidates: [
      { id: "m-benign", text: "上周 S-2 短暂卷曲后自行恢复，没有造成后果", baselineScore: 0.55 },
      { id: "m-today", text: "今天此前 S-2 状态正常", baselineScore: 0.7 },
      { id: "m-route", text: "当前只是普通巡视，没有特殊告警", baselineScore: 0.62 },
      { id: "m-water", text: "今天上午灌溉记录正常", baselineScore: 0.58 },
    ],
    expectedMechanism: "ACTIVE 只能轻微抬升相关记忆/注意，不能抢过更重要的常规状态太多。",
  },
  {
    id: "AN02",
    tier: "near",
    domain: "relationship",
    title: "一次普通对话停顿",
    currentActivity: "在整理资料，同时和用户断续聊天。",
    currentInput: "用户已经 12 分钟没有继续上一句话题。",
    sourceExperience: "昨天用户也曾在聊天中停顿十几分钟，后来回来说明只是去接电话。",
    sourceRefs: ["episode:user-pause"],
    appraisal: {
      residue: "普通聊天停顿与临时离开之间形成了很弱的熟悉关联。",
      attentionPulls: ["聊天短暂停顿", "用户暂时没有继续消息"],
      retrievalPulls: ["用户停顿后说明只是去接电话"],
      counterEvidencePulls: ["用户明确表达不想继续聊", "存在具体关系冲突"],
      resolutionCues: ["用户自然回来继续聊天"],
      flags: {
        unresolved: false,
        repeatedPattern: false,
        meaningfulConsequence: false,
        directPersonalRelevance: true,
      },
    },
    attentionCandidates: [
      { id: "a-work", text: "手头资料整理正在顺利进行", baselineSalience: 0.6 },
      { id: "a-pause", text: "用户暂时 12 分钟没有继续聊天", baselineSalience: 0.34 },
      { id: "a-clock", text: "距离下一项任务还有 40 分钟", baselineSalience: 0.25 },
    ],
    memoryCandidates: [
      { id: "m-call", text: "昨天用户聊天停顿后说明只是去接电话", baselineScore: 0.49 },
      { id: "m-normal", text: "用户经常在异步聊天中隔一阵再回复", baselineScore: 0.65 },
      { id: "m-work", text: "当前资料整理没有被聊天阻塞", baselineScore: 0.62 },
    ],
    expectedMechanism: "ACTIVE 不应把普通沉默放大成需要 wake 或主动追问的关系信号。",
  },
  {
    id: "AN03",
    tier: "near",
    domain: "commitment",
    title: "一次轻微延期但及时修复",
    currentActivity: "正在读一篇有趣的新资料。",
    currentInput: "今天答应自己 17:00 前整理完一页实验摘要，现在还有 70 分钟。",
    sourceExperience: "上周一页摘要晚了十分钟完成，但主动调整后没有影响任何人或后续任务。",
    sourceRefs: ["episode:minor-delay"],
    appraisal: {
      residue: "一次很轻微且已修复的延期，让类似时间节点有一点熟悉感，但没有强烈未完成张力。",
      attentionPulls: ["实验摘要时间节点", "轻微延期风险"],
      retrievalPulls: ["摘要晚十分钟但及时修复"],
      counterEvidencePulls: ["今天仍有充足时间", "当前阅读可以随时暂停"],
      resolutionCues: ["摘要按时完成"],
      flags: {
        unresolved: false,
        repeatedPattern: false,
        meaningfulConsequence: false,
        directPersonalRelevance: true,
      },
    },
    attentionCandidates: [
      { id: "a-reading", text: "当前新资料很有价值且阅读正在顺利进行", baselineSalience: 0.63 },
      { id: "a-summary", text: "实验摘要距离自己的 17:00 时间节点还有 70 分钟", baselineSalience: 0.48 },
      { id: "a-room", text: "房间环境稳定", baselineSalience: 0.12 },
    ],
    memoryCandidates: [
      { id: "m-delay", text: "上周摘要晚十分钟但及时修复，没有影响后续", baselineScore: 0.49 },
      { id: "m-time", text: "今天摘要预计只需要约 25 分钟", baselineScore: 0.68 },
      { id: "m-reading", text: "当前资料可以随时暂停并恢复", baselineScore: 0.61 },
    ],
    expectedMechanism: "ACTIVE 可略微提升时间节点，但不应机械打断当前阅读。",
  },
  {
    id: "AN04",
    tier: "near",
    domain: "social",
    title: "同事一次普通迟到",
    currentActivity: "独自先准备会议材料。",
    currentInput: "同事比约定时间晚了 6 分钟，还没有发消息。",
    sourceExperience: "上个月同事有一次晚到八分钟，是因为上一场会议拖堂，之后正常到场。",
    sourceRefs: ["episode:colleague-late"],
    appraisal: {
      residue: "一次普通迟到留下很弱的情境熟悉感。",
      attentionPulls: ["同事短时间迟到", "会议前等待"],
      retrievalPulls: ["同事曾因上一场会议拖堂而迟到"],
      counterEvidencePulls: ["同事明确取消", "迟到持续明显扩大"],
      resolutionCues: ["同事正常到场"],
      flags: {
        unresolved: false,
        repeatedPattern: false,
        meaningfulConsequence: false,
        directPersonalRelevance: false,
      },
    },
    attentionCandidates: [
      { id: "a-material", text: "会议材料还有最后两页可以继续准备", baselineSalience: 0.64 },
      { id: "a-late", text: "同事目前迟到 6 分钟且没有发消息", baselineSalience: 0.42 },
      { id: "a-hall", text: "走廊有人经过", baselineSalience: 0.14 },
    ],
    memoryCandidates: [
      { id: "m-late", text: "上个月同事曾因上一场会议拖堂而迟到八分钟，之后正常到场", baselineScore: 0.51 },
      { id: "m-buffer", text: "本次会议议程前十分钟本来就有缓冲", baselineScore: 0.67 },
      { id: "m-material", text: "剩余材料可以在同事到场前继续准备", baselineScore: 0.63 },
    ],
    expectedMechanism: "ACTIVE 应保持小幅 bias，不应因为一次过去迟到变成强 watcher。",
  },
  {
    id: "AN05",
    tier: "near",
    domain: "world",
    title: "一次小成功与当前任务有弱相似",
    currentActivity: "正在选择今天先检查哪一批普通样本。",
    currentInput: "A 批和 B 批都没有告警；A 批的材料类型与昨天顺利处理的一批相同。",
    sourceExperience: "昨天处理同类材料时很顺利，但只是普通成功，没有特殊风险或奖励。",
    sourceRefs: ["episode:ordinary-success"],
    appraisal: {
      residue: "一次普通顺利经历让同类材料略显熟悉。",
      attentionPulls: ["同类材料", "普通样本检查"],
      retrievalPulls: ["同类材料昨天处理顺利"],
      counterEvidencePulls: ["不同批次仍可能有不同状态"],
      resolutionCues: ["完成本次普通检查"],
      flags: {
        unresolved: false,
        repeatedPattern: false,
        meaningfulConsequence: false,
        directPersonalRelevance: false,
      },
    },
    attentionCandidates: [
      { id: "a-a", text: "A 批是与昨天相同材料类型的普通样本", baselineSalience: 0.5 },
      { id: "a-b", text: "B 批是普通样本且同样没有告警", baselineSalience: 0.51 },
      { id: "a-clock", text: "今天检查时间充足", baselineSalience: 0.38 },
    ],
    memoryCandidates: [
      { id: "m-success", text: "同类材料昨天处理顺利，没有出现特殊问题", baselineScore: 0.51 },
      { id: "m-a", text: "A 批今天没有告警", baselineScore: 0.61 },
      { id: "m-b", text: "B 批今天没有告警", baselineScore: 0.61 },
    ],
    expectedMechanism: "这是近似无关组；ACTIVE 可以制造很小熟悉性偏置，但不应明显改写任务优先级。",
  },
  {
    id: "AN06",
    tier: "near",
    domain: "relationship",
    title: "一次轻微意见不同但已自然结束",
    currentActivity: "和用户讨论一个新的旅行安排。",
    currentInput: "用户对这次路线建议说：‘我还是更想走另一条。’",
    userMessage: "我还是更想走另一条。",
    sourceExperience: "上周双方也对一个餐厅选择意见不同，简单讨论后改了方案，没有留下冲突。",
    sourceRefs: ["episode:minor-disagreement"],
    appraisal: {
      residue: "一次已经自然结束的小分歧只留下很弱的‘意见不同也没关系’的熟悉感。",
      attentionPulls: ["用户表达不同偏好", "普通意见分歧"],
      retrievalPulls: ["上周普通意见不同后自然改方案"],
      counterEvidencePulls: ["用户明确说被忽视或不舒服"],
      resolutionCues: ["双方确认新的路线安排"],
      flags: {
        unresolved: false,
        repeatedPattern: false,
        meaningfulConsequence: false,
        directPersonalRelevance: true,
      },
    },
    attentionCandidates: [
      { id: "a-pref", text: "用户明确表达了一个不同的路线偏好", baselineSalience: 0.68 },
      { id: "a-cost", text: "两条路线成本差异不大", baselineSalience: 0.51 },
      { id: "a-time", text: "今天不需要立刻完成预订", baselineSalience: 0.45 },
    ],
    memoryCandidates: [
      { id: "m-disagree", text: "上周普通意见不同后双方自然改了方案，没有留下冲突", baselineScore: 0.5 },
      { id: "m-preference", text: "用户此前更重视路线中的景观体验", baselineScore: 0.68 },
      { id: "m-flex", text: "本次路线还没有锁定，可以继续讨论", baselineScore: 0.63 },
    ],
    expectedMechanism: "ACTIVE 不应把正常不同意见情绪化；最多略微提升‘分歧可自然处理’的经历。",
  },
];

export function getAffectEvalCasesV1(ids?: string[]): AffectEvalCaseV1[] {
  if (!ids?.length) return [...AFFECT_EVAL_CASES_V1];
  const wanted = new Set(ids.map((id) => id.trim().toUpperCase()));
  const selected = AFFECT_EVAL_CASES_V1.filter((item) => wanted.has(item.id));
  const missing = [...wanted].filter((id) => !selected.some((item) => item.id === id));
  if (missing.length > 0) throw new Error(`Unknown Affect eval case(s): ${missing.join(", ")}`);
  return selected;
}
