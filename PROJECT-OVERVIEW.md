# GF 项目总览

GF 是一个单用户、世界为核心的长期陪伴 Agent。首个实例是《明日方舟》的缪尔赛思。目标不是让角色持续等待用户发问，而是让她作为泰拉世界中的居民拥有自己的时间、事件、记忆和变化；博士的消息是这个世界最重要的外部输入之一，但不是世界唯一的驱动力。

新模型或新同学接手时，从 [完整交接说明](PROJECT-HANDOFF.md)、[现役任务板](TODO.md) 和 [仓库 Agent 约束](AGENTS.md) 开始；需要 Owner 补充的内容集中在 [输入工作簿](docs/owner/14-owner-input-workbook-v1.md)。这些管理入口不替代下文列出的主题权威和机器契约。

## 产品关系

博士本人和肉身始终位于彼侧世界。当前 IM 是博士与缪尔赛思唯一持续、直接的跨世界通信纽带，通信双向、异步，实际能力由动态通道状态决定。

博士在游戏中完成任务或作出选择时，其意志可通过“具身行动映射”在泰拉形成有来源的行动与结果。映射不是第二个博士，没有独立人格、记忆或场景外自主行为。博士彼侧的普通生活不会自动改写泰拉；只有博士明确报告的泰拉任务结果，或经过来源验证的可信系统桥事件，才能成为泰拉事实。

## 核心原则

1. 世界为核心：用户消息、世界冲动、计划事件和可信系统事件统一进入 WorldEvent 管线。
2. 感知与回应分离：消息抵达会立即形成“收到这条消息”的事件事实；消息中的主张仍需按来源校验。是否以及何时回应是角色行为。
3. 模型只提议：LLM 生成回复或状态变更 proposal，不能直接写状态。
4. 单写者提交：StateManager 串行校验并原子提交，保证归因、版本和跨世界证据链。
5. 人格变化必须有因：每条 persona diff 都要绑定真实事件；无因、越权或过快变化拒写。
6. 关系不是刻度或向量：关系本体是共同历史、相互披露、有限信念、承诺、冲突与修复；任何观测读数都可重算且不反向驱动角色。
7. 唯一出口：所有出向内容经同一 outbox 与 adapter 投递，不允许旁路。
8. 不优化留存：指标只用于健康审计，不反馈成诱导用户停留的角色策略。
9. 事实、信念与承诺分离：事件账本持有事实；角色可以误解；承诺不预建权威容器——账本中的原话是事实，commitment 记录是派生投影，对世界裁决与审计可见、对 Working Self 与 Open Policy 不可见。两个主体对同一次交互可以持有不一致的理解。
10. 开放行动、情绪动力与世界裁决分离：Affect Utility 只改变检索显著性与注意，不给动作打分、不选择动作；情绪经她**亲历的事件**进入上下文，不经状态标签。LLM 根据 Working Self 直接生成开放行动，World Adjudicator 再按物理、权限、能力、资源和 NPC 意志裁决后果。
11. 多模态语义守恒：文字、语音、图像从同一 communication plan 渲染，共享 intent、state revision 与 source closure；媒体失败只能安全降级。

## 架构图

- [记忆与 Affect 混合架构 v1](memory-affect-hybrid-architecture-v1.png)（[SVG](memory-affect-hybrid-architecture-v1.svg) / [Mermaid](memory-affect-hybrid-architecture-v1.mmd)）：展示记忆、appraisal、可拆卸 Affect Utility、Working Self、开放 Policy 与世界裁决的权责边界。
- [混合运行循环 v1](memory-affect-runtime-loop-v1.png)（[SVG](memory-affect-runtime-loop-v1.svg) / [Mermaid](memory-affect-runtime-loop-v1.mmd)）：展示 `off / shadow / active` 三种模式怎样共享同一个事件、提交与投递闭环。
- [产品交互架构](product-interaction-architecture.png)（[SVG](product-interaction-architecture.svg) / [Mermaid](product-interaction-architecture.mmd)）：区分 IM 直接通信、游戏任务因果路径和可信系统桥。
- [技术架构（M1 基线）](technical-architecture.png)（[SVG](technical-architecture.svg) / [Mermaid](technical-architecture.mmd)）：展示接入、事件化、Prompt 装配、模型 proposal、校验、状态与投递；原文件保留用于回退对照。
- [运行时事件生命周期](runtime-event-lifecycle.png)（[SVG](runtime-event-lifecycle.svg) / [Mermaid](runtime-event-lifecycle.mmd)）：展示从入站、持久化到事务提交、outbox 投递和场景结算的完整顺序。
- [最小涌现验证闭环](emergence-validation-loop.png)（[SVG](emergence-validation-loop.svg) / [Mermaid](emergence-validation-loop.mmd)）：展示 NPC 请求、承诺冲突、局部选择、世界裁决、联系目的与跨时后果怎样形成可回放闭环。

每张图同时提供 PNG 预览、可缩放 SVG 和 Mermaid 语义源文件；`scripts/render_architecture_diagrams.js` 可从 SVG 重建 PNG。原有四张图继续作为 M1 历史基线，不因 M2 增量被覆盖或删除。

## 建议的代码目录

    src/gf/
      adapters/          # CLI、飞书及后续 IM 适配器
      gateway/           # 鉴权、去重、命令拦截、入站标准化
      domain/            # WorldEvent、patch、persona、thread 等领域类型
      orchestration/     # 队列、L2 gate、调用点编排与场景生命周期
      prompts/           # Prompt manifest、编译器、槽位渲染与 schema
      inference/         # 模型客户端、重试、锁版与 structured output
      validation/        # provenance、跨世界、人格归因与状态版本校验
      state/             # StateManager、reducers、事务与 repositories
      memory/            # 检索、压缩、canon 门控与向量索引
      cognition/         # Working Self 与开放行动 Policy；不依赖 Affect 也可运行
      affect/            # 可拆卸 appraisal/Utility 动力学；off/shadow/active
      world/adjudication/# 将开放行动裁决为实际世界后果
      delivery/          # outbox、投递 worker、回执与静默投递
      scheduler/         # phase、scheduled 与 impulse 事件
      observability/     # 日志、指标、拒写审计、dry-run 与 probes
    schemas/             # JSON Schema 与模型/宿主机器契约
    tests/
      unit/
      integration/
      prompt_regression/
      simulation/
    migrations/          # SQLite DDL 与版本迁移
    runtime/             # 本地 SQLite、日志和缓存；不提交私密数据

建议让 Prompt 文件仍留在现有 prompts/ 作为人工维护资产；运行代码只通过 manifest 和编译器读取明确允许的现役文件，历史示例与 research 不参加装配。

## 当前阶段

截至 2026-08-06，项目处于 M1.1 可移植性收口与 M2 输入准备并行阶段：

- 机制、交互边界、跨世界协议和大部分角色种子已经形成文档。
- canon 语料处理管线和三类 canon 表已经就绪。
- 五个 Prompt 调用点、原生 role、跨世界信任边界、活动场景历史和 prompt manifest 已收束；结构化调用已有 JSON Schema，A7 对话语料仍待 Owner 逐句定稿。
- 初始 SQLite DDL、事件／claim／patch／debt／surface 契约、契约回归和 canon 安全构建已经落地。
- TypeScript M1 骨架已有 CLI、gateway、SQLite migration runner、事件队列、StateManager、Prompt assembler、stub 模型、v1 文本 surface、outbox worker、scheduler 和恢复测试。
- 机器契约测试通过；运行时测试当前 15/19，四个失败来自 Prompt CRLF 解析；完整审计另有 Windows canon EOL/hash 阻塞。
- Perception、真实 memory retrieval、通用 commitment、Working Self、开放 Policy、World Adjudicator、独立 NPC/环境驱动、真实异步模型客户端与 Affect 模块尚未实现。

当前并行完成两件事：Owner 按 docs/14 签字世界运行规则、Concern/张力、A7 与纵向样例；工程侧按 `TODO.md` 修复 M1.1 的 EOL/hash、实际 source closure、timezone 和异步推理接口。随后先在 `affect_mode=off` 下完成 Perception、Memory/Commitment、Working Self、开放 Policy 与 World Adjudicator 的最终基线，再接独立世界驱动、shadow Affect 和 active 消融。主动消息在同一文本 renderer/outbox 主动路径与非操纵测试通过前保持关闭；语音/图像仍后置。

## 权威文档

- **架构约束（冻结，高于以下全部）**：[docs/invariants/19-architecture-invariants-v1.md](docs/invariants/19-architecture-invariants-v1.md)
- 机制：[docs/cognition/02-framework-v3.5.md](docs/cognition/02-framework-v3.5.md)
- 交互：[docs/product/03-interaction-v1.md](docs/product/03-interaction-v1.md)
- 边界：[docs/product/04-boundary-v2.md](docs/product/04-boundary-v2.md)
- 实例种子：[docs/character/06-muelsyse-seed-draft-v1.md](docs/character/06-muelsyse-seed-draft-v1.md)
- 实施缺口：[docs/history/08-implementation-gap-checklist.md](docs/history/08-implementation-gap-checklist.md)
- A7 骨架：[docs/character/09-a7-dialogue-samples-scaffold.md](docs/character/09-a7-dialogue-samples-scaffold.md)
- 跨世界协议：[docs/product/10-crossworld-protocol-v1.md](docs/product/10-crossworld-protocol-v1.md)
- 修复计划：[docs/history/11-repair-plan-v1.md](docs/history/11-repair-plan-v1.md)
- 补充融合决策记录：[docs/history/12-supplement-integration-review-v1.md](docs/history/12-supplement-integration-review-v1.md)
- M2 记忆与 Affect 混合架构：[docs/cognition/13-memory-affect-hybrid-architecture-v1.md](docs/cognition/13-memory-affect-hybrid-architecture-v1.md)
- Prompt 调用清单：[prompts/manifest.yaml](prompts/manifest.yaml)
- 机器契约：[schemas/README.md](schemas/README.md)
- SQLite 迁移：[migrations/README.md](migrations/README.md)
- canon 构建清单：[corpus/canon/manifest.json](corpus/canon/manifest.json)

## 项目管理与交接

- 完整交接：[PROJECT-HANDOFF.md](PROJECT-HANDOFF.md)
- 现役任务板：[TODO.md](TODO.md)
- 编码 Agent 约束：[AGENTS.md](AGENTS.md)
- Owner 输入工作簿：[docs/owner/14-owner-input-workbook-v1.md](docs/owner/14-owner-input-workbook-v1.md)

本文、交接/管理入口和六张图用于快速建立共同理解，不替代上述权威文档；docs/12 是第一轮融合决策记录。docs/13 持有 M2 认知/情绪增量，但不覆盖 docs/02 的 M1 契约、docs/10 的跨世界本体或任何现役机器 Schema。
