# 可计算世界模型草案 v1

- 状态：**OWN-001 Owner 评审主草案，未签字**
- 日期：2026-08-07
- 适用实例：特里蒙重组过渡期的缪尔赛思
- 实现目标：严格 TypeScript、离散事件模拟、可回放、可替换参数

配套结构图：

- [可计算世界组成](../computable-world-architecture-v1.png)（[SVG](../computable-world-architecture-v1.svg) / [Mermaid](../computable-world-architecture-v1.mmd)）：回答世界内部有哪些可编码的状态与过程。
- [世界交互与写入权限](../world-interaction-structure-v1.png)（[SVG](../world-interaction-structure-v1.svg) / [Mermaid](../world-interaction-structure-v1.mmd)）：回答世界事件怎样进入认知和裁定、哪些路径不调用 LLM，以及谁拥有世界事实写入权。

## 0. 方向校正

[`15-world-runtime-interaction-rules-draft-v1.md`](15-world-runtime-interaction-rules-draft-v1.md)
定义的是 Agent 与世界之间的**裁定接口**：行动持续多久、地点是否可达、NPC 能否
拒绝、结果是否部分成功。它没有定义世界自身如何生产、消耗、积累和失衡，因此单靠
那一层，世界事件仍然需要 LLM 临时编写。

本文改为定义一个可以编码的世界：

```text
资源禀赋 + 生产过程 + 容量分配 + 位置/权限
        + 生物与环境变化 + 外生扰动
                         |
                         v
                  下一时刻世界状态
```

世界不是剧情生成器，而是一个带随机扰动的状态转移系统。LLM 不计算物理结果、
产量、库存、耗时或故障；它只在需要主体判断时提出开放行动。行动被编译成对世界
模型的操作，之后由 TypeScript 引擎计算结果。

本文与 docs/15 的关系：

- 本文持有“世界为什么会自己运行”的模型；
- docs/15 持有“一个开放行动怎样进入该模型并被裁定”的接口；
- 两者都不替 Affect Utility 选择行动；
- Owner 未签字前，两者都不进入正式 Prompt、Schema 或运行规则。

---

## 1. 建模选择

### 1.1 采用混合离散事件与库存-流量模型

世界状态记为：

```text
S(t) = {
  accounts,          // 各主体/地点持有的资源库存
  capacities,        // 人员、设备、注意、交通等区间容量
  processes,         // 正在等待、执行、暂停或返工的生产过程
  agents,            // 身体、位置、权限、承诺和可用容量
  organizations,     // 预算、岗位、项目、审批和资产
  locations,         // 路网、容纳、开放时段和环境条件
  environment,       // 天气、温湿度、能源、水与污染
  knowledge,         // 带来源、访问权和认识主体的信息
  event_queue        // 下一批确定性或有界随机事件
}
```

给定世界参数 `theta`、Agent/系统命令 `U` 和可复现外生扰动 `xi`：

```text
S(t + dt) = F_theta(S(t), U[t, t+dt], xi(seed, t, dt))
```

其中：

- 连续变化用于水量、植物生长、能量、衰减和价格等慢变量；
- 离散事件用于到货、会议开始、工序完成、设备故障、承诺到期和消息到达；
- 模拟器直接跳到下一个事件边界，不逐分钟调用 LLM；
- 相同 `S + U + theta + seed` 必须得到完全相同的 outcome。

### 1.2 为什么不做全量多 Agent 仿真

首版只精细模拟能改变缪尔赛思生活的局部经济：本人、生态科、生态园、少量协作
NPC，以及它们与莱茵和特里蒙外部系统的输入输出。城市和莱茵其余部分先作为带库存、
价格、交付周期和事件分布的边界节点。

这不是因为外部世界不存在，而是为了让模型闭合：模拟边界之外的输入必须通过明确
的 `external_source`、订单、交通或可信事件进入，不能从自然语言背景里直接出现。

---

## 2. 世界模型的六类实体

| 实体 | 数学角色 | 例子 |
|---|---|---|
| `ResourceType` | 定义量纲、守恒、上下界和衰减规律 | 清洁水、实验耗材、预算、注意容量、数据 |
| `Account` | 某主体在某地点持有多少资源 | 生态园水箱、生态科耗材库、缪尔赛思个人余额 |
| `ProcessDefinition` | 输入、容量、时间经过怎样变成输出 | 样本培养、检测、报告复核、设备维护 |
| `ProcessInstance` | 某次具体生产活动的在制品 | S-4 第三次培养批次 |
| `Actor` | 能持有资源、提供容量、拥有权限和提交命令 | 缪尔赛思、塞雷娅、当班研究员、生态科 |
| `LocationNode` | 资源与行动发生的空间节点 | 生态园、主控区、会议室、街区、外部供应商 |

关系全部显式化：资源属于账户，账户属于主体并位于地点；工序从账户扣输入、占用
容量、向账户写输出；移动在地点图上发生；权限只允许操作，不凭空生成资源。

---

## 3. 资源语义与守恒规律

### 3.1 资源类型不是一个总分

不同资源遵守不同数学规律，不能都塞进 `utility` 或 `energy` 一个数里。首版支持
六种资源法则；这是物理/经济语义的有限集合，不是角色行为候选集合。

| 法则 | 状态 | 数学特性 | 例子 |
|---|---|---|---|
| `stock` | 可累计数量 `x >= 0` | 转移守恒，可消耗、产出、衰减 | 水、营养液、样本、食物、实验耗材 |
| `currency` | 账户余额 | 组织边界内复式转移；外部收支有来源 | 个人余额、科室预算 |
| `capacity` | 每时间区间可用量 | 不可跨期囤积，同一区间不能重复占用 | 人员工时、仪器小时、交通运力 |
| `condition` | 有上下界的状态 | 可恢复、恶化，但不能直接转移 | 身体能量、设备健康、植株健康 |
| `information` | 带来源的可复制对象 | 复制不消耗原件，读取受权限和感知限制 | 原始读数、报告、知识、终端文字 |
| `permission` | 对主体-对象-操作的授权 | 不可当普通数量交易，有签发和失效事件 | 实验室访问、审批权、数据读取权 |

### 3.2 库存方程

对任意可累计资源 `i`：

```text
x_i(t + dt)
  = x_i(t)
  + produced_i
  + transferred_in_i
  + external_in_i
  - consumed_i
  - transferred_out_i
  - decay_i
  - external_out_i
```

硬约束：

```text
x_i(t) >= 0
transferred_out_i <= available_i
consumed_i <= reserved_i + unreserved_available_i
```

任何资源增加都必须来自：另一个账户转入、合法生产工序产出、已验证外部输入，或
明确配置的恢复/再生规律。LLM 不能写一句“她找到了材料”直接增加库存。

### 3.3 生产矩阵

用输入矩阵 `A`、输出矩阵 `B` 和批次数量向量 `q` 表示一组工序：

```text
x_after = x_before + (B - A) * q - decay + external_flow
```

开工前必须满足：

```text
A * q <= available_stock
C * q <= available_capacity_over_interval
all(preconditions) == true
all(required_permissions) == true
```

`C` 是工序对人员、仪器、空间和注意容量的需求矩阵。库存够但仪器被占用，工序仍
不能开始；有权限但没有样本，也不能把权限当成产出。

### 3.4 容量不能被重复花费

对容量资源 `k` 和时间区间 `[t0, t1)`：

```text
sum_j allocation(k, process_j, [t0, t1)) <= capacity(k, [t0, t1))
```

容量在区间结束后失效，不能把“昨天没用完的两小时注意力”存到今天。设备、人员、
流形控制和本体时间都使用同一预留机制，因此会议和实验会真实冲突，而不是同时在
文字里被宣布完成。

### 3.5 货币与预算

组织内部转账使用平衡分录：

```text
debit(payer, amount) + credit(payee, amount) = 0
```

模拟边界外的工资、拨款、采购和消费必须各有外部账户。外部账户可以不模拟内部
经济，但必须留下来源、金额、时间和交换物。预算不是情绪，也不是“能不能做”的
唯一条件；采购还受库存、价格、交期、运输和权限约束。

### 3.6 信息与知识不守恒，但必须有来源

信息可以复制而不消耗原件，但认识主体只能获得自己可感知、被告知或获准读取的
副本：

```text
knowledge(actor, fact)
  requires observation_or_message
  and source_ref
  and visibility(actor, source)
```

原始读数、解释、结论和记忆分别存储。一次实验失败仍可生产“失败数据”；它消耗了
时间与材料，但不是零产出。

---

## 4. 生产过程与工作流

### 4.1 批处理工序

每个 `ProcessDefinition` 至少定义：

```text
inputs                  立即扣除或预留的库存
capacity_requirements   随时间占用的人员/设备/注意/空间
duration_model          确定值或有界分布
preconditions           地点、环境、权限和上游工序
output_model            产量、质量和数据
failure_model           失败消耗、废料、返工或部分产出
interruptibility        能否暂停，暂停损失什么
```

工序生命周期是客观生产状态：

```text
queued -> reserved -> running -> completed
                       |   |
                       |   +-> failed / rework_required
                       +-----> paused / cancelled
```

这些状态不是 Agent 的行为树。Agent 可以提出任何开放计划；只有当计划需要改变
客观生产状态时，编译器才生成开工、预留、暂停、转移或取消命令。

### 4.2 进度与产量

正在运行的工序 `j`：

```text
progress_j(t + dt)
  = clamp(progress_j(t) + dt * effective_rate_j, 0, 1)

effective_rate_j
  = nominal_rate_j
  * equipment_factor
  * environment_factor
  * operator_factor
  * coordination_factor
```

完成时才结算主要产出：

```text
output_j = recipe_output_j * yield_j

yield_j = clamp(
  base_yield
  * input_quality
  * process_quality
  * environment_quality
  * (1 - failure_loss),
  0,
  yield_cap
)
```

所有随机量来自有界、带 seed 的分布。当前 Affect、对话气氛或“今天需要有故事”不能
改变产量。

### 4.3 工序队列

仪器、审批人、洁净空间和运输节点都是服务站。每个站点定义：

- 同时服务容量；
- 开放时段；
- 队列纪律，如先到先服务、明确优先级或预约；
- 服务时长分布；
- 维护与故障规律；
- 谁可以改变队列顺序。

一个实验可能材料充足却排不到设备；也可能设备空闲但操作员工时不足。延迟由队列
状态自然产生，不需要 LLM 编一个临时会议来阻止她。

### 4.4 项目是生产图，不是剧情图

研究项目用工序依赖图表示：

```text
样本入库 -> 培养 -> 观察 -> 检测 -> 分析 -> 报告 -> 复核
                       |               |
                       +-> 重采样 <----+
```

依赖图只描述“产出需要哪些前置工作”，不规定角色会怎样感受、联系谁或作何选择。
失败边可以回到重采样、补材料或终止；它们生产真实成本和新信息，而不是预写剧情节拍。

---

## 5. 世界边界与资源禀赋

### 5.1 分层账户

首版账户按五层组织：

```text
Terra external boundary
  -> Trimounts city boundary
    -> Rhine Life organization
      -> Ecology Department / Ecology Garden
        -> Actor / device / storage / project
```

每一层只精细模拟与当前生活相关的部分。上层向下层提供资金、商品、能源、交通、
公共服务和制度约束；下层向上层交付研究、报告、费用、申请和需求。

### 5.2 生态科初始资源目录

具体数量等待 Owner 与后续校准，但资源种类和单位必须先定。建议首版只启用下表：

| 资源 | 法则 | 单位 | 持有节点 | 主要来源 | 主要消耗 |
|---|---|---|---|---|---|
| 科室预算 | `currency` | credit | 生态科 | 莱茵拨款/项目 | 工资外成本、采购、维护、交通 |
| 员工工时 | `capacity` | person-minute | 生态科角色池 | 排班 | 工序、会议、行政、维护 |
| 主任审批容量 | `capacity` | minute | 缪尔赛思 | 清醒可用时间 | 方案、文件、人员事务 |
| 洁净实验空间 | `capacity` | bench-minute | 实验区 | 场所开放/维护 | 培养、检测、操作 |
| 仪器容量 | `capacity` | device-minute | 各设备 | 设备健康/排班 | 检测、分析、校准 |
| 清洁水 | `stock` | liter | 水箱/生态园 | 市政/回收/降水 | 灌溉、清洁、流形环境支持 |
| 能源配额 | `stock` 或分时 `capacity` | kWh | 生态科 | 莱茵设施 | 温控、照明、仪器、水循环 |
| 培养耗材 | `stock` | kit | 耗材库 | 采购到货 | 培养批次 |
| 维护备件 | `stock` | item | 维护库/外部设施 | 采购或莱茵设施调拨 | 设备维护 |
| 样本 | `stock` | specimen | 样本库/项目 | 采集、合作方 | 检测、培养、损耗 |
| 数据集 | `information` | artifact | 项目/档案 | 观察、检测、外部协作 | 不消耗；分析需权限与工时 |
| 设备健康 | `condition` | 0..1 | 各设备 | 维护恢复 | 使用与自然磨损 |
| 场所权限 | `permission` | grant | 人员/角色 | 组织签发 | 到期、撤销，不按数量消耗 |
| 维护技师工时 | `capacity` | technician-minute | 莱茵设施边界 | 排班/服务预约 | 校准、检修和维修 |

不为“科研灵感”“关系”“好感”“情绪”建立可交易资源。它们不遵守库存守恒，也不
应通过加减一个数成为生产资料。

### 5.3 个人资源禀赋

缪尔赛思作为 Actor 至少具有：

| 状态 | 数学含义 | 说明 |
|---|---|---|
| 本体时间 | 分时 `capacity` | 同时只能占用一次；移动、工作、睡眠都会消耗 |
| 认知容量 | 分时 `capacity` | 科研判断、会议、复杂交流与流形控制共同竞争 |
| 流形控制容量 | 分时 `capacity` | 连续负荷，不设固定流形个数上限 |
| 身体能量 | `condition [0,1]` | 睡眠、进食恢复；清醒、活动、疾病消耗 |
| 睡眠压力 | `condition [0,1]` | 清醒累积，睡眠下降；影响可用容量而非决定行为 |
| 个人余额 | `currency` | 工资、日常消费、个人物品，不与科室预算混用 |
| 随身物 | `stock/item` | 必须有位置、所有权和来源事件 |
| 权限集合 | `permission` | 主任权限、场所权限、数据权限分别记录 |
| 已知信息 | `information refs` | 只含她实际可知的内容 |

### 5.4 流形的资源规律

流形扩展的是身体执行面，不复制主体。对同时受控任务 `m`：

```text
control_load
  = sum_m(
      precision_weight_m
      * distance_factor_m
      * novelty_factor_m
      * concurrency_factor_m
    )

coordination_factor
  = 1 / (1 + alpha * max(0, control_load - comfortable_load)^beta)

error_hazard
  = base_error
  + gamma * max(0, control_load - comfortable_load)^delta

P(error in dt) = 1 - exp(-error_hazard * dt)
```

其中 `error_hazard` 的量纲是 `1/time`，因此改变积分步长不会凭空改变长期差错率。

规则含义：

- 没有“第 N 个流形必然失败”的硬门槛；
- 远、精细、陌生和并行会连续降低效率、提高小差错率；
- 高层认知任务同时计入认知容量，不能用流形绕过；
- `alpha/beta/gamma/delta` 是版本化参数，不进入 Prompt；
- 同一状态和 seed 下差错可回放；差错规模还受安全规则上限约束。

原作没有提供这些系数。公式是产品模型，Owner 只需确认形状和相对关系，具体数值
通过仿真校准。

### 5.5 可直接运行的归一化 Day-0 fixture

在真实单位和组织数据定稿前，工程实现仍需要一组闭合数值做性质测试。以下是
`simulation_fixture_v1`，**只用于测试，不是 canon，也不是最终世界禀赋**。

其中 `NDD` 表示对应资源的一个正常日需求，`RCU` 表示一次常规实验批次的预算成本。

| 账户/状态 | Day-0 数值 | 含义 |
|---|---:|---|
| 生态园清洁水 | `3.0 NDD` | 在无补给时约覆盖三个普通日 |
| 每日能源容量 | `1.25 NDD/day` | 普通运行后保留约 25% 峰值余量 |
| 常规培养耗材 | `12 batch` | 可启动十二个常规批次 |
| 循环泵维护备件 | `1 item` | 可完成一次标准维护，补货有交期 |
| 科室可支配预算 | `40 RCU` | 足以运行，但维护与额外采购会产生取舍 |
| 研究员工时 | `1440 person-minute/day` | 三个等效工作日岗位，只是 fixture 容量 |
| 维护技师容量 | `240 technician-minute/day` | 来自莱茵设施边界，需预约 |
| 主任可分配工作容量 | `300 minute/day` | 扣除固定会议与管理后的开放容量 |
| 洁净台 | `960 bench-minute/day` | 两个等效台位的日容量 |
| 主要检测仪 | `600 device-minute/day` | 含校准和维护后的服务容量 |
| 循环泵健康 | `0.62` | 接近维护区，但尚未失效 |
| 主要检测仪健康 | `0.78` | 正常可用，存在缓慢磨损 |
| S-4 健康 | `0.48` | 存活但状态偏弱 |
| S-4 stress | `0.35` | 有累积胁迫，尚无已验证根因 |
| 缪尔赛思身体能量 | `0.72` | 可正常工作，不代表她会选择继续工作 |
| 缪尔赛思睡眠压力 | `0.28` | 日间普通水平 |

fixture 的目标不是还原泰拉计量，而是验证系统会在没有 LLM 造事的情况下产生：正常
完成、容量冲突、维护、延期、失败数据和空事件。Owner 定稿后，用有来源的正式参数
集替换 fixture，旧版本继续保留用于回归。

---

## 6. 生态园的生物与环境模型

### 6.1 采用植株群组，不模拟单个细胞

每个物种/批次群组 `g` 记录：

```text
biomass_g           生物量
health_g            健康状态 0..1
water_store_g       可利用水分
nutrient_store_g    可利用营养
adaptation_g        对当前环境的适应状态
stress_g            累积胁迫
observed_traits_g   已验证或待验证的性状 observations
```

环境节点记录：

```text
temperature, humidity, light, water_quality,
soil_moisture, contamination, irrigation_capacity,
drainage_capacity, energy_available
```

### 6.2 水量平衡

```text
water(t + dt)
  = water(t)
  + irrigation
  + precipitation
  - evapotranspiration
  - drainage
  - leakage
```

灌溉受水箱库存、泵容量、能源和控制设置共同限制。喷头提前启动会真实减少水和电，
改变局部湿度，并占用清理工时；但在正常参数下不会自动升级成园区灾难。

### 6.3 生长与健康

群组生长使用有界的环境响应：

```text
growth_g
  = r_g * biomass_g * (1 - biomass_g / carrying_capacity_g)
  * f_water(g)
  * f_nutrient(g)
  * f_temperature(g)
  * f_light(g)
  * f_adaptation(g)

health_change_g
  = recovery_g
  - water_stress_g
  - nutrient_stress_g
  - temperature_stress_g
  - contamination_stress_g
```

每个 `f_*` 都是 `[0,1]` 的物种参数函数。超出适宜区间不会立刻产生戏剧结果，而是
先累积 stress、降低生长和提高异常 observation 概率。

### 6.4 观察不等于发现新事实

模型产生客观生物状态；观察工序产生带噪读数：

```text
measurement = observe(true_state, instrument_quality, operator_attention, seed)
```

性状解释需要检测和分析工序。引擎可以计算“读数偏离基线”，但不能自动宣布新物种、
精灵线索或科研突破。只有通过配置的验证链和来源审计，才能把 hypothesis 升级为
已验证知识。

---

## 7. 人体节律与日常再生产

身体模型只提供约束，不替角色决定要不要休息。

```text
energy(t + dt)
  = clamp(
      energy(t)
      + sleep_recovery
      + food_recovery
      - basal_cost
      - physical_work
      - control_cost,
      0,
      1
    )

sleep_pressure(t + dt)
  = clamp(
      sleep_pressure(t)
      + awake_accumulation
      - sleep_release,
      0,
      1
    )

available_cognition
  = base_cognition
  * health_factor
  * energy_factor
  * sleep_factor
```

吃饭、睡眠、锻炼、疾病和源石/污染防护是生产能力的再生产过程。它们可以被推迟，
但推迟会改变后续容量与风险。情绪不能直接修改身体能量；情绪可能影响 Policy 提出
什么行动，但同一行动的身体成本不变。

---

## 8. 组织运行与科研生产逻辑

### 8.1 生态科的基本循环

```text
预算/人员/设施
   -> 采购与排班
   -> 样本和实验批次
   -> 数据与失败数据
   -> 分析/报告/评审
   -> 新预算、合作、返工或项目终止
```

每一环都通过账户和工序连接：

- 采购：预算扣除 -> 供应商订单 -> 交期 -> 到货入库；
- 实验：耗材/样本 + 工时 + 仪器时间 -> 数据/废料/返工需求；
- 行政：文件 + 主任审批分钟 -> 批准、退回或补材料请求；
- 维护：预算 + 备件 + 技师/设备停机 -> 设备健康恢复；
- 合作：权限 + 数据副本 + 双方工时 -> 联合产出与新承诺。

以下四条配方组成首个闭合 fixture：

| 工序 | 输入与容量 | 时长 | 完成产出 | 失败/部分产出 |
|---|---|---:|---|---|
| `s4_daily_cultivation` | `0.08 NDD` 水、`0.02 NDD` 能源、`15 person-minute`、`1440 bench-minute` | 1 日 | 按生长方程更新 S-4 状态，创建观察窗口 | 胁迫上升、无显著生长；仍保留环境日志 |
| `s4_observation` | `30 person-minute`、`20 device-minute`、`15 cognition-minute` | 30-60 分钟 | 一份带噪原始读数与 observation | 低质量/不完整读数，消耗的时间不返还 |
| `report_review` | 报告 artifact、`45 director-minute` | 30-90 分钟 | `approved`、`returned_with_requirements` 或来源明确的待补项 | 中断时保留审阅痕迹，不生成批准 |
| `circulation_pump_maintenance` | `1 spare_part`、`120 technician-minute`、`120 pump-downtime-minute` | 2-4 小时 | 设备健康提高 `0.25`，上限为 `1` | 健康只提高一部分、需二次维护，并生成维护记录 |

这些数值同样只是 fixture。正式配方必须将每个输入、容量、输出和失败结果落到有单位
的账户；不能保留“消耗一些资源”“得到一些数据”这种无法执行的描述。

### 8.2 期限与承诺怎样进入生产系统

承诺不是资源，但会创建有期限的需求：

```text
commitment
  -> required_output
  -> required_process_graph
  -> required_inputs/capacities
  -> feasible_schedule or conflict
```

当两个承诺争夺同一容量时，引擎只计算冲突与可行方案空间，不替缪尔赛思选择谁更
重要。Routine 调度可以遵守既有预约和明确组织优先级；任何需要改变承诺、伤害关系
或承担新风险的分配都进入开放 Policy。

### 8.3 后台工作人员

未聚焦 NPC 不运行完整 LLM。其岗位容量按排班进入生态科资源池，已经接受的任务按
队列与工序规则推进。只有出现下列决策边界时才需要 NPC Policy 或焦点模型：

- 要不要接受一个尚未形成的请求；
- 两项职责冲突且制度没有唯一答案；
- 需要解释、协商、拒绝、隐瞒或承担风险；
- 行动会形成新的长期承诺或关系后果。

这样普通生产由数学模型推进，NPC 仍保留自主性，而不是每分钟生成一段内心戏。

对已经接受、路径明确的 routine jobs，后台调度器可以求一个纯运营问题：

```text
minimize sum_j(
  due_weight_j * tardiness_j
  + switching_cost_j
  + overtime_cost_j
)

subject to:
  stock conservation
  capacity reservations
  queue/access rules
  accepted commitments only
```

该求解器不得替 NPC 接受新请求、解除承诺或承担新风险。若可行解需要改变这些语义，
它只提交 `decision_required`，由对应主体的 Policy 决定。

---

## 9. 特里蒙边界模型

### 9.1 交通网络

地点构成有向图 `G = (V, E)`。边记录：

```text
base_travel_time
money_cost
opening_window
transport_capacity
weather_sensitivity
access_requirement
```

实际移动时间：

```text
travel_time_e
  = base_time_e
  * congestion_factor_e
  * weather_factor_e
  + bounded_delay(seed, e, t)
```

本体与流形分别占用位置；流形不能把本体随身物或身份签字能力一起移动。

### 9.2 市场与供应商

MVP 不模拟整座城市的一般均衡经济。每类外部商品只建供应节点：库存状态、价格、
交期、营业时间和有界波动。

可选价格模型：

```text
log_price(t + 1)
  = mean_log_price
  + rho * (log_price(t) - mean_log_price)
  + bounded_shock(seed, t)
```

价格只影响预算和购买选择，不触发情绪或对话。二手物品价格也可以用同一规律，产生
她会注意到的生活 observation，但不能为制造话题每天剧烈波动。

### 9.3 天气与公共服务

天气是外生、有季节约束的状态过程，影响交通、温湿度、光照、生态园能耗和郊外
活动可行性。公共服务提供能源、水、交通和营业时段。它们可以有小故障和排队，但
天灾、战争与城市级事故不属于普通随机过程。

---

## 10. Agent 怎样作用于数学世界

### 10.1 开放行动到世界命令

Policy 仍直接生成一个开放语义行动，例如：

> 把下午原定的报告复核延后，先亲自去看 S-4 的根部状态，同时让流形把已完成的
> 湿度记录带到会议室，请当班研究员保留仪器预约。

Action Compiler 从中提取世界操作：

```text
reschedule(commitment/report_review)
reserve(body_time, ecology_garden, interval)
move(body, ecology_garden)
reserve(control_capacity, manifestation_task, interval)
start(observation_process, S-4)
request(npc, preserve_device_booking)
```

这些命令是状态机的执行语言，不是给 LLM 选择的语义候选。`request` 也不等于成功；
NPC 接受后才形成资源预留或承诺。

### 10.2 引擎负责什么

- 验证库存、容量、位置、时间、权限和安全；
- 计算移动、消耗、排队、进度、产出、失败和副作用；
- 推进植物、设备、身体、市场和天气状态；
- 生成达到阈值、工序完成、资源不足和期限冲突事件；
- 保证同一输入可回放；
- 把结果提交为客观事实。

### 10.3 LLM 负责什么

- 根据 Working Self 提出开放意图与计划；
- 在焦点 NPC 决策边界提出其有限视角下的行动；
- 把已提交结果形成主观解释、记忆和表达；
- 生成自然语言，但不能新增计算结果。

### 10.4 Affect 与世界模型

Affect 可以改变 Policy 对同一处境的主观理解，因而可能提出不同命令；它不能修改：

- 资源余额、生产配方、设备容量和交期；
- 相同工序的耗时、产量公式和失败分布；
- NPC 已提交的决定；
- 外生事件 seed；
- 世界守恒与权限规则。

`affect_mode=off/shadow/active` 下，对同一个状态和同一组世界命令，`WorldEngine.step`
必须得到相同结果。

---

## 11. 世界自主运行算法

### 11.1 下一事件时间

```text
t_next = min(
  next_process_completion,
  next_schedule_boundary,
  next_commitment_due,
  next_delivery,
  next_maintenance_or_failure,
  next_environment_threshold,
  next_external_event
)
```

引擎从 `t` 积分到 `t_next`，提交确定性状态变化，再处理同一时刻的离散事件。事件
排序使用稳定优先级和幂等键，不能依赖数据库返回顺序。

### 11.2 什么时候不调用 LLM

- 工序按既有预留继续运行；
- 植物、能量、库存和设备按方程变化；
- 到货、自动灌溉、普通排班和已接受任务按规则推进；
- 没有跨阈值、承诺冲突或主体可感知的新信息；
- 离线聚合只跨过普通生产节点。

### 11.3 什么时候产生认知/决策事件

- 关键资源不足，当前计划不可行；
- 两个承诺争夺同一不可替代容量；
- NPC 提出需要接受、拒绝或协商的请求；
- 工序失败、质量异常或产生需要解释的新 observation；
- 环境阈值改变了可达性、安全或生产条件；
- 博士消息到达；
- 已提交的长期目标出现新的可行路径。

这些触发条件来自世界状态，不是固定剧情模板。触发只要求主体重新决定，不规定她
会采取什么行动，更不规定她必须联系博士。

---

## 12. 一个涌现链条示例

以下链条没有预写“今天她会烦”或“她会主动聊天”：

1. 生态园循环泵健康从 `0.62` 自然磨损到维护阈值，生成维护需求。
2. 维护需要停用一段灌溉容量，并占用技术员工时和备件。
3. 同一时段 S-4 培养批次进入关键观察窗口，需要稳定湿度和仪器预约。
4. 生态科只能临时调用备用泵；备用泵效率较低，能源消耗上升。
5. 预算仍够，但当天能源配额接近上限，另一批非紧急检测被顺延。
6. 顺延使她此前答应研究员的报告期限与重组会议发生冲突。
7. 当班研究员请求她决定：保留 S-4 观察、申请额外能源，还是调整其它批次。
8. 到这里才调用开放 Policy。她的记忆、承诺、人格和可选 Affect 影响她怎样处理，
   但“泵磨损、能耗上升、检测顺延”都已经由世界模型确定。
9. 博士若此时发来消息，它与上述处境相交；消息不是危机的原因，也不会让资源恢复。
10. 她是否回复、说多少、是否提到这件事，由同一个主体在当下决定。

这类活人感来自多个平凡系统互相占用资源，而不是从候选事件集中抽到“设备故障”。
泵是否达到阈值由使用与磨损决定，维护后它也会长时间正常，不会为了新鲜感反复坏。

---

## 13. TypeScript 契约草图

以下只固定边界形状，不在本文冻结 v1 Schema：

```ts
type ResourceLaw =
  | "stock"
  | "currency"
  | "capacity"
  | "condition"
  | "information"
  | "permission";

interface ResourceType {
  id: string;
  law: ResourceLaw;
  unit: string;
  min?: number;
  max?: number;
  decayModel?: string;
}

interface ResourceAccount {
  id: string;
  resourceTypeId: string;
  ownerId: string;
  locationId?: string;
  balance: number;
  reserved: number;
  revision: number;
}

interface ProcessDefinition {
  id: string;
  version: string;
  inputs: ResourceAmount[];
  outputs: ResourceAmount[];
  capacities: CapacityRequirement[];
  durationModel: string;
  outputModel: string;
  failureModel: string;
  preconditionRuleIds: string[];
  requiredPermissionIds: string[];
  interruptibility: "none" | "lossy" | "safe";
}

interface ProcessInstance {
  id: string;
  definitionId: string;
  definitionVersion: string;
  status: ProcessStatus;
  progress: number;
  reservations: ReservationRef[];
  startedAt?: string;
  expectedCompletionAt?: string;
  baseStateRevision: number;
  randomSeed: string;
}

interface WorldStepInput {
  fromTime: string;
  untilTime: string;
  baseStateRevision: number;
  commands: WorldCommand[];
  ruleSetVersion: string;
  randomSeed: string;
}

interface WorldStepResult {
  proposedEvents: WorldEventProposal[];
  resourceDeltas: ResourceDelta[];
  processDeltas: ProcessDelta[];
  nextEventTime?: string;
  audit: WorldStepAudit;
}
```

`ResourceLaw` 和 `ProcessStatus` 是机器状态的有限类型，允许严格校验；角色的意图、
关切、情绪和语义行动不因此被枚举。

生产配方、资源类型、地点图和参数放版本化 JSON/YAML 数据；积分、守恒、预留、队列
和随机模型写成纯 TypeScript。模型调用不得发生在 `WorldEngine.step` 内部。

---

## 14. 必须通过的性质测试

| ID | 性质 |
|---|---|
| `WM-P01` | 任意合法 step 后，所有 `stock/currency` 账户不低于允许下界 |
| `WM-P02` | 无 external flow 的转移前后，总量守恒 |
| `WM-P03` | 同一时间区间的容量预留总和不超过容量 |
| `WM-P04` | 未完成工序不能产生完成态主产出 |
| `WM-P05` | 失败工序的消耗、废料、数据和返工均按定义入账，不静默回滚时间 |
| `WM-P06` | 权限和信息不能被当成材料库存消耗或凭空转化为物质 |
| `WM-P07` | 相同初态、命令、规则版本与 seed 得到字节级一致的 proposal |
| `WM-P08` | 关闭 Affect 或删除其派生表不改变同一世界命令的模拟结果 |
| `WM-P09` | 博士沉默不产生资源损失、故障概率、NPC 请求或联系增益 |
| `WM-P10` | 联想与记忆不能直接写资源账户、工序状态、环境或 NPC 决定 |
| `WM-P11` | 离线聚合结果与逐事件边界执行结果一致 |
| `WM-P12` | 任何世界产出都能追到配方、输入账户、容量预留、外部来源或恢复规律 |

---

## 15. MVP 范围与扩展顺序

### M0：模拟内核

- 资源类型、账户、转移、预留、生产批次、事件队列；
- 确定性 seed、状态 revision、审计和性质测试；
- 不接 LLM，不接 Affect。

### M1：一个闭合生活循环

- 缪尔赛思的本体时间、认知容量、流形负荷、能量和睡眠压力；
- 生态园水/电/泵/植物群组；
- 一个 S-4 培养-观察-复核工序图；
- 验证数日离线推进能自然产生正常、延迟、维护与空事件。

### M2：生态科生产系统

- 员工工时、仪器队列、耗材、预算、采购和报告审批；
- 承诺转换为生产需求；
- 少量后台岗位容量与焦点 NPC 决策边界。

### M3：城市边界与 Agent 接入

- 交通、供应商、价格、天气和公共服务；
- OpenAction -> WorldCommand 编译；
- WorldOutcome -> observation/memory/Working Self；
- `affect_mode=off` 先完成整条闭环。

### M4：校准与扩展

- 200 轮加速模拟和 7 天 1:1；
- 校准故障、交期、能耗、流形负荷与植物响应；
- 再判断是否增加更多科室、NPC、城市产业或 active Affect。

不要首版模拟泰拉宏观经济、整个莱茵组织、所有植物个体或 5-12 个完整 Agent。局部
模型闭合且有解释力，比名词覆盖面更重要。

---

## 16. Owner 需要提供的世界参数

下一步需要的不是 Prompt，也不是 Utility 内容，而是**资源表、生产配方和初始禀赋**。

### 16.1 必须先确认

1. 是否接受“混合离散事件 + 库存-流量 + 生产网络”作为世界内核？
2. MVP 是否只模拟“缪尔赛思个人 + 生态园 + 生态科 + 特里蒙边界”，暂不做泰拉
   宏观经济？
3. 是否接受六种资源法则，以及关系/情绪/科研灵感不作为可交易资源？
4. 是否接受流形连续负荷公式，不设置固定数量上限？
5. 生产系统的时间尺度以分钟/小时为主，植物生长以小时/日积分，是否合适？

### 16.2 需要共同填写的种子表

- 生态科有哪些真实资源账户，单位是什么；
- 每个账户 Day-0 大约是充足、正常、偏紧还是短缺；
- 3-5 条最常发生的生产链及其输入、耗时、容量和输出；
- 哪些设备/人员是瓶颈，补充它们通常需要多久；
- S-4 和另外 2-3 个植物群组的适宜环境与当前状态；
- 科室的预算周期、采购交期、排班和审批关系；
- 缪尔赛思本体、认知与流形负荷的相对成本；
- 哪些外部供应或天气扰动可以普通生成，哪些必须来自 canon/Owner。

这些内容先用自然语言和相对量级填写即可。工程侧再把它们转成有单位的参数、
JSON Schema、TypeScript 纯函数和回放测试；不要求 Owner 直接填写小数系数。
