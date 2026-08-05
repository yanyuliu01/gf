# gf · 个人陪伴 Agent 项目

单用户、世界为核心的自主陪伴 agent。首个实例：明日方舟 · 缪尔赛思。

## 目录结构

```
gf/
├── README.md        ← 本文件：项目入口
├── PROJECT-OVERVIEW.md                 ← 五分钟项目 brief
├── *.png / *.svg / *.mmd               ← 产品、技术、运行时与因果验证图
├── docs/            ← 产品、机制、世界观与实施文档
    ├── README.md    ← 文档集索引：阅读顺序、权威顺序、设计演进史、未决问题
    ├── 01-prd-v0.1.md
    ├── 02-framework-v3.5.md          ← 机制唯一权威
    ├── 03-interaction-v1.md
    ├── 04-boundary-v2.md
    ├── 05-seed-config-v1.md
    ├── 06-muelsyse-seed-draft-v1.md
    ├── 07-muelsyse-scenario-patch-v2.md
    ├── 08-implementation-gap-checklist.md  ← 下一步从这里开始
    ├── 09-a7-dialogue-samples-scaffold.md
    ├── 10-crossworld-protocol-v1.md        ← 跨世界本体与通信协议
    ├── 11-repair-plan-v1.md                ← M0 修复路线与验收门
    ├── 12-supplement-integration-review-v1.md ← 补充方案融合裁决
    └── archive/     ← 已废弃版本（仅供追溯设计理由）+ 原始下载包
├── prompts/         ← 运行 Prompt、manifest、槽位、装配示例与校验约定
├── schemas/         ← 运行时 JSON Schema 唯一机器契约
├── migrations/      ← SQLite 版本化 DDL
├── tests/           ← 契约正反例与数据库不变量检查
└── corpus/          ← 正史语料、稳定构建脚本、工作产物与 canon 表
```

第一次了解项目先读 `PROJECT-OVERVIEW.md` 和四张总览图；要理解本次补充如何并入，读 `docs/12-supplement-integration-review-v1.md`；要做实现则从 `docs/11-repair-plan-v1.md`、`prompts/manifest.yaml`、`schemas/README.md` 与 `migrations/README.md` 开始。运行代码后续建在本目录下的 `src/`，与 docs 平级。

当前跨世界设定以 `docs/10-crossworld-protocol-v1.md` 为语义权威，并由 `prompts/slots/S2-world-v2.md` 落到运行时。游戏内博士是彼侧博士的具身行动映射：可在有来源的任务／正史场景中交互，但没有独立意识，也不是本人肉身穿越。实现交接时：机制给 02、触点给 03、跨世界协议给 10、任务分解给 08、实例数据给 06。

当前状态：M0 Contract Freeze 已完成静态契约收口；A7 与真实集成/恢复测试仍是退出门。下一工程步骤是 CLI + migration runner + StateManager + 单队列 + v1 文本 surface + 无发言 tick 的 M1 最小闭环。M2 主动消息在同一文本 renderer 与 outbox 恢复测试完成前保持关闭；多模态 plan/renderer 属于 M4。
