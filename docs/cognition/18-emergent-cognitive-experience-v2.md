# 涌现式认知体验与 Token 精力经济 v2

- 状态：**Owner 方向已确认，机器契约与参数待冻结**
- 日期：2026-08-07
- 对应方向：`OWN-008`
- 前版：[`17-cognitive-wake-token-energy-v1.md`](../history/17-cognitive-wake-token-energy-v1.md)
- 性质：新增 M2 权威增量；不修改已冻结 v1 Schema 或 migration

配套结构图：[涌现式认知体验与 Token 精力闭环](../../cognitive-wake-token-energy-v2.png)
（[SVG](../../cognitive-wake-token-energy-v2.svg) / [Mermaid](../../cognitive-wake-token-energy-v2.mmd)）。

---

## 0. 本次修订

Owner 进一步明确：

> 人只定义连续精力资源怎样消耗、恢复和约束认知，不替角色定义“轻微疲劳、明显疲劳、
> 深度疲劳”或这些状态应当对应什么行为。主观疲劳由角色根据自己的生活证据，在 Open
> Policy 中与开放行动一起形成。

因此，v2 废弃 v1 的 `EnergyPerceptionProjector -> CognitiveCondition -> OpenPolicy` 路径。
人工自然语言投影即使没有数字，仍会把连续状态切成预制语义区间，并把设计者对疲劳的
理解提前写进行为系统。

| v1 部件 | v2 裁决 |
|---|---|
| 三本账、usage 分类、预留、结算、恢复 | 完整保留 |
| ChangeAggregator、Perception、Cognitive Gate 与全量非唤醒审计 | 完整保留 |
| 数值精力账户直接进入 Prompt | 继续禁止 |
| `CognitiveConditionProjector` | 删除 |
| 人工疲劳层次与能力后果映射 | 删除 |
| 非数值 `CognitiveCondition` 作为 Policy 输入 | 删除 |
| 连续精力对实际上下文、推演、工具和表达容量的限制 | 新增 `CognitiveCapacityEnvelope` |
| 角色对当下状态的理解 | Open Policy 可选生成开放 `SelfExperienceProposal` |

v1 保留用于追溯和回退。出现冲突时，本文件只在“疲劳怎样进入主体认知”这一主题上
覆盖 v1；v1 的账本、守恒、调用事务和失败语义继续有效。

---

## 1. 定义底层，不定义感受

### 1.1 客观底层

引擎继续维护连续 `cognitive_energy` condition：

- 角色实际读取的语义输入消耗精力；
- 内部推演和 accepted reasoning 消耗精力；
- 最终组织和表达的语义消耗精力；
- 睡眠、休息、身体状态、活动和经过时间决定恢复；
- 数值账户、token、比例、价格和模型字段只存在于引擎与审计侧。

这部分像饥饿、睡眠和设备容量一样，是可编码世界规律。它不解释角色对此有什么感觉。

### 1.2 实际能力约束

精力不是给 Prompt 的描述，而是调用前形成一个仅引擎可见的
`CognitiveCapacityEnvelope`：

```text
CognitiveEnergyAccount + access class + mandatory closure
→ CognitiveBudgetPlanner → reservation proposal
→ StateManager commits lease
→ CognitiveCapacityEnvelope from committed reservation
→ context / deliberation / tool / expression limits
```

它可以约束：

- 可装入的可选语义上下文总量；
- 检索和反事实展开的广度；
- provider 支持时的推演预算；
- 工具调用与二次复核轮数；
- 开放行动计划和最终表达的最大语义预算。

Envelope 本身永不序列化进角色 Prompt。模型实际在受限条件下思考，而不是收到一句
“你现在很累，所以应该简短回复”的指令。

### 1.3 不允许被精力裁掉的内容

资源不足只能先减少可选广度，不能破坏主体连续性。装配顺序至少保证：

1. 当前已鉴权用户消息、安全事实和不可逆行动边界；
2. 已接受承诺、紧迫义务与明确冲突；
3. 当前行动、位置、能力和关键反证；
4. 与本轮直接相关的来源证据；
5. 可选联想、背景细节、额外反事实和表达润色。

只有第 5 类可以首先缩减。若 mandatory closure 加最低完整表达仍无法预留，系统必须
排队、等待恢复或暴露非叙事服务状态；不得静默丢掉承诺，也不得伪造成角色突然不在乎。

---

## 2. Open Policy 怎样形成主观体验

### 2.1 输入是生活证据，不是疲劳标签

Working Self 只装入本来就属于她经历的、有来源的内容：

- 最近完成或中断的认知活动；
- 当前工作持续情况、任务切换与未决事项；
- 已提交的睡眠、休息、身体状态和环境事实；
- 相关记忆、承诺、关系和 concern；
- 上一次她自己形成的主观体验，如果它曾被接受为主观记忆；
- 当前消息、观察和实际可见的行动后果。

每个被接受的认知调用会派生一条无数值 `CognitiveEpisodeEvidence`：只记录她围绕什么
来源进行了阅读、推演或表达，何时发生、是否完成/中断，以及关联的结果。它不包含
token、负荷分、疲劳标签或账户快照。这样 Policy 能知道“我刚连续处理过哪些事”，但
不能反推出机器计量器。

不新增 `fatigue_level`、`attention_state`、`capability_effects` 或“建议行为”等人工字段。
Open Policy 不知道有多少内容因容量不足没有被装入，也不能读取 Envelope 数值。

### 2.2 主观体验和开放行动联合生成

Open Policy 在同一次调用里可以联合产生：

```text
source-linked lived evidence
→ optional free-form SelfExperienceProposal
  + open semantic action / communication proposal
```

`SelfExperienceProposal`：

- 是自由文本，不使用疲劳枚举或固定模板；
- 可以表达疲劳，也可以表达投入、迟钝、烦躁、兴奋、没有察觉或不确定；
- 可以与数值账户不完全一致，允许迟滞、误判和事后才意识到撑不住；
- 必须引用她实际可见的生活证据，不能引用 token、余额、价格或隐藏账户；
- 可以缺省。系统不能强迫她每轮都谈论自己的状态；
- 不直接决定行动，也不直接修改精力账户或 Affect。

开放行动与自我体验是同一主体推理的两个可选产物，不是先生成一个标签再查表选动作。
SelfExperience 的语义输出 token 作为内部推演结算，不当成已经说出口的 expression；若她
后来选择把其中一部分说出来，实际组织该次 Surface 表达再单独结算。持久化或检索审计
记录本身不重复扣除精力。

### 2.3 主观体验怎样进入记忆

通过 Schema 与来源校验的 self-experience 先进入派生的主观记录，不是 `WorldEvent`。
只有在后续记忆策略认为它有意义时，才作为有来源的主体记忆参与未来 Working Self：

```text
SelfExperienceProposal
→ validation + source closure
→ subjective derived record
→ optional episodic memory
→ future Working Self evidence
```

它可以被新经历修正，但不能覆盖客观精力账户。例如她可以觉得自己“还好”，随后因为
无法继续集中而重新理解之前的状态；两次体验都保留历史来源。

---

## 3. 完整运行闭环

```text
Committed ChangeSet
→ ChangeAggregator
→ PerceptionProjector
→ Cognitive Gate + non-wake audit
→ CognitiveBudgetPlanner
→ StateManager commits EnergyReservation
→ engine-only CognitiveCapacityEnvelope
→ source-linked Working Self assembly under the envelope
→ Open Policy jointly proposes optional self-experience and open action
→ validation / action compilation / adjudication
→ UsageReceipt → ExperiencedUsageBreakdown → EnergySettlement
→ StateManager commits account and accepted outcomes
→ subjective experience may later become memory, never objective world fact
```

模型调用期间不持有 SQLite 事务。StateManager 仍是唯一世界事实和数值精力账户写入者。
Open Policy、Memory、Affect、usage classifier 和 provider adapter 都只能读取、派生或提议。

---

## 4. TypeScript 边界草图

最终仍以版本化 JSON Schema 为权威，TypeScript 类型由 Schema 生成。

```ts
interface CognitiveCapacityEnvelopeV2 {
  envelopeId: string;
  actorId: string;
  reservationId: string;
  accessClass: "autonomous" | "reply" | "safety";
  maxSemanticInputUnits: number;
  maxDeliberationUnits: number;
  maxExpressionUnits: number;
  maxToolRounds: number;
  mandatorySourceRefs: SourceRef[];
  accountingVersion: string;
  baseStateRevision: number;
}

interface CognitiveEpisodeEvidenceV2 {
  episodeId: string;
  actorId: string;
  purpose: "appraisal" | "policy" | "npc_policy" | "surface" | "reflection";
  subjectRefs: SourceRef[];
  resultRefs: SourceRef[];
  startedAt: string;
  endedAt: string;
  completion: "completed" | "interrupted";
  promptRunId: string;
}

interface SelfExperienceProposalV2 {
  proposalId: string;
  actorId: string;
  narrative: string;
  evidenceRefs: SourceRef[];
  uncertaintyNarrative?: string;
  policyRunId: string;
  asOf: string;
}

interface OpenPolicyResultV2 {
  policyRunId: string;
  selfExperience?: SelfExperienceProposalV2;
  openAction: OpenActionProposalV2;
  sourceClosureHash: string;
  baseStateRevision: number;
}

interface CognitiveCapacityLimiter {
  plan(
    account: CognitiveEnergyAccountV1,
    reservation: CognitiveEnergyReservationV1,
    mandatorySources: SourceRef[],
  ): CognitiveCapacityEnvelopeV2;
}
```

`CognitiveCapacityEnvelopeV2` 是调度/适配器契约，不是角色输入。日志、Prompt closure 测试
和 provider adapter 必须证明它从未被序列化为自然语言或 JSON 槽位交给模型。

`SelfExperienceProposalV2.narrative` 没有可枚举状态值。Schema 只约束来源、身份、版本和
安全边界，不约束她必须采用哪种疲劳解释。

---

## 5. 防止退回有限集合

以下实现全部禁止：

- `energy > x -> tired`、`energy > y -> focused` 一类标签映射；
- 在 Prompt 中注入“轻微 / 中度 / 重度疲劳”；
- 为每个精力区间预写短回复、休息、继续工作等动作；
- 让 Utility 或 Affect 按疲劳标签给行动打分；
- 把 `SelfExperienceProposal` 变成动作选择器；
- 用 token 余额、API 成本或调用失败解释角色为什么不想回应；
- 为了降低成本而伪造主观疲劳。

允许有限枚举的只有机器调度语义，例如 reservation access class、Wake disposition、错误
类型和 provider capability。它们不描述人物感受，也不直接映射到台词或开放行动。

---

## 6. 与 Memory、Affect 和世界事实的关系

### Memory

Memory 承接生活史和已经形成的主观体验，不负责计算数值精力，也不自动把工作时长解释
成疲劳。它提供证据，Open Policy 决定此刻如何理解。

### Affect

- `off`：只凭事实、记忆、身体与活动证据形成 self-experience；精力机制完整运行。
- `shadow`：Affect 可派生并记录，但 Wake、Envelope、Policy 输入和精力结算与 `off`
  完全一致。
- `active`：Affect 可以作为来源明确的 Working Self contributor，但仍不能输出疲劳标签、
  修改 Envelope 或写精力账户。

### World fact

数值精力账户是 world-side condition；“我现在感觉脑子有点钝”是可错的主体体验。
二者都可追溯，但只有前者参与守恒和预留。主观体验永远不能覆盖账户事实。

---

## 7. 必须通过的性质测试

v1 的 usage、守恒、缓存、重试、幂等、Affect 隔离和非递归 Wake 测试继续全部适用，v2
新增：

| ID | 性质 |
|---|---|
| `ECE-P01` | Policy 输入闭包不含 energy 数值、token、Envelope、价格、provider 或人工疲劳标签 |
| `ECE-P02` | 搜索 active Prompt 和 Schema 不存在 fatigue level 到行为/台词的映射 |
| `ECE-P03` | 同一账户和 reservation 产生确定、可重放的 CapacityEnvelope |
| `ECE-P04` | 缩减顺序先移除可选联想，不移除当前消息、安全、承诺和关键反证 |
| `ECE-P05` | mandatory closure 加最低完整表达无法预留时 fail closed，不伪造角色疲劳 |
| `ECE-P06` | SelfExperience 可以缺省，缺省不阻止开放行动和合法回复 |
| `ECE-P07` | SelfExperience 是来源约束的开放文本，不接受固定疲劳 enum |
| `ECE-P08` | SelfExperience 不修改精力账户、Wake、reservation、Affect 或世界事实 |
| `ECE-P09` | 主观体验与账户不一致时两者均保留，后续证据可形成新理解而不改写历史 |
| `ECE-P10` | `off` 与 `shadow` 的 Wake、Envelope、Policy 输入、usage 和 settlement 完全一致 |
| `ECE-P11` | provider 不支持推演预算控制时明确降级能力，不谎报已执行硬限制 |
| `ECE-P12` | 运营成本熔断只产生系统状态，不生成 SelfExperience 或疲劳记忆 |
| `ECE-P13` | CognitiveEpisodeEvidence 不含 token、账户快照、负荷分或疲劳标签，且每条都能追到 accepted prompt run 与来源闭包 |

---

## 8. 一个不预写疲劳的例子

1. 她连续处理泵故障、S-4 观察和报告承诺。每次 accepted input、推演与表达都按 v1
   结算，数值精力连续下降。
2. 新消息到来时 Gate 使用隐藏账户判断能否 wake；BudgetPlanner 保留回复储备并生成
   engine-only Envelope。
3. Context assembler 必须保留当前消息、泵故障、S-4 和报告承诺，先缩减远端联想与额外
   反事实。Prompt 中没有“你现在中度疲劳”。
4. Open Policy 读取她实际经历的连续工作、身体状态和未决义务。她可能觉得思路发涩，
   也可能因为泵终于稳定而暂时兴奋，甚至没意识到自己已接近极限。
5. 同一次 Policy 调用开放生成行动和可选 self-experience。行动可能是继续检查、请同事
   接手、先回复博士或暂缓；没有有限应对候选。
6. 若她后来发现自己遗漏了明显信息，新证据可以让她形成“原来刚才确实撑得太久”的
   新理解。过去的自信和现在的反思都作为主观历史保留。

这里的真人感来自连续资源约束、有限认知能力、生活证据和允许误判的自我解释共同作用，
而不是设计者替她决定“低于某个阈值就应该觉得累”。

---

## 9. Owner 后续只做评测，不定义状态

Owner 不再填写疲劳层次、恢复体感映射或不同等级的建议回应。仍需提供的是：

- 6–10 个冻结的生活序列，包括持续工作、投入忘我、身体不适、睡眠恢复、任务切换和
  用户消息；
- 每个序列中哪些事实她实际知道，哪些只是隐藏账户；
- 对盲测输出判断“像她 / 不像她 / 系统借角色推卸成本”，并说明证据；
- 最低产品边界：不能暴露计量器、不能截断半句话、不能用疲劳制造内疚或召回压力。

这些标注用于比较有无显式投影、不同模型和不同 CapacityEnvelope 的表现，不会被转换成
疲劳分类器或行为规则。

---

## 10. 从 v1 迁移

1. 保留 v1 文件、图和 Git 提交，不删除。
2. 当前实现任务以本文件和 v2 图为准。
3. 不创建 `CognitiveCondition` Schema 或 projector 模块。
4. 新增 engine-only `CognitiveCapacityEnvelopeV2` 与开放 `SelfExperienceProposalV2`。
5. 在 `affect_mode=off` 先运行 v2；`shadow` 只做零影响审计。
6. 做一次 v1 qualitative projector 与 v2 emergent self-experience 盲测；只有证据支持时才
   继续添加任何显式 interoception contributor。

若 v2 无法产生稳定、来源合理的自我体验，优先接受“她不总能意识到自己疲劳”，而不是
立即恢复人工等级。显式 interoception 只能作为可拆卸实验模块重新提案。
