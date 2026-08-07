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
├── docs/            ← 全部规范；编号是稳定 ID，目录表示主题
    ├── README.md    ← 文档集索引：权威顺序、核心决策、演进史、未决问题
    ├── invariants/  ← 约束层（冻结）
    │   └── 19-architecture-invariants-v1.md  ← 不可协商的架构约束 + 解冻程序
    ├── product/     ← 产品目标、伦理、触点、边界、跨世界本体
    │   ├── 01-prd-v0.1.md
    │   ├── 03-interaction-v1.md
    │   ├── 04-boundary-v2.md
    │   └── 10-crossworld-protocol-v1.md      ← 跨世界语义权威
    ├── world/       ← 世界怎样自己运行
    │   ├── 15-world-runtime-interaction-rules-draft-v1.md  ← 开放行动裁定接口
    │   └── 16-computable-world-model-draft-v1.md           ← 可计算世界内核（未签字）
    ├── cognition/   ← 她怎样感知、记忆、决定与表达
    │   ├── 02-framework-v3.5.md              ← M1 机制基线权威
    │   ├── 13-memory-affect-hybrid-architecture-v1.md
    │   └── 18-emergent-cognitive-experience-v2.md
    ├── character/   ← 这一个实例是谁
    │   ├── 05-seed-config-v1.md
    │   ├── 06-muelsyse-seed-draft-v1.md
    │   ├── 07-muelsyse-scenario-patch-v2.md
    │   └── 09-a7-dialogue-samples-scaffold.md  ← 待 Owner 定稿
    ├── owner/       ← 需要 Owner 填写的输入
    │   └── 14-owner-input-workbook-v1.md
    └── history/     ← 已退役的迭代 + 未处理发现清单（仅供追溯，不得被现役依赖）
├── prompts/         ← 运行 Prompt、manifest、槽位、装配示例与校验约定
├── schemas/         ← 运行时 JSON Schema 唯一机器契约
├── migrations/      ← SQLite 版本化 DDL
├── tests/           ← 契约正反例与数据库不变量检查
└── corpus/          ← 正史语料、稳定构建脚本、工作产物与 canon 表
```

第一次了解项目先读 `PROJECT-OVERVIEW.md`；准备接手工作则读 `PROJECT-HANDOFF.md`、`TODO.md` 与 `AGENTS.md`。**动手改架构之前先读 `docs/invariants/19-architecture-invariants-v1.md`**——它是冻结的约束层，高于其余全部文档，推翻需走 ADR。M1 基线看原有四张总览图，M2 认知/情绪增量看 `docs/cognition/13-memory-affect-hybrid-architecture-v1.md` 和两张新版图。具体实现仍须读取任务对应的权威文档、`prompts/manifest.yaml`、`schemas/README.md` 与 `migrations/README.md`。

`docs/` 下编号是**稳定 ID，不表示阅读顺序**；目录表示主题。文档移动或退役都不改号，因为正文里有大量 `docs/02`、`docs/10` 形式的交叉引用。已退役的迭代在 `docs/history/`，其 README 同时列出**尚未处理的历史发现**。

新版图：[记忆与 Affect 混合架构](memory-affect-hybrid-architecture-v1.png)（[SVG](memory-affect-hybrid-architecture-v1.svg) / [Mermaid](memory-affect-hybrid-architecture-v1.mmd)）｜[混合运行循环](memory-affect-runtime-loop-v1.png)（[SVG](memory-affect-runtime-loop-v1.svg) / [Mermaid](memory-affect-runtime-loop-v1.mmd)）｜[可计算世界组成](computable-world-architecture-v1.png)（[SVG](computable-world-architecture-v1.svg) / [Mermaid](computable-world-architecture-v1.mmd)）｜[世界交互与写入权限](world-interaction-structure-v1.png)（[SVG](world-interaction-structure-v1.svg) / [Mermaid](world-interaction-structure-v1.mmd)）｜[当前涌现式认知精力闭环 v2](cognitive-wake-token-energy-v2.png)（[SVG](cognitive-wake-token-energy-v2.svg) / [Mermaid](cognitive-wake-token-energy-v2.mmd)）。[定性投影 v1 图](cognitive-wake-token-energy-v1.png)继续保留用于对照与回退。

当前跨世界设定以 `docs/product/10-crossworld-protocol-v1.md` 为语义权威，并由 `prompts/slots/S2-world-v2.md` 落到运行时。游戏内博士是彼侧博士的具身行动映射：可在有来源的任务／正史场景中交互，但没有独立意识，也不是本人肉身穿越。实现交接时，当前任务与依赖给 `TODO.md`；机制给 02、触点给 03、跨世界协议给 10、实例数据给 06。08 只作历史缺口清单，不单独驱动开工。

当前状态（2026-08-06）：M0 静态契约基本收口，TypeScript M1 骨架已包含 CLI、migration runner、StateManager、单队列、v1 文本 surface、outbox 恢复路径与无发言 tick。当前先执行 `TODO.md` 的 M1.1 可移植性修复，使 Prompt EOL、canon hash、实际 source closure、world timezone 和异步推理接口全绿；同时由 Owner 按 docs/14 定稿世界运行规则、Concern/张力和 A7。M2 先在 `affect_mode=off` 下完成最终开放 Policy/World Adjudicator 基线，再接 shadow 与 active；多模态仍后置。
