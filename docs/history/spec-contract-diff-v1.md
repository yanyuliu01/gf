# 规范差异清单 v1

生成日期：2026-08-07 ｜ 对照范围：`docs/01`–`docs/12`、`schemas/`、`migrations/001_initial.sql`、`prompts/manifest.yaml`、`src/gf/`

**本文性质**：只陈述差异，不做裁决、不给建议、不持有任何字段权威。每条列出各处的原文事实与差异点，由 Owner 决定哪一侧为准。核对方式为逐文件比对 + 运行时验证，不含推测；无法核实的项已剔除。

分两组：**A 组**是规范与机器契约（Schema / DDL / 实现）之间的差异，**B 组**是规范文档彼此之间的差异。

---

## A 组 · 规范 ↔ 机器契约

### A1 · WorldEvent 字段名

| 位置 | 内容 |
|---|---|
| `docs/02 §2.2` 示例 | `id`、`source`、`principal_id`（平铺）、`connector_id`（平铺）、`causation_id`、`arrived_at`、`salience_hint` |
| `schemas/world-event.schema.json` | `event_id`、`origin`、`provenance.principal_id`、`provenance.connector_id`、`causation_event_id`、`received_at`；无 `salience_hint` |

差异：七个字段名对不上，其中一个在 Schema 中不存在。`docs/02 §3` 顶部声明「本文必须自包含」，`schemas/README.md` 声明「不能从 Prompt 文本反推字段语义」，但 §2.2 的示例本身是旧字段名。

### A2 · 显著度（salience）无载体

| 位置 | 内容 |
|---|---|
| `docs/02 §1` 系统图、`§3` 第 2 步 | L2 门控「查预算/时段/世界状态合法性」 |
| `docs/02 §2.2` | 事件带 `salience_hint`，「user 事件默认高，但最终由 L3 在情境中判断」 |
| `docs/02 §10` | 健康指标「极端事件密度 = 高显著事件 / 全部已提交世界事件」 |
| `schemas/world-event.schema.json` | 无 salience 字段 |
| `migrations/001` `world_events` 表 | 无 salience 列 |
| `migrations/001` `memory_records` 表 | **有** `salience REAL CHECK (salience >= 0 AND salience <= 1)` |
| `schemas/tick-proposal.schema.json` | 有 `salience_self`（角色自身显著度，非事件显著度） |

差异：显著度只存在于记忆表和 tick 输出，不存在于事件本身。`§10` 的极端事件密度指标按现有契约无法计算。

### A3 · 线索 thread 有三种形状

| 位置 | 内容 |
|---|---|
| `docs/02 §2.3`、`docs/06 A3` | `{id, hook, stakes, current_state, open, needs_user, last_touched_event}`；明确「取消 status 四值枚举与 progress 阶梯」，`open` 是唯一布尔态 |
| `migrations/001` `relationship_threads` | `{thread_id, label, status CHECK IN ('open','paused','resolved','retired'), summary, privacy_scope, opened_by_operation_id, updated_by_operation_id, updated_at}` |
| `src/gf/state/reducers.ts:133-141` | 线索存在 `world_state.threads` JSON 内；`thread.status = value` 为主，`thread.open = value !== "resolved" && value !== "retired"` 为派生 |

差异三点：(1) 四值枚举出现在 DDL 与实现中；(2) 规范以 `open` 为主、实现以 `status` 为主，主从关系相反；(3) DDL 缺 `hook`、`stakes`、`current_state`、`needs_user`、`last_touched_event` 五字段，其中 `last_touched_event` 是 `docs/08 §1.4` 打分函数中 `unresolved` 权重的唯一来源。

补充事实：`relationship_threads` 表在 `src/` 中零引用（已 grep 验证）；实际使用的容器是 `state_documents.world_state.threads`。

（`docs/history/12-v2 §6.1` 已记录此项。）

### A4 · 欠账 debt：布尔 vs 枚举，且有两个容器

| 位置 | 内容 |
|---|---|
| `docs/02 §2.3` | 「欠账使用独立记录：至少包含 `debt_id`、来源消息/场景、承诺内容、created/due 时间、**open** 与 `repaid_by_event_id`」 |
| `schemas/debt.schema.json` | `status` 枚举 `['open','repaid','cancelled','expired']`，无 `open` 布尔 |
| `src/gf/validation/policy.ts:161-170` | `close` 操作的值必须 ∈ `repaid / cancelled / expired / **resolved**` |
| `migrations/001` `debts` 表 | 独立表，由 `stateManager.insertDebts()` 写入 |
| `src/gf/state/reducers.ts:148-165` | 另有 `world_state.debts` JSON 容器，由 `target:"debt"` 的 patch 写入 |
| `src/gf/prompts/assembler.ts:177-190` | `renderOwed()` 读的是 `world_state.debts`，判 `status === "open"` |

差异三点：(1) 规范用布尔 `open`，Schema 用四值枚举；(2) `policy.ts` 允许 `resolved`，该值不在 `debt.schema.json` 的枚举内；(3) 写入路径（`debts` 表）与读取路径（`world_state.debts`）是两个容器，代码中无同步逻辑——经运行时验证，仅提交 `debts_add` 时该欠账不会出现在快段 prompt 中。

### A5 · channel_capabilities 的 Day-0 取值有四份

| 位置 | 键集合 |
|---|---|
| `docs/02 §2.3` | `text, image, audio, files`（4 项） |
| `docs/06 A3` | `text, image, audio, files, realtime`（5 项） |
| `migrations/001` capability 种子 | `text, image, audio, files, reaction, realtime`（6 项，transport 与 diegetic 同值） |
| `src/gf/state/reducers.ts:36-43` | `text, image, audio, files, reaction, realtime`（6 项） |

附带差异：`docs/03 §1` 的 adapter 能力声明用的是另一套键名 `push_free / reaction / typing / segments / max_len`；`docs/03 §1` 末段与 `docs/10 §7` 要求「运输能力与 `world_state.channel_capabilities` 取交集」，但两套键名只有 `reaction` 重合，交集的计算规则无定义。

### A6 · L3 输出结构与 tick-proposal 契约

| 位置 | 内容 |
|---|---|
| `docs/02 §3` 第 4 步 | `{happened, channels:{act, monologue, speech, express}, owes_reply, world_state_patch, persona_patch, salience_self}` |
| `schemas/tick-proposal.schema.json` | `{happened, channels:{act, monologue, communication_intent, speech_seed, express}, claims, patch_ops, salience_self, valence, intensity, involves}` |

差异三点：(1) 规范的 `channels.speech` 在契约中拆成 `communication_intent` + `speech_seed`；(2) 规范列为「唯一保留的机制态」的 `owes_reply` 在契约中不存在；(3) 契约多出 `valence`、`intensity`、`involves` 三字段（`docs/02 §6` mood_charge 与 `docs/08 §1.6` 使用），`§3` 的输出清单未列。

### A7 · surface-message 缺通信意图三字段

| 位置 | 内容 |
|---|---|
| `docs/02 §6`「统一通信意图与多模态守恒」 | plan 必须绑定 `intent_id + purpose + content_seed + source_refs + base_state_revision + recipient/privacy + capability_revision` |
| `docs/03 §2`「多模态共享意图」 | 同上，措辞为「联系目的」 |
| `prompts/manifest.yaml` `communication_surface.semantic_plan.shared_fields` | `intent_id, purpose, content_seed, source_refs, base_state_revision, recipient_principal_id, privacy_scope, capability_revision`（8 项） |
| `docs/01` FR-10、PRD S3 | 每条主动消息可回溯到事件、有明确目的 |
| `schemas/surface-message.schema.json` | `schema_version, speech_id, operation_id, channel, recipient_principal_id, privacy_scope, capability_revision, authorization_decision_id, source_refs, bubbles`（10 项） |

差异：manifest 声明的 8 个共享字段中，`intent_id`、`purpose`（联系目的）、`content_seed`、`base_state_revision` 四项在 surface-message 契约中不存在。

（`docs/history/12-v2 §6.3` 记录了 `contact_reason` 一项；此处为完整比对结果。）

### A8 · 记忆检索层与 canon 表

| 位置 | 内容 |
|---|---|
| `docs/02 §2.4` | 四 namespace 权重 observed 1.0 / world 0.8 / inferred 0.5 / generated 0.3；检索配额默认 3/4/2/1；压缩每 50 事件或 7 天 |
| `docs/02 §2.4` canon 段 | canon「永不压缩、永不衰减、**物理隔离（独立表）**」；τ 门控，单轮 ≤2 片；τ_low < sim < τ_high 时降级浮出 |
| `migrations/001` `memory_records` | 有 namespace 枚举、salience/valence/intensity，**无权重列、无配额字段** |
| `migrations/001` 全表清单 | 无 canon 表；canon 仅以 `corpus/canon/*.jsonl` 文件形式存在（2758 条，`stats.md` 记 runtime-safe 2517 / quarantined 241） |
| `src/gf/` | `memory_records`、`memory_sources` 零引用；`assembler.ts` 的 `canonHits` 与 `memories` 参数在运行时从不传入（已 grep 验证） |

差异：canon 的「独立表」在 DDL 中不存在；检索配额与 τ 门控无契约落点；两类资产当前对运行时输出零影响。

### A9 · 联想采样配置无契约

| 位置 | 内容 |
|---|---|
| `docs/05 A6`、`docs/06 A6` | 池 + 4 权重 + 3–6 偏置 + refractory + express_gate |
| `docs/08 §1.4` | `score(item) = w_r·recency + w_u·unresolved + w_c·|charge| + w_d·dormancy + bias`；`sample ~ softmax(score/T)`；异构对象归一为 `{id, kind, text, ts, charge, open, assoc_tags}` |
| `docs/08 §1.5` | 「全量落 `sampling_log` 与 `speech`」 |
| `schemas/`、`migrations/001` | 无 action/sampling 相关 schema；无 `sampling_log` 表；无 `speech.jsonl` 对应表（有 `speech_records`，字段不含采样信息） |

### A10 · A3 种子的容器

| 位置 | 内容 |
|---|---|
| `docs/05 A3` | 要求地点 3–5、线索 2–4、物件 3–6 |
| `docs/06 A3` | 已定稿 4 地点、5 线索、5 物件、1 个 flag、channel_capabilities |
| `docs/06 A4`/`A5`/`A6` | 8 条创世日志、11 条 persona、完整采样配置 |
| `migrations/001` 全表清单 | 无 `locations`、无 `entities`；物件对应 `state_documents.inventory`，初值为空对象 |
| `src/gf/state/reducers.ts:28-49` | `EMPTY_STATE_DOCUMENTS` 为硬编码默认值：`location` 一个字符串、`presence: []`、`threads: {}`、`inventory: {}`、`persona.statements: {}` |
| `scripts/` | 只有 `render_architecture_diagrams.js` 与 `validate_project.py`，无 `seed_load` |

差异：`docs/08 §1.7` 列出的 `seed_load.py` 未实现；A3–A6 已定稿内容无对应容器。

（`docs/history/12-v2 §6.2` 已记录此项。）

### A11 · payload.crossworld 被 Schema 禁止

| 位置 | 内容 |
|---|---|
| `docs/02 §2.2` 示例 payload | `{text, crossworld: true, lands_in_terra: false, source_message_ids}` |
| `docs/02 §2.2` 正文 | 「普通 IM 原始事件恒为 true」 |
| `docs/08 §1.3` | 「涉及彼侧的事件在 payload 中记录 `crossworld: true`」 |
| `docs/10 §2` | 「**要补的客观元数据**：涉及彼侧的事件在 payload 中记录 `crossworld: true`」 |
| `schemas/message-payload.schema.json` | 属性仅 `message_id, sender_principal_id, reply_to_message_id, content`；**`additionalProperties: false`** |
| 全部 schema 中 `crossworld` 出现处 | 仅 `memory-compression.schema.json` |
| 全部 schema 中 `lands_in_terra` 出现处 | 仅 `claim.schema.json` |

差异：三份规范要求在 IM 消息 payload 中记录 `crossworld`，而 message-payload 契约以 `additionalProperties: false` 明确禁止任何额外字段。按现契约该标记无法写入。

### A12 · prompt_runs 与探针协议

| 位置 | 内容 |
|---|---|
| `docs/02 §5` | 探针需冻结 prompt hash、槽位快照、模型/供应商版本、温度、seed（若支持）与时间快照 |
| `prompts/manifest.yaml` `examples.golden_generation_rule` | 「记录 manifest/template/asset 哈希」 |
| `migrations/001` `prompt_runs` 表 | 存在，含 `operation_id` 索引 |
| `src/gf/` | `prompt_runs` 零引用 |
| `src/gf/prompts/assembler.ts:312-322, 361-371` | 已计算 `promptHash`、`manifestHash`、`slotCharCounts`，未落库 |
| `src/gf/prompts/assembler.ts:321, 370` | `modelId` 硬编码为字符串 `"stub"`，不取自 `InferenceClient.modelId` |
| `src/gf/inference/base.ts` 注释 | 「客户端必须锁定具体模型版本（never `latest`）以保证可复现」 |

### A13 · A7 / S3 的 release gate 无执行者

| 位置 | 内容 |
|---|---|
| `prompts/manifest.yaml` `role_assets.dialogue_samples` | `status: "required_before_release"`，无 `path` |
| `prompts/manifest.yaml` `communication_surface.required_inputs` | 含 `S3_dialogue_samples` |
| `prompts/manifest.yaml` `communication_surface.release_gate` | 「主动投递在 v1 文本 surface renderer 实现本接口并经 StateManager/outbox 提交前保持关闭」 |
| `src/gf/prompts/manifest.ts:39-46` | `roleAssetStatus()` 已实现 |
| `src/gf/` | `roleAssetStatus` 零调用（已 grep 验证） |
| `src/gf/prompts/manifest.ts:48-58` | `readSlot()` 在 `readFileSync` 抛错时 `catch` 返回 `null` |
| `src/gf/prompts/assembler.ts:226-231` | S3 为空时静默删除该段模板，不报错 |

差异：gate 在 manifest 中声明，代码中无检查点；且任一 slot 文件缺失或不可读时装配静默降级，不 fail-closed。

---

## B 组 · 规范 ↔ 规范

### B1 · /mute 与 ack_always 的交集未定义

| 位置 | 内容 |
|---|---|
| `docs/01 §5` | 「**/mute 绝对生效**：静音高于一切机制，包括欠账偿还（静音期欠账只积累不发送）。她的任何状态都不能绕过静音。」 |
| `docs/04` 不变量 4 | 「/mute 冻结全部出向端口，含 express」 |
| `docs/02 §6` 响应下限 | 「`ack_always`：默认 true。即便当下无力细说，也送出一个极简感知信号」 |
| `docs/03 §2` | 「这里的『不能纯沉默』只约束已经收到的 user 消息；没有 user 事件时，主动发言默认沉默仍然完全合法。」 |

差异：静音期收到 user 消息时是否发送 ack 信号，四处均未明确。当前实现（`src/gf/adapters/cli.ts:16-18` + `delivery/outbox.ts:33-35`）为 mute 拦截整批 outbox，即 mute 优先。

### B2 · 首个可见回应的 SLO

| 位置 | 内容 |
|---|---|
| `docs/01 §7`、`docs/02 §10` | 「user 消息到首个可见回应」P50 < 5s、P95 < 15s |
| `docs/01 §7` 同段 | 「回复需完整生成、校验和落账后再分气泡投递，不能为追首字而绕过边界」 |
| `docs/02 §3`「发送前提交」 | 完整回复经格式/能力/本体/隐私/来源检查 → 事务写 speech/claims/debts/outbox → adapter 才可投递 |
| `docs/02 §3` 同段 | 「若语义检查失败则**整轮重生成**，不能先流式送出再撤回」 |
| `docs/03 §2` 分段输出 | adapter 以 1–3 秒节奏发送 1–3 个气泡 |
| `docs/03 §2` 投入度映射表 | 「睡着/完全脱不开身」时首个可见物为 reaction，而非文本 |

差异：「首个可见回应」在 `docs/01`/`02` 指文本回复，在 `docs/03` 可以是 reaction；且完整生成 + 校验 + 事务 + 重生成 + 1–3s 分段节奏的串行链路与 P50 5s 的关系未在任何文档中核算。

### B3 · 离线事件密度：既写死配额又声明不设配额

| 位置 | 内容 |
|---|---|
| `docs/01` FR-05 验收标准 | 「离线 3 天回归无补课负担，期间事件 **≤2/日**」 |
| `docs/02 §3.5` | 「用户长时间离线时，L0 只投放低强度 scheduled 事件（**1–2 次/日**）」 |
| `docs/02 §3.5` 同节 | 「**显著度是预算，不是戏剧强度旋钮**……普通日子自然占多数，但这**不是运行时固定配额**」 |
| `docs/01` G1 | 「无交互时她的世界持续推进，可通过 /world 验证其自洽与**累积**」 |

差异：同一节内一处给出每日数量上限并写入验收标准，一处声明不设固定配额。

### B4 · 涌现指标的预设数值

| 位置 | 内容 |
|---|---|
| `docs/01 §8`、`docs/02 §10` | 空转率期望 20%–40%；记忆自引用比 < 20%；硬约束触发率 < 10%；对话归因占比异常低（< 15%）时人工审视 |
| `docs/history/12-v2 §5.4` | M1.5 出口条件「空转率落入 `docs/01` 规定的 20–40%」 |
| `docs/08 §1.5` | 「**原则：先记录，后标定。** 所有常数用最简单的线性起步……跑两周后用真实数据回归。**预先拍常数是又一次『预设刻度』**」 |
| `docs/README`「审计判据」 | 「这个枚举描述的是**客观事实**还是**主观/涌现现象**？后者一律拆」 |
| `docs/04 §4` 预算表 | P1 周级 1–2 次/周且要求 salience > 0.8；P2 ≤3 条/周；IN-3 周级配额 |
| `docs/04 §4` 待复核注 | 「表达层的周级配额是否同样应改为状态派生……暂予保留」 |

差异：采样常数已适用「先记录后标定」，健康指标与表达层配额未适用；`docs/04 §4` 自己标注了这一不一致但保留了配额。

### B5 · S7 的阶段依赖倒置

| 位置 | 内容 |
|---|---|
| `docs/01 §9`、`docs/02 §9` | S7（有代价的生活选择）是 **M2 出口条件** |
| `docs/01` FR-20（世界母版、组织/资源、分档 NPC 运行时） | 优先级 **P4** |
| `docs/05 A10` | 世界母版生活性要求标 **M5 扩展，不阻塞 MVP** |
| `docs/history/12-v2 §5.1` | S7 展开出 8 项工程前置，当前 0 项存在；其中 `entities`、`locations` 在原路线属 M5 |

差异：M2 的出口条件依赖被排在 M5 的能力。（`docs/history/12-v2 §5.2` 已记录。）

### B6 · 标记为 M0 的未决项数量

| 位置 | 内容 |
|---|---|
| `README.md`「当前状态」、`docs/11 §2` 尾段 | M0 未退出项为两项：A7 Owner 定稿、真实运行时集成/恢复测试 |
| `docs/01 §11` Q1 | 「产品代号与她的名字」，决策时机 **M0** |
| `docs/README`「当前未决问题」Q1 | 「产品代号」，决策时机 **M0** |
| `docs/04 §10` QE1 | 「变体集素材来源」，时机 **M0 前** |
| `docs/06`「留桩（你来补）」 | 需核对是否包含名字相关留桩 |

差异：导航层记两项，各主题文档合计标记 M0 的未决项为四项。

### B7 · world_phase 集合与时区口径

| 位置 | 内容 |
|---|---|
| `docs/02 §3.5` | 「world_phase 直接映射现实时段（dawn / morning / noon / evening / night）」——5 值，未指定时区 |
| `migrations/001:20` | `CHECK (world_phase IN ('dawn','morning','noon','afternoon','evening','night'))`——6 值 |
| `src/gf/scheduler/scheduler.ts:14-21` | 6 值，边界 5/8/12/14/18/21，判据为 `date.getUTCHours()` |
| `docs/02 §3.5` | 「附带收益：她的作息与你的现实昼夜自然对齐」 |
| `docs/06 A2 §2` | 作息与生活半径（含具体钟点，需 Owner 核对是否与 6 值边界一致） |

差异两点：phase 集合规范 5 值、契约与实现 6 值；时区在任何规范中均无口径，实现落到 UTC。

### B8 · 回应档位已解散，但资产结构仍按三档组织

| 位置 | 内容 |
|---|---|
| `docs/02 §3`「v3.4：解散回应档位」 | 「旧版把回应方式切成三个固定档，这是对连续量的人为分桶」 |
| `docs/01 §12` 术语表 | 「投入度（回应完整度，连续量，v3.5 起取消档位）」 |
| `docs/03 §2` 投入度映射表 | 三行：闲着 / 手头有事 / 睡着；标注「只是界面降级示例，不是三个运行档位」 |
| `docs/09` A7 骨架 | 轮 1「闲着，完整接话」、轮 2「手头有事，短应」、轮 3「脱不开身，极短回应 + 欠账」、轮 6「深夜，极短」 |
| `docs/08 §1.2` | A7 要求「不同投入度的回应各 2 轮」 |

差异：表述层已加免责声明，但 A7 语料骨架与 `docs/08` 的覆盖要求仍按三档组织。A7 尚未定稿，此项影响定稿形态。

### B9 · reciprocity 断言的落点

| 位置 | 内容 |
|---|---|
| `docs/01 §5` 伦理红线 | 「阻尼单调性（**代码断言**）……这条必须写进 **StateManager 校验**，不能只靠 prompt」 |
| `docs/02 §6` | 「该形状要写进**纯函数与测试**，不能只靠 prompt」 |
| `docs/08 §1.5` | 「**必须写进代码的断言**：低 reciprocity 区间越冷淡阻力越高；达到中性值后对 reciprocity 的导数为 0」 |
| `src/gf/` | 无 reciprocity 相关实现、无对应测试 |

差异：三处对断言的落点描述不同（StateManager 校验 / 纯函数 + 测试 / 未指定）；当前均无实现。属 P1/M2 范围，此处仅记录三处措辞不一致。

### B10 · boundary 双权威与合并时机

| 位置 | 内容 |
|---|---|
| `docs/04` 头部现役关系说明 | 「两者都现役……以 docs/10 为准。**FR-E1 前必须合并为 boundary v3**」 |
| `docs/10 §7`、`docs/README`「权威关系」第 4 条 | 同上 |
| `docs/04 §9` FR-E1 | 阶段标注 **M4 前置** |

差异：合并动作被绑定到 M4 前置的 FR-E1，而双文并行现役的查阅成本从 M0 起即存在。

### B11 · 文档状态失真

| 位置 | 内容 |
|---|---|
| `PROJECT-OVERVIEW.md`「当前阶段」 | 「StateManager、adapter、outbox worker、真实 Prompt assembler、模型客户端、dry-run 和观测工具**仍未实现**」 |
| `docs/11 §2` P0 表「快段上下文与提交语义」 | 「契约完成，**代码待阶段 1**」 |
| `README.md`「当前状态」 | 「**下一工程步骤**是 CLI + migration runner + StateManager + 单队列 + v1 文本 surface + 无发言 tick 的 M1 最小闭环」 |
| `README.md` 目录树 | 未列 `src/`、`package.json`、`tsconfig.json` |
| `README.md` 正文 | 「运行代码**后续**建在本目录下的 `src/`」 |
| git 实际 | `7cfe56c`「feat(runtime): TypeScript M1 runtime skeleton」、`ba232dd`「test(runtime): M1 contract, engine, gateway, and recovery tests」；上述项除观测工具外均已落地，19 项单测通过 |

（`docs/history/12-v2 §6.5` 已记录此项。）

### B12 · docs/history/12-v2 自身的生效状态

| 位置 | 内容 |
|---|---|
| `docs/history/12-v2 §8` | 「本文标『需并入』的条款在被对应权威文档吸收前**不生效**；实现者不得直接依据本文创建字段」 |
| `docs/history/12-v2 §8` | 「本文的阶段修正（§5.3、§5.4）需同步回 `docs/01 §9`、`docs/02 §9`、`docs/11 §3` 后才成为现役路线」 |
| `docs/README` 阅读顺序表 | 已列为第 12 项，状态「决策记录（v2 全文重裁）」 |
| `README.md` 正文 | 「要理解本次补充如何并入，读 `docs/history/12-supplement-integration-review-v2.md`」 |
| git 状态 | `docs/history/12-supplement-integration-review-v2.md` 为 **untracked**；`docs/history/12-...-v1.md → docs/archive/12-...-v1-superseded.md` 的改名已 staged 但未提交 |

差异：被两处导航引用、且自我声明未生效的 485 行裁决当前不在版本库内。

### B13 · 观测层要求与实际埋点

| 位置 | 内容 |
|---|---|
| `docs/02 §10` | 13 项核心健康指标（空转率、归因完整率、对话归因占比、响应延迟分布、欠账还账率、硬约束触发率、主动发言响应率、配对比较结果、记忆自引用比、承诺闭环率、模态新增事实率、世界模拟增益、极端事件密度） |
| `docs/08 §1.7` | 健康指标计算脚本：空转率、采样多样性、归因完整率、还账率、被跨世界校验拒绝的无来源 patch 数 |
| `docs/01 §8` 护栏指标 | 「全部来自技术方案 §10，**自动采集**」 |
| `src/gf/observability/metrics.ts` | 通用 Map 计数器，无指标定义 |
| `src/gf/` 实际埋点（grep） | 10 个：`user_messages`、`world_events`、`scheduled_events`、`ticks_committed`、`replies_committed`、`scenes_settled`、`tick_speech_seed_blocked`、`outbox_sent`、`outbox_failed`、`outbox_recovered` |

差异：10 个埋点与 §10 的 13 项无交集，护栏指标中「自动采集」当前可采集 0 项。

（`docs/history/12-v2 §6.4` 记录了此项，其中「三个计数器」的描述与实际 10 个埋点不符，结论一致。）

---

## 附：核对方法与未纳入项

**核对方式**：`docs/01`–`docs/12` 全文通读；`schemas/*.json` 用 Python 解析属性表；`migrations/001_initial.sql` 逐表比对；`src/gf/` 全量 grep 交叉引用；运行时行为经隔离副本实测（`npm test` 19/19 通过，`--dry-run` 可执行，`validate_project.py` 与 `validate_contracts.py` 均 OK）。

**未纳入本清单的类别**：

1. 纯实现缺陷（不涉及规范差异）——如去抖无定时器、outbox 卡在 `sending`、`state_hash` 与落库文档不一致等，共 8 项，已在会话中单列。
2. 已在 `docs/history/12-v2 §3` 裁决过、且裁决结论本身不构成差异的条款。
3. `corpus/` 内部的语料一致性——`audit_canon.py` 已覆盖且通过。
4. `docs/07`（场景补丁）与 `docs/09`（A7 骨架）中的角色语料内容——属 Owner 判断范围，非契约差异。
