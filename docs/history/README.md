# 历史迭代

本目录存放已退役的文档，**仅供追溯设计理由**。

两条规则：

1. **现役文档不得依赖本目录中的任何章节才能被实现。** 若某条历史论证仍然必要，把它搬进现役文档，而不是引用。
2. **不删除。** 被推翻的判断本身是项目的一部分——`docs/README` 的「八次废除」之所以有用，正是因为每一次的原始论证都还在。

---

## 索引

| 文档 | 曾经是什么 | 为什么退役 | 继任者 |
|---|---|---|---|
| `08-implementation-gap-checklist.md` | 从 spec 到代码的缺口清单 | 任务与状态改由任务板承载，本文的阶段判断已过时 | 根目录 `TODO.md` |
| `11-repair-plan-v1.md` | M0/M1 缺陷的修复顺序与验收门 | 同上；其 M0 完成定义仍有参考价值 | 根目录 `TODO.md` |
| `12-supplement-integration-review-v1.md` | 第一轮补充方案融合裁决 | 上下文不完整，多处误判 | `12-...-v2.md` |
| `12-supplement-integration-review-v2.md` | 第二轮全文重裁 | 其阶段修正已被 M1.1/M2.x 路线取代 | 根目录 `TODO.md`；**但 §6 仍有未处理项，见下** |
| `17-cognitive-wake-token-energy-v1.md` | 认知精力 v1，含人工疲劳投影器 | `CognitiveConditionProjector` 会把连续状态切成预制语义区间 | `cognition/18`；**账本、Wake、预留/结算、恢复机制被 18 完整继承** |
| `spec-contract-diff-v1.md` | 规范与机器契约的 25 条差异清单 | 其中 5 条已被 `invariants/19` §6 吸收 | 其余 20 条见下 |
| `framework-v1-superseded.md` | 技术方案 v1 | 双回路架构，被单一世界管线取代 | `cognition/02` |
| `framework-v2-superseded.md` | 技术方案 v2 | 同上 | `cognition/02` |
| `world-and-expression-v1-superseded.md` | 世界与表达 v1 | 被边界框架取代 | `product/04` |
| `companion-agent-docs-source-20260804.zip` | 最初的文档下载包 | 原始素材 | — |

---

## 退役但未处理的发现

以下条目**不是**因为被解决而退役，是因为承载它们的文档退役了。它们仍然成立，且当前任务板里没有对应任务。

### 来自 `12-...-v2.md` §6

| # | 发现 | 核对结果 |
|---|---|---|
| 6.1 | `relationship_threads` 的四值 `status` 枚举是第 4 次废除的复发；`reducers.ts` 里 `status` 为主、`open` 为派生，方向与规范相反；DDL 缺 `hook`/`stakes`/`current_state`/`needs_user`/`last_touched_event` 五字段，其中 `last_touched_event` 是联想采样未决度权重的唯一来源 | 属实 |
| 6.2 | 种子从未加载。`character/06` A1–A6 已定稿（4 地点、5 线索、5 物件、2 NPC、8 条创世日志、11 条 persona、完整采样配置），运行时用的是 `reducers.ts` 里的硬编码默认值；无 `seed_load` | 属实 |
| 6.3 | `surface-message.schema.json` 缺 `contact_reason`；连同 `intent_id`、`content_seed`、`base_state_revision` 共四项，与 `prompts/manifest.yaml` 声明的 8 个共享字段对不上 | 属实 |
| 6.4 | 观测层名不副实。`cognition/02 §10` 的 13 项健康指标当前可采集 0 项 | 属实（原文称「三个计数器」，实际 10 个埋点，与那 13 项无交集） |

### 来自 `spec-contract-diff-v1.md`

已被 `invariants/19` §6 吸收：A3（线索三形状）、A4（debt 双容器）、A7（surface-message 缺意图字段）、B5（S7 依赖倒置）、B11（文档失真，已修）。

仍未处理的，按严重度：

- **A11** `cognition/02 §2.2`、`08`、`product/10 §2` 三处要求 IM 事件在 payload 记 `crossworld: true`，而 `message-payload.schema.json` 的 `additionalProperties: false` 禁止任何额外字段。按现契约该标记写不进去。
- **A2** 显著度无载体。`world-event.schema.json` 与 `world_events` 表均无 salience 字段，而 `cognition/02 §1` 的 L2 门控与 §10 的「极端事件密度」指标都依赖它。
- **A4 连带** `policy.ts` 允许 debt 的 `close` 取值 `resolved`，`debt.schema.json` 的枚举里没有这个值。
- **A5** `channel_capabilities` 的 Day-0 键集合有四份不同版本（02 四项、06 五项、DDL 六项、reducers 六项）；且与 `product/03` 的 adapter 能力键名只有 `reaction` 重合，「取交集」无定义。
- **A6** `cognition/02 §3` 的 L3 输出结构与 `tick-proposal.schema.json` 不一致：`channels.speech` 在契约里拆成两项，规范列为「唯一保留的机制态」的 `owes_reply` 在契约里不存在。
- **A8** canon 的「物理隔离独立表」在 DDL 中不存在；`canonHits` 与 `memories` 在运行时从不传入 assembler。
- **A12** `prompt_runs` 表零引用；assembler 已算出 `promptHash`/`manifestHash`/`slotCharCounts` 但不落库；`modelId` 硬编码为 `"stub"`。
- **A13** `prompts/manifest.yaml` 的 `release_gate` 与 `dialogue_samples.status` 在代码中无执行者；`readSlot` 读不到文件时静默返回 null，装配静默降级而非 fail closed。
- **B1** `/mute` 与 `ack_always` 的交集未定义（`product/01 §5`、`product/04` 不变量 4、`cognition/02 §6`、`product/03 §2` 四处都没写）。
- **B2** `P50 < 5s` 与「完整生成 → 校验 → 落账 → 分段投递 → 失败整轮重生成」的串行链路不自洽；且「首个可见」在 01/02 指文本回复、在 03 可以是 reaction。
- **B3** 离线事件密度：`product/01` FR-05 写死 ≤2/日并进验收，`cognition/02 §3.5` 同节声明「不是运行时固定配额」。
- **B4** 空转率 20–40%、自引用比 < 20%、IN-3 周级配额等，是给涌现现象预设的刻度；而 `08 §1.5` 对采样常数已适用「先记录，后标定」。
- **B7** world_phase 集合规范 5 值、DDL 与 scheduler 6 值（多 `afternoon`）；时区在任何规范中无口径，实现落到 UTC。
- **B8** 回应档位已在 v3.4 解散，但 `character/09` A7 骨架与 `08 §1.2` 的覆盖要求仍按「闲着/手头有事/脱不开身」三档组织。
- **B9** reciprocity 单边饱和阻尼的落点三处措辞不一（StateManager 校验 / 纯函数+测试 / 未指定），当前均无实现。
- **B10** `product/04` 与 `product/10` 并行现役、待合并 boundary v3，而合并被绑在标为 M4 前置的 FR-E1 上。

### 未进入任何文档的运行时缺陷

三条阻断级，`TODO.md` 中无对应任务，且现有 19 个测试全绿也测不出：

1. **去抖无定时器**（`gateway.ts:80-91`）。单条消息永远不会被时间触发；而超过窗口后到达的行会被并进同一事件，窗口语义是反的。
2. **校验失败即丢消息并崩溃**（`engine.ts:113` 先入 scene、`:153` 才提交；`repositories.ts:54` 把「消息已入 scene」当作已消费）。`processOnce` 无 try/catch，异常会终止 REPL，且该事件已从待处理队列消失。
3. **outbox 卡在 `sending`**（`outbox.ts:75`）。崩在 `markSending` 之后的行永远停在 `sending`，而 dispatch 只捞 `pending`/`retry`，无 reaper、无退避、无死信。

另有五条应修项：幂等键随机生成（去重失效）、`proposal_hash` 用非规范序列化、`state_hash` 与落库文档对不上（无法用于重放校验）、`commitReply` 复用 `operation_kind='admin'`、`closureFromDb` 全库闭包（已有 `M11-003`）。
