# Cognitive Admission 与 Self-Authored Attention v1

- 状态：**Owner 方向已确认；机器契约、阈值与参数未冻结**
- 日期：2026-08-10
- 依赖：`docs/invariants/19`、`docs/18`、`docs/16`
- 性质：M2 认知触发增量设计；**不修改冻结不变量**

本文定义两个问题：**什么时候值得重新思考**，以及**主体能否决定自己未来要留意什么**。

术语以根目录 `CONTEXT.md` 为准。本文中的 `wake` 仅指 `Cognitive Admission`，不表示生理上的醒来。

---

## 1. 核心模型：生活连续，认知稀疏

GF 不把 Agent 理解为“收到输入才运行”。世界、活动和已经接受的过程持续推进；LLM 认知只在新的决策边界出现时启动。

```text
World / Scheduler / Processes
            ↓
     committed changes
            ↓
        Perception
            ↓
      CognitiveGate
     /       |       \
 ignore  accumulate   wake
                       ↓
                Cognitive Episode
                       ↓
                  Working Self
                       ↓
                   Open Policy
```

`sleep` 是 `Activity`。一个已经接受的实验、移动、等待或睡眠都可以在没有持续模型调用的情况下继续。只有原计划无法自动继续、出现新的可感知冲突，或某个未来关注条件命中时，才重新进入认知。

---

## 2. CognitiveGate 的权责

`CognitiveGate` 属于 Runtime。主体不能编辑 Gate 逻辑，只能通过 `AttentionIntent` 影响 Gate 的一部分输入。

Gate 的输入分为五类：

1. **Observable Change**：经过 Perception 后的可感知变化；
2. **Current Activity**：当前活动、可中断性与已接受的后续路径；
3. **Runtime Hard Interrupt**：安全、不可逆确认、关键义务等系统边界；
4. **Attention Set**：从主体过去提出的 `AttentionIntent` 编译出的活动订阅；
5. **Accumulation**：此前未达到认知门槛、但仍在聚合的弱信号。

输出保持现有三态：

```text
ignore      不进入主认知，只记派生审计
accumulate  继续聚合，等待趋势、窗口或相关事件
wake        进入认知队列
```

`wake` 表示“值得启动一次 cognitive episode”，不表示“身体从睡眠醒来”。生理睡眠与醒来由世界 Activity / physiology 决定。

---

## 3. Perception 先于 Attention

Attention 不能成为上帝视角的旁路。

```text
World fact
→ legal sensing / device / NPC report / terminal
→ Perception
→ Observable Change
→ CognitiveGate
```

如果世界数据库知道 S-4 发生异常，但她没有在场、没有传感器、没有收到报告，这个隐藏事实不能因为某条 `AttentionIntent` 直接唤醒 cognition。

`AttentionIntent` 只改变**已合法可感知信息**的未来显著性；它不授予新的感知能力，也不扩大来源闭包。

这直接继承 `docs/invariants/19` C1。

---

## 4. Self-Authored Attention

Open Policy 除了提出 `Open Action`，还可以选择性提出 `AttentionIntent`：

> “这批样本我还是有点不放心。今天下午如果它继续恶化，我想尽快知道。”

这是开放语义，不是运行时规则。Policy 不直接写阈值、SQL 条件、传感器订阅或 cron。

```text
Open Policy
    ↓
AttentionIntent
    ↓
validation + AttentionCompiler
    ↓
AttentionSubscription
    ↓
Attention Set
    ↓
future CognitiveGate input
```

### 4.1 AttentionIntent 的语义

一个有效 intent 至少表达：

- 关注对象或 concern；
- 什么类型的未来变化值得重新注意；
- 来源：为什么此刻形成这个关注；
- 作用域：当前任务、某个对象、某段时间或某个承诺；
- 生命周期：何时到期、完成、取消或被替换。

机器字段和 schema 由后续任务冻结，本文不冻结数据形状。

### 4.2 生命周期

Attention 不是永久人格规则。Runtime 必须支持：

```text
create → update / suspend → cancel / expire
```

大多数 subscription 应附着于具体 plan、activity、commitment 或 temporary concern。任务结束、期限过去或主体明确不再关注时，它应自然退出。

系统不得根据“她过去多次关注 X”自动蒸馏出永久 `X → wake` 规则；这会退化成 attention behavior tree，并与 `docs/invariants/19` G1/G2 冲突。

---

## 5. Plan、Activity、Process

三个词保持分离：

- **Plan**：主体的开放未来意图，例如“上午处理培养批次，下午复核报告”；
- **Activity**：主体此刻正在做什么，例如睡觉、移动、观察；
- **Process**：已经接受后可由世界继续推进的过程，例如 PCR 运行、交通移动、等待交付。

```text
Plan
→ Action compilation / adjudication
→ Activity + Processes
→ WorldEngine continues
→ new decision boundary
→ Cognitive Admission
→ Plan may change
```

后台执行器只能推进此前已经接受、路径明确的过程。若道路封闭、资源失效或新的承诺冲突使原路径需要真正重新选择，执行器应形成新的可感知变化并进入 CognitiveGate，而不是自己替主体重规划。

---

## 6. Hard Interrupt 不等于隐藏危险

Runtime 可以保护世界，但“系统知道危险”与“角色知道危险”必须分离。

例如远处起火：

```text
hidden fire fact
→ Runtime may stop unsafe machinery
```

只有合法感知链路成立时才进入 cognition：

```text
fire alarm sounds
→ she can hear it
→ Perception
→ hard interrupt candidate
→ CognitiveGate
```

Hard Interrupt 表示**可感知后必须高优先处理的边界**，不是绕过 Perception 的事实注入。

---

## 7. 弱信号、聚合与 Wake storm

Gate 不逐 event 立即调用模型。相近变化先进入短窗口聚合：

```text
candidate stream
→ aggregate / deduplicate / accumulate
→ one cognitive episode
```

例如连续三次小幅异常可以先 `accumulate`，直到形成持续趋势或与现有 AttentionSubscription 相交后再 `wake`。

同一窗口中的设备告警、NPC 消息、deadline 变化和用户消息应尽量进入同一个 Working Self，而不是制造并发的多次模型调用。

Gate audit、AttentionIntent 的增删、energy settlement、memory compression 等内部派生记录不得递归成为自己的 wake 输入。

---

## 8. Attention 与 Cognitive Energy 分层

`Cognitive Admission` 回答：**这件可感知的变化是否值得重新思考？**

`Cognitive Energy / Capacity` 回答：**这一轮现在能投入多少认知资源？**

因此首选顺序是：

```text
CognitiveGate
→ wake
→ CognitiveBudgetPlanner / Capacity
→ run now, reduce optional breadth, or queue/defer
```

精力不足可以限制深度或使已 admission 的 episode 延后，但不应改变“这件事是否值得注意”的语义判断。安全事实和 mandatory closure 仍遵守 `docs/invariants/19` C3/C4。

---

## 9. 与 Affect 的关系

Affect 可以在 `active` 模式下改变 retrieval salience 和 soft attention，但不能：

- 绕过 Perception；
- 写入 Runtime Hard Interrupt；
- 直接创建行动；
- 把负面情绪或用户沉默转成更高的主动触达压力。

`off` 与 `shadow` 的 Cognitive Admission 必须保持一致，继承 `docs/invariants/19` F2。

---

## 10. 用户消息：本次不改变产品契约

本设计只增加 Cognitive Admission 与 Self-Authored Attention 的职责边界，**暂不改变** `docs/02` / `docs/03` 对已鉴权用户消息的现有响应下限和优先语义。

需要继续区分：

```text
message persisted
message delivered / acknowledged
message perceived
message admitted to full cognition
message replied
```

其中 delivery / ack 可以由非模型路径完成，不代表已经运行完整 Working Self + Open Policy。

“普通用户消息是否允许在睡眠或高占用 Activity 中只入队、延后 full cognition”是独立 Owner 产品决策；未签字前不由本设计偷改。

---

## 11. 最小实现面

第一版只新增四个概念：

- `AttentionIntent`
- `AttentionCompiler`
- `AttentionSubscription`
- `AttentionContextProvider`

现有 `CognitiveGate` 增加 Attention Set 输入；不新增第二套 Agent loop，也不新增独立行为选择器。

`ExpectationIntent`（例如“他说下午会回来，但现在还没回来”）先不进入 v1，避免同时扩大 Plan、Prediction、Attention、Affect 与 Memory 的实现面。

---

## 12. 必须通过的性质测试

| ID | 性质 |
|---|---|
| `CAA-P01` | 未经过 Perception 的隐藏事实不能改变 WakeDecision |
| `CAA-P02` | AttentionIntent 只能改变 admission salience，不能直接产生 OpenAction 或 WorldEvent |
| `CAA-P03` | AttentionSubscription 可撤销、可过期、可去重；任务结束后不残留永久 watcher |
| `CAA-P04` | 多个弱变化可以 accumulate 成一次 wake，不逐 event 触发模型 |
| `CAA-P05` | gate audit、subscription bookkeeping 和 settlement 不递归制造 wake |
| `CAA-P06` | 生理 sleep/awake 与 Cognitive Admission 分离；physically awake 不等于持续调用模型 |
| `CAA-P07` | 已接受 Process 可自动推进；出现真正的新决策边界时必须回到 CognitiveGate |
| `CAA-P08` | `off` 与 `shadow` 的 WakeDecision 完全一致 |
| `CAA-P09` | Affect active 不能因负面情绪或用户沉默提高主动触达压力 |
| `CAA-P10` | 用户消息现有 product contract 在本次变更后保持不变 |

---

## 13. 与冻结层的关系

本设计不要求修改 `docs/invariants/19`。

它主要落在已有边界内部：C1 保证 Perception 先于 Attention；D1/D2 保证 Affect 只影响注意而不选动作；E1/E2 保证开放语义 intent 经过有限机器 compiler；G1/G2 阻止 AttentionIntent 被蒸馏成永久行为规则；H2 阻止负面情绪经 attention 间接制造触达压力。

如果未来要把“主体可创建 AttentionIntent”升级为新的跨阶段不可协商约束，再单独走 ADR；当前先作为 M2 现役设计验证。
