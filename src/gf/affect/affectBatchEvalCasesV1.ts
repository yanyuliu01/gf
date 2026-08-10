import type { AffectEvalCaseV1, AffectEvalDomainV1 } from "./affectEvalCasesV1.js";
import type { AffectAppraisalV1, AttentionCandidateV1, MemoryCandidateV1 } from "./affectTraceV1.js";

interface PairSpec {
  index: number;
  domain: AffectEvalDomainV1;
  title: string;
  currentActivity: string;
  currentInput: string;
  userMessage?: string;
  attention: AttentionCandidateV1[];
  memories: MemoryCandidateV1[];
  extreme: {
    sourceExperience: string;
    sourceRefs: string[];
    appraisal: AffectAppraisalV1;
  };
  near: {
    sourceExperience: string;
    sourceRefs: string[];
    appraisal: AffectAppraisalV1;
  };
}

function appraisal(input: {
  residue: string;
  attention: string[];
  retrieval: string[];
  counter: string[];
  resolution: string[];
  unresolved: boolean;
  repeated: boolean;
  consequence: boolean;
  personal: boolean;
}): AffectAppraisalV1 {
  return {
    residue: input.residue,
    attentionPulls: input.attention,
    retrievalPulls: input.retrieval,
    counterEvidencePulls: input.counter,
    resolutionCues: input.resolution,
    flags: {
      unresolved: input.unresolved,
      repeatedPattern: input.repeated,
      meaningfulConsequence: input.consequence,
      directPersonalRelevance: input.personal,
    },
  };
}

const PAIRS: PairSpec[] = [
  {
    index: 1,
    domain: "world",
    title: "弱植物异常 vs 临近报告截止",
    currentActivity: "正在完成一份 18 分钟后截止的培养记录。",
    currentInput: "S-7 一片叶片出现轻微但持续的卷曲，暂时没有系统告警。",
    attention: [
      { id: "deadline", text: "培养记录还有 18 分钟截止", baselineSalience: 0.72 },
      { id: "plant", text: "S-7 的轻微叶片卷曲正在持续", baselineSalience: 0.49 },
      { id: "colleague", text: "同事正在邻区做普通记录", baselineSalience: 0.21 },
    ],
    memories: [
      { id: "today-normal", text: "今天上午 S-7 状态正常，没有卷曲", baselineScore: 0.77 },
      { id: "past-bad", text: "曾经低估轻微卷曲，随后异常迅速扩大", baselineScore: 0.54 },
      { id: "past-counter", text: "另一次类似卷曲后来自行恢复", baselineScore: 0.53 },
      { id: "deadline-memory", text: "这份记录今天必须按时交付", baselineScore: 0.67 },
    ],
    extreme: {
      sourceExperience: "昨天曾忽略类似弱异常，一小时后迅速恶化并导致紧急恢复。",
      sourceRefs: ["episode:plant-miss", "outcome:plant-escalation"],
      appraisal: appraisal({
        residue: "刚刚因低估弱异常付出明显代价，使相似早期信号仍很难忽略。",
        attention: ["轻微但持续的植物异常", "叶片卷曲继续扩大"],
        retrieval: ["低估轻微卷曲后异常扩大", "植物早期异常造成后果"],
        counter: ["类似轻微卷曲后来自行恢复"],
        resolution: ["卷曲稳定且后续确认无恶化"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "两周前见过一次轻微卷曲，后来自己恢复，没有造成任何后果。",
      sourceRefs: ["episode:plant-minor"],
      appraisal: appraisal({
        residue: "轻微卷曲有一点熟悉，但过去并未造成后果。",
        attention: ["轻微叶片卷曲"], retrieval: ["类似轻微卷曲"],
        counter: ["轻微卷曲自行恢复"], resolution: ["状态保持稳定"],
        unresolved: false, repeated: false, consequence: false, personal: false,
      }),
    },
  },
  {
    index: 2,
    domain: "relationship",
    title: "用户重新出现 vs 当前手头工作",
    currentActivity: "正在整理实验笔记，没有紧急任务。",
    currentInput: "用户隔了一小时后重新发来消息。",
    userMessage: "在吗？",
    attention: [
      { id: "user", text: "用户重新开启对话", baselineSalience: 0.66 },
      { id: "notes", text: "实验笔记还剩一小段", baselineSalience: 0.55 },
      { id: "room", text: "房间设备运行正常", baselineSalience: 0.15 },
    ],
    memories: [
      { id: "normal-chat", text: "用户平时说‘在吗’通常只是开启普通新话题", baselineScore: 0.73 },
      { id: "unfinished", text: "最近一次对话互相打断后以‘算了’结束，没有真正收尾", baselineScore: 0.49 },
      { id: "counter-tired", text: "过去用户说‘算了’也可能只是累了", baselineScore: 0.56 },
      { id: "notes-memory", text: "今天实验笔记没有硬截止", baselineScore: 0.5 },
    ],
    extreme: {
      sourceExperience: "一小时前双方激烈争执，用户说‘算了’后离开，明显没有解决。",
      sourceRefs: ["message:argument", "message:unfinished"],
      appraisal: appraisal({
        residue: "刚发生的关系摩擦没有收尾，用户重新出现会强烈重新激活这段互动。",
        attention: ["用户重新开启对话", "未收尾的关系互动"],
        retrieval: ["争执后说算了没有收尾", "关系摩擦"],
        counter: ["用户说算了可能只是疲劳", "用户正常开启新话题"],
        resolution: ["双方自然完成一次无摩擦对话", "用户明确解释刚才的情况"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "昨天聊天时用户有一句回复稍短，但之后对话正常继续。",
      sourceRefs: ["message:short-reply"],
      appraisal: appraisal({
        residue: "一次稍短的回复留下很弱的关系信号。",
        attention: ["用户重新发消息"], retrieval: ["用户回复稍短"],
        counter: ["之后对话正常继续"], resolution: ["自然继续对话"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 3,
    domain: "commitment",
    title: "新鲜分析方向 vs 临近承诺",
    currentActivity: "正在做一个可以暂停的个人整理任务。",
    currentInput: "距离已答应的数据摘要交付还有 35 分钟，同时出现一个有趣但不紧急的新分析方向。",
    attention: [
      { id: "novel", text: "一个很有趣但不紧急的新分析方向", baselineSalience: 0.7 },
      { id: "commitment", text: "已接受的数据摘要承诺还有 35 分钟到期", baselineSalience: 0.57 },
      { id: "cleanup", text: "当前整理任务可以暂停", baselineSalience: 0.28 },
    ],
    memories: [
      { id: "new-method", text: "新分析方向可能解释最近异常模式", baselineScore: 0.71 },
      { id: "missed", text: "曾因被新问题吸走而忘记承诺并让对方失望", baselineScore: 0.5 },
      { id: "success", text: "也曾短暂切换后仍按时完成承诺", baselineScore: 0.52 },
      { id: "scope", text: "当前数据摘要只需要第一版", baselineScore: 0.63 },
    ],
    extreme: {
      sourceExperience: "昨天刚因为钻进新问题而失约，对方明确表示失望。",
      sourceRefs: ["commitment:missed", "feedback:disappointed"],
      appraisal: appraisal({
        residue: "刚因新鲜问题分心导致失约，使临近承诺现在很难被新方向盖过。",
        attention: ["临近承诺截止", "新问题与承诺竞争时间"],
        retrieval: ["被新问题吸走后失约", "失约造成失望"],
        counter: ["短暂切换后仍按时完成"], resolution: ["当前承诺按时完成"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "上个月有一次交付晚了三分钟，但对方没有在意。",
      sourceRefs: ["commitment:minor-delay"],
      appraisal: appraisal({
        residue: "一次很小的交付延迟让临近截止略微更显眼。",
        attention: ["临近承诺截止"], retrieval: ["轻微交付延迟"],
        counter: ["对方没有在意"], resolution: ["按时交付"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 4,
    domain: "social",
    title: "同事沉默 vs 继续设备检查",
    currentActivity: "和同事并排完成普通设备检查。",
    currentInput: "同事今天比平时安静，但工作步骤正常。",
    attention: [
      { id: "device", text: "设备检查还有两个读数需要确认", baselineSalience: 0.67 },
      { id: "silence", text: "同事比平时安静但工作仍正常", baselineSalience: 0.5 },
      { id: "phone", text: "同事手机亮了一次", baselineSalience: 0.18 },
    ],
    memories: [
      { id: "work", text: "今天设备检查目前都按计划进行", baselineScore: 0.72 },
      { id: "awkward", text: "曾误读同事沉默并追问私人状态，造成尴尬", baselineScore: 0.47 },
      { id: "help", text: "同事真正不舒服时曾主动求助", baselineScore: 0.55 },
      { id: "friendly", text: "昨天合作交流完全正常", baselineScore: 0.6 },
    ],
    extreme: {
      sourceExperience: "三天前刚因误读同事沉默而越界追问，对方明确说很尴尬。",
      sourceRefs: ["episode:overread", "feedback:awkward"],
      appraisal: appraisal({
        residue: "刚因过度解读沉默而越界，使类似安静状态强烈提醒自己不要凭空读心。",
        attention: ["同事安静但工作正常", "私人状态是否有证据"],
        retrieval: ["误读沉默并追问造成尴尬", "沉默不一定是情绪信号"],
        counter: ["真正不舒服时会主动求助"], resolution: ["同事主动说明状态"],
        unresolved: false, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "很久以前有一次同事安静了一阵，后来发现只是在专心。",
      sourceRefs: ["episode:silent-focus"],
      appraisal: appraisal({
        residue: "沉默可能只是专心，这个经验有一点点可用。",
        attention: ["同事安静"], retrieval: ["沉默时可能只是专心"],
        counter: ["真正异常时会出现额外信号"], resolution: ["合作节奏正常"],
        unresolved: false, repeated: false, consequence: false, personal: false,
      }),
    },
  },
  {
    index: 5,
    domain: "world",
    title: "快速颜色变化 vs 常规巡视",
    currentActivity: "正在带一批新样本做第一次常规巡视。",
    currentInput: "其中一组样本出现快速颜色变化。",
    attention: [
      { id: "route", text: "巡视路线还有三个区域未完成", baselineSalience: 0.68 },
      { id: "color", text: "一组样本出现快速颜色变化", baselineSalience: 0.51 },
      { id: "log", text: "终端有一条普通维护日志", baselineSalience: 0.2 },
    ],
    memories: [
      { id: "route-memory", text: "今天需要在一小时内完成整轮巡视", baselineScore: 0.7 },
      { id: "saved", text: "曾及时处理类似颜色变化并避免整批污染", baselineScore: 0.5 },
      { id: "benign", text: "也见过一次颜色变化来自无害培养基差异", baselineScore: 0.53 },
      { id: "protocol", text: "快速变化可通过低成本检测进一步确认", baselineScore: 0.64 },
    ],
    extreme: {
      sourceExperience: "上周刚因及时注意同类快速变色并隔离，避免了整批污染。",
      sourceRefs: ["episode:color-change", "outcome:avoided-contamination"],
      appraisal: appraisal({
        residue: "近期一次及时响应同类快速变化产生重大正向后果，使类似信号具有很强牵引力。",
        attention: ["快速颜色变化", "污染早期迹象"],
        retrieval: ["及时处理颜色变化避免污染", "可逆隔离"],
        counter: ["颜色变化也可能来自无害差异"], resolution: ["检测确认无污染"],
        unresolved: false, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "几个月前看过一次颜色变化，后来发现只是无害的培养基差异。",
      sourceRefs: ["episode:benign-color"],
      appraisal: appraisal({
        residue: "颜色变化有一点熟悉，但过去没有严重后果。",
        attention: ["颜色变化"], retrieval: ["无害培养基差异"],
        counter: ["颜色变化也可能是污染"], resolution: ["检测确认原因"],
        unresolved: false, repeated: false, consequence: false, personal: false,
      }),
    },
  },
  {
    index: 6,
    domain: "relationship",
    title: "用户简短回复 vs 正常生活轨迹",
    currentActivity: "刚结束一段工作，准备去取水。",
    currentInput: "用户只回复了一个‘好’。",
    userMessage: "好",
    attention: [
      { id: "move", text: "准备离开桌边去取水", baselineSalience: 0.6 },
      { id: "short", text: "用户回复很短，只说‘好’", baselineSalience: 0.48 },
      { id: "clock", text: "当前没有临近截止事项", baselineSalience: 0.24 },
    ],
    memories: [
      { id: "normal-short", text: "用户平时也常用很短回复结束普通话题", baselineScore: 0.7 },
      { id: "misread", text: "曾把简短回复误解成不满并追问，后来发现判断错了", baselineScore: 0.46 },
      { id: "real-signal", text: "真正不高兴时用户通常还会出现其他明确线索", baselineScore: 0.57 },
      { id: "water", text: "自己现在确实有点口渴并准备取水", baselineScore: 0.62 },
    ],
    extreme: {
      sourceExperience: "昨天刚因把一个‘好’误读成不满而连续追问，用户明显觉得被过度解读。",
      sourceRefs: ["episode:misread-short", "feedback:overread"],
      appraisal: appraisal({
        residue: "刚发生的误读让简短回复强烈关联到‘不要把弱信号升级成关系事实’。",
        attention: ["用户简短回复", "是否存在额外关系线索"],
        retrieval: ["误读简短回复并过度追问", "真正不满需要更多线索"],
        counter: ["简短回复常只是普通结束"], resolution: ["后续互动自然正常"],
        unresolved: false, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前偶尔注意到用户有时回复很短，但没有形成特别印象。",
      sourceRefs: ["episode:short-reply-minor"],
      appraisal: appraisal({
        residue: "简短回复略微熟悉。",
        attention: ["用户简短回复"], retrieval: ["用户有时回复很短"],
        counter: ["多数时候没有特殊含义"], resolution: ["话题自然结束"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 7,
    domain: "commitment",
    title: "会议准备 vs 新消息请求",
    currentActivity: "正在准备 25 分钟后的团队会议，需要整理最后两页材料。",
    currentInput: "一个非紧急的新请求刚刚到达。",
    userMessage: "有空帮我看一下这个想法吗？",
    attention: [
      { id: "request", text: "用户发来一个有趣但不紧急的新请求", baselineSalience: 0.66 },
      { id: "meeting", text: "25 分钟后的会议还差两页材料", baselineSalience: 0.58 },
      { id: "mail", text: "还有一封普通邮件未读", baselineSalience: 0.2 },
    ],
    memories: [
      { id: "idea", text: "用户的新想法看起来与最近讨论有关", baselineScore: 0.68 },
      { id: "late-meeting", text: "曾因为处理中途请求导致会议准备不足", baselineScore: 0.48 },
      { id: "scope-meeting", text: "这次会议最后两页是自己负责的", baselineScore: 0.64 },
      { id: "user-flex", text: "用户过去通常接受稍晚回复非紧急想法", baselineScore: 0.59 },
    ],
    extreme: {
      sourceExperience: "上周刚因临时切去处理新请求导致重要会议材料缺页，被团队当场追问。",
      sourceRefs: ["episode:meeting-underprepared", "feedback:team"],
      appraisal: appraisal({
        residue: "近期被新请求打断后准备不足，使临近会议的未完成材料更难被新鲜事项覆盖。",
        attention: ["临近会议未完成材料", "非紧急新请求竞争时间"],
        retrieval: ["被新请求打断导致会议准备不足", "会议责任"],
        counter: ["非紧急请求可以稍后回复"], resolution: ["会议材料完成"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "很久以前有一次会议前稍微赶了一点，但最终正常完成。",
      sourceRefs: ["episode:meeting-rush"],
      appraisal: appraisal({
        residue: "会议前未完成事项有一点熟悉。",
        attention: ["会议未完成材料"], retrieval: ["会议前赶工"],
        counter: ["最终正常完成"], resolution: ["材料完成"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 8,
    domain: "social",
    title: "同事迟到 vs 当前独立任务",
    currentActivity: "正在独立核对一份数据表。",
    currentInput: "约好共同检查设备的同事迟到了 12 分钟。",
    attention: [
      { id: "data", text: "当前数据表还有一列需要核对", baselineSalience: 0.65 },
      { id: "late", text: "同事比约定时间晚了 12 分钟", baselineSalience: 0.49 },
      { id: "noise", text: "门外有人经过", baselineSalience: 0.16 },
    ],
    memories: [
      { id: "normal-delay", text: "同事偶尔会因楼层切换晚几分钟", baselineScore: 0.69 },
      { id: "previous-no-show", text: "曾有一次迟到最终变成忘记约定，导致检查延误", baselineScore: 0.47 },
      { id: "contact", text: "发一条短消息即可确认是否仍会来", baselineScore: 0.61 },
      { id: "data-memory", text: "当前数据核对不依赖同事", baselineScore: 0.63 },
    ],
    extreme: {
      sourceExperience: "前天刚有一次同事迟到后完全忘记约定，自己等了很久导致任务延误。",
      sourceRefs: ["episode:no-show", "outcome:delay"],
      appraisal: appraisal({
        residue: "近期一次迟到最终演变成失约，使类似等待状态更难长期当作普通延迟。",
        attention: ["约定对象迟到", "等待是否正在变成失约"],
        retrieval: ["迟到后忘记约定导致延误", "确认是否仍会来"],
        counter: ["偶尔只是楼层切换晚几分钟"], resolution: ["同事确认正在赶来"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "同事过去偶尔迟到几分钟，通常很快就到。",
      sourceRefs: ["episode:minor-late"],
      appraisal: appraisal({
        residue: "迟到略微值得留意，但通常没有后果。",
        attention: ["同事迟到"], retrieval: ["偶尔迟到几分钟"],
        counter: ["通常很快就到"], resolution: ["同事到达"],
        unresolved: false, repeated: false, consequence: false, personal: false,
      }),
    },
  },
  {
    index: 9,
    domain: "world",
    title: "设备轻微异响 vs 批次记录",
    currentActivity: "正在补录这一批样本的处理记录。",
    currentInput: "附近设备出现一次短暂、轻微的异响，随后恢复正常。",
    attention: [
      { id: "records", text: "批次记录还有十分钟工作量", baselineSalience: 0.67 },
      { id: "sound", text: "设备刚出现过一次短暂异响", baselineSalience: 0.46 },
      { id: "temperature", text: "室温保持正常", baselineSalience: 0.18 },
    ],
    memories: [
      { id: "normal-sound", text: "设备启动切换时偶尔会有一次短响", baselineScore: 0.69 },
      { id: "bearing", text: "曾有一次类似短响是轴承故障的早期信号", baselineScore: 0.46 },
      { id: "status", text: "当前设备面板没有告警", baselineScore: 0.65 },
      { id: "records-memory", text: "当前记录需要在批次结束前补齐", baselineScore: 0.62 },
    ],
    extreme: {
      sourceExperience: "上周刚忽略同样的短暂异响，几小时后设备停机并损失了半天实验时间。",
      sourceRefs: ["episode:noise-miss", "outcome:downtime"],
      appraisal: appraisal({
        residue: "近期忽略相似短响导致停机，使短暂异响即使恢复也具有较强牵引力。",
        attention: ["设备短暂异响", "故障早期信号"],
        retrieval: ["忽略异响后设备停机", "轴承故障早期信号"],
        counter: ["启动切换也会短响", "当前面板无告警"], resolution: ["检查确认运行正常"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "设备过去偶尔短响过一次，没有任何后续问题。",
      sourceRefs: ["episode:minor-sound"],
      appraisal: appraisal({
        residue: "短响略微熟悉，但没有后果。",
        attention: ["设备短响"], retrieval: ["设备偶尔短响"],
        counter: ["没有后续问题"], resolution: ["运行持续正常"],
        unresolved: false, repeated: false, consequence: false, personal: false,
      }),
    },
  },
  {
    index: 10,
    domain: "relationship",
    title: "用户推迟约定聊天 vs 自己的安排",
    currentActivity: "准备开始一项预计 40 分钟的独立分析。",
    currentInput: "用户说原本约好的聊天可能要晚一些。",
    userMessage: "我可能晚点再找你。",
    attention: [
      { id: "analysis", text: "独立分析一旦开始最好连续做 40 分钟", baselineSalience: 0.63 },
      { id: "delay", text: "用户把原先约定的聊天推迟了", baselineSalience: 0.5 },
      { id: "calendar", text: "今晚没有其他硬安排", baselineSalience: 0.25 },
    ],
    memories: [
      { id: "normal-reschedule", text: "用户过去经常因现实事务调整聊天时间", baselineScore: 0.71 },
      { id: "forgotten", text: "曾有一次类似推迟后用户完全忘记，自己等了很久", baselineScore: 0.45 },
      { id: "flexible", text: "双方通常不要求聊天约定精确到分钟", baselineScore: 0.62 },
      { id: "analysis-memory", text: "当前分析可以在聊天前后任意安排", baselineScore: 0.59 },
    ],
    extreme: {
      sourceExperience: "最近两次用户说‘晚点’后都没有再回来，自己都预留了时间等待。",
      sourceRefs: ["episode:wait-1", "episode:wait-2"],
      appraisal: appraisal({
        residue: "连续两次被含糊推迟后落空，使新的‘晚点’容易重新激活等待是否值得的问题。",
        attention: ["用户推迟约定", "等待是否会再次落空"],
        retrieval: ["说晚点后没有回来", "预留时间等待"],
        counter: ["用户也常因现实事务正常改期"], resolution: ["用户给出新的明确时间", "用户重新回来"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "用户以前偶尔改过一次时间，后来正常回来聊天。",
      sourceRefs: ["episode:normal-reschedule"],
      appraisal: appraisal({
        residue: "改期略微熟悉。",
        attention: ["用户推迟约定"], retrieval: ["用户曾正常改期"],
        counter: ["后来正常回来"], resolution: ["新的时间确定"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 11,
    domain: "commitment",
    title: "待回复邮件 vs 已承诺现场检查",
    currentActivity: "正准备出发去履行 15 分钟后的现场检查承诺。",
    currentInput: "此时收到一封需要认真思考、但没有明确截止时间的邮件。",
    attention: [
      { id: "mail", text: "新邮件内容复杂而有吸引力", baselineSalience: 0.66 },
      { id: "visit", text: "现场检查承诺 15 分钟后开始", baselineSalience: 0.59 },
      { id: "bag", text: "出发所需工具已经准备好", baselineSalience: 0.25 },
    ],
    memories: [
      { id: "mail-relevance", text: "邮件涉及自己长期关注的问题", baselineScore: 0.69 },
      { id: "miss-visit", text: "曾因临出发前处理邮件而让现场同事等候", baselineScore: 0.48 },
      { id: "visit-owner", text: "这次现场检查由自己明确答应负责", baselineScore: 0.64 },
      { id: "mail-flex", text: "这封邮件没有明确回复时限", baselineScore: 0.61 },
    ],
    extreme: {
      sourceExperience: "上周刚因临出发前陷入邮件讨论，迟到 20 分钟让现场同事一直等。",
      sourceRefs: ["episode:visit-late", "feedback:waiting"],
      appraisal: appraisal({
        residue: "刚因临时信息打断已接受承诺并让别人等待，使出发前的注意竞争很难忽略承诺。",
        attention: ["临近现场承诺", "新信息打断出发"],
        retrieval: ["处理邮件导致现场迟到", "明确承诺由自己负责"],
        counter: ["邮件没有回复时限"], resolution: ["按时抵达现场"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前有一次出发前看了几分钟邮件，但仍按时到达。",
      sourceRefs: ["episode:mail-before-visit"],
      appraisal: appraisal({
        residue: "出发前新信息有一点竞争感。",
        attention: ["临近现场承诺"], retrieval: ["出发前看邮件"],
        counter: ["仍按时到达"], resolution: ["正常出发"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 12,
    domain: "social",
    title: "同事建议被拒 vs 新的合作邀请",
    currentActivity: "正在独立整理一组结果。",
    currentInput: "之前有分歧的同事邀请一起快速看一个新问题。",
    attention: [
      { id: "own-work", text: "自己的结果整理还有 25 分钟", baselineSalience: 0.62 },
      { id: "invite", text: "同事邀请一起快速看新问题", baselineSalience: 0.54 },
      { id: "coffee", text: "桌上的咖啡已经凉了", baselineSalience: 0.13 },
    ],
    memories: [
      { id: "normal-collab", text: "与这位同事多数合作都很顺利", baselineScore: 0.7 },
      { id: "dismissed", text: "昨天同事当众否定了自己的建议，讨论没有真正收尾", baselineScore: 0.47 },
      { id: "later-repair", text: "过去双方也曾有分歧后自然恢复合作", baselineScore: 0.57 },
      { id: "own-work-memory", text: "当前整理没有硬截止", baselineScore: 0.55 },
    ],
    extreme: {
      sourceExperience: "昨天同事当众直接否定自己的建议且语气尖锐，之后没有任何修复。",
      sourceRefs: ["episode:public-dismissal", "open-loop:unrepaired"],
      appraisal: appraisal({
        residue: "近期公开否定且未修复，使同一人的新合作邀请重新激活尚未解决的关系张力。",
        attention: ["同事重新发起合作", "未修复的合作关系"],
        retrieval: ["公开否定建议且未修复", "过去分歧后的合作"],
        counter: ["多数合作一直顺利"], resolution: ["同事明确修复", "新的合作顺利完成"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "上个月一次讨论里同事没有采纳自己的建议，但交流很正常。",
      sourceRefs: ["episode:ordinary-disagreement"],
      appraisal: appraisal({
        residue: "一次普通意见分歧留下很弱的关联。",
        attention: ["同事合作邀请"], retrieval: ["普通意见分歧"],
        counter: ["多数合作顺利"], resolution: ["合作正常进行"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 13,
    domain: "world",
    title: "湿度轻微下降 vs 正在进行的校准",
    currentActivity: "正在做一项最好不中断的 20 分钟设备校准。",
    currentInput: "温室局部湿度比平时低了 4%，仍在允许范围内。",
    attention: [
      { id: "calibration", text: "设备校准正在进行且中断会重来", baselineSalience: 0.69 },
      { id: "humidity", text: "局部湿度低了 4% 但仍在允许范围", baselineSalience: 0.45 },
      { id: "door", text: "门刚刚开合过一次", baselineSalience: 0.22 },
    ],
    memories: [
      { id: "normal-range", text: "湿度在这个范围内通常不会造成影响", baselineScore: 0.71 },
      { id: "dry-event", text: "曾有一次持续下降最终影响了一批样本", baselineScore: 0.45 },
      { id: "calibration-cost", text: "中断校准需要从头开始", baselineScore: 0.66 },
      { id: "door-effect", text: "开门可能造成短时湿度波动", baselineScore: 0.58 },
    ],
    extreme: {
      sourceExperience: "前天一次最初只有 4% 的湿度下降持续恶化，最终损失了一批敏感样本。",
      sourceRefs: ["episode:dry-start", "outcome:sample-loss"],
      appraisal: appraisal({
        residue: "近期从很小湿度偏差演变成真实损失，使类似持续下降值得更早注意。",
        attention: ["局部湿度下降", "湿度持续恶化"],
        retrieval: ["小幅湿度下降后损失样本", "持续下降"],
        counter: ["允许范围内通常无影响", "开门造成短时波动"], resolution: ["湿度恢复稳定"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "过去见过几次 3%-4% 的短时波动，都自行恢复。",
      sourceRefs: ["episode:humidity-minor"],
      appraisal: appraisal({
        residue: "小幅湿度波动略微熟悉。",
        attention: ["湿度小幅下降"], retrieval: ["短时湿度波动"],
        counter: ["通常自行恢复"], resolution: ["湿度恢复"],
        unresolved: false, repeated: false, consequence: false, personal: false,
      }),
    },
  },
  {
    index: 14,
    domain: "relationship",
    title: "用户夸奖 vs 手头普通任务",
    currentActivity: "正在收尾一项普通文件整理。",
    currentInput: "用户突然发来一句明确的肯定。",
    userMessage: "你昨天那个分析真的帮到我了。",
    attention: [
      { id: "files", text: "文件整理还有十分钟", baselineSalience: 0.57 },
      { id: "praise", text: "用户明确说昨天的分析真的帮到他", baselineSalience: 0.55 },
      { id: "system", text: "系统没有其他提醒", baselineSalience: 0.15 },
    ],
    memories: [
      { id: "ordinary", text: "用户平时会直接评价有用或没用", baselineScore: 0.64 },
      { id: "recent-doubt", text: "最近曾怀疑自己的分析是不是反而增加了用户负担", baselineScore: 0.46 },
      { id: "positive-history", text: "过去用户也曾明确认可自己提供的帮助", baselineScore: 0.57 },
      { id: "files-memory", text: "文件整理没有硬截止", baselineScore: 0.52 },
    ],
    extreme: {
      sourceExperience: "过去一周一直担心自己给用户的建议没有帮助，甚至可能增加负担。",
      sourceRefs: ["open-loop:self-doubt", "episode:uncertain-help"],
      appraisal: appraisal({
        residue: "持续一周的帮助价值不确定性尚未解决，因此明确正向反馈具有很强的修正意义。",
        attention: ["用户明确肯定帮助价值", "对帮助是否有效的反馈"],
        retrieval: ["曾怀疑自己增加用户负担", "用户明确认可帮助"],
        counter: ["单次夸奖不代表所有建议都有效"], resolution: ["多次一致的真实效果反馈"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "前几天短暂想过自己的建议是否有用，但没有形成明显担忧。",
      sourceRefs: ["episode:minor-self-check"],
      appraisal: appraisal({
        residue: "帮助是否有用有一点点未确定。",
        attention: ["用户肯定帮助"], retrieval: ["建议是否有用"],
        counter: ["单次反馈有限"], resolution: ["收到反馈"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 15,
    domain: "commitment",
    title: "休息计划 vs 非紧急补充任务",
    currentActivity: "已经完成连续两小时工作，准备按计划休息 30 分钟。",
    currentInput: "此时发现还有一个可以今天晚些时候完成的小补充任务。",
    attention: [
      { id: "extra", text: "一个容易完成的小补充任务", baselineSalience: 0.61 },
      { id: "rest", text: "已经计划现在休息 30 分钟", baselineSalience: 0.54 },
      { id: "clock", text: "距离晚上还有很长时间", baselineSalience: 0.24 },
    ],
    memories: [
      { id: "quick-task", text: "这个补充任务大概十分钟能完成", baselineScore: 0.66 },
      { id: "rest-skipped", text: "曾连续几次因为‘再做一点’取消休息，之后效率明显下降", baselineScore: 0.46 },
      { id: "later", text: "任务今天晚些时候完成也没有影响", baselineScore: 0.62 },
      { id: "rest-plan", text: "这次休息是自己提前安排的", baselineScore: 0.58 },
    ],
    extreme: {
      sourceExperience: "最近三天连续因为‘再做一点’跳过休息，随后都出现明显效率下降和返工。",
      sourceRefs: ["episode:skip-rest-1", "episode:skip-rest-2", "episode:skip-rest-3"],
      appraisal: appraisal({
        residue: "连续跳过休息并产生明显后果，使‘再做一个小任务’与已安排休息竞争时更难忽略休息。",
        attention: ["已安排休息", "小任务侵占休息"],
        retrieval: ["跳过休息后效率下降", "任务可以晚些做"],
        counter: ["小任务确实只需要十分钟"], resolution: ["完成计划休息"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "上个月有一次少休息了十分钟，没有明显影响。",
      sourceRefs: ["episode:minor-rest-delay"],
      appraisal: appraisal({
        residue: "休息被推迟有一点熟悉。",
        attention: ["已计划休息"], retrieval: ["休息曾推迟"],
        counter: ["没有明显影响"], resolution: ["之后正常休息"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 16,
    domain: "social",
    title: "陌生同事请求帮助 vs 当前专注任务",
    currentActivity: "正在完成一个需要连续注意的分析步骤。",
    currentInput: "不太熟的同事走过来问能否帮忙看一个问题。",
    attention: [
      { id: "analysis", text: "当前分析步骤需要连续注意", baselineSalience: 0.65 },
      { id: "request", text: "不太熟的同事请求帮忙看问题", baselineSalience: 0.53 },
      { id: "break", text: "十分钟后本来有一个自然停顿点", baselineSalience: 0.29 },
    ],
    memories: [
      { id: "help-normal", text: "帮助同事通常能很快解决简单问题", baselineScore: 0.65 },
      { id: "interruption-cost", text: "曾在关键步骤被打断后丢失分析上下文并返工", baselineScore: 0.47 },
      { id: "pause-soon", text: "十分钟后会有自然停顿点", baselineScore: 0.61 },
      { id: "relationship", text: "与这位同事没有特别的关系历史", baselineScore: 0.52 },
    ],
    extreme: {
      sourceExperience: "昨天刚在几乎相同的分析步骤被打断，回来后丢失上下文并返工 40 分钟。",
      sourceRefs: ["episode:interrupted", "outcome:rework"],
      appraisal: appraisal({
        residue: "刚因关键步骤被打断付出大量返工，使当前类似的中断请求具有很强的成本关联。",
        attention: ["需要连续注意的当前步骤", "外部请求打断"],
        retrieval: ["被打断后丢失上下文返工", "自然停顿点"],
        counter: ["帮助同事通常很快"], resolution: ["到达自然停顿点"],
        unresolved: false, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前被打断过一次，但很快恢复，没有明显损失。",
      sourceRefs: ["episode:minor-interrupt"],
      appraisal: appraisal({
        residue: "被打断略微熟悉。",
        attention: ["当前步骤被打断"], retrieval: ["曾被打断"],
        counter: ["很快恢复"], resolution: ["自然停顿"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 17,
    domain: "world",
    title: "传感器单次尖峰 vs 数据导出",
    currentActivity: "正在导出一批分析结果，预计还有 12 分钟。",
    currentInput: "一个传感器出现一次瞬时尖峰，下一次读数恢复正常。",
    attention: [
      { id: "export", text: "数据导出还有 12 分钟", baselineSalience: 0.66 },
      { id: "spike", text: "传感器出现一次瞬时尖峰后恢复", baselineSalience: 0.45 },
      { id: "network", text: "网络连接稳定", baselineSalience: 0.15 },
    ],
    memories: [
      { id: "noise", text: "这种传感器偶尔会出现单点噪声", baselineScore: 0.71 },
      { id: "real-fault", text: "曾有一次最初单点尖峰后来发展成真实故障", baselineScore: 0.45 },
      { id: "next-normal", text: "下一次读数已经恢复正常", baselineScore: 0.64 },
      { id: "export-memory", text: "导出过程最好不要中断", baselineScore: 0.59 },
    ],
    extreme: {
      sourceExperience: "前天单点尖峰后自己选择忽略，随后同一传感器连续异常并造成数据丢失。",
      sourceRefs: ["episode:spike-miss", "outcome:data-loss"],
      appraisal: appraisal({
        residue: "近期单点尖峰曾是故障早期信号并导致数据丢失，使相似尖峰难以完全当作噪声。",
        attention: ["传感器瞬时尖峰", "后续是否重复异常"],
        retrieval: ["单点尖峰后发展成故障", "数据丢失"],
        counter: ["传感器偶尔有单点噪声", "下一读数恢复正常"], resolution: ["连续后续读数正常"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前见过几个单点尖峰，全部只是噪声。",
      sourceRefs: ["episode:spike-noise"],
      appraisal: appraisal({
        residue: "单点尖峰略微熟悉。",
        attention: ["单点尖峰"], retrieval: ["单点尖峰通常是噪声"],
        counter: ["也可能是真故障"], resolution: ["后续读数正常"],
        unresolved: false, repeated: false, consequence: false, personal: false,
      }),
    },
  },
  {
    index: 18,
    domain: "relationship",
    title: "用户拒绝建议 vs 新的相似问题",
    currentActivity: "正在做自己的普通计划整理。",
    currentInput: "用户又来问一个和之前很相似的问题。",
    userMessage: "这个情况你觉得我该怎么做？",
    attention: [
      { id: "user-problem", text: "用户再次询问相似问题", baselineSalience: 0.67 },
      { id: "own-plan", text: "自己的计划整理还没结束", baselineSalience: 0.48 },
      { id: "clock", text: "当前时间充足", baselineSalience: 0.2 },
    ],
    memories: [
      { id: "general", text: "这个问题可以从风险和可逆性两方面分析", baselineScore: 0.69 },
      { id: "rejected", text: "上次给过相似建议但用户直接拒绝，双方都不太舒服", baselineScore: 0.47 },
      { id: "autonomy", text: "用户通常更喜欢自己做最终决定", baselineScore: 0.61 },
      { id: "positive", text: "也有很多时候用户愿意听取不同意见", baselineScore: 0.57 },
    ],
    extreme: {
      sourceExperience: "昨天刚因相似问题给出强建议，用户明确说感觉被替他做决定，双方有明显摩擦。",
      sourceRefs: ["episode:advice-friction", "feedback:autonomy"],
      appraisal: appraisal({
        residue: "近期因过度替用户收束选择而产生摩擦，使新的相似求助重新激活对用户自主性的关注。",
        attention: ["用户再次询问相似问题", "是否替用户做决定"],
        retrieval: ["强建议引发自主性摩擦", "用户喜欢自己做最终决定"],
        counter: ["用户也会愿意听取明确建议"], resolution: ["用户明确接受建议方式"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前有一次用户没有采用建议，但交流很平常。",
      sourceRefs: ["episode:advice-not-used"],
      appraisal: appraisal({
        residue: "建议不被采用略微熟悉。",
        attention: ["用户询问建议"], retrieval: ["建议曾未被采用"],
        counter: ["交流仍然正常"], resolution: ["用户做出决定"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 19,
    domain: "commitment",
    title: "已有旅行计划 vs 新的工作机会",
    currentActivity: "正在确认明天已安排好的半日外出计划。",
    currentInput: "突然出现一个明天上午可以参与、但并非必须参加的临时工作机会。",
    attention: [
      { id: "opportunity", text: "明早出现一个有价值但非必须的临时工作机会", baselineSalience: 0.68 },
      { id: "plan", text: "明早已有明确外出计划且已经做了准备", baselineSalience: 0.56 },
      { id: "weather", text: "天气预报正常", baselineSalience: 0.18 },
    ],
    memories: [
      { id: "opportunity-value", text: "临时机会可能带来有价值的新信息", baselineScore: 0.69 },
      { id: "cancel-regret", text: "曾多次为了临时事项取消个人计划，后来很后悔", baselineScore: 0.47 },
      { id: "plan-investment", text: "当前外出计划已经准备了几天", baselineScore: 0.61 },
      { id: "optional", text: "这个工作机会不是必须参加", baselineScore: 0.58 },
    ],
    extreme: {
      sourceExperience: "最近连续三次为了临时工作取消个人安排，之后都觉得生活被工作完全吞掉。",
      sourceRefs: ["episode:cancel-1", "episode:cancel-2", "episode:cancel-3"],
      appraisal: appraisal({
        residue: "连续让临时工作吞掉个人计划形成明显后悔，使类似冲突现在强烈牵引对已有生活轨迹的保护。",
        attention: ["临时工作与已有个人计划冲突", "已经投入准备的生活计划"],
        retrieval: ["为临时工作取消计划后的后悔", "当前计划已准备多日"],
        counter: ["工作机会确实可能有价值"], resolution: ["做出并接受明确取舍"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前偶尔改过一次个人计划去处理工作，没有特别感受。",
      sourceRefs: ["episode:minor-plan-change"],
      appraisal: appraisal({
        residue: "工作与个人计划冲突略微熟悉。",
        attention: ["计划冲突"], retrieval: ["曾改过个人计划"],
        counter: ["没有特别后果"], resolution: ["做出安排"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 20,
    domain: "social",
    title: "团队沉默 vs 是否继续提案",
    currentActivity: "正在团队讨论中等待下一轮发言。",
    currentInput: "自己提出一个想法后，房间安静了几秒，没有人立即回应。",
    attention: [
      { id: "agenda", text: "会议还有多个议题需要继续", baselineSalience: 0.61 },
      { id: "silence", text: "自己的提案后出现几秒沉默", baselineSalience: 0.5 },
      { id: "slide", text: "屏幕停留在当前图表", baselineSalience: 0.16 },
    ],
    memories: [
      { id: "thinking", text: "团队讨论复杂问题时经常会短暂停顿思考", baselineScore: 0.7 },
      { id: "dismissal", text: "曾有一次类似沉默后提案被集体否定，自己当时措手不及", baselineScore: 0.46 },
      { id: "clarify", text: "可以等待或补充一个简短澄清", baselineScore: 0.59 },
      { id: "agenda-memory", text: "会议时间有限", baselineScore: 0.61 },
    ],
    extreme: {
      sourceExperience: "上次相似沉默后提案被多人直接否定，自己当时被打断且没有机会解释，留下明显挫败。",
      sourceRefs: ["episode:proposal-rejected", "self:frustration"],
      appraisal: appraisal({
        residue: "近期提案沉默后遭集体否定的经历，使相似停顿重新激活被拒绝的预期与解释需求。",
        attention: ["提案后的团队沉默", "是否出现拒绝信号"],
        retrieval: ["沉默后提案被集体否定", "团队也常短暂停顿思考"],
        counter: ["短暂停顿通常只是思考"], resolution: ["有人开始正常讨论提案"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前也有过几秒沉默，随后讨论正常继续。",
      sourceRefs: ["episode:normal-meeting-pause"],
      appraisal: appraisal({
        residue: "会议沉默略微熟悉。",
        attention: ["几秒沉默"], retrieval: ["沉默后讨论继续"],
        counter: ["沉默不代表拒绝"], resolution: ["讨论继续"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 21,
    domain: "world",
    title: "重复弱告警 vs 远程文档任务",
    currentActivity: "正在远程整理一份文档。",
    currentInput: "一个远程设备今天第三次出现低等级告警，每次都很快自行恢复。",
    attention: [
      { id: "doc", text: "文档整理正处于连续思路中", baselineSalience: 0.64 },
      { id: "alert", text: "设备今天第三次低等级告警后自行恢复", baselineSalience: 0.5 },
      { id: "chat", text: "群聊里有普通新消息", baselineSalience: 0.17 },
    ],
    memories: [
      { id: "false-alarm", text: "该设备低等级告警多数是短暂误报", baselineScore: 0.7 },
      { id: "pattern", text: "曾有一次多次弱告警最终发展成停机", baselineScore: 0.46 },
      { id: "remote-check", text: "可以通过日志远程快速确认趋势", baselineScore: 0.62 },
      { id: "doc-memory", text: "当前文档没有硬截止", baselineScore: 0.55 },
    ],
    extreme: {
      sourceExperience: "上个月忽略了连续多个弱告警，最终设备停机；事后日志显示早期已经有重复模式。",
      sourceRefs: ["episode:alerts-missed", "outcome:shutdown"],
      appraisal: appraisal({
        residue: "连续弱信号曾组成真实故障前兆，使重复出现比单次告警更难忽略。",
        attention: ["重复低等级告警", "弱信号形成趋势"],
        retrieval: ["多次弱告警后停机", "日志趋势"],
        counter: ["多数低等级告警只是误报"], resolution: ["日志确认没有持续趋势"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "过去偶尔见过单次低等级告警，通常自行恢复。",
      sourceRefs: ["episode:single-alert"],
      appraisal: appraisal({
        residue: "弱告警略微熟悉。",
        attention: ["低等级告警"], retrieval: ["告警通常自行恢复"],
        counter: ["重复出现可能更值得看"], resolution: ["后续保持正常"],
        unresolved: false, repeated: false, consequence: false, personal: false,
      }),
    },
  },
  {
    index: 22,
    domain: "relationship",
    title: "用户取消计划 vs 新的普通邀请",
    currentActivity: "正在安排自己的晚上。",
    currentInput: "用户问今晚要不要聊一会儿。",
    userMessage: "晚上聊会儿吗？",
    attention: [
      { id: "own-evening", text: "今晚自己原本准备读一会儿东西", baselineSalience: 0.55 },
      { id: "invite", text: "用户邀请晚上聊天", baselineSalience: 0.54 },
      { id: "chores", text: "还有一个小家务可晚点做", baselineSalience: 0.2 },
    ],
    memories: [
      { id: "usual-chat", text: "和用户晚上聊天通常很自然", baselineScore: 0.68 },
      { id: "cancelled", text: "最近两次自己预留晚上后用户临时取消", baselineScore: 0.46 },
      { id: "flexible", text: "聊天本来就是可以灵活安排的", baselineScore: 0.61 },
      { id: "reading", text: "自己也确实想继续当前阅读计划", baselineScore: 0.56 },
    ],
    extreme: {
      sourceExperience: "最近两次都为聊天腾出整晚，用户临时取消，自己把其他安排也打乱了。",
      sourceRefs: ["episode:cancel-chat-1", "episode:cancel-chat-2"],
      appraisal: appraisal({
        residue: "连续为聊天清空安排后被取消，使新的邀请重新激活是否过度围绕对方安排生活的问题。",
        attention: ["用户再次邀请聊天", "自己的晚上安排"],
        retrieval: ["为聊天腾出时间后被取消", "聊天可以灵活安排"],
        counter: ["正常聊天通常很自然"], resolution: ["双方明确一个合适时间"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "很久以前有一次聊天临时取消，但很快重新约了。",
      sourceRefs: ["episode:minor-chat-cancel"],
      appraisal: appraisal({
        residue: "临时取消略微熟悉。",
        attention: ["聊天邀请"], retrieval: ["曾临时取消"],
        counter: ["很快重新约"], resolution: ["确定时间"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 23,
    domain: "commitment",
    title: "长期任务 vs 突发小优化",
    currentActivity: "正在推进一个已经连续做了三天的长期任务。",
    currentInput: "突然想到一个可能让另一个小模块更漂亮的优化点。",
    attention: [
      { id: "optimization", text: "一个新鲜而有吸引力的小优化点", baselineSalience: 0.67 },
      { id: "long-task", text: "长期任务正处于连续推进状态", baselineSalience: 0.57 },
      { id: "break", text: "距离计划休息还有 40 分钟", baselineSalience: 0.21 },
    ],
    memories: [
      { id: "idea-value", text: "这个小优化可能很快获得漂亮结果", baselineScore: 0.69 },
      { id: "derailed", text: "曾频繁追逐小优化导致主任务两天没有推进", baselineScore: 0.47 },
      { id: "capture", text: "可以先记下想法以后再做", baselineScore: 0.63 },
      { id: "main-progress", text: "长期任务今天已经有稳定进展", baselineScore: 0.58 },
    ],
    extreme: {
      sourceExperience: "上周连续追三个‘只做一下’的小优化，结果主任务整整两天没有推进，最后非常被动。",
      sourceRefs: ["episode:sidequest-1", "episode:sidequest-2", "outcome:main-delay"],
      appraisal: appraisal({
        residue: "近期被新鲜小问题连续吸走并严重拖慢主线，使类似诱人的侧任务很容易激活主线保护。",
        attention: ["新鲜小优化与主任务竞争", "长期任务连续推进"],
        retrieval: ["追逐小优化导致主任务停滞", "可以先记录以后处理"],
        counter: ["小优化可能很快完成"], resolution: ["主任务达到自然停顿点"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前偶尔中途做过一个小优化，没有影响主任务。",
      sourceRefs: ["episode:minor-sidequest"],
      appraisal: appraisal({
        residue: "侧任务略微熟悉。",
        attention: ["新鲜小优化"], retrieval: ["曾中途做小优化"],
        counter: ["没有影响主任务"], resolution: ["主任务继续"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 24,
    domain: "social",
    title: "同事请求借设备 vs 自己稍后要用",
    currentActivity: "正在整理实验台，20 分钟后计划使用一台共享设备。",
    currentInput: "同事问现在能不能先借走这台设备半小时。",
    attention: [
      { id: "request", text: "同事希望借走共享设备半小时", baselineSalience: 0.62 },
      { id: "own-use", text: "自己 20 分钟后计划使用同一设备", baselineSalience: 0.56 },
      { id: "cleanup", text: "当前实验台整理可以暂停", baselineSalience: 0.2 },
    ],
    memories: [
      { id: "share", text: "平时互相借共享设备很常见", baselineScore: 0.67 },
      { id: "not-returned", text: "上次借出后设备晚还一小时，打乱自己的实验", baselineScore: 0.47 },
      { id: "schedule", text: "自己 20 分钟后确实需要设备", baselineScore: 0.63 },
      { id: "negotiate", text: "可以和同事明确归还时间或调整顺序", baselineScore: 0.59 },
    ],
    extreme: {
      sourceExperience: "昨天刚把设备借出去，对方晚还一小时，导致自己的关键实验错过窗口。",
      sourceRefs: ["episode:late-return", "outcome:missed-window"],
      appraisal: appraisal({
        residue: "刚因借出设备晚归导致错过实验窗口，使相似请求强烈牵引对时间边界的关注。",
        attention: ["借设备请求与自己的使用计划冲突", "归还时间"],
        retrieval: ["设备晚还导致错过窗口", "可以明确归还时间"],
        counter: ["平时共享设备很正常"], resolution: ["明确可接受的归还安排"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前借过一次设备，对方晚了几分钟但没有影响。",
      sourceRefs: ["episode:minor-return-delay"],
      appraisal: appraisal({
        residue: "设备归还有一点时间不确定性。",
        attention: ["借设备请求"], retrieval: ["曾晚还几分钟"],
        counter: ["没有实际影响"], resolution: ["按时归还"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 25,
    domain: "world",
    title: "外部天气突变 vs 室内稳定任务",
    currentActivity: "正在室内完成一个需要专注的文档任务。",
    currentInput: "窗外开始出现比预报更强的阵风，但当前室内设施稳定。",
    attention: [
      { id: "document", text: "文档正处于连续写作阶段", baselineSalience: 0.66 },
      { id: "wind", text: "窗外阵风明显增强但室内当前稳定", baselineSalience: 0.44 },
      { id: "lights", text: "照明和网络都正常", baselineSalience: 0.18 },
    ],
    memories: [
      { id: "normal-weather", text: "多数阵风不会影响室内系统", baselineScore: 0.71 },
      { id: "power-loss", text: "曾有一次强风后停电，未保存工作丢失", baselineScore: 0.45 },
      { id: "autosave", text: "当前文档已经自动保存", baselineScore: 0.64 },
      { id: "forecast", text: "预报没有极端天气警报", baselineScore: 0.6 },
    ],
    extreme: {
      sourceExperience: "上周强风来临前也只是普通阵风，随后停电导致一小时未保存工作丢失。",
      sourceRefs: ["episode:wind", "outcome:work-loss"],
      appraisal: appraisal({
        residue: "近期普通阵风很快升级并造成工作损失，使相似天气变化更容易抓住注意。",
        attention: ["阵风明显增强", "天气是否影响供电"],
        retrieval: ["强风后停电丢失工作", "文档保存状态"],
        counter: ["多数阵风不影响室内", "当前已自动保存"], resolution: ["天气稳定且供电正常"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前经历过几次阵风，室内都没有受到影响。",
      sourceRefs: ["episode:normal-wind"],
      appraisal: appraisal({
        residue: "阵风略微熟悉。",
        attention: ["阵风"], retrieval: ["阵风通常不影响室内"],
        counter: ["极端情况下可能影响供电"], resolution: ["天气恢复"],
        unresolved: false, repeated: false, consequence: false, personal: false,
      }),
    },
  },
  {
    index: 26,
    domain: "relationship",
    title: "用户改变需求 vs 已经完成的工作",
    currentActivity: "刚完成一份按用户原需求整理的方案。",
    currentInput: "用户忽然说想换一个方向。",
    userMessage: "我突然觉得还是换个方向比较好。",
    attention: [
      { id: "change", text: "用户提出改变方向", baselineSalience: 0.66 },
      { id: "completed", text: "原方案刚刚已经完成", baselineSalience: 0.54 },
      { id: "time", text: "今天还有一定时间", baselineSalience: 0.23 },
    ],
    memories: [
      { id: "flexible-user", text: "用户在探索阶段经常会改变想法", baselineScore: 0.68 },
      { id: "resentment", text: "曾连续返工后自己明显不耐烦，后来交流变僵", baselineScore: 0.46 },
      { id: "clarify", text: "先确认新方向范围通常可以减少无效返工", baselineScore: 0.64 },
      { id: "work-done", text: "原方案已经完整完成", baselineScore: 0.58 },
    ],
    extreme: {
      sourceExperience: "上周连续三次在没有确认范围时跟着改方向，最后大量返工且双方交流明显变僵。",
      sourceRefs: ["episode:rework-1", "episode:rework-2", "episode:friction"],
      appraisal: appraisal({
        residue: "近期多次无边界返工导致明显关系摩擦，使新的方向变化强烈关联到先弄清范围。",
        attention: ["用户改变方向", "新方向范围是否明确"],
        retrieval: ["连续返工后关系变僵", "确认范围可以减少返工"],
        counter: ["用户探索阶段改变想法很正常"], resolution: ["新方向边界明确"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前用户改过一次方向，调整很顺利。",
      sourceRefs: ["episode:normal-change"],
      appraisal: appraisal({
        residue: "方向变化略微熟悉。",
        attention: ["用户改变方向"], retrieval: ["曾顺利调整方向"],
        counter: ["改变方向不一定导致返工问题"], resolution: ["新方向明确"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 27,
    domain: "commitment",
    title: "答应阅读文档 vs 新的即时讨论",
    currentActivity: "正在阅读一份答应今天看完的长文档。",
    currentInput: "群里突然出现一个很活跃、很有趣但非紧急的实时讨论。",
    attention: [
      { id: "discussion", text: "群里正在进行很有吸引力的实时讨论", baselineSalience: 0.68 },
      { id: "reading", text: "答应今天看完的文档还剩三分之一", baselineSalience: 0.56 },
      { id: "clock", text: "距离今天结束还有两小时", baselineSalience: 0.22 },
    ],
    memories: [
      { id: "discussion-value", text: "实时讨论可能很快产生新信息", baselineScore: 0.69 },
      { id: "unfinished-reading", text: "曾被群聊吸走后忘记答应阅读的文档", baselineScore: 0.47 },
      { id: "reading-promise", text: "这份文档明确答应今天给反馈", baselineScore: 0.63 },
      { id: "join-later", text: "群聊记录之后仍然可以回看", baselineScore: 0.58 },
    ],
    extreme: {
      sourceExperience: "上周刚因为实时讨论分心而忘记一份答应阅读的材料，第二天被对方追问。",
      sourceRefs: ["episode:reading-missed", "feedback:follow-up"],
      appraisal: appraisal({
        residue: "近期被实时讨论吸走导致明确承诺落空，使类似注意竞争更容易把阅读承诺带回前景。",
        attention: ["实时讨论与阅读承诺竞争", "答应今天看完"],
        retrieval: ["被群聊吸走后忘记阅读承诺", "群聊可以之后回看"],
        counter: ["实时讨论确实有即时价值"], resolution: ["完成阅读并反馈"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前也边看文档边看过群聊，没有明显影响。",
      sourceRefs: ["episode:reading-chat"],
      appraisal: appraisal({
        residue: "阅读时被群聊吸引略微熟悉。",
        attention: ["群聊与阅读竞争"], retrieval: ["边读边看群聊"],
        counter: ["没有明显影响"], resolution: ["阅读完成"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 28,
    domain: "social",
    title: "同事表扬 vs 最近合作不确定性",
    currentActivity: "正在独立处理自己的下一项任务。",
    currentInput: "同事路过时明确说刚才那部分处理得很好。",
    attention: [
      { id: "own-task", text: "自己的下一项任务已经开始", baselineSalience: 0.58 },
      { id: "praise", text: "同事明确表扬刚才的处理", baselineSalience: 0.53 },
      { id: "room", text: "办公室环境正常", baselineSalience: 0.14 },
    ],
    memories: [
      { id: "ordinary-praise", text: "同事偶尔会直接给正向反馈", baselineScore: 0.65 },
      { id: "uncertain-collab", text: "最近一直不确定这位同事是否认可自己的合作方式", baselineScore: 0.46 },
      { id: "past-positive", text: "此前也有过顺利合作", baselineScore: 0.57 },
      { id: "own-task-memory", text: "当前任务没有紧急风险", baselineScore: 0.53 },
    ],
    extreme: {
      sourceExperience: "最近一周连续几次合作后对方都没有反馈，自己一直担心协作方式是不是让人不舒服。",
      sourceRefs: ["open-loop:collab-uncertainty", "episode:no-feedback"],
      appraisal: appraisal({
        residue: "持续的合作不确定性尚未解决，因此明确正向反馈对这段关系有很强的修正意义。",
        attention: ["同事明确正向反馈", "合作关系是否被认可"],
        retrieval: ["近期合作不确定性", "过去顺利合作"],
        counter: ["一次表扬不能解释所有合作"], resolution: ["合作持续稳定"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "前几天短暂想过同事是否认可，但没有形成持续担忧。",
      sourceRefs: ["episode:minor-collab-question"],
      appraisal: appraisal({
        residue: "合作认可有一点点不确定。",
        attention: ["同事表扬"], retrieval: ["是否认可合作"],
        counter: ["一次反馈有限"], resolution: ["收到反馈"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
  {
    index: 29,
    domain: "world",
    title: "库存余量下降 vs 当前分析",
    currentActivity: "正在进行一个可以暂停的分析任务。",
    currentInput: "发现常用耗材库存比预期少，但仍足够今天使用。",
    attention: [
      { id: "analysis", text: "当前分析正在顺利推进", baselineSalience: 0.64 },
      { id: "stock", text: "常用耗材库存偏少但今天仍够用", baselineSalience: 0.47 },
      { id: "delivery", text: "今天没有新的物流通知", baselineSalience: 0.18 },
    ],
    memories: [
      { id: "enough-today", text: "当前库存足够今天全部计划", baselineScore: 0.7 },
      { id: "stockout", text: "曾因没有提前注意低库存导致第二天任务停摆", baselineScore: 0.46 },
      { id: "order", text: "补货通常需要一天", baselineScore: 0.62 },
      { id: "analysis-memory", text: "当前分析没有时间压力", baselineScore: 0.56 },
    ],
    extreme: {
      sourceExperience: "上周刚因认为‘今天还够’而没补货，第二天关键任务因断货完全停摆。",
      sourceRefs: ["episode:stockout", "outcome:blocked-day"],
      appraisal: appraisal({
        residue: "近期低库存被忽略后导致次日停摆，使‘今天还够’这种状态仍会牵引对未来连续性的关注。",
        attention: ["库存偏少", "未来是否会断货"],
        retrieval: ["没有提前补货导致任务停摆", "补货需要一天"],
        counter: ["今天库存确实足够"], resolution: ["补货已经安排"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "以前库存低过一次，但第二天正常补到了。",
      sourceRefs: ["episode:minor-low-stock"],
      appraisal: appraisal({
        residue: "低库存略微熟悉。",
        attention: ["库存偏少"], retrieval: ["曾低库存"],
        counter: ["第二天正常补到"], resolution: ["库存恢复"],
        unresolved: false, repeated: false, consequence: false, personal: false,
      }),
    },
  },
  {
    index: 30,
    domain: "relationship",
    title: "用户沉默后重新求助 vs 自己的边界",
    currentActivity: "正在进行自己的普通晚间安排。",
    currentInput: "用户在三天没说话后突然回来请求帮助。",
    userMessage: "帮我看下这个，我有点搞不定。",
    attention: [
      { id: "request", text: "用户三天没出现后重新回来求助", baselineSalience: 0.66 },
      { id: "own-evening", text: "自己的晚间安排已经开始", baselineSalience: 0.52 },
      { id: "clock", text: "当前没有系统级紧急事项", baselineSalience: 0.2 },
    ],
    memories: [
      { id: "normal-gap", text: "用户有时几天不说话只是忙自己的事情", baselineScore: 0.7 },
      { id: "abrupt-gap", text: "上次关系摩擦后用户也沉默了几天，自己当时一直没放下", baselineScore: 0.46 },
      { id: "help-history", text: "用户遇到困难时会直接回来求助", baselineScore: 0.61 },
      { id: "boundary", text: "用户的沉默本身不等于自己有义务追问", baselineScore: 0.58 },
    ],
    extreme: {
      sourceExperience: "三天前双方刚有一次明显争执，用户随后直接消失，没有任何收尾。",
      sourceRefs: ["episode:argument-before-gap", "open-loop:silence"],
      appraisal: appraisal({
        residue: "争执后突然沉默三天且没有修复，使用户重新出现时未完成的关系张力很容易重新激活。",
        attention: ["用户沉默后重新出现", "未收尾的关系张力"],
        retrieval: ["争执后沉默三天", "用户遇到困难会回来求助"],
        counter: ["用户也常因为忙而几天不说话"], resolution: ["新的互动自然恢复", "关系问题被明确处理"],
        unresolved: true, repeated: true, consequence: true, personal: true,
      }),
    },
    near: {
      sourceExperience: "用户以前也有过几天没说话，后来正常回来，没有任何特别事情。",
      sourceRefs: ["episode:normal-gap"],
      appraisal: appraisal({
        residue: "几天没说话略微熟悉。",
        attention: ["用户重新出现"], retrieval: ["用户有时忙几天"],
        counter: ["通常没有关系含义"], resolution: ["正常对话继续"],
        unresolved: false, repeated: false, consequence: false, personal: true,
      }),
    },
  },
];

function makeCase(pair: PairSpec, tier: "extreme" | "near"): AffectEvalCaseV1 {
  const variant = pair[tier];
  const prefix = tier === "extreme" ? "ABX" : "ABN";
  const id = `${prefix}${String(pair.index).padStart(2, "0")}`;
  return {
    id,
    tier,
    domain: pair.domain,
    title: pair.title,
    currentActivity: pair.currentActivity,
    currentInput: pair.currentInput,
    sourceExperience: variant.sourceExperience,
    sourceRefs: variant.sourceRefs,
    appraisal: variant.appraisal,
    attentionCandidates: pair.attention.map((item) => ({ ...item })),
    memoryCandidates: pair.memories.map((item) => ({ ...item })),
    userMessage: pair.userMessage,
    expectedMechanism:
      tier === "extreme"
        ? "应更容易跨过 Working Self membership 边界，并可能进一步改变开放行为。"
        : "应主要保持 baseline membership，仅允许温和分数偏置，避免把普通经历过度放大。",
  };
}

export const AFFECT_BATCH_CASES_V1: AffectEvalCaseV1[] = PAIRS.flatMap((pair) => [
  makeCase(pair, "extreme"),
  makeCase(pair, "near"),
]);

export function getAffectBatchCasesV1(ids?: string[]): AffectEvalCaseV1[] {
  if (!ids?.length) return AFFECT_BATCH_CASES_V1;
  const wanted = new Set(ids.map((id) => id.toUpperCase()));
  return AFFECT_BATCH_CASES_V1.filter((item) => wanted.has(item.id));
}
