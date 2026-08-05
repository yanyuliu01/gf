# 运行时机器契约 v1

本目录是模型输出与 StateManager 之间的**唯一机器契约**。文档中的 JSON 仅用于说明；运行时必须使用这里的 Schema 校验，不能从 Prompt 文本反推字段语义。

## 边界

- `world-event.schema.json`：进入事件账本的不可变信封。`provenance` 由 ingress 代码生成，模型无权声明自己可信。
- `claim.schema.json`：关于博士彼侧、泰拉后果或通道能力的显式主张。来源与真值分开记录。
- `patch-op.schema.json`：模型提出的状态变更。每项变更必须逐项引用证据，并携带预期 state revision。
- `capabilities.schema.json`：平台运输能力与世界内通道能力分开保存；有效能力由代码取交集。
- `debt.schema.json`：欠账是有来源、有期限、有状态的实体，不再只用一个布尔值表示。
- `tick-proposal.schema.json`、`scene-settlement.schema.json`：两个慢调用点的严格输出契约。
- `memory-compression.schema.json`：只生成可回源的派生检索索引，不得改写事件账本。
- `probe-judgement.schema.json`：盲化 A/B 判官输出；确定性门禁仍由代码执行。
- `surface-message.schema.json`：最终通信表层的收件人、隐私、能力快照与气泡契约。

## 信任模型

四个维度禁止混用：

1. `provenance`：内容从哪里来、由谁认证。
2. `epistemic_status`：它是报告、验证事实、推测还是生成内容。
3. `scope`：它描述博士彼侧、泰拉世界还是通道能力。
4. `privacy_scope`：它能进入私聊、内部状态还是第三方可见表面。

博士的普通消息是 `authenticated + reported`：可以证明“博士说过”，不能自动证明客观世界事实。明确的泰拉任务结果可以形成 `doctor_attestation`；系统桥接事实只有在 ingress 已验证 connector 与 principal 后才能标为 `verified`。

## 提交规则

模型只产出 proposal。提交前依次执行：

1. JSON Schema 校验；
2. 引用闭包校验（所有 source ref 必须属于本轮输入或合法来源闭包）；
3. allowed path 与 capability reducer 校验；
4. proposal 顶层的 `base_state_revision` 与每个 patch op 的 `expected_state_revision` 乐观并发校验；
5. 在同一事务中写入 event / claim / patch / debt / speech / outbox。

任何一步失败，proposal 整体不提交，也不得先向 IM 流式发送其中的文字。

## 已冻结语义、尚未进入 v1 Schema 的接口

- **通用 commitment**：`debt` 只表示“稍后回复博士”的通信欠账。角色对 NPC、组织、工作和自身计划的承诺将在阶段 2 进入独立版本化契约，至少携带主体、对象、条件/期限、source refs、状态与履约/失信/解除事件；不得复用 debt 冒充。
- **v1 文本 surface 已是当前契约**：`surface-message.schema.json` 在 M1 先约束被动回复的收件人、隐私、能力快照、来源与气泡；M2 的主动 tick 也必须经过同一文本 renderer、StateManager 与 outbox，不能等到 M4 才补这条路径。
- **多模态 communication plan**：版本化 plan 与 media renderers 到 M4 才进入机器 Schema。它是在 v1 文本 surface 之上扩展，不是重新建立出向管线；未来文字/语音/图像必须共享 intent、state revision、source closure 与授权，renderer 无事实写权且失败可安全降级。
- **B/C external action 扩展**：当前 `source_type=external_action` 只预留证据引用语义，不代表资产交换、同步裁决、化身、位置或权限已经实现。

这些语义用于防止当前字段把未来能力封死，但不构成 M0 运行实现要求；正式实现时必须新建版本化 Schema/迁移，不能向 v1 payload 偷加字段。
