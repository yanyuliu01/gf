# 同类项目 prompt 实践调研与当前版本评估

调研日期 2026-08-04。目的：评估 S1/S2 v2 是否"短"、是否"粗糙"。

> **体量注记（2026-08-05）**：本文最初测量发生在跨世界硬约束加入前。现役 S1+S2 约 4.2k 净字符；下文的 3404／3.4k 均是历史快照，不可用于预算。关于“常驻前缀已经很厚、不要靠继续加描述解决问题”的定性结论仍成立，而且更强。

---

## 一、抓到的数据点

| 项目 | 常驻身份描述的体量 | 约束的**理由** |
|---|---|---|
| **Stanford Generative Agents**（21.7k star，`scratch.py: get_str_iss()`） | **ISS ≈ 100 tokens**，7 个字段（Name/Age/Innate/Learned/Currently/Lifestyle/Daily plan req），注释明写"the bare minimum description that gets used in **almost all prompts**" | 可信度不靠身份描述的厚度，靠 memory stream + reflection 检索 |
| **Letta / MemGPT** | core memory block 默认 **2000 字符/块**（persona + human 两块起步） | 官方原话："blocks are powerful **since there's no retrieval to fail**, but the cost is the token count, which is why blocks are bounded" |
| **SillyTavern 官方文档** | description "always included in the prompt"，"**could be of any length (be it 200 or 2000 tokens)**" | token 焦虑**明确来自 2048 context**："a 1000-token character definition cuts the AI's 'memory' in half" |
| **SillyTavern 社区共识** | 推荐 400–800 tokens；"tight 400–800 token cards usually roleplay better than bloated 2000-token definitions" | 与 chat history 抢 context |
| **Trappu PLists + Ali:Chat**（ST 官方推荐指南） | PList 紧凑单行 trait 列表 + 1–2 段高质量示范对话 | 见下方"位置效应"，这是本次调研最有价值的一条 |
| **Lorebook 生态共识** | 条目短、关键词触发、不常驻 | "shorter entries activate faster, stack better, and compete less aggressively with live chat context" |

## 二、结论一：「短」不成立

当时 S1+S2 = 3404 字；现役约 4.2k 净字符。对照上表，这已经是**上述所有项目里最厚的常驻身份描述**之一。中文字符不能直接等同 token，精确值必须用运行模型 tokenizer 测量。

而且各家压缩的理由，**对我们几乎都不成立**：

- SillyTavern 的 2048 context → 我们 200k，且每轮重建 prompt、不累积 history
- Letta 的 token 成本 → 我们有 cache，前缀每轮约 0.001 美元
- Lorebook 的"与实时对话竞争" → 这条**部分成立**，见结论三

所以：**不要再加长了。** 你感觉"短"，我认为是错觉，来源大概是把数千字符的常驻前缀跟“一份完整设定集”比，而不是跟“每轮都要读的内容”比。

## 三、结论二：「粗糙」成立，但不是长度问题

真正的三个缺口，按严重程度：

### 缺口 1 · 位置：最重要的东西放在了最弱的位置 ⚠️ 最严重

Trappu 指南的核心论断（这是整个 ST 生态的共识）：

> "The lowest point in the context has the strongest influence on the model's outputs."
> description 会随对话推进沉入"第三记忆篮"，变得几乎不起作用。解法是把紧凑的 PList 放进 **Author's Note @ depth 4**——即离最后一条消息很近的位置。

我们的装配顺序是 S1 内核锚 → …… → S8 本轮消息 → S9 输出契约。**内核锚在最顶端，也就是最弱的位置。** 我当初把它放那儿的理由是 KV cache（稳定前缀可复用），这个理由本身没错，但我没有补上位置效应的代价。

这大概就是你感觉"粗糙"的真实来源：**不是内容不够，是最重要的四条锚被埋在数千字常驻前缀的最上面。**

**解法**（已实施，见下）：底部锚。S1 保持原位（cache 友好），同时在 S9 输出契约里嵌入一个 40 字以内的紧凑重述。cache 不受影响（S9 也是静态尾），但人格锚同时占据了最强位置。

### 缺口 2 · A7 仍然空着 ⚠️ 次严重

所有调研到的项目**一致认为**示范对话是控制语域最强的手段，强于任何描述性文字：

- SillyTavern 文档："The model is more likely to pick up the style and length constraints from the first message than anything else"
- Trappu："Ali:Chat example dialogues are what define your character"，且**示范的长度直接决定输出长度**——想要短回复就把短示范放在靠下位置
- Trappu 的 Quality > Quantity：1–2 段写得好的 > 一堆写得差的

我们的 S3 是空的（docs/09 只是骨架）。这意味着**当前版本控制语域的能力接近于零**，全靠【语气】段的自然语言指令硬扛——而这恰恰是所有指南都说效果最差的方式。

**这是当前版本最大的实际风险，且它跟 S1/S2 写得多好完全无关。**

### 缺口 3 · 缺"她不会怎样"

S2 §B 全是正面事实（她是什么、她有什么、她做过什么），没有一条**否定式约束**。§A 的"不可能之事"管的是世界层面的事件，不管她的言行。

Trappu 特别点名了一类必须用否定式堵的坑——"角色替用户说话"（impersonation），并说这个坑一旦在示范里出现就会被继承。我们的契约目前没有任何一条防这个。

**但要小心**：docs/05 §5 反模式清单第 4 条禁止"当 X 发生时她会 Y"的句式。所以否定式只能写成**语域/边界层面**（她不会替博士说话、不会写小作文、不会自报家门），不能写成剧情层面（"当博士难过时她会……"）。

## 四、结论三：一条需要你权衡的取舍

Letta 那句话值得单独拎出来：

> "Blocks are powerful **since there's no retrieval to fail**, but the cost is the token count."

它是**支持**厚常驻的——常驻内容不会检索失败。这跟 Lorebook 生态"能检索就别常驻"的主张正面冲突。两派都对，分歧在于各自的成本结构：Lorebook 派受 context 限制，Letta 派不受。

我们不受 context 限制，所以**倾向常驻是对的**——这也是我上一轮支持 §B 放长的依据，调研之后我仍然维持这个判断。

但 Lorebook 派还有一条论据我们躲不掉：**竞争**。§B7 的癖好清单（润唇膏、匿名账号、慢跑十五圈、二手奢侈品行情）常驻在场，模型会倾向于"用上它"。这是我上一轮提的掉书袋风险，调研没有推翻它。

**建议维持现状 + dry-run 验证**，判据我上一轮给过：50 轮回复里 §B 专有名词出现次数。真超标了再把 §B7 挪进检索层。现在挪是凭猜测。

## 五、最终判断

| 你的感觉 | 判断 | 依据 |
|---|---|---|
| 有点短 | **不成立**，已是同类项目里最厚的 | 上表六个数据点 |
| 有点粗糙 | **成立**，但根因是位置与缺示范，不是字数 | Trappu 位置效应；各家对示范对话的一致评价 |

**本研究当时的 Prompt 结论：S1/S2 v2 本身可以直接用，不需要重写。** 这不是当前项目 readiness 结论；后续契约审查已确认 A7、机器契约、连续上下文、事务/恢复、证据模型和 canon 完整性共同构成 M0 门槛，现状以 `docs/history/11-repair-plan-v1.md` 为准。

排序建议：
1. **定稿 A7**（语域控制的重要阻塞项，但不是 M0 唯一阻塞项）
2. 底部锚（已实施，见 `10-fast-reply.md` 与 `README.md`）
3. 补否定式约束三条（已实施）
4. dry-run 后再决定 §B7 是否下沉

---

Sources:
- [SillyTavern-Docs · characterdesign.md](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/Characters/characterdesign.md)
- [joonspk-research/generative_agents · scratch.py](https://github.com/joonspk-research/generative_agents)
- [Letta · Memory Blocks: The Key to Agentic Context Management](https://www.letta.com/blog/memory-blocks/)
- [Letta Docs · Core memory](https://docs.letta.com/guides/ade/core-memory/)
- [Trappu · PLists + Ali:Chat Character writing guide](https://wikia.schneedc.com/bot-creation/trappu/creation)
- [MiniTavern · SillyTavern Character Card Format Guide](https://blog.mini-tavern.com/blog/sillytavern-character-card-format-guide-json-structure-w-and-beyond-eb82f0)
- [AI Companion Lorebooks: How Persistent Character Memory Works (2026)](https://aiinsightsnews.net/ai-companion-lorebooks/)
