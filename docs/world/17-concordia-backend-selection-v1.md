# World Backend 选型 v1：Concordia 作为第一候选

- 状态：实现探索，不覆盖 docs/world/15、16 的已有不变量
- 分支：`feat/world-prompt-v1`
- 目标：让 GF 主体进入一个持续运行、可裁定、可推进时间的外部世界，而不把 GF 的认知 Runtime 交给外部框架

## 1. 结论

首个 world backend 采用 **Google DeepMind Concordia** 做集成候选。

采用的是它的 world / Game Master / time / scene 设计，不采用它的 agent cognition 作为 GF 的心智实现。

GF 继续独占：

- wake / cognition scheduling
- Working Self
- memory / belief / relationship
- Affect
- Character / identity
- Open Policy

World backend 独占：

- objective world state
- time and causality
- location / resource / permission / process rules
- NPC/world event evolution
- action adjudication
- legal observation production

## 2. 为什么是 Concordia

Concordia 的核心抽象与 GF 已有 world 草案高度对齐：

```text
GF Open Policy
  -> natural-language action intent
  -> World / GM adjudication
  -> objective outcome
  -> visibility-filtered observation
  -> GF cognition
```

Concordia 明确把环境 Engine 分成 Observe / Schedule / Resolve / Terminate，并支持 Scene 与 GameClock；Game Master 负责把主体提出的自然语言动作裁成世界结果。

这比直接采用一个“Agent framework”更合适，因为 GF 已经有自己的 cognition/runtime。

## 3. 其他候选的定位

### AI Town

优点：TypeScript、共享 global state、simulation engine、2D 可视化，适合很快看到角色在地图里走动和社交。

问题：项目自带 agent/memory/chat 逻辑，与 GF 的心智层重叠；world rule 更偏游戏空间与社交，而 GF 需要更通用的资源、过程、权限、日程与开放行动裁定。

定位：后续可作为 UI / visualization 参考，不作为第一 world authority。

### SOTOPIA

擅长复杂社会互动与 social-intelligence eval，但以 episode/scenario 为主，不适合作为 GF 的长期生活世界。

定位：后续做 social eval benchmark。

### Agentopia / 大型 society simulator

长期生活、关系、职业、周计划等很有参考价值，但会同时接管 agent memory/profile/goal/reward，和 GF 重叠过多。

定位：参考长期社会节律与数据布局，不直接集成。

## 4. 集成方式：Python sidecar，不直接侵入 GF

首版使用独立 Python sidecar 包 Concordia，GF 通过稳定 JSON contract 调用。

```text
GF Runtime (TS)
   |
   | observe(actor, cursor)
   | resolve(open action intent)
   | advance(time)
   v
Concordia Sidecar (Python)
   |
   v
Game Master / Clock / Scene / World Components
```

首版接口：

- `POST /v1/observe`
- `POST /v1/resolve`
- `POST /v1/advance`

TS contract：`src/gf/world/contract.ts`
Bridge：`src/gf/world/concordiaBridge.ts`

## 5. 一个重要边界：暂时不用 Concordia 决定 GF 何时思考

Concordia 原 Engine 有自己的 `next_acting` / turn scheduling，而 GF 已经有 Awake / Attention / Scheduler。

因此首版不让 Concordia 直接替 GF 决定 cognition timing。

```text
World event / time boundary
       -> legal observation
       -> GF admission / wake
       -> GF decides whether cognition starts
       -> GF Policy proposes action
       -> Concordia resolves
```

如果未来需要多 NPC 同步行动，再单独决定是否让 Concordia Engine 承担 NPC scheduling。

## 6. 第一个可运行世界不要做整座泰拉

首个 POC 只做一个局部闭合世界：

- 生态科办公室
- 中央生态园
- 一间会议室 / 公共走廊
- 住所或附近街区
- 2-3 个 NPC
- 2-3 个植物/实验过程
- 一个共享设备
- 一个日程与承诺队列

必须具备：

- 时间推进
- 地点移动
- NPC 可拒绝/改期
- 资源/设备占用
- 一个长过程可以被中断
- 世界在主体不思考时继续推进
- 开放 action 可能成功、部分成功、失败或延期

先证明“她真的在世界里生活”，再扩地图和社会规模。

## 7. 下一实现

1. Python sidecar 最小服务；
2. 一个 Concordia GM / Scene；
3. 一个 GF actor；
4. 跑通 `observe -> cognition -> resolve -> advance -> observe`；
5. 再接长期运行与 NPC。
