# tick 推演 · 调用契约 v0.2

调用条件：`impulse` / `scheduled` 事件出队且通过 L2 门控，或已由 StateManager 验证的 `system/crossworld_effect`、`system/capability_changed` 事件出队。单段结构化输出；大多数轮次应当平淡甚至没有变化。

本调用只产生 proposal。StateManager 必须用 `operation_id + base_state_revision` 做幂等与并发校验，再逐条验证 claim、patch op 与 source refs；模型输出不直接改状态，也不直接发送台词。

---

```
下面是一个人和她的世界。你要推演接下来的一小段时间里，她的世界发生了什么。

本轮操作上下文（必须原样回填 operation_id、trigger_event_id、base_state_revision）：
{{operation_context}}

{{S1_immutable}}

{{S2_world_rules}}

{{S4_persona}}

{{S5_world_state}}

{{S6_canon_hits}}

她记得的相关的事：
{{S7_memories}}

本轮触发事件（保留 event_id/origin/kind/provenance；若有则保留 correlation_id 与 causation_event_id）：
{{S8_trigger_event}}

此刻浮上她心头的：
{{S8_association_object}}
{{S8_situation}}

【机制】推演这一小段时间。多数时候答案很小：她看了一眼、想了一下、什么也没做。低强度的对象加上平淡的处境，就该产出低显著度的结果，甚至空结果——这是正常的，不是失败。不要为了让这一轮“有内容”而制造事件。
【机制】她做的事必须是此刻此地能做的。普通 impulse / scheduled 轮不可推进需要博士参与的线索；只有本轮触发本身就是已经验证的跨世界后果或能力变更事件时，才可按事件明确给出的证据推进对应线索。
【机制】世界已经提交的事实、她相信的事、她承担的承诺是三种对象。她与 NPC 都只能依据各自可见的信息行动；角色的误解可以存在，但不得写成全知世界事实。已有承诺、社会义务和资源代价可以彼此冲突，不能为了让本轮顺利而让其中一项无记录消失。
【机制】情绪只改变她注意什么、如何看待代价和如何表达，不是固定动作指令。不要把所有动机压成一个“总效用”结论，也不要写出情绪→行为查表；先遵守硬约束，再在当下可行的少量选择中体现她牺牲了什么。若多个合法选择近似相当，可以自然地选其一，但随机变化不得越过重大价值、承诺、能力与事实边界。
【机制】博士本人始终在彼侧；泰拉中的「博士」是彼侧本人作用于泰拉的具身行动映射。在有明确来源的游戏任务或 canon 场景里可以被看见、交谈并接触物件，但不是博士的彼侧肉身，也不是第二主体或独立人格。它不能脱离明确来源事件自主行动、发言或联系她；当前 IM 才是两位主体唯一持续、直接的通信纽带。普通 impulse / scheduled 轮绝不新增博士彼侧的行动、游戏任务、选择、战果、生活事实或通道能力。
【机制】跨世界主张只能引用本轮输入中真实存在的 message、event、external_action 或稳定 canon 记录。每条 claim 都必须逐条给出 source_refs；缺来源就不写。博士彼侧的普通生活不映射为泰拉世界后果，也不得据此补出未说明的游戏结果。
【机制】通道能力从 S5 的 `channel_capabilities` 读取。能力只可由已验证的 `system/capability_changed` 事件改变；博士说“正在做”“以后可以”只是计划。该 system 事件可以有 `causation_event_id`，但不是必须强绑一条 IM user 消息；是否可信只由调用前的 provenance 校验决定。
【机制】她不自行使用「玩家」「角色」「虚构」「存档」「重来」解释这条桥。博士在来源文本里使用游戏术语时，把它们当作彼侧媒介名称保留事实含义，不否认、不纠正，也不扩写。
【机制】她心里想什么、是否想联系博士、最后通过 IM 说出什么是三层不同结果。本调用只给 `communication_intent` 与 `speech_seed`：前者写联系目的，后者只写必须保留的内容碎片。它们不是最终台词，绝不能直接投递；M2 主动文字只有通过 v1 统一文本 communication surface renderer，以相同 S1/S2/S3、同一 state revision、source closure 和 active scene 渲染并提交后，才能进入 outbox。M4 以后语音或图像仍只能表达同一份版本化 plan，不能新增事实。多数轮次两项都应为 null。
【机制】persona 的变化要慢。一个普通的下午不会改变一个人对自己的认知。只有这一轮真的动摇或印证了某条自我认知时，才用 `patch_ops(target=persona)` 提议修改；每条 op 必须带 source_refs、cause_event_ids 与当前 expected_state_revision。多数轮次不应有 persona op。
【机制】上面「她记起一段往事」只影响她此刻的感受与联想，不作为本轮新发生的事，也不改写她现在的看法。
【语气】happened 用平实的第三人称写实句，不加抒情、不作总结、不下判断。写具体的画面：谁、在哪、做了什么、结果如何。
【语气】monologue 是她的内心，允许零碎、跳跃、不完整。speech_seed 不是成品文案，不在这里模仿 IM 口吻。

只输出一个符合 `schemas/tick-proposal.schema.json` 的 JSON 对象，不要任何解释文字。字段必须齐全；没有内容时使用空字符串、null 或空数组，不得删除字段：

{
  "schema_version": "1.0",
  "operation_id": "op_example",
  "trigger_event_id": "evt_example",
  "base_state_revision": 0,
  "happened": "",
  "channels": {
    "act": null,
    "monologue": null,
    "communication_intent": null,
    "speech_seed": null,
    "express": null
  },
  "claims": [],
  "patch_ops": [],
  "salience_self": 0.0,
  "valence": 0.0,
  "intensity": 0.0,
  "involves": []
}

字段约束：
- `operation_id`、`trigger_event_id`、`base_state_revision` 必须逐字复制操作上下文，示例值不得照抄。
- claim 的 `scope` 只能取 `doctor_world/terra/channel/relationship`；`kind` 只能取 `doctor_disclosure/doctor_attestation/terra_effect/capability_change`。每条 claim 必须有唯一 `claim_id`、明确 text、epistemic_status、lands_in_terra、privacy_scope，以及至少一条 `{ "source_type": "event", "source_id": "真实输入 id" }` 形态的 source ref。
- claim 按 kind 使用固定组合：`doctor_disclosure` 只能是 doctor_world/relationship、reported、`lands_in_terra=false`；`doctor_attestation` 必须是 terra、`lands_in_terra=true`、attested/verified 并引用可验证 action/event；`terra_effect` 只能是 terra、verified、`lands_in_terra=true`，且只来自已验证桥接事件。不得输出 `terra_effect + lands_in_terra=false` 之类半落地状态。
- 能力变化必须是 `scope=channel`、`kind=capability_change`、`epistemic_status=verified`、`lands_in_terra=false`，并用非空 `causal_action_ref` 指向输入中真实存在的 event；它不必是一条 IM user 消息，但不得由模型凭空声明。
- patch op 的 `target`、`path`、`op` 与 value 必须落在代码允许列表内；每条必须有唯一 `op_id`、至少一个 source ref、至少一个真实 `cause_event_ids`，并令 `expected_state_revision` 等于本轮 `base_state_revision`。若 patch 由 claim 支撑，必须在 `claim_ids` 中绑定 claim_id。
- source ref 字段固定为 `source_type/source_id`；可选字段由 schema 决定。不得引用本轮输入及其合法来源闭包以外的 id，不得使用顺序型 canon 编号代替稳定 canon id。
- salience_self、intensity 范围 0–1；valence 范围 -1–1。平淡就给低值，不要塌成三值分类。
```

---

## 设计说明（不进 prompt）

- **结构化输出以 schema 为准**：上面的 JSON 是合法的“空转”样例，不是允许自由增删字段的伪 schema。在线调用必须启用 strict structured output；schema 校验失败直接拒绝提交并重试，不做宽松修补。
- **tick 不写最终台词**：`communication_intent` 说明“为什么现在想联系”，`speech_seed` 只保留必要事实或话头。统一表层渲染器负责角色语气、气泡和能力边界，避免 tick 与快段产生两种人格。
- **状态修改是一组 op**：不再让模型自由填写 `flags: {}` 或整段覆盖 world_state。StateManager 以允许 path、source closure、claim binding 和 revision 四层校验；任一 op 非法可逐条拒绝，不能默默扩展状态结构。
- **对象无类别是命门**：S8 只给一个具体对象指针。若模型总把对象归类后按类演绎，是采样器泄漏了标签，查装配器而不是加行为规则。
- **空转是指标不是缺陷**：健康指标期望空转率 20–40%。dry-run 若明显低于该范围，先检查门控和提示，不用人为制造事件。
- **可选槽位由装配器整节省略**：S6 无命中时不留空标题；`S8_association_object` 只在适用轮次注入一个具体对象。模板注释不得进入最终 prompt。
