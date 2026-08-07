# 认知唤醒与 Token 精力经济草案 v1

> **历史版本**：本文的三本账、Wake、预留/结算与恢复设计仍被 v2 继承；人工
> `CognitiveConditionProjector` 已由
> [`18-emergent-cognitive-experience-v2.md`](../cognition/18-emergent-cognitive-experience-v2.md)
> 废弃。当前实现以 v2 为准，本文保留用于回退和对照实验。

- 状态：**Owner 方向已确认，参数与机器契约待冻结**
- 日期：2026-08-07
- 对应方向：`OWN-008`
- 依赖：`docs/13` 的开放 Policy / 可拆卸 Affect、`docs/16` 的可计算世界内核
- 性质：新增 M2 基线设计；不修改已冻结 v1 Schema 或 migration

配套结构图：[认知唤醒与 Token 精力闭环](../../cognitive-wake-token-energy-v1.png)
（[SVG](../../cognitive-wake-token-energy-v1.svg) / [Mermaid](../../cognitive-wake-token-energy-v1.mmd)）。

---

## 0. Owner 决定与设计结论

Owner 已明确：

> Token 是角色认知精力消耗的计量来源。思考和说话都需要消耗精力；角色能够感到
> 疲劳、注意力受限和恢复需要，但不能感知 token、余额、百分比或 API 成本等具体数值。

本设计据此采用以下结论：

1. **认知精力是世界资源，不是运营指标的拟人化文案。** 每次被角色实际经历的模型
   输入、推理和表达都产生可追溯的精力结算。
2. **精力不是 Affect。** `affect_mode=off` 时，认知精力、预留、恢复、唤醒与审计仍然
   完整运行；Affect 无权直接增减精力。
3. **精力不选择动作。** 它约束本轮能够投入多少认知容量，并把疲劳后果投影进
   Working Self；Open Policy 仍直接生成开放行动。
4. **角色不读取机器仪表。** 数值账户只供引擎、裁定和审计使用；Policy 只收到来源
   明确的非数值体感描述。
5. **账单不是世界事实。** 模型价格、缓存折扣、套餐限额和基础设施故障不改变角色
   精力；否则一次供应商涨价就会无因改变人格与生活状态。
6. **先预留、后调用、再结算。** 不允许模型调用完成后才发现精力已经透支，也不允许
   模型自行申报消耗。
7. **不逐微小 delta 唤醒。** 连续状态先聚合为有意义的已提交变化，再进入可感知性和
   Cognitive Gate；每次 gate 判定均可审计，包括未唤醒。

一句话：**模型 token 是认知劳动的计量来源；StateManager 把真实 usage 结算成世界内
精力变化；角色只体验劳动后的状态，不看见计量器。**

---

## 1. 三本账必须分离

### 1.1 Provider Usage + Billing：供应商与运营原始账

Provider adapter 记录供应商返回或本地 tokenizer 复核的原始数据：

- input / cached input / output / reasoning token；
- 模型、tokenizer、provider request、prompt run 和重试信息；
- 实际价格、折扣与币种；
- provider 尝试序号、完成/错误状态和原始请求关联。

这是不可变审计输入。语义结果是否合法由后续校验记录，不能让 provider adapter 自己
裁定。原始账既不是世界事实，也不能直接进入角色 Prompt。

### 1.2 Experienced Token Load：角色实际经历的认知负荷

原始 usage 按来源闭包拆为：

| 类别 | 是否消耗角色精力 | 说明 |
|---|---:|---|
| 当前 observation、消息、相关记忆、承诺和世界处境 | 是 | 她实际读取和理解的内容 |
| 开放计划、appraisal、内部推演和可用 reasoning token | 是 | 她实际进行的思考 |
| 最终 speech / communication plan 的语义内容 | 是 | 她实际组织和表达的内容 |
| 重复但本轮仍需注意的 cached semantic input | 是 | 缓存只降低账单，不代表她没处理信息 |
| JSON Schema、工具说明、序列化字段名和传输包装 | 否 | 运行时脚手架不是角色经历 |
| Provider transport 重试、超时重发和 SDK 遥测 | 否 | 基础设施故障不能使角色疲劳 |
| 因实现缺陷导致的格式修复重试 | 默认否 | 不能让工程 bug 变成世界后果 |

所有会进入角色精力的 token 必须能追到具体 prompt segment、source refs 和
`prompt_run_id`。没有分类证据的 usage 只能进入 billing audit，不能猜测性地扣除精力。

### 1.3 World-side Cognitive Energy：世界内精力账

只有被接受的 experienced load 才能通过版本化换算形成 reservation / settlement，并由
StateManager 改变角色的 `cognitive_energy` condition。它记录可用、预留、恢复与 revision，
但不保存价格，也不直接读取供应商缓存折扣。

三本账通过不可变 ID 单向关联：raw receipt -> experienced breakdown -> energy settlement。
任何一步都不能就地改写上一步，也不能拿运营金额反推角色疲劳。

### 1.4 Operator Billing Budget：非叙事控制面

运营侧仍保留月预算、异常调用告警、供应商熔断和费用上限，但它们是非叙事控制面：

- 价格变化不改变相同认知活动的精力消耗；
- 成本上限命中不能伪装成“她今天累了”；
- 服务不可用时记录系统故障并走恢复语义，不生成虚假的身体或关系原因；
- Owner/运维可以看见金额和 token，角色与 NPC 不可以。

---

## 2. 认知精力账户

### 2.1 世界语义

`cognitive_energy` 是 `condition` 类型资源：有上下界、可恢复、不可转账，属于角色本身。
它不同于：

- 身体能量：移动、睡眠、疾病和源石技艺等身体过程；
- 注意容量：某个时间区间能并行占用多少注意；
- Affect：事件留下的 valence/arousal/dominance 与残留；
- API 预算：Owner 愿意支付多少费用。

这些变量可以相互影响，但不能合并为一个总 Utility。v1 只允许已提交的身体状态和活动
影响恢复率；Affect 派生值既不能改变 token-to-energy 换算，也不能直接写账户余额。

### 2.2 状态与恢复

内部状态至少包含：

```text
CognitiveEnergyAccount = {
  available,
  reserved,
  capacity,
  protected_reply_reserve,
  recovered_at,
  recovery_model_version,
  revision
}
```

恢复由 TypeScript 纯函数按经过时间积分：

```text
available(t1) = min(
  capacity,
  available(t0)
    + integral(recovery_rate(physiology, sleep, activity), t0, t1)
)
```

- 睡眠和真正休息提高恢复率；
- 高负荷工作、身体不适和持续并行任务可以降低恢复率；
- 没有模型调用时不会凭 Prompt 需要扣精力；
- 离线追赶直接积分到当前时间，不逐分钟制造恢复事件；
- 恢复在账户读取、预留或结算时惰性物化，不为每个恢复增量创建 WakeCandidate；
- `available - reserved` 永不为负。

`protected_reply_reserve` 防止自主思考耗尽所有响应能力。它不是免费回复或每日配额：
用户消息产生的思考和表达照常结算，只是自主轮次不能预先占用这部分容量。

### 2.3 Token 到精力的版本化换算

不同模型和 tokenizer 对同一语义会产生不同 token 数，不能用未经校准的供应商数字
直接改变角色生活。精力消耗仍只来自 token，但需要版本化归一：

```text
experienced_load = normalize_v(
  semantic_input_tokens,
  deliberation_tokens,
  expression_tokens,
  model_id,
  tokenizer_version
)

energy_spent = accounting_v(experienced_load)
```

首版只允许透明、单调的线性或分段线性换算。权重表示读取、推演和表达的单位负荷差异，
不是人格参数；上下文、情绪或期望行动不得偷偷改变单位价格。换模型前必须使用冻结文本
集校准归一系数，使同一认知任务不会因为 tokenizer 改变就突然更累或更轻松。

数值系数由工程回放校准，不要求 Owner 填写小数。

---

## 3. Cognitive Gate：什么值得叫醒主体

### 3.1 Gate 之前先聚合变化

每个数值变化都是新状态，但不是每个数值变化都是认知事件：

```text
WorldEngine continuous deltas
→ ChangeAggregator
→ committed WorldChangeSet
→ PerceptionProjector
→ CognitiveGate
```

例如：

- 设备健康 `0.800 -> 0.797`：只更新 condition，不创建认知候选；
- 设备跨过维护阈值：创建带来源的 `maintenance_required` ChangeSet；
- 作物每小时增长：连续积分；
- 作物进入需要观察的新阶段：形成可感知 observation candidate；
- 普通工序完成且后续路径已预先接受：直接推进；
- 完成结果与承诺、资源或新机会相交：形成决策候选。

### 3.2 Gate 不读取完整 Working Self

`WakePredicate(worldDelta, workingSelf)` 会形成循环：为了判断是否值得思考，先完成了
最昂贵的记忆检索和主体装配。首版改用较轻的 `AttentionContext`：

- 已提交且可感知的 observation candidate；
- 当前活动与可中断性；
- 即将到期的承诺和明确冲突；
- 安全、权限和硬唤醒规则；
- 认知精力可用状态与已有预留；
- 来源明确的稳定 concern 激活，不读取自由生成的行动候选。

Affect 在 v1 不改变硬唤醒结果。未来若允许 active Affect 影响软注意，它必须作为可拆卸、
有上界的 contributor；`off` 与 `shadow` 的 gate 输出必须完全一致。

### 3.3 Gate 输出不是简单布尔值

```text
ignore      本候选不进入主认知；只保留 gate audit
accumulate  合并进背景观察，等待新的阈值、窗口或相关事件
wake        进入认知队列并预留本轮精力
```

硬唤醒至少包括：已鉴权用户消息、安全风险、需要主体接受/拒绝的新承诺、不可逆行动确认
和已到期的关键义务。用户消息优先但不抢占正在提交的操作。

精力不足可以让软候选从 `wake` 变为 `accumulate` 或延后，不能让硬安全事实消失，不能
把用户沉默解释为负面事件，也不能因为负面 Affect 提高主动联系压力。

### 3.4 未唤醒也必须可审计

每个进入 Cognitive Gate 的候选都写入独立 `wake_decision_audit`，包括 `ignore` 和
`accumulate`。它不是 `WorldEvent Ledger`：未唤醒是系统对已提交事实的派生判定，把它
写回世界账本会造成递归触发和事实污染。

审计至少保存：

- candidate / observation / source refs；
- disposition、queue lane、reason codes 和 matched rule IDs；
- energy snapshot hash；Wake 后另由 reservation 记录反向引用该 decision；
- gate / rule / parameter version；
- input closure hash、base revision 和时间；
- 可选 Affect contributor 是否计算、是否实际生效。

连续微变量没有形成候选时不逐点落审计；ChangeAggregator 保存区间摘要和边界证据。

---

## 4. 调用前预留与调用后结算

### 4.1 基本事务顺序

```text
WakeDecision(wake)
→ CognitiveBudgetPlanner 提议调用深度和最大语义 token
→ StateManager 原子创建 EnergyReservation + prompt_run shell
→ 事务外调用模型
→ Provider 返回 UsageReceipt + 语义 proposal
→ 校验 proposal、usage 和 source closure
→ StateManager 结算实际精力、释放未用预留并提交结果
```

模型调用期间不得持有 SQLite 事务。Reservation 带租约和幂等键；崩溃恢复后必须判断
provider request 是否已有 receipt，不能重复调用后双重扣除。

### 4.2 思考消耗

以下调用属于思考，只要形成了被角色接受的认知产物就结算：

- appraisal；
- Working Self 之后的开放 Policy；
- 需要模型参与的 NPC 决策；
- 对不可逆后果的反事实复核；
- 场景结算中真正形成角色记忆或信念的语义处理。

纯 TypeScript 世界推进、SQLite 检索和 Schema 校验不产生 token 精力消耗。检索结果被
装入模型并由角色读取时，其 semantic input token 才进入负荷。

行动后来被 Adjudicator 驳回不会返还思考精力：她确实尝试过。驳回理由进入行动审计，
可以成为未来记忆和策略证据。

### 4.3 说话消耗

Open Policy 产生 communication intent 后，Surface Renderer 必须预留表达预算。最终已
提交 speech 的语义输出 token 进入精力结算：

- 多个气泡合并计量，不能靠拆泡逃逸；
- 未通过校验、未提交且源于工程错误的废弃草稿默认不形成角色消耗；
- 角色主动删除、重写或斟酌过的草稿若被明确建模为认知行为，可以在未来版本计入；
- adapter 重试和同一 outbox 的重复投递尝试不再次消耗角色精力；
- 语音/图像未来只结算共享 communication plan 的认知与文字语义负荷，媒体算力另进
  billing audit，不能无依据折算成角色体力。

输出上限必须给完整句子留足空间，禁止在 token 边界直接截断台词。精力不足时应在
Policy 阶段形成较轻的完整表达、延后深入讨论或留下可履行的沟通承诺。

### 4.4 失败与重试

| 情况 | Billing audit | 角色精力 |
|---|---:|---:|
| 合法认知结果，行动随后失败 | 记录 | 结算 |
| Provider transport 超时并透明重试 | 记录每次 | 只结算最终被经历的一次 |
| Schema/序列化实现 bug 导致重试 | 记录 | 默认不结算废弃尝试 |
| 角色明确进行第二次反思 | 记录 | 两次都结算 |
| outbox 投递失败后重发相同内容 | 记录 | 不重复结算 |
| 调用被成本熔断阻止，未发生认知 | 记录系统故障 | 不结算、不伪造疲劳 |

---

## 5. 角色怎样感知精力但不知道数值

### 5.1 数值隔离

以下字段永不进入 Policy、Memory、Affect、NPC observation 或 Surface：

- available / reserved / capacity；
- token counts、tokenizer、provider request；
- 金额、单价、缓存折扣和成本上限；
- 剩余百分比、调用次数或“上下文窗口”。

管理员可以在非叙事诊断面板查看这些字段，但不能把它们拼进角色 Prompt。

### 5.2 Energy Perception Projector

Policy 只读取由确定性 projector 产生、有来源的 `CognitiveCondition`，例如：

> 她刚连续处理完一段复杂推演，注意仍能维持，但继续深挖会明显更费力；短而完整的
> 交流没有问题，新的长任务更适合稍后处理。

Projector 根据账户状态、最近消耗、恢复方向、当前身体和活动生成自然语言体感，不提供
数值标签。该文本描述能力后果，不替 Policy 决定“必须短回复”或“必须休息”。

角色可以自然地说自己累、需要缓一会儿或想先做完手头的事，但不能说：

- “我只剩 2300 token”；
- “这条回复太贵”；
- “你让我超预算了”；
- “因为你没回复，我的精力下降”。

### 5.3 记忆与精力

记忆保存她经历过长时间思考、疲劳、休息和恢复的事件证据，不复制当前数值余额。当前
余额由资源账户和恢复函数重建；记忆中的“当时很累”可以正确，也可以因主观视角不完整
而模糊，但不能覆盖引擎账户。

---

## 6. 与 Affect、Wake 和开放 Policy 的关系

```text
Committed ChangeSet
→ Perception
→ Cognitive Gate（可选 active Affect 只提供有界软注意证据）
→ Energy Reservation
→ Memory / Commitment / optional Appraisal-Affect
→ Working Self（只含非数值 CognitiveCondition）
→ Open Policy
→ Action / Communication Proposal
→ Adjudication
→ Usage Settlement + Outcome Commit
```

- `off`：没有 appraisal/Affect；token 精力照常预留、结算和恢复。
- `shadow`：Affect 正常计算并记录，但不能改变 Wake、预算或 Policy 输入。
- `active`：Affect 可影响 Working Self；是否允许其影响软 Wake 必须单独验收，不能默认
  开启。
- 任一模式下，相同已接受调用、usage receipt、账户状态和 accounting version 得到相同
  精力结算。
- Affect 不得成为“情绪越强就允许花更多 token”的自我强化回路。

认知精力让思考具有机会成本，但仍不计算 `U(action)`，也不把行动变成有限候选排序。
她怎样使用有限精力仍由具体事实、承诺、人格张力和开放 Policy 共同决定。

---

## 7. TypeScript 契约草图

以下只固定模块边界。最终以版本化 JSON Schema 为权威，TypeScript 类型由 Schema 生成。

```ts
type PromptSegmentPurpose =
  | "observation"
  | "memory"
  | "commitment"
  | "working_self"
  | "deliberation"
  | "expression"
  | "runtime_overhead";

interface TokenSegmentUsage {
  segmentId: string;
  purpose: PromptSegmentPurpose;
  tokenCount: number;
  experienced: boolean;
  sourceRefs: SourceRef[];
}

interface InferenceUsageReceiptV1 {
  receiptId: string;
  promptRunId: string;
  providerRequestId: string;
  modelId: string;
  tokenizerVersion: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  attemptOrdinal: number;
  completionStatus: "completed" | "transport_error" | "cancelled";
  usageSource: "provider" | "local_tokenizer" | "versioned_estimate";
}

interface ExperiencedUsageBreakdownV1 {
  breakdownId: string;
  usageReceiptId: string;
  promptRunId: string;
  segments: TokenSegmentUsage[];
  attemptClass: "accepted_semantic" | "transport_retry" | "runtime_repair";
  classificationVersion: string;
  inputClosureHash: string;
}

interface CognitiveEnergyAccountV1 {
  actorId: string;
  available: number;
  reserved: number;
  capacity: number;
  protectedReplyReserve: number;
  recoveredAt: string;
  recoveryModelVersion: string;
  revision: number;
}

interface CognitiveConditionV1 {
  actorId: string;
  summary: string;
  capabilityEffects: string[];
  recoveryOrientation?: string;
  sourceRefs: SourceRef[];
  projectorVersion: string;
  asOf: string;
}

interface CognitiveEnergyReservationV1 {
  reservationId: string;
  actorId: string;
  promptRunId: string;
  purpose: "appraisal" | "policy" | "npc_policy" | "surface" | "reflection";
  maxNormalizedTokenUnits: number;
  accessClass: "autonomous" | "reply" | "safety";
  baseStateRevision: number;
  accountingVersion: string;
  expiresAt: string;
  idempotencyKey: string;
}

interface CognitiveEnergySettlementV1 {
  settlementId: string;
  reservationId: string;
  usageReceiptId: string;
  experiencedBreakdownId: string;
  normalizedTokenUnits: number;
  energySpent: number;
  releasedReservation: number;
  accountingVersion: string;
  sourceRefs: SourceRef[];
}

interface WakeCandidateV1 {
  candidateId: string;
  actorId: string;
  committedRevision: number;
  observationRefs: SourceRef[];
  boundaryKind: string;
  occurredAt: string;
}

interface AttentionContextV1 {
  currentActivityRef?: SourceRef;
  interruptibility: "none" | "lossy" | "safe";
  commitmentRefs: SourceRef[];
  safetyRuleRefs: SourceRef[];
  cognitiveEnergySnapshotHash: string;
}

interface WakeDecisionV1 {
  decisionId: string;
  candidateId: string;
  disposition: "ignore" | "accumulate" | "wake";
  queueLane: "background" | "next";
  reasonCodes: string[];
  matchedRuleIds: string[];
  gateVersion: string;
  inputClosureHash: string;
  baseStateRevision: number;
}

interface CognitiveGate {
  evaluate(
    candidate: WakeCandidateV1,
    context: AttentionContextV1,
  ): WakeDecisionV1;
}
```

`reasonCodes` 和 `queueLane` 是客观调度/审计语义，可以有限枚举；它们不是开放行动候选，
也不能直接映射为台词。

---

## 8. 持久化与模块边界

建议新增而不修改 `001_initial.sql`：

```text
inference_usage_receipts     原始 provider/local token usage，不可变
experienced_usage_breakdowns segment、purpose、source refs、experienced 标记与分类版本
cognitive_energy_accounts    当前 condition 账户与 revision
cognitive_energy_reservations 调用前预留、租约与幂等键
cognitive_energy_settlements 实际结算和 accounting version
wake_candidates              有意义事件边界产生的候选
wake_decision_audit          包含 ignore/accumulate/wake 的全部 gate 结果
```

写入权：

- Provider adapter 只能返回 usage receipt proposal；
- Usage classifier 只能从 raw receipt 提出 experienced breakdown；
- Token accounting 只能从 accepted breakdown 提出 settlement；
- Cognitive Gate 只能提出 wake decision；
- 只有 StateManager 可以提交账户、预留、结算和正式认知事件；
- billing audit 可由 observability 落库，但不能反向写世界状态；
- `wake_decision_audit` 和 inference audit 是派生/审计数据，不伪装为客观世界事件。

建议模块：

```text
src/gf/cognition/wake/       aggregator, gate, audit port
src/gf/cognition/energy/     account, recovery, reservation, settlement, projector
src/gf/inference/usage/      provider receipts, segment accounting, normalization
src/gf/observability/billing non-diegetic price and operator budget
```

---

## 9. 必须通过的性质测试

| ID | 性质 |
|---|---|
| `CE-P01` | 任何提交后 `available >= 0`、`reserved >= 0` 且 `available - reserved >= 0` |
| `CE-P02` | 相同账户、receipt、来源分类和 accounting version 得到字节级一致结算 |
| `CE-P03` | 改变 API 单价、折扣或币种不改变角色精力结算 |
| `CE-P04` | cached semantic input 仍计认知负荷；cache billing 折扣不改变该负荷 |
| `CE-P05` | transport retry、SDK 重发和实现修复不产生重复角色消耗 |
| `CE-P06` | Adjudicator 驳回不返还已发生的合法思考消耗 |
| `CE-P07` | outbox 重试同一已提交 speech 不重复消耗表达精力 |
| `CE-P08` | raw token、余额、比例、价格和 provider 字段永不进入 Policy/Surface 输入闭包 |
| `CE-P09` | `affect_mode=off/shadow` 的 Wake、预算和结算结果完全一致 |
| `CE-P10` | Affect 表删除或关闭不损坏精力账户、预留、结算、Wake 或恢复 |
| `CE-P11` | 每个 WakeCandidate 恰有一个可重放 decision audit，包括非 wake 结果 |
| `CE-P12` | Wake audit、精力结算和惰性恢复不生成独立 WakeCandidate，不形成递归唤醒 |
| `CE-P13` | 离线聚合恢复与逐事件边界恢复在同一时间点得到相同账户状态 |
| `CE-P14` | 模型/tokenizer 切换使用冻结校准集；超出容差则禁止静默切换 accounting version |
| `CE-P15` | 用户消息使用保护预留但仍正常结算；自主轮次不能占用保护部分 |

---

## 10. 一个完整例子

1. 泵健康连续下降只更新 condition，没有逐点唤醒她。
2. 泵跨过维护阈值，WorldEngine 提交 `maintenance_required` ChangeSet。
3. PerceptionProjector 判断她在生态园且能获知该告警，生成 WakeCandidate。
4. Cognitive Gate 发现维护会占用 S-4 观察窗口，并与她已接受的报告承诺冲突，输出
   `wake`；该决定和一次认知精力预留同时提交。
5. Policy 调用读取告警、承诺、相关记忆和非数值体感。她不知道账户余额，只感到自己
   刚处理完长会议，继续推演会更费力。
6. Provider 返回合法 OpenActionProposal 和 UsageReceipt。StateManager 根据实际
   semantic input、deliberation 和 plan token 结算思考精力，释放未用预留。
7. 她决定先让研究员保留仪器预约，自己检查备用泵，再晚些回复报告。Adjudicator 计算
   路径、容量和实际后果；无论行动成功与否，第 6 步的思考消耗都不会退款。
8. 她若联系博士，Surface Renderer 另做表达预留；最终提交的消息 token 再结算表达精力。
9. 夜间休息按时间积分恢复。第二天她记得昨天处理得很费神，但不知道“用了多少 token”。

这个闭环使 API 成本对应真实的认知机会成本，同时避免角色拿运营仪表解释自己的生活。

---

## 11. 参数冻结与后续实验

Owner 已决定语义方向，不需要填写 token-to-energy 小数。工程侧下一步需要：

1. 用 20–30 个冻结任务测量不同模型/tokenizer 的 input、reasoning 和 expression usage；
2. 标记哪些 prompt segment 是角色实际经历，哪些是 runtime overhead；
3. 先在 `affect_mode=off` 下校准恢复、预留和完整表达下限；
4. 比较结构化状态注入与等价自然语言注入的 usage、行动质量和疲劳轨迹；
5. 再运行 shadow Affect，证明它不改变 Wake 或精力预算；
6. 只有 active Affect 有稳定纵向增益时，才讨论它是否可影响软注意。

仍需 Owner 用自然语言确认的只有：

- 她连续深聊后多快出现可感知疲劳才像本人；
- 睡眠、独处、普通工作和高压会议的恢复相对快慢；
- 哪些用户场景即使疲劳也必须保留完整、诚实的最低响应；
- 她会怎样自然描述“想缓一会儿”，哪些说法明显像系统在借角色推卸成本。

这些输入用于标注相对体感和验收样例，不要求 Owner 接触账户数值或供应商 token 表。
