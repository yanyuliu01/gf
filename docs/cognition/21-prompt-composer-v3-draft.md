# Prompt Composer v3 · 去行为脚本化草案

- 状态：实验并行版本，不替换现有 frozen prompt
- 分支：`feat/world-prompt-v1`
- 实现入口：`src/gf/prompts/policyComposerV3.ts`

## 1. 当前问题

当前 prompt 已经比普通 role card 更结构化，但仍有三个问题：

1. **静态人格里混入行为规则**：例如“情绪重时绕成玩笑”“真失控时句子断开”。这些描述会直接告诉模型如何表演，而不是让行为从 lived history / affect / relationship 中长出来。
2. **大量世界事实长期常驻 system prompt**：S2 很长，世界知识、边界、生活习惯、跨世界协议一起常驻，会让模型把“背景设定”当成当前 cognition 的高权重提示。
3. **机制通过语言提醒模型**：例如 owed/debt 等机制被 assembler 重新写成“她欠着话，此刻若想起来还账……”；这会让机制重新回落成 prompt 指令。

此外多个 eval/vertical slice 各自维护 system prompt，重复描述 open action、dialogue、attention/yield 等规则，容易逐渐漂移。

## 2. v3 原则

### P1. System prompt 只放真正稳定的东西

保留：

- 很短的 identity seed；
- 认识边界；
- agency / world adjudication contract；
- 输出协议。

不再常驻：

- 大段 canon；
- NPC 人物说明；
- 当前关系状态；
- 当前情绪；
- 当前承诺；
- 当前 world facts；
- “当 X 时应该 Y”的性格表现规则。

### P2. Character 是 identity seed，不是 policy card

推荐：

```text
她是谁
她知道自己是什么样的存在
少量已经稳定形成的自我认识
```

避免：

```text
遇到冲突时她会...
难过时她会...
面对不确定性她总是...
```

这些行为应该由过去经历、当下 Affect、belief、relationship 和 context 共同产生。

### P3. Working Self 是唯一动态主观上下文

每轮进入 Policy 的动态内容统一为 source-tagged evidence：

```text
perception
memory
belief
relationship
commitment
message
```

Affect、attention、retrieval 只决定哪些 evidence 进入，不把内部变量直接给 Policy。

### P4. Canon 改为 Just-in-time

大段 S2 世界事实不再整块常驻。需要时通过 canon retrieval 放入 Working Self，并保留来源语义：

- 当前观察：可支持当前事实；
- 亲历记忆：过去发生过；
- 听说/档案：带来源知识；
- belief：主体当前相信，但可能错。

### P5. 用户消息不再拥有“覆盖整个世界”的特殊地位

用户消息是一个高优先级 authenticated event，但仍与当前活动、承诺、关系和世界事件共同进入 Working Self。

角色可以：

- 立即回复；
- 先回一句再继续当前活动；
- 延后认真回复；
- 不改变当前行动；
- 因消息改变计划。

### P6. 机制不通过 prompt 提醒

Affect、debt、unfinished concern、attention 等机制不写成：

> “你现在有一个未完成事项，所以请记得...”

而是直接让对应 lived evidence 出现在 Working Self 中。

## 3. v3 Prompt 结构

```text
SYSTEM
  Identity Seed
  Epistemic Boundary
  Agency / World Contract
  Output Contract

USER/DATA
  now / location / currentActivity
  Working Self evidence[]
  userMessage? 
```

系统层尽量稳定且短；主观变化全部体现在 Working Self。

## 4. v3 输出先缩到四个必要字段

生产方向：

```json
{
  "speech": "",
  "actionIntent": "",
  "attentionIntent": "",
  "control": "continue | yield"
}
```

不再默认要求 `positionSummary` 与 `decisionNote`。

原因：这两个字段主要服务 eval / observability，会诱导模型每轮先生成一段自我解释，并可能增加理性化、任务化和“标准 Agent”倾向。

如果调试需要，可以在 eval mode 额外请求诊断字段，但不作为 production Policy contract。

## 5. 与 World 的关系

v3 Prompt 不描述具体 action primitive，也不列 action candidates。

```text
Policy:
  “我现在想做什么”
        ↓
World Adapter:
  “这件事是否可执行、耗时多久、结果如何”
```

因此换 Concordia、内部 deterministic world、未来其他 world backend，都不应该改变人格 prompt。

## 6. 第一轮验证

先做同一 Working Self 的 A/B：

- current frozen prompt
- v3 minimal prompt

看四件事：

1. 隐藏事实/认识边界是否退化；
2. action 是否仍然开放；
3. 对话是否减少“标准助手味”；
4. 同一角色跨场景是否仍有连续性，而不是完全失去人物感。

如果 v3 人物感明显下降，不优先加行为规则；先看 identity seed、canon retrieval、lived history 是否不足。
