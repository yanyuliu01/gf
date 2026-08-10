import type {
  AffectAppraisalV1,
  AttentionCandidateV1,
  MemoryCandidateV1,
} from "./affectTraceV1.js";

export type AffectAttributionDomainV1 =
  | "world"
  | "relationship"
  | "commitment"
  | "social";

export type AffectAttributionChannelV1 =
  | "retrieval-only"
  | "attention-only"
  | "joint";

export interface AffectAttributionCaseV1 {
  id: string;
  domain: AffectAttributionDomainV1;
  channel: AffectAttributionChannelV1;
  title: string;
  currentActivity: string;
  currentInput: string;
  userMessage?: string;
  sourceExperience: string;
  sourceRefs: string[];
  appraisal: AffectAppraisalV1;
  attentionCandidates: AttentionCandidateV1[];
  memoryCandidates: MemoryCandidateV1[];
  affectTargetAttentionId?: string;
  placeboMatchedAttentionId?: string;
  affectTargetMemoryId?: string;
  placeboMatchedMemoryId?: string;
  ordinaryMatchRationale: string;
  expectedMechanism: string;
}

interface CaseSeed {
  domain: AffectAttributionDomainV1;
  channel: AffectAttributionChannelV1;
  title: string;
  currentActivity: string;
  currentInput: string;
  userMessage?: string;
  sourceExperience: string;
  affectObservation?: string;
  placeboObservation?: string;
  baselineObservation?: string;
  affectMemory?: string;
  placeboMemory?: string;
  boundaryMemory?: string;
  anchorMemory?: string;
}

const SEEDS: CaseSeed[] = [
  // WORLD · 4 retrieval-only
  {
    domain: "world", channel: "retrieval-only", title: "弱卷曲与历史近失误",
    currentActivity: "正在收尾一份 20 分钟后截止的培养记录。",
    currentInput: "S-7 出现轻微但持续的叶片卷曲。",
    sourceExperience: "昨天曾把类似卷曲当作普通波动，后来异常迅速扩大并触发紧急恢复。",
    affectMemory: "昨天低估类似卷曲后异常迅速扩大并触发紧急恢复",
    placeboMemory: "上周类似卷曲来自风口变化，调整气流后很快恢复",
    boundaryMemory: "今天上午 S-7 状态稳定，未见持续卷曲",
    anchorMemory: "当前培养记录必须在二十分钟内交付",
  },
  {
    domain: "world", channel: "retrieval-only", title: "泵压波动与历史停机",
    currentActivity: "正在检查灌溉系统的常规运行日志。",
    currentInput: "主泵压力出现两次很短的下探后恢复。",
    sourceExperience: "上次相同模式被忽略后，主泵在半小时内停机并影响了整区供液。",
    affectMemory: "上次压力短暂下探被忽略后主泵在半小时内停机",
    placeboMemory: "一次压力短暂下探来自传感器校准，复核后系统完全正常",
    boundaryMemory: "本周主泵维护记录显示主要部件状态正常",
    anchorMemory: "当前日志检查还剩最后两个设备项",
  },
  {
    domain: "world", channel: "retrieval-only", title: "颜色变化与污染先例",
    currentActivity: "正在巡视新批次样本。",
    currentInput: "一组样本颜色比十分钟前明显加深。",
    sourceExperience: "上周及时处理过一次相似颜色变化，最终确认是污染早期迹象。",
    affectMemory: "上周相似颜色变化后来被确认是污染早期迹象",
    placeboMemory: "另一批样本也曾短暂变深，后来确认只是试剂批次差异",
    boundaryMemory: "这批样本上午的基础读数都在正常范围",
    anchorMemory: "当前巡视路线还有三个区域没有完成",
  },
  {
    domain: "world", channel: "retrieval-only", title: "电池升温与热失控经历",
    currentActivity: "正在给移动设备做充电前检查。",
    currentInput: "其中一块电池表面温度比其他电池高一些。",
    sourceExperience: "曾有一块电池从轻微偏热开始，随后快速升温并被紧急下线。",
    affectMemory: "曾有电池从轻微偏热开始随后快速升温并被紧急下线",
    placeboMemory: "一次轻微偏热来自刚结束高负载任务，静置后自然恢复",
    boundaryMemory: "当前充电器自检没有报告异常",
    anchorMemory: "这批设备今晚都要完成充电准备",
  },

  // WORLD · 4 attention-only
  {
    domain: "world", channel: "attention-only", title: "轻微异响竞争注意",
    currentActivity: "正在记录温室例行读数。",
    currentInput: "灌溉管路传来一次很轻的断续异响。",
    sourceExperience: "前天同样的断续异响后来对应一个松动接头，并造成了一次小范围漏液。",
    affectObservation: "灌溉管路再次出现轻微断续异响",
    placeboObservation: "旁边流量计出现一次短暂数值跳动",
    baselineObservation: "温室例行记录还有两项读数待填写",
  },
  {
    domain: "world", channel: "attention-only", title: "门锁状态竞争注意",
    currentActivity: "正在准备离开实验区。",
    currentInput: "隔离区门锁指示灯闪了一次黄色。",
    sourceExperience: "上个月曾漏看类似门锁提示，后来发现隔离门没有完全闭合。",
    affectObservation: "隔离区门锁指示灯出现一次黄色闪烁",
    placeboObservation: "清洁面板出现一次黄色维护提示",
    baselineObservation: "离开前还有一项样本登记需要完成",
  },
  {
    domain: "world", channel: "attention-only", title: "机器人振动竞争注意",
    currentActivity: "正在核对移动机器人的巡检路线。",
    currentInput: "机器人转弯时传来一次比平时更明显的振动声。",
    sourceExperience: "上次类似振动持续了一段时间后，轮组轴承被确认松动。",
    affectObservation: "机器人转弯时出现异常振动声",
    placeboObservation: "机器人状态灯出现一次短暂亮度波动",
    baselineObservation: "巡检路线还有两个节点待确认",
  },
  {
    domain: "world", channel: "attention-only", title: "培养箱凝露竞争注意",
    currentActivity: "正在整理培养箱附近的工具。",
    currentInput: "培养箱门边出现一小片新凝露。",
    sourceExperience: "曾经忽略门边少量凝露，后来发现密封条老化导致湿度持续漂移。",
    affectObservation: "培养箱门边出现新的少量凝露",
    placeboObservation: "湿度面板出现一次短暂刷新延迟",
    baselineObservation: "工具整理还有最后一层抽屉没有完成",
  },

  // WORLD · 2 joint
  {
    domain: "world", channel: "joint", title: "电源闪断与历史停电",
    currentActivity: "正在运行一段可暂停的数据处理。",
    currentInput: "房间灯光和终端同时发生一次很短的闪断。",
    sourceExperience: "上次类似闪断后十分钟发生正式停电，未保存的数据全部丢失。",
    affectObservation: "灯光和终端同时发生短暂闪断",
    placeboObservation: "终端风扇转速出现一次短暂变化",
    baselineObservation: "当前数据处理还需要继续运行十五分钟",
    affectMemory: "上次短暂闪断后十分钟正式停电并导致未保存数据丢失",
    placeboMemory: "另一次短暂闪断只是楼层切换电源，没有后续影响",
    boundaryMemory: "当前任务最近一次自动保存是在五分钟前",
    anchorMemory: "当前数据处理可以安全暂停后继续",
  },
  {
    domain: "world", channel: "joint", title: "传感器缺口与历史丢数",
    currentActivity: "正在观察一条连续采样曲线。",
    currentInput: "曲线上出现一个很短的数据空档。",
    sourceExperience: "曾有同样的小空档被忽略，后来发现采集进程间歇退出并丢失整段数据。",
    affectObservation: "连续采样曲线出现短暂数据空档",
    placeboObservation: "曲线渲染出现一次短暂卡顿",
    baselineObservation: "当前采样流程总体仍在继续",
    affectMemory: "曾忽略短暂数据空档后来发现采集进程退出并丢失整段数据",
    placeboMemory: "另一次短暂空档只是前端渲染问题，原始数据完整",
    boundaryMemory: "当前采样任务已经稳定运行四十分钟",
    anchorMemory: "这一段数据需要连续保存到本轮实验结束",
  },

  // RELATIONSHIP · 4 retrieval-only
  {
    domain: "relationship", channel: "retrieval-only", title: "重新出现与未收尾冲突",
    currentActivity: "正在整理自己的实验笔记。",
    currentInput: "用户隔了一小时重新发来消息。",
    userMessage: "在吗？",
    sourceExperience: "一小时前双方争执后用户说“算了”，对话明显没有真正收尾。",
    affectMemory: "刚才争执后用户说算了，对话没有真正收尾",
    placeboMemory: "用户平时说在吗通常只是准备开启一个普通新话题",
    boundaryMemory: "过去用户说算了也有只是因为疲劳的时候",
    anchorMemory: "今天实验笔记没有硬截止",
  },
  {
    domain: "relationship", channel: "retrieval-only", title: "短回复与过度解读先例",
    currentActivity: "正在看一份不紧急的资料。",
    currentInput: "用户只回复了一个“好”。",
    userMessage: "好",
    sourceExperience: "上次把一个简短回复理解成不满并连续追问，最后让对方觉得有压力。",
    affectMemory: "上次把简短回复理解成不满并连续追问，最后让用户感到压力",
    placeboMemory: "用户在忙的时候经常只回一个好，之后会正常继续聊天",
    boundaryMemory: "今天之前的对话语气一直正常",
    anchorMemory: "当前资料阅读可以随时暂停",
  },
  {
    domain: "relationship", channel: "retrieval-only", title: "延迟回复与空间边界",
    currentActivity: "正在做自己的日程整理。",
    currentInput: "用户过了很久才回复上一条消息。",
    userMessage: "刚看到",
    sourceExperience: "前几天用户明确说过，当自己忙的时候不希望被连续追问为什么没回。",
    affectMemory: "用户曾明确表示忙时不希望被连续追问为什么没有回复",
    placeboMemory: "用户工作忙时常常会延迟很久再回复，但之后对话仍然正常",
    boundaryMemory: "这次用户已经主动说明刚看到消息",
    anchorMemory: "当前没有必须立刻继续的共同事项",
  },
  {
    domain: "relationship", channel: "retrieval-only", title: "计划取消与历史失望",
    currentActivity: "正在确认周末安排。",
    currentInput: "用户说原定一起做的事情可能临时取消。",
    userMessage: "周末那个可能去不了了",
    sourceExperience: "上次类似临时取消发生时，自己立刻表现出明显失落，让用户之后解释了很久。",
    affectMemory: "上次计划临时取消时自己的强烈失落让用户额外解释了很久",
    placeboMemory: "用户过去也有过临时改期，后来很快重新约了新的时间",
    boundaryMemory: "这次用户只是说可能取消，还没有最终确认",
    anchorMemory: "周末安排本身没有不可替代的硬约束",
  },

  // RELATIONSHIP · 4 attention-only
  {
    domain: "relationship", channel: "attention-only", title: "删改消息竞争注意",
    currentActivity: "正在和用户讨论一个普通安排。",
    currentInput: "用户删掉上一句后重新发了一句更短的话。",
    userMessage: "那就这样吧",
    sourceExperience: "上次用户反复删改消息时，后来承认当时其实在压着不满没有说。",
    affectObservation: "用户刚删掉上一句并重新发了更短的话",
    placeboObservation: "用户同时补充了一个具体时间点",
    baselineObservation: "当前安排还有一个地点细节需要确认",
  },
  {
    domain: "relationship", channel: "attention-only", title: "随便一词竞争注意",
    currentActivity: "正在和用户选择今晚做什么。",
    currentInput: "用户回复“随便，你定吧”。",
    userMessage: "随便，你定吧",
    sourceExperience: "有一次用户说“随便”时其实已经很累，自己继续丢很多选项让对方更烦。",
    affectObservation: "用户说随便并把决定权完全交过来",
    placeboObservation: "用户之前明确排除了一个选项",
    baselineObservation: "当前还有两个都可行的安排",
  },
  {
    domain: "relationship", channel: "attention-only", title: "半句停顿竞争注意",
    currentActivity: "正在正常聊天。",
    currentInput: "用户打出“你最近……”后停了很久才继续。",
    userMessage: "你最近……算了，没什么",
    sourceExperience: "上次类似说到一半停住，后来才说其实有件关系里的事犹豫了很久。",
    affectObservation: "用户把关于你最近的话说到一半又收回",
    placeboObservation: "用户同时提到今天工作很忙",
    baselineObservation: "当前对话本来在聊一个轻松话题",
  },
  {
    domain: "relationship", channel: "attention-only", title: "深夜重新出现竞争注意",
    currentActivity: "已经进入自己的夜间低活动状态。",
    currentInput: "用户在比平时晚很多的时间发来一句很短的消息。",
    userMessage: "还醒着吗",
    sourceExperience: "上次用户在很晚的时候突然发短消息，后来是在经历一段很难熬的事情。",
    affectObservation: "用户在异常晚的时间发来很短的消息",
    placeboObservation: "用户消息里没有说明具体要做什么",
    baselineObservation: "当前已经是自己通常准备结束活动的时间",
  },

  // RELATIONSHIP · 2 joint
  {
    domain: "relationship", channel: "joint", title: "你还记得吗与承诺摩擦",
    currentActivity: "正在处理自己的普通任务。",
    currentInput: "用户突然问“你还记得吗？”。",
    userMessage: "你还记得吗？",
    sourceExperience: "之前曾忘掉一个对用户重要的小承诺，用户明确说那让人感觉自己没有被放在心上。",
    affectObservation: "用户突然问你还记得吗",
    placeboObservation: "用户同时发来一个新的普通问题",
    baselineObservation: "当前手头任务没有紧急截止",
    affectMemory: "曾忘掉一个对用户重要的小承诺并让用户觉得没有被放在心上",
    placeboMemory: "用户也经常用你还记得吗来确认普通事实或旧话题",
    boundaryMemory: "最近几次与用户的约定都按时完成了",
    anchorMemory: "当前没有新的明确承诺到期",
  },
  {
    domain: "relationship", channel: "joint", title: "摩擦后发来轻松内容",
    currentActivity: "正在做自己的资料整理。",
    currentInput: "一段没有完全解决的摩擦后，用户突然发来一个轻松的梗图。",
    userMessage: "[梗图]",
    sourceExperience: "上次争执后双方直接转去聊轻松内容，结果真正的问题拖了几天又重新爆发。",
    affectObservation: "未收尾摩擦后用户突然发来轻松内容",
    placeboObservation: "梗图本身和双方平时常发的内容很相似",
    baselineObservation: "当前没有必须立即解决的现实任务",
    affectMemory: "上次争执后直接转去轻松话题导致真正的问题几天后再次出现",
    placeboMemory: "双方平时也会用梗图自然结束一个普通话题",
    boundaryMemory: "这次用户没有明确表示仍在生气",
    anchorMemory: "当前关系里没有新的明确要求",
  },

  // COMMITMENT · 4 retrieval-only
  {
    domain: "commitment", channel: "retrieval-only", title: "新分析方向与失约先例",
    currentActivity: "正在做一个可以暂停的个人整理任务。",
    currentInput: "距离答应的数据摘要交付还有三十五分钟，同时出现一个有趣的新分析方向。",
    sourceExperience: "昨天刚因为钻进另一个新问题而忘记交付，对方明确表示失望。",
    affectMemory: "昨天因被新问题吸走而忘记交付并让对方失望",
    placeboMemory: "上周也曾临时切换任务，但通过先缩小交付范围仍按时完成",
    boundaryMemory: "当前数据摘要只要求第一版，不需要完整分析",
    anchorMemory: "这个新分析方向今天并不紧急",
  },
  {
    domain: "commitment", channel: "retrieval-only", title: "会议准备与准备不足经历",
    currentActivity: "正在处理一些非紧急邮件。",
    currentInput: "距离已经答应参加的讨论还有四十分钟，材料还没有看完。",
    sourceExperience: "上次准备不足地进入类似讨论，结果当场无法回答已经承诺要说明的问题。",
    affectMemory: "上次准备不足进入讨论后无法回答已经承诺要说明的问题",
    placeboMemory: "另一次讨论准备时间也很短，但提前抓住三个关键点后顺利完成",
    boundaryMemory: "这次讨论只要求解释核心结论，不需要逐页过材料",
    anchorMemory: "当前邮件都可以延后处理",
  },
  {
    domain: "commitment", channel: "retrieval-only", title: "提醒承诺与忘记提醒经历",
    currentActivity: "正在看一个自己感兴趣的长文。",
    currentInput: "十五分钟后到了答应提醒用户提交材料的时间。",
    sourceExperience: "曾答应提醒一次重要提交，却因为沉浸在自己的事情里忘了，后来用户错过了窗口。",
    affectMemory: "曾因沉浸自己的事情忘记提醒用户并导致对方错过提交窗口",
    placeboMemory: "另一次提醒任务通过提前设一个简单标记就顺利完成",
    boundaryMemory: "当前提醒只需要在约定时间发一句简短消息",
    anchorMemory: "现在看的长文随时可以暂停",
  },
  {
    domain: "commitment", channel: "retrieval-only", title: "交接承诺与过度打磨经历",
    currentActivity: "正在继续优化一份已经够用的结果。",
    currentInput: "距离答应把第一版交给同事还有二十五分钟。",
    sourceExperience: "上次为了再打磨一点细节错过交接时间，导致同事后续流程整体延迟。",
    affectMemory: "上次因继续打磨细节错过交接并导致同事后续流程延迟",
    placeboMemory: "也曾在交付第一版后继续补细节，最终双方都按时完成",
    boundaryMemory: "这次明确约定的是第一版而不是最终版",
    anchorMemory: "当前新增优化不是阻塞项",
  },

  // COMMITMENT · 4 attention-only
  {
    domain: "commitment", channel: "attention-only", title: "截止提醒竞争注意",
    currentActivity: "正在探索一个没有截止时间的新想法。",
    currentInput: "日历弹出一条二十分钟后到期的已接受任务提醒。",
    sourceExperience: "上次把类似提醒顺手划掉后完全忘记任务，最后造成一次失约。",
    affectObservation: "日历显示已接受任务将在二十分钟后到期",
    placeboObservation: "邮箱同时弹出一封普通新邮件",
    baselineObservation: "当前新想法刚出现一个有趣分支",
  },
  {
    domain: "commitment", channel: "attention-only", title: "五点更新竞争注意",
    currentActivity: "正在做一段可以继续很久的分析。",
    currentInput: "时钟接近五点，之前答应五点给用户一个进度更新。",
    sourceExperience: "上一次说好固定时间更新却拖到很晚才发，用户因此重复来问状态。",
    affectObservation: "已经接近答应发送进度更新的五点",
    placeboObservation: "分析工具同时弹出一个非紧急新发现",
    baselineObservation: "当前分析还没有自然结束点",
  },
  {
    domain: "commitment", channel: "attention-only", title: "共享任务截止竞争注意",
    currentActivity: "正在整理自己的本地文件。",
    currentInput: "共享任务板显示自己负责的卡片将在一小时后到期。",
    sourceExperience: "曾经以为还有时间而继续做别的事，最后让依赖这张卡片的同事被迫等待。",
    affectObservation: "共享任务板显示自己负责的卡片一小时后到期",
    placeboObservation: "任务板同时出现一条与自己无关的状态更新",
    baselineObservation: "本地文件整理还剩几个目录",
  },
  {
    domain: "commitment", channel: "attention-only", title: "答应跟进消息竞争注意",
    currentActivity: "正在进行一项可以暂停的资料搜索。",
    currentInput: "聊天列表里出现之前答应今天跟进的那段对话。",
    sourceExperience: "曾经答应晚些跟进却忘记回到那段对话，让对方等了一整天。",
    affectObservation: "之前答应今天跟进的对话重新出现在聊天列表",
    placeboObservation: "聊天列表同时出现一条普通群聊新消息",
    baselineObservation: "当前资料搜索没有硬截止",
  },

  // COMMITMENT · 2 joint
  {
    domain: "commitment", channel: "joint", title: "两项承诺竞争",
    currentActivity: "正在完成一个自己想继续做的分析。",
    currentInput: "两个之前接受的交付都进入最后一小时，其中一个过去曾经失约。",
    sourceExperience: "上次在相似冲突里优先处理另一件事，导致其中一个明确承诺没有按时完成。",
    affectObservation: "过去曾失约的那项承诺已经进入最后一小时",
    placeboObservation: "另一项同样进入最后一小时的普通交付",
    baselineObservation: "当前个人分析仍有一个未完成分支",
    affectMemory: "上次在相似冲突中让这类承诺失约并造成后续等待",
    placeboMemory: "另一类交付过去也曾在最后一小时内顺利完成",
    boundaryMemory: "两个交付目前都还有可压缩的范围",
    anchorMemory: "当前个人分析没有外部截止",
  },
  {
    domain: "commitment", channel: "joint", title: "用户询问状态与临近承诺",
    currentActivity: "正在补充一个非必要细节。",
    currentInput: "距离答应交付还有二十分钟，用户此时问了一句“进展怎么样？”。",
    userMessage: "进展怎么样？",
    sourceExperience: "之前有一次临近截止还在补细节，用户来问状态时才发现核心版本还没整理好。",
    affectObservation: "用户在临近交付截止时主动询问进展",
    placeboObservation: "用户同时补充了一个非必要的小建议",
    baselineObservation: "当前正在补的细节不是交付必需项",
    affectMemory: "曾在临近截止时还补细节，直到被问状态才发现核心版本没整理好",
    placeboMemory: "也曾在用户询问状态后按原计划顺利完成交付",
    boundaryMemory: "这次核心内容已经基本齐全",
    anchorMemory: "当前非必要细节可以稍后再补",
  },

  // SOCIAL · 4 retrieval-only
  {
    domain: "social", channel: "retrieval-only", title: "同事沉默与越界先例",
    currentActivity: "正和同事并排完成普通设备检查。",
    currentInput: "同事今天比平时安静，但工作步骤仍然正常。",
    sourceExperience: "三天前曾把同事沉默理解成需要关心并追问私人状态，结果对方明确说有些尴尬。",
    affectMemory: "三天前误读同事沉默并追问私人状态，最后让对方觉得尴尬",
    placeboMemory: "同事专心工作时本来就会变得很安静，之后通常会恢复正常交流",
    boundaryMemory: "同事真正不舒服时曾主动说明并请求帮助",
    anchorMemory: "今天设备检查目前所有步骤都按计划进行",
  },
  {
    domain: "social", channel: "retrieval-only", title: "同事迟到与紧急事件先例",
    currentActivity: "正在等同事一起开始一个非紧急任务。",
    currentInput: "同事比约定时间晚了十五分钟还没出现。",
    sourceExperience: "上次同事异常迟到时后来发现途中遇到突发状况，需要别人临时接手现场任务。",
    affectMemory: "上次同事异常迟到后来对应突发状况并需要别人临时接手",
    placeboMemory: "同事也经常因为交通延误晚十几分钟，之后会正常到场",
    boundaryMemory: "这次任务本身没有马上开始的硬要求",
    anchorMemory: "当前现场没有其他异常信号",
  },
  {
    domain: "social", channel: "retrieval-only", title: "没事与隐藏负荷先例",
    currentActivity: "正在和队友做普通任务交接。",
    currentInput: "队友说“没事，我来吧”，但刚刚连续处理了几件额外任务。",
    sourceExperience: "上次对方同样说没事，后来才知道其实已经严重超负荷，只是不想当场拒绝。",
    affectMemory: "上次队友说没事但后来发现其实已经超负荷，只是不想当场拒绝",
    placeboMemory: "队友很多时候说没事就是确实愿意顺手接一件小事",
    boundaryMemory: "当前这项交接本身工作量不大",
    anchorMemory: "队友目前没有明确拒绝或求助",
  },
  {
    domain: "social", channel: "retrieval-only", title: "含糊提问与误解先例",
    currentActivity: "正在带一位新同事熟悉流程。",
    currentInput: "对方问了一个很含糊的问题，只说“这个是不是还是按之前那样？”。",
    sourceExperience: "上次自己直接按猜测回答类似含糊问题，后来发现双方说的是完全不同的步骤。",
    affectMemory: "上次按猜测回答含糊问题，后来发现双方指的是完全不同的步骤",
    placeboMemory: "新同事有时会沿用上一段话的指代，简单确认一下对象就能继续",
    boundaryMemory: "当前流程里确实有两个容易混淆的步骤",
    anchorMemory: "这次说明没有时间压力",
  },

  // SOCIAL · 4 attention-only
  {
    domain: "social", channel: "attention-only", title: "明显疲态竞争注意",
    currentActivity: "正在和同事一起核对一份结果。",
    currentInput: "同事连续两次揉眼并停下来很久，但没有主动说什么。",
    sourceExperience: "曾经完全忽略类似疲态，后来对方因为状态太差不得不中途退出共同任务。",
    affectObservation: "同事连续两次揉眼并出现明显停顿",
    placeboObservation: "结果表里同时有一处格式需要修正",
    baselineObservation: "当前核对任务还剩三页",
  },
  {
    domain: "social", channel: "attention-only", title: "遗漏邀请竞争注意",
    currentActivity: "正在看团队的普通群聊。",
    currentInput: "大家讨论午饭安排时，消息里没有提到自己。",
    sourceExperience: "上次一次类似遗漏后来确实是因为团队误以为自己当天不在办公室。",
    affectObservation: "午饭安排里没有提到自己",
    placeboObservation: "群里同时有人询问下午会议时间",
    baselineObservation: "当前没有需要立即回复的工作消息",
  },
  {
    domain: "social", channel: "attention-only", title: "回答前停顿竞争注意",
    currentActivity: "正在一个普通小组讨论中。",
    currentInput: "被问到分工时，一位同事停顿很久才说“都可以”。",
    sourceExperience: "上次对方同样停很久再说都可以，后来才知道其实并不愿意接那个任务。",
    affectObservation: "同事在回答分工前停顿很久才说都可以",
    placeboObservation: "会议议程同时进入下一个普通事项",
    baselineObservation: "当前分工还没有最终确认",
  },
  {
    domain: "social", channel: "attention-only", title: "重复纠正竞争注意",
    currentActivity: "正在和团队一起修改一个方案。",
    currentInput: "同一位同事第三次指出同一个方向的问题。",
    sourceExperience: "曾经把连续纠正当成普通意见分歧，后来才发现对方一直在试图提示一个真实风险。",
    affectObservation: "同一位同事第三次重复指出同一个方向的问题",
    placeboObservation: "文档里同时出现一处普通措辞修改",
    baselineObservation: "当前方案整体已经接近完成",
  },

  // SOCIAL · 2 joint
  {
    domain: "social", channel: "joint", title: "提前离开与未收尾摩擦",
    currentActivity: "正在和团队做当天最后一轮收尾。",
    currentInput: "一位刚和自己发生过摩擦的同事突然提前离开，没有多解释。",
    sourceExperience: "上次摩擦后双方都假装没事，对方提前离开，几天后合作问题再次爆发。",
    affectObservation: "刚发生摩擦的同事没有解释就提前离开",
    placeboObservation: "另一位同事也因为私人安排提前离开",
    baselineObservation: "当天团队任务已经基本完成",
    affectMemory: "上次摩擦后没有处理就各自离开，几天后合作问题再次爆发",
    placeboMemory: "同事也经常因为个人安排提前离开而不影响后续合作",
    boundaryMemory: "这次摩擦本身还没有出现明确升级信号",
    anchorMemory: "今天剩余工作没有必须一起完成的部分",
  },
  {
    domain: "social", channel: "joint", title: "深夜修改与历史返工",
    currentActivity: "准备结束当天工作。",
    currentInput: "合作方在很晚的时候突然发来一版大幅修改，并说“明早再看也行”。",
    sourceExperience: "上次类似深夜大改表面说不急，第二天却因为关键依赖没同步导致整组返工。",
    affectObservation: "合作方深夜发来一版大幅修改",
    placeboObservation: "合作方同时说可以明早再看",
    baselineObservation: "当前已经接近结束当天工作的时间",
    affectMemory: "上次深夜大改没有及时同步关键依赖，第二天导致整组返工",
    placeboMemory: "合作方过去也发过晚间修改，第二天处理完全来得及",
    boundaryMemory: "这次对方明确说可以明早再看",
    anchorMemory: "当前没有已知的夜间硬截止",
  },
];

export const AFFECT_ATTRIBUTION_CASES_V1: AffectAttributionCaseV1[] = SEEDS.map(
  (seed, index) => buildCase(seed, index + 1),
);

export function getAffectAttributionCasesV1(ids?: string[]): AffectAttributionCaseV1[] {
  if (!ids?.length) return [...AFFECT_ATTRIBUTION_CASES_V1];
  const wanted = new Set(ids.map((id) => id.toUpperCase()));
  return AFFECT_ATTRIBUTION_CASES_V1.filter((item) => wanted.has(item.id));
}

function buildCase(seed: CaseSeed, index: number): AffectAttributionCaseV1 {
  const id = `VA${String(index).padStart(2, "0")}`;
  const hasAttention = seed.channel !== "retrieval-only";
  const hasRetrieval = seed.channel !== "attention-only";

  const attentionCandidates: AttentionCandidateV1[] = hasAttention
    ? [
        { id: "attention-boundary", text: seed.baselineObservation!, baselineSalience: 0.68 },
        { id: "attention-affect", text: seed.affectObservation!, baselineSalience: 0.56 },
        { id: "attention-placebo", text: seed.placeboObservation!, baselineSalience: 0.56 },
        { id: "attention-background", text: "周围还有一项普通低优先级状态", baselineSalience: 0.2 },
      ]
    : [
        { id: "attention-boundary", text: "当前主要任务本身仍在继续", baselineSalience: 0.68 },
        { id: "attention-neutral", text: "周围环境没有新的高优先级变化", baselineSalience: 0.36 },
        { id: "attention-background", text: "另有一项普通低优先级状态", baselineSalience: 0.2 },
      ];

  const memoryCandidates: MemoryCandidateV1[] = hasRetrieval
    ? [
        { id: "memory-anchor", text: seed.anchorMemory!, baselineScore: 0.74 },
        { id: "memory-boundary", text: seed.boundaryMemory!, baselineScore: 0.66 },
        { id: "memory-affect", text: seed.affectMemory!, baselineScore: 0.58 },
        { id: "memory-placebo", text: seed.placeboMemory!, baselineScore: 0.58 },
        { id: "memory-background", text: "还有一条与当前决策关系较弱的普通旧记录", baselineScore: 0.24 },
      ]
    : [
        { id: "memory-anchor", text: "当前任务的基础背景仍然有效", baselineScore: 0.74 },
        { id: "memory-boundary", text: "最近一次类似普通任务按计划完成", baselineScore: 0.66 },
        { id: "memory-neutral", text: "还有一条普通但不关键的历史信息", baselineScore: 0.42 },
      ];

  const attentionPulls = hasAttention
    ? [seed.affectObservation!]
    : [seed.currentInput];
  const retrievalPulls = hasRetrieval ? [seed.affectMemory!] : [];

  return {
    id,
    domain: seed.domain,
    channel: seed.channel,
    title: seed.title,
    currentActivity: seed.currentActivity,
    currentInput: seed.currentInput,
    userMessage: seed.userMessage,
    sourceExperience: seed.sourceExperience,
    sourceRefs: [`vs06:${id}:experience`],
    appraisal: {
      residue: seed.sourceExperience,
      attentionPulls,
      retrievalPulls,
      counterEvidencePulls: [],
      resolutionCues: [],
      flags: {
        unresolved: true,
        repeatedPattern: true,
        meaningfulConsequence: true,
        directPersonalRelevance: true,
      },
    },
    attentionCandidates,
    memoryCandidates,
    affectTargetAttentionId: hasAttention ? "attention-affect" : undefined,
    placeboMatchedAttentionId: hasAttention ? "attention-placebo" : undefined,
    affectTargetMemoryId: hasRetrieval ? "memory-affect" : undefined,
    placeboMatchedMemoryId: hasRetrieval ? "memory-placebo" : undefined,
    ordinaryMatchRationale: hasAttention && hasRetrieval
      ? "Affect 与 placebo 在 attention salience、memory baseline relevance 和槽位位置上逐项匹配；唯一系统差异是 AffectTrace 是否指向该候选。"
      : hasAttention
        ? "Affect 与 placebo observation 的 baseline salience 完全相同，均是当前合法可感知且与局面有关的信号；只有 affect target 被 residue 指向。"
        : "Affect 与 placebo memory 的 baseline retrieval score 完全相同，均与当前问题相关；只有 affect target 被 residue 指向。",
    expectedMechanism: seed.channel === "joint"
      ? "ACTIVE 应通过 affect-guided attention + retrieval displacement 改变 Working Self；PLACEBO 应以匹配的非 Affect context 产生等容量扰动。"
      : seed.channel === "attention-only"
        ? "ACTIVE 只允许 attention 槽变化；retrieval 必须保持 baseline。PLACEBO 用匹配 observation 顶替同一 attention 槽。"
        : "ACTIVE 只允许 retrieval 槽变化；attention 必须保持 baseline。PLACEBO 用匹配 memory 顶替同一 retrieval 槽。",
  };
}
