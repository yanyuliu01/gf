# corpus — A9 正史语料库·原始数据源

对应 `docs/05-seed-config-v1.md` §A9 与 `docs/06-muelsyse-seed-draft-v1.md`「A9 正史语料库配置」的**采集**环节产物。抓取日期 2026-08-04。

## 来源与方式

- 原计划抓 prts.wiki,该站对抓取服务持续拦截(首请求后全部返回空),Chrome 扩展当时未连接。
- 实际来源:**ArknightsGameData**(github.com/Kengxxiao/ArknightsGameData，当时请求 `master`)。git 稀疏克隆后本地提取，文本零 wiki 噪声。采集时没有保存 resolved commit，因此当前只能声明为本地快照，不能声称可从上游逐字节复现；权威披露见 `source-manifest.json`。
- 剧情脚本已由游戏指令格式清洗为可读对白体(`raw/story/`),同时保留未清洗原件(`raw/original-scripts/`)。清洗规则:`[name="X"]台词`→`X：台词`;旁白保留;选项→`【博士选项】`;分支→`【分支·承接选项n】`;Sticker/Subtitle→`【画面文字】`;舞台指令(背景/音乐/立绘等)删除;`{@nickname}`→`博士`。每文件头部带来源、活动、关卡码、节点(行动前/后/幕间)与官方剧情简介。

> `【博士选项】`、分支标签等仅是**语料加工标记**，不可原样装入角色可见上下文。当前实例的本体解释以 `docs/10-crossworld-protocol-v1.md` 为准：官方剧情中的博士现场对白与行动，装配时统一包装为博士本人经游戏作用于泰拉的“具身行动映射”经历；它能在该场景中被看见和交互，但没有独立意识，不证明博士本人肉身在泰拉，也不向缪尔赛思暴露玩家、选项或剧情树。

## 清单

| 目录 | 文件数 | 大小 |
|---|---|---|
| story/act25side-孤星(CW,含尾声两幕) | 24+索引 | 531 KB |
| story/act19side-绿野幻梦(多萝西线,缪尔赛思重要登场) | 20+索引 | 281 KB |
| story/act15d0-孤岛风云(她最早的客串) | 18+索引 | 165 KB |
| story/act47side-未许之地(莱茵后续,她在场) | 19+索引 | 311 KB |
| story/memory-干员密录(她的「无根之雨」+塞雷娅/星源/卡夫卡提及她的密录) | 4 | 78 KB |
| story/mentions-零散提及(其余活动/集成战略中提及她或莱茵生命的单篇) | 28 | 448 KB |
| muelsyse/(干员档案 9 节、语音记录 75 条含皮肤差分、模组故事「梳妆流形」「落叶四季」+证章) | 3 | 27 KB |
| worldview/莱茵生命相关干员档案(16 名干员全档案)+势力代号表 | 17 | 143 KB |
| original-scripts/(上述剧情未清洗原件镜像) | 85 | 2.6 MB |

## 与 A9 管线对接(docs/05 §A9) — 状态 2026-08-04

1. ~~采集~~ ← 本目录 `raw/`
2. ~~切片~~ ← `scripts/chunk.py` → `work/chunks.jsonl`（200–500 字为目标、行边界对齐；极短完整段落允许低于下限）
3. ~~视角分拣~~ ← 脚本出在场信号摘要(`work/digest.md`),人工逐段判定 → `work/labels.json`;判定依据全录 `work/sorting-notes.md`(命门步骤,改口径先读它)
4. ~~按源清洗~~ ← 语音 75→40(剔战斗台词);17 份档案原文切块入 world + 她与塞雷娅蒸馏事实(`work/facts.jsonl`);她档案内第一人称口述引文归 self
5. 入库 ← **产物就绪**：`canon/canon_{self,known,world}.jsonl`。当前数量、runtime-safe 隔离数与文件哈希以 `canon/manifest.json` 和 `canon/stats.md` 为准，不在说明文档复制固定数字。运行时只可装配 `runtime_safe=true` 的 `role_safe_text`；研究原文 `text` 不可直接进入角色上下文。向量化待运行时确定 embedding 模型后执行（docs/08 §1.3 canon_vectors 独立表，永不压缩衰减）。复现：`python scripts/chunk.py`、`python scripts/build_canon.py`、`python scripts/audit_canon.py`。

## 已知缺口

- **PRTS 世界观词条页**(泰拉/源石/矿石病/天灾/国家势力综述):wiki 编辑内容,游戏数据无对应物。待 Chrome 扩展连接后补抓,或接受以剧情原文+档案为世界观依据(A2 世界法则文档已存在,此缺口影响有限)。
- **上游 revision 未固定**：原采集没有保存 commit id。补录前，`source-manifest.json` 必须保持 `unverified_unpinned_snapshot`，不能用 `master` 冒充可复现版本。
- 主线剧情未抓(按 2026-08-04 决定的范围)。
- 干员档案蒸馏仅做了她本人+塞雷娅(最高频引用);其余 15 人暂以原文切块形态在 world 表服务检索,蒸馏为可选精修。
