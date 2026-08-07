# gf · 个人陪伴 Agent 项目

单用户、世界为核心的自主陪伴 agent。首个实例：明日方舟 · 缪尔赛思。

## 目录结构

```
gf/
├── README.md                          ← 本文件：项目入口
├── AGENTS.md                          ← 编码模型与新贡献者的仓库约束
├── PROJECT-HANDOFF.md                 ← 完整项目说明与技术交接入口
├── TODO.md                            ← 当前任务、依赖、Owner 与验收标准
├── PROJECT-OVERVIEW.md                 ← 五分钟项目 brief
├── *.png / *.svg / *.mmd               ← 产品、技术、运行时与因果验证图
├── docs/            ← 产品、机制、世界观与实施文档
    ├── README.md    ← 文档集索引：阅读顺序、权威顺序、设计演进史、未决问题
    ├── 01-prd-v0.1.md
    ├── 02-framework-v3.5.md          ← M1 机制基线权威
    ├── 03-interaction-v1.md
    ├── 04-boundary-v2.md
    ├── 05-seed-config-v1.md
    ├── 06-muelsyse-seed-draft-v1.md
    ├── 07-muelsyse-scenario-patch-v2.md
    ├── 08-implementation-gap-checklist.md  ← 历史实施缺口；现役排期以 TODO 为准
    ├── 09-a7-dialogue-samples-scaffold.md
    ├── 10-crossworld-protocol-v1.md        ← 跨世界本体与通信协议
    ├── 11-repair-plan-v1.md                ← M0 修复路线与验收门
    ├── 12-supplement-integration-review-v1.md ← 补充方案融合裁决
    ├── 13-memory-affect-hybrid-architecture-v1.md ← 可拆卸记忆 + Affect Utility 架构
    ├── 14-owner-input-workbook-v1.md ← Owner 世界规则、Concern、A7 与评测工作簿
    ├── 15-world-runtime-interaction-rules-draft-v1.md ← 开放行动裁定接口草案
    ├── 16-computable-world-model-draft-v1.md ← 可计算世界内核草案
    ├── 17-cognitive-wake-token-energy-v1.md ← 历史：定性疲劳投影 v1
    ├── 18-emergent-cognitive-experience-v2.md ← 当前：涌现式主观体验 + token 精力底层
    └── archive/     ← 已废弃版本（仅供追溯设计理由）+ 原始下载包
├── prompts/         ← 运行 Prompt、manifest、槽位、装配示例与校验约定
├── schemas/         ← 运行时 JSON Schema 唯一机器契约
├── migrations/      ← SQLite 版本化 DDL
├── tests/           ← 契约正反例与数据库不变量检查
└── corpus/          ← 正史语料、稳定构建脚本、工作产物与 canon 表
```

第一次了解项目先读 `PROJECT-OVERVIEW.md`；准备接手工作则读 `PROJECT-HANDOFF.md`、`TODO.md` 与 `AGENTS.md`。M1 基线看原有四张总览图，本次 M2 认知/情绪增量看 `docs/13-memory-affect-hybrid-architecture-v1.md` 和两张新版图。第一轮融合裁决仍保留在 `docs/12-supplement-integration-review-v1.md`；具体实现仍须读取任务对应的权威文档、`prompts/manifest.yaml`、`schemas/README.md` 与 `migrations/README.md`。

新版图：[记忆与 Affect 混合架构](memory-affect-hybrid-architecture-v1.png)（[SVG](memory-affect-hybrid-architecture-v1.svg) / [Mermaid](memory-affect-hybrid-architecture-v1.mmd)）｜[混合运行循环](memory-affect-runtime-loop-v1.png)（[SVG](memory-affect-runtime-loop-v1.svg) / [Mermaid](memory-affect-runtime-loop-v1.mmd)）｜[可计算世界组成](computable-world-architecture-v1.png)（[SVG](computable-world-architecture-v1.svg) / [Mermaid](computable-world-architecture-v1.mmd)）｜[世界交互与写入权限](world-interaction-structure-v1.png)（[SVG](world-interaction-structure-v1.svg) / [Mermaid](world-interaction-structure-v1.mmd)）｜[当前涌现式认知精力闭环 v2](cognitive-wake-token-energy-v2.png)（[SVG](cognitive-wake-token-energy-v2.svg) / [Mermaid](cognitive-wake-token-energy-v2.mmd)）。[定性投影 v1 图](cognitive-wake-token-energy-v1.png)继续保留用于对照与回退。

当前跨世界设定以 `docs/10-crossworld-protocol-v1.md` 为语义权威，并由 `prompts/slots/S2-world-v2.md` 落到运行时。游戏内博士是彼侧博士的具身行动映射：可在有来源的任务／正史场景中交互，但没有独立意识，也不是本人肉身穿越。实现交接时，当前任务与依赖给 `TODO.md`；机制给 02、触点给 03、跨世界协议给 10、实例数据给 06。08 只作历史缺口清单，不单独驱动开工。

当前状态（2026-08-06）：M0 静态契约基本收口，TypeScript M1 骨架已包含 CLI、migration runner、StateManager、单队列、v1 文本 surface、outbox 恢复路径与无发言 tick。当前先执行 `TODO.md` 的 M1.1 可移植性修复，使 Prompt EOL、canon hash、实际 source closure、world timezone 和异步推理接口全绿；同时由 Owner 按 docs/14 定稿世界运行规则、Concern/张力和 A7。M2 先在 `affect_mode=off` 下完成最终开放 Policy/World Adjudicator 基线，再接 shadow 与 active；多模态仍后置。
