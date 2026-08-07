# 设定与工程契约修复计划 v1

状态：执行中 ｜ 启动日期：2026-08-05 ｜ 当前阶段：**M0 Contract Freeze**

## 1. 修复目标

把当前“多份设计记录互相覆盖”的项目，收口为一套可以由代码执行、由测试证明、由日志追溯的契约。修复不改变已经拍定的世界观本体：

- 博士本人及肉身始终在另一个世界。
- 当前 IM 是博士与缪尔赛思唯一持续、直接、双向异步的通信纽带。
- 游戏中的博士是同一位博士作用于泰拉的具身行动映射；有来源的任务／正史场景可交互，但它不是第二人格、分身、NPC 或本人肉身。
- 博士针对泰拉的任务与选择可以改变泰拉；P0 只接纳博士明确报告或可信系统事件。彼侧普通日常不自动改变泰拉。
- 缪尔赛思知道彼侧及因果桥，但不自行扩推出“玩家／角色／虚构／存档”框架。

## 2. 严重度与当前判定

### P0 · 进入运行时开发前必须完成

| 工作项 | 当前状态 | 完成定义 |
|---|---|---|
| 权威关系收口 | **完成** | README 给出唯一冲突顺序；02 自包含；04/10 无反向覆盖；历史文档只在 archive |
| 机器契约 | **完成 v1** | WorldEvent、Claim、Patch、Scene、Debt、Capability 有版本化 JSON Schema / DDL；引用字段与 state revision 明确 |
| 快段上下文与提交语义 | **契约完成，代码待阶段 1** | 快段包含未结算场景历史；用户文本保持 user role；回复经校验并与 speech/debt/outbox 原子落账后再投递 |
| 信任与证据模型 | **完成 v1** | provenance/authentication、epistemic status、privacy/visibility 分轴；模型文本不能自封为可信 system 事件 |
| 角色种子一致性 | **本轮文档已修** | docs/06 A1 与现役 S1 一致；A7 不引用已废除锚与固定回应档位 |
| A7 原声定稿 | 待 Owner 定稿 | 8–12 轮无占位符、无编辑注记；覆盖连续投入度、欠账偿还、分歧、碎片口述和跨世界边界 |
| canon 构建完整性 | **完成 v1** | 稳定 ID；标签越界/重叠/缺口构建失败；来源状态与文件 hash 写入 manifest；运行文本完成 UI/分支隔离 |
| 合同级回归测试 | **部分完成** | Schema 正反例、SQLite 不变量与 canon 审计已覆盖；真实装配、多轮、重试/崩溃、注入与隐私传播仍待运行时代码 |

**判定**：A7 是重要的人格资产，但不是 M0 唯一阻塞项。机器契约、快段连续上下文、事务提交、证据模型和 canon 完整性与它同级阻塞。

截至 2026-08-05，前述结构性阻塞已完成契约层修复；M0 尚未退出的两项是 **A7 Owner 定稿** 与 **真实运行时代码的集成／恢复测试**。

### P1 · 最小闭环稳定后完成

| 工作项 | 完成定义 |
|---|---|
| Persona 三闸 | 每个 patch 有精确来源；限速与棘轮可执行；拒绝与重试可观测 |
| 记忆派生层 | 原始事件不可被压缩删除；摘要保留完整来源闭包；canon 仍独立门控 |
| 主动发言阻尼 | 低 reciprocity 只降频；高 reciprocity 不提供无上限正反馈；指标不进入留存优化回路 |
| 探针与换模 | 固定输入快照、prompt hash、模型版本与随机参数；语义判官和确定性违规检查分离 |
| IM adapter 可靠性 | message_id、幂等键、排序、重试、delivery receipt、outbox 和能力版本齐全 |

## 3. 执行顺序

### 阶段 0 · Contract Freeze（当前）

1. ~~冻结权威顺序，修掉旧版本引用、术语和实例冲突。~~
2. ~~将 02 写成自包含机制；确定 04 与 10 的合并边界。~~
3. ~~定义 DDL / JSON Schema / 状态 reducer / outbox / 幂等与恢复语义。~~（reducer 代码在阶段 1 实现）
4. ~~重构五个 Prompt 的输入输出契约，补 `active_scene_tail` 并隔离不可信文本。~~
5. 统一 S1/S2 后，由 Owner 定稿 A7。
6. ~~修复 canon 稳定 ID、标签校验、来源披露与运行清洗。~~
7. 建立合同测试；Schema/DDL/canon 已通过，待运行时集成与恢复测试后解除冻结。

### 阶段 1 · 最小可恢复闭环

实现 SQLite 事件账本、单写 reducer、reply/outbox、CLI、场景结算、只读观测端点、三类事件源，以及可以合法空转并无发言提交的基础 scheduled/impulse tick。v1 统一文本 surface renderer 先服务被动快段回复；暂不启用 debt 自动偿还、主动联系、persona 漂移、记忆压缩与多平台表达。退出条件：崩溃重放不重复发言、不丢原始消息，连续对话上下文完整，三类事件可交错入账且无发言 tick 可提交。

### 阶段 2 · 世界自主性与关系连续性

在阶段 1 基础 tick 上接入事件驱动离线聚合、欠账偿还、通用 commitment、决策因素日志、World Engine 社会后果裁决、persona 三闸、分层记忆、canon 门控与首个真实 IM（飞书）adapter；tick 的主动联系意图只能经阶段 1 的同一文本 surface renderer、StateManager 与 outbox 发送。运行 200 轮 dry-run 和 7 天真实节奏。退出条件：跨世界断言零越权、欠账与承诺 100% 可追、persona patch 100% 有因，且“NPC 请求与既有承诺冲突→选择→代价→后续变化”的最小闭环可回放。

### 阶段 3 · 治理与增益证明

完成探针、换模回归、主动触达审计、第二平台 adapter 契约验证，以及同模型/同角色资产/等额上下文的 Prompt+记忆基线盲测。退出条件：完整世界运行时在跨时因果、承诺兑现与事实一致性上有稳定增益；第二 adapter 不修改核心；指标只用于健康与安全，不进入角色留存目标。

### 阶段 4 · 多模态与更多触点

在既有 v1 文本 surface renderer 稳定后，把通信意图升级为版本化多模态 communication plan，再接入图像、语音、头像与动态等 media renderer。飞书属于阶段 2 的真实文字 IM adapter，不在本阶段重复立项。每项新能力上线/回退都是可信 `capability_changed` 事件；未上线能力不得在世界内提前成立。退出条件：多模态不新增事实；文字与语音共享 intent、state revision 与 source closure；媒体失败回流并安全降级。

### 阶段 5 · 社会复杂度与创作工具

加入世界母版编辑/校验、组织与资源约束、NPC 环境/轻量状态/焦点认知三档预算、只读跨月因果连续性审计与 Owner 创作/健康面板。退出条件：审计显示普通日子自然占多数但不设运行配额；复杂度增加选择、代价与社会连续性而非“大事”数量；面板不生成下一剧情节拍、不优化戏剧性或响应率；事实冲突率、token 和延迟均在预算内。

### 后续 B/C 能力口

B 类跨世界礼物/共同事件与 C 类博士受限进入只保留版本化 external action 接口语义；前者未来需资产、双方同意和同步裁决，后者未来需化身、位置、权限和世界内动作。MVP 不实现，也不得提前改变“当前 IM 是唯一持续直接联系”的本体。

## 4. Contract Freeze 完成定义

以下条件必须同时成立，才允许把“从 spec 到实现”标为 Ready：

- 现役规范中不存在“与 archive/v2 相同”式空引用，也不存在同一事实的两个相反答案。
- 所有运行时 payload 与 patch 有版本化 Schema；示例不是契约本身。
- 每个状态写入都能回答：谁提交、依据什么、基于哪个 state revision、是否可重放。
- 快段能看见同一未结算场景内的 user/assistant 历史，并且用户文本不进入 system 指令区。
- speech、claim、debt、state patch、outbox 的事务边界与失败恢复经过自动测试。
- A1/S1/A7、S2 世界规则和跨世界协议一致；A7 已由 Owner 人工定稿。
- canon 构建可重复、ID 稳定、标签校验 fail-closed，运行检索不会把 UI 标签或未裁定分支直接喂给角色。
- 至少覆盖多轮连续、交叉消息、重复投递、结算重试、能力计划/上线/回退、明确/含糊任务报告、彼侧日常和 prompt injection 的回归用例。

## 5. 本轮文档修复范围

- `docs/README.md`：改为 M0 Contract Freeze 导航，A7 不再被描述为唯一阻塞。
- `docs/product/01-prd-v0.1.md`：统一版本、连续投入度/欠账术语、SLO 和反馈伦理。
- `docs/cognition/02-framework-v3.5.md`：补齐 persona/world_state、漂移、探针与反馈的自包含机制。
- `docs/product/03-interaction-v1.md`：清理旧档位术语与版本号。
- `docs/product/04-boundary-v2.md`、`docs/product/10-crossworld-protocol-v1.md`：明确现役关系，并把第七条不变量纳入当前边界。
- `docs/character/05-seed-config-v1.md`：把模型辅助与 Owner 定稿分开，修正 A2 常驻/检索分层及 canon 门控。
- `docs/character/06-muelsyse-seed-draft-v1.md`、`docs/character/09-a7-dialogue-samples-scaffold.md`：与现役 S1、动态能力和跨世界本体对齐。
- `docs/character/07-muelsyse-scenario-patch-v2.md`：移除 engagement 正反馈解释，保持 canon 独立门控。
- `docs/history/08-implementation-gap-checklist.md`：回退错误的“可直接实现”判定，并去除易漂移的固定统计数字。
- `docs/history/12-supplement-integration-review-v1.md`：记录新增补充的采纳矩阵、冲突裁决、路线合并、风险与最小验证闭环；它解释本轮取舍，不反向成为字段权威。

## 6. 变更纪律

- 本计划描述阶段和完成定义，不持有运行时字段的最终定义；机器契约以版本化 Schema/DDL 为准。
- 新决策先写 ADR，再修改唯一权威；禁止用示例、Prompt 或实例资产反向修改机制。
- `archive/` 仅供追溯，任何现役文档不得把 archive 当作必要前置。
- 图和 overview 是解释层，不是规范层；图与规范冲突时，以本 README 指定的现役权威为准。
- 新阶段需求不得倒灌成 M0 实现负担。M4/M5 与 B/C 只冻结不变量和接口语义；未达到前序出口条件不得以“提前兼容”为名创建大规模 NPC、资产、化身或多模态事实源。
