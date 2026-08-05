# 实施缺口清单 · 从 spec 到可运行代码

现状：设计方向已经形成，但项目仍处于 **M0 Contract Freeze**。本清单列出落到代码还缺什么；执行顺序以 `11-repair-plan-v1.md` 为准，不能把本文件当作已经闭合的实现规范。

---

## 0. 总览

| 层 | 状态 |
|---|---|
| 机制设计 | v3.5 已自包含；Schema/DDL 合同已落地，待运行时集成与恢复测试证明 |
| 边界与交互 | 04/10 双文档现役；跨世界语义已收口，adapter 与消息管线代码未落地 |
| 种子内容 | A1 已对齐现役 S1；A7 待 Owner 定稿 |
| **Prompt 契约** | **5 个调用点、原生 role/active scene、严格 Schema、source closure 与 manifest 已冻结；缺真实 assembler、模型客户端和发送前事务的运行证明** |
| canon 语料库 | 三表与 fail-closed 构建已通过审计；运行期检索器和 Owner 持续策展仍待实现 |
| 数据 schema | v1 SQLite DDL 与 12 个 JSON Schema 已落地；migration runner、repository 与 reducer 代码未实现 |
| 算法细节 | 起步公式已写明；参数只可在 M2 真实数据与 dry-run 后标定 |
| 工具链 | 合同/canon/项目审计与图渲染已有；运行时初始化、加速模拟和观测端点未实现 |
| 决策与社会闭环 | 事实/信念/承诺与无全局 Utility 原则已定；通用 commitment 契约、候选仲裁日志与 S7 回放尚未实现 |
| 多模态 | 同 intent/state/source closure 与安全降级已冻结为后续不变量；M0 仍只实现文字 |

**一句话判断**：现在可以且应该进入 M1 最小运行时开发，但还不能宣称 M0 已退出或系统可上线。剩余门槛是 A7 Owner 定稿，以及真实 assembler、StateManager、事务/outbox、重放与恢复测试把已冻结契约证明出来。

---

## 1. M0 剩余门槛与 M1 实现合同

### 1.1 Prompt 契约（最高优先级）

> **状态（2026-08-05）**：`../prompts/manifest.yaml`、五份调用模板与 `../schemas/` 已冻结 active scene 原生 role、system/不可信数据隔离、严格输出、精确 source refs、state revision 和发送前提交顺序。仍缺真实 assembler、structured-output 客户端、独立语义检查、StateManager 事务与崩溃恢复证明；A7/S3 仍待 Owner 定稿。

**跨世界条款同样必须人工核对**：快段、tick、场景结算三份契约都要纳入 docs/10——博士本人及肉身始终在彼侧；当前 IM 是两位主体唯一持续、直接的通信，双向异步且 Day-0 仅文字；博士具身行动映射可在有来源的游戏／正史场景中交互，但不是第二人格、分身或本人肉身，场景外不自主行动；游戏任务后果只来自博士明确报告或可信系统事件；彼侧普通日常不得改写泰拉；“游戏/任务”是彼侧媒介名，不自动推出玩家/角色框架。

系统当前有五个模型调用点，各自已有独立契约；L4 出口判断与 canon 分拣属于确定性代码/离线语料管线，不伪装成额外模型调用：

| 调用点 | 输出形态 | 频次 | 备注 |
|---|---|---|---|
| 快段回复 | 完整纯文本 + 多气泡分段标记 | 高 | 人格主战场；发送前校验并事务落账，不先流式外发 |
| tick 推演 | 结构化 JSON | 中 | happened + claims + patch ops + communication intent/speech seed；不能直接发言 |
| 场景结算 | 结构化 JSON | 低 | 慢段记账 |
| 记忆压缩 | 结构化派生记忆 | 周级 | 只写可回源索引，不改事件账本 |
| 探针判官 | 结构化配对比较 | 双周 | 盲化顺序；确定性违规由代码判定 |

**装配顺序建议**（稳定在前，当下在后）：

```
system：通用契约 → 内核锚 → 世界硬规则 → A7 → 调用点输出契约
trusted context：persona → world_state@revision → 按需 world facts/canon/记忆 → 本轮触发
conversation：active_scene_tail（原生 user/assistant roles）→ 最新博士消息（user role）
```

两个理由：稳定 system 前缀可复用 KV cache；用户文本、记忆和外部素材保持数据/消息身份，不进入 system 指令区。最新消息位置靠后，但输出契约仍由 system 持有，不能被消息覆盖。

**体量以构建产物为准**：装配器对每个调用点输出 prompt hash、各槽位字符/token 数和最终模型 tokenizer 计数，不在文档复制易漂移总数。超长时先减少未命中的 world facts、generated/inferred 记忆和 canon 命中数，再压缩非关键 world_state 展示；S1、S2 硬规则、当前 state revision、active scene、最新消息与输出契约不得截断。A7 可做经测试的代表性采样，但不能无声截半轮对话。

### 1.2 A7 语料样例（你的活）

8–12 轮，需覆盖：不同投入度的回应各 2 轮、一轮欠账后的偿还、至少 1 轮分歧（建议落在内核锚第 3 条）、以及**被问起烦心事时的碎片式口述**（补丁 C2 已给示范段）。这是控制语域最有力的单一资产，比任何 prompt 指令有效。

### 1.3 数据 schema（DDL）

v1 DDL 已在 `../migrations/001_initial.sql` 落地，包含事件/消息/场景、operation commit、revision/state document、claim/patch/source、capability、relationship thread、debt、memory、speech、outbox/delivery 与 prompt run。实现不得依据本段重新发明表；以版本化 migration 为准。

向量层仍保持两套逻辑索引：运行时 memory 与独立 canon。是否采用同一底层扩展可以后定，但 namespace、来源、压缩和权限必须隔离；向量记录不是事实权威。

**跨世界字段不新增事件源或人物表**：
- 博士明确报告仍是 `origin=user`，可信自动事实仍是 `origin=system`；后者必须由 StateManager 验证 principal/connector/provenance，并用 `causation_event_id` 保留完整事件因果。只有实际由某条聊天事件触发时才指向该聊天事件，不能为过校验伪造聊天因果，也不能因模型输出自称 system 就获得信任。博士具身行动映射不得作为独立主体写入 `entities`，也不得拥有 persona、独立记忆或场景外自主行为。
- 涉及彼侧的事件在 payload 中记录 `crossworld: true`。只有原始 user 报告明确指向泰拉任务/选择，或 system 事件带可信 provenance 时，才允许派生 `lands_in_terra: true` 的 claim 并提交泰拉状态 patch；模型生成内容永远不能成为这一标记的来源。
- `world_state` 保存跨界终端的动态能力集合，Day-0 至少为 `{ "text": true, "image": false, "audio": false, "realtime": false }`。这是客观能力状态，不是“带宽等级”。
- `跨界终端` 与 `泰拉个人终端` 在文本和 schema 命名上分开；前者承接当前 IM，后者只是泰拉世界内设备。

**结算校验的三条断言**：
1. 无博士明确报告、无可信 system provenance → 拒绝任何声称由游戏任务造成的泰拉 patch。
2. 彼侧吃饭、工作、睡觉等普通日常 → 只能写 `doctor_disclosure/reported`，`lands_in_terra` 必须为 false。
3. canon 中与博士当面相处的内容 → 可归于同一位博士的具身行动映射；该场景中允许被看见、交谈和递交物件，但不得创建第二主体、分身、本人肉身或场景外自主行为。

**关键澄清**：**联想采样不需要向量**——它是基于元数据的加权抽样。向量只用于两处：记忆语义检索、canon 门控。两套机制别混在一起实现。

### 1.4 采样打分函数

```
score(item) = w_r · recency(item) + w_u · unresolved(item)
            + w_c · |charge(item)| + w_d · dormancy(item)
            + bias(item, 境遇/关系派生量)
sample ~ softmax(score / T)，refractory 内的对象硬过滤
```

异构对象先归一为统一记录：`{id, kind, text, ts, charge, open, assoc_tags}`。`unresolved` 对 threads 取 `open && 时间距离`，对其他 kind 取 0。

### 1.5 派生量与阻力函数

| 量 | 起步公式 | 备注 |
|---|---|---|
| reciprocity | 近 14 天她的主动发言被 30 分钟内回应的比例，EMA | 补丁 A |
| contact_density | 近 14 天有交谈天数 / 14，EMA | |
| disclosure_recent | observed 中标记披露的条数 | 需在场景结算时打标 |
| 开口阻力 | `base + k1·近N小时输出量 - k2·|mood_charge| + k3·max(0, neutral-reciprocity) + 性情常量` | reciprocity 只作低回应阻尼，中性值以上增益为 0 |

**原则：先记录，后标定。** 所有常数用最简单的线性起步，全量落 `sampling_log` 与 `speech`，跑两周后用真实数据回归。**预先拍常数是又一次"预设刻度"**。

**必须写进代码的断言**：低 reciprocity 区间越冷淡阻力越高；达到中性值后对 reciprocity 的导数为 0，既不反向召回，也不形成高回应正反馈。

### 1.6 mood_charge 充放电

由 L3 在 tick 输出中给出本次事件的 `valence`（连续，非三值）与 `intensity`；`mood_charge` 为带时间衰减的累加。分享后按补丁 B5 回落。衰减半衰期建议 12–24 小时起步，同样先记录后调。

### 1.7 初始化与观测

- `seed_load.py`：把 A1–A6 灌进 DB，创世日志写入 events（provenance: genesis）。
- `/status`、`/world` 的渲染实现（纯读，零模型调用）。
- 健康指标计算脚本：空转率、采样多样性、归因完整率、还账率，以及被跨世界校验拒绝的无来源 patch 数。**没有这层，世界跑起来你也看不见它在干嘛。**

### 1.8 失败处理

API 报错重试与降级、JSON 解析失败重掷（≤2 次）、部分写入回滚（StateManager 事务）、adapter 断线本地缓存。

### 1.9 通用承诺与决策回放（P1 契约，M0 只冻结边界）

现有 `debt` 只表示对博士“稍后回复”的通信欠账，不能承载她对 NPC、组织、工作或自身计划的义务。P1 需要独立 commitment 契约，至少含主体、对象、承诺内容、条件/期限、状态、source refs、履约/失信/解除事件与冲突引用。

决策日志不保存模型私有推理链，但必须保存：候选动作摘要、硬约束过滤原因、参与仲裁的承诺/关切来源、显式机会成本、最终意图和 World Engine 裁决事件。禁止把这些因素压成一个持久化全局 Utility，禁止把情绪映射成固定动作。

这项不是当前最小回复闭环的新增阻塞；它在阶段 2 接入，并以 PRD S7 作为出口测试。

---

## 2. 分阶段加速验证装置

多数验收标准要几百轮才看得出：空转率、采样多样性、200 轮后是否枯竭、漂移方向。按 1:1 真实时间要跑几个月。

**M1 必须先做 dry-run 骨架**：
- 跳过真实时间等待，按虚拟时钟批量推进 N 轮
- 跳过 IM 投递，输出写文件
- 可选跳过模型调用（用桩），单测纯逻辑
- 跑完输出基础统计：事件源分布、空转率、重复提交/投递、threads 变更与拒写原因
- 加三组跨世界回归：明确报告泰拉任务可落地；彼侧普通日常不改泰拉；无输入时模型不能自行生成“博士刚完成了某任务”

**M2 再扩展生活与决策回放**：
- 跑 200 轮，输出采样对象分布、重复事件率、threads、debt/commitment 与 persona_diff 统计
- 加一组最小因果生活回归：NPC 请求与既有承诺冲突 → 角色选择 → 有代价裁决 → 信念/安排变化 → 是否联系博士 → 博士回应成为证据 → 后续选择可观察变化

**M3 才做架构增益证明**：
- 同一冻结输入跑“完整世界运行时”和“同模型 Prompt+记忆、无离线世界裁决”基线；模型、角色资产、检索与 token 预算对齐

**收益**：把"跑三个月才发现设计有问题"压缩到一下午。冲动表被废除、阻力函数改连续量这类判断，都需要这个装置才能验证。这是整份清单里性价比最高的一项。

---

## 3. M1 之后

| 项 | 阶段 | 备注 |
|---|---|---|
| v1 统一文本 surface renderer | M1 实现、M2 启用主动 | M1 先服务 fast reply；tick 主动意图须到 M2 且通过 source closure/outbox/恢复门才接入 |
| 飞书 adapter | M2=P1 | 契约已定，按能力声明实现 |
| 通用 commitment、局部仲裁与 S7 | M2=P1 | 不倒灌成 M1 数据库之外的运行阻塞 |
| probes.yaml、主动发言审计与同模型基线 | M3=P2 | 指标只诊断，不优化响应率；S7 在 M2 可回放，M3 才做增益证明 |
| 第二平台 adapter | M3=P2 | 验证 adapter 契约通用性，不改变核心世界/关系 |
| 表达层（边界文档 FR-E 系列） | M4+ | 先有稳定的人再谈穿搭 |
| 多模态 communication plan / media renderers | M4 | 扩展既有文本 surface；共享 intent/state/source closure，不新增事实，失败回流并安全降级 |
| 世界母版工具、组织/资源、NPC 三档认知 | M5 | 普通日子和成本预算是出口条件；不做全量 LLM NPC |
| B/C 能力口 | 产品验证后 | 仅保留 external action 语义兼容；MVP 不实现资产/同步裁决/化身/位置/权限 |

---

## 4. 建议的实施顺序

**前置 · M0 Contract Freeze**
静态合同已通过，可以用已冻结 Schema/DDL 开始 M1。M0 只有在 A7 Owner 定稿且真实集成/恢复测试通过后才正式退出；在此之前不得上线或把试跑数据迁入长期世界。

**Day 1–2 · 最小可恢复闭环**
SQLite migration runner + 事件账本 + StateManager/reducer + 快段 active scene + v1 文本 surface + speech/outbox 原子提交 + CLI。先不做 debt 自动生命周期、persona 变更与记忆压缩。目标是看到第一句话，同时证明崩溃恢复不会丢消息或重复说话。

风险表里"你自己弃坑"是真实风险，尽早拿到体感比架构完整更重要。

**Day 3–7 · 补齐 M1=P0 世界管线**
补齐来源/跨世界/能力校验 → threads → 三类事件源 → 基础 scheduled/impulse tick → 最小 World Engine proposal → 无发言提交 → dry-run/恢复装置。通信 debt、persona 三闸、单边阻尼、通用 commitments、决策因素日志与复杂社会后果统一留到 M2，不倒灌成 M1 阻塞。

**M2 · 世界自主性与关系连续性**
接通信 debt/persona/分层记忆/阻尼与主动文本 surface → 飞书 → 通用 commitment/局部仲裁/World Engine 社会后果 → 200 轮 dry-run 与 S7 回放 → 真实节奏跑 7 天。此时才依据统计标定采样与阻力常数。

**M3 · 治理与增益证明**
完成 probes、主动触达审计、第二平台 adapter、换模演练，并运行同模型 Prompt+记忆基线与 S7 反事实盲测。

**之后**按 PRD 里程碑走。

---

## 5. 交给 Claude Code 时的建议

- **可以放手的**：schema、事件循环、StateManager、adapter、dry-run、观测脚本、统计。机制描述足够明确。
- **必须你把关的**：全部 prompt 文本、A7 语料、采样权重初值、阻力函数形状。这些是人格所在地。
- **喂 spec 的方式**：先给 `docs/README.md` 与 `11-repair-plan-v1.md`，再按主题给 01/02/03/04/10 与对应 Schema；本清单只是任务分解，06 是数据样例。不得省略权威顺序，也不得让实现者从示例反推契约。
- **提醒它**：本项目多次废除枚举与配额（见技术方案变更清单）。若它在实现中新增了任何"类别表""档位""每日上限"，都要回来确认——那大概率是同一个病的第五次发作。
- **再提醒一次术语**：通信是双向异步的；单边的是建联/扩容权，不是消息方向。跨界终端承接 IM，泰拉个人终端只是世界内设备；任何把两者混成一个 `terminal` 的实现都应打回。
