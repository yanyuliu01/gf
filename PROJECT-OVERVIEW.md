# GF 项目总览

GF 是一个单用户、世界为核心的长期陪伴 Agent。首个实例是《明日方舟》的缪尔赛思。目标不是让角色持续等待用户发问，而是让她作为泰拉世界中的居民拥有自己的时间、事件、记忆和变化；博士的消息是这个世界最重要的外部输入之一，但不是世界唯一的驱动力。

新模型或新同学接手时先读 [AGENTS.md](AGENTS.md) 的 context pointers；跨文档术语以 [CONTEXT.md](CONTEXT.md) 为准。实时任务在 [TODO.md](TODO.md)，主题权威由 [docs/README.md](docs/README.md) 索引。

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
11. 生活连续、认知稀疏：World / Activity / Process 持续推进；`CognitiveGate` 只在新的可感知决策边界出现时启动认知。Open Policy 可提出 `AttentionIntent`，决定未来要留意什么，但不能修改 Gate、扩大 Perception 或直接选择动作。
12. 多模态语义守恒：文字、语音、图像从同一 communication plan 渲染，共享 intent、state revision 与 source closure；媒体失败只能安全降级。

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

实时里程碑、失败项和依赖只维护在 [`TODO.md`](TODO.md)，本文不缓存测试通过数或阻塞状态。当前设计前沿是：先完成 `affect_mode=off` 的 Perception → Cognitive Admission → Memory/Working Self → Open Policy → World Adjudicator 纵向闭环，再验证 Self-Authored Attention、独立世界驱动与 Affect 消融。

## 权威文档

主题所有权与冲突顺序以 [`docs/README.md`](docs/README.md) 为准。常用入口：

- **架构约束（冻结）**：[`docs/invariants/19-architecture-invariants-v1.md`](docs/invariants/19-architecture-invariants-v1.md)
- **术语**：[`CONTEXT.md`](CONTEXT.md)
- **M1 机制**：[`docs/cognition/02-framework-v3.5.md`](docs/cognition/02-framework-v3.5.md)
- **Memory / Affect**：[`docs/cognition/13-memory-affect-hybrid-architecture-v1.md`](docs/cognition/13-memory-affect-hybrid-architecture-v1.md)
- **Cognitive Energy**：[`docs/cognition/18-emergent-cognitive-experience-v2.md`](docs/cognition/18-emergent-cognitive-experience-v2.md)
- **Cognitive Admission / Attention**：[`docs/cognition/20-cognitive-admission-attention-v1.md`](docs/cognition/20-cognitive-admission-attention-v1.md)
- **World Adjudication / Computable World**：[`docs/world/15-world-runtime-interaction-rules-draft-v1.md`](docs/world/15-world-runtime-interaction-rules-draft-v1.md) + [`docs/world/16-computable-world-model-draft-v1.md`](docs/world/16-computable-world-model-draft-v1.md)
- **Interaction / Cross-world**：[`docs/product/03-interaction-v1.md`](docs/product/03-interaction-v1.md) + [`docs/product/10-crossworld-protocol-v1.md`](docs/product/10-crossworld-protocol-v1.md)
- **Machine contracts**：[`schemas/README.md`](schemas/README.md)

`docs/history/` 只用于追溯，不是现役实现权威。

## 项目管理与交接

- 完整交接：[PROJECT-HANDOFF.md](PROJECT-HANDOFF.md)
- 现役任务板：[TODO.md](TODO.md)
- 编码 Agent 约束：[AGENTS.md](AGENTS.md)
- Owner 输入工作簿：[docs/owner/14-owner-input-workbook-v1.md](docs/owner/14-owner-input-workbook-v1.md)

本文只用于快速建立共同理解，不持有主题权威。发生冲突时按 `docs/README.md` 的主题所有权裁决。
