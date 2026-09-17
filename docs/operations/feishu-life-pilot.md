# S-4 世界与飞书私聊试运行

对应任务：M2.1 / M21-013。代码入口：`src/gf/lifeCli.ts`。

常开运行、数据迁移与远程 debug 见 [服务器部署方案](server-deployment.md)。

这是在既有认知模块上接出的单用户生活场景。S-4 的灌溉、仪器采样、设备磨损、补给和已开始活动可以在没有用户消息、没有模型调用时推进。用户消息与世界事件共同进入 Perception → Gate → Working Self → Open Policy；随后另一次模型调用忠实编译行动，确定性执行器判断是否可行，StateManager 提交结果。只有明确的沟通意图才创建 speech/outbox。

## 当前边界

- 场景是生态园、办公室和住所；可执行移动、S-4 观察、补水、泵维护、等待及文字交流。执行接口只提供给后置编译器，不给开放 Policy 一份行为菜单。
- 使用独立的 `runtime/life.db`，不会把旧 M1 CLI 状态直接当作新世界初态。请勿把新入口指向旧数据库。
- 记忆保留已经感知的最近 24 条记录；其中被拒绝的行动作为不可裁剪的反证，当前进行中的活动另外保留。通用 FTS 检索、承诺管理、语义反证识别和长程记忆仍待接入。
- Policy 的自我体验与未来关注意图随 episode 保存。目前不会将任意 AttentionIntent 编译为生效的 watcher；Gate 使用现有确定性实现和弱信号累计。
- Affect 固定关闭。没有完整 NPC 社会、生理模型或经过校准的长期体验。当前供应和耗用参数是可版本化的试运行参数。
- 这条试运行链路没有替代通用 M20-021..026 / M21 世界工程的验收。

## 飞书配置

在[飞书开发者后台](https://open.feishu.cn/app)创建企业自建应用，开启机器人能力，并将使用范围限制为自己。

1. 开启 `im:message.p2p_msg:readonly` 和 `im:message:send_as_bot` 权限。
2. 订阅 `im.message.receive_v1`；接收方式选长连接。
3. 发布并安装应用，使权限生效。长连接配置如要求先建立连接，先完成下面的凭据配置并启动进程，再回后台保存事件订阅。
4. 获取自己在**这个应用下**的 `open_id`，用平台调试工具核对身份。不要填用户名、手机号、`user_id` 或另一个应用的 `open_id`。

接入采用[飞书官方 Node SDK](https://github.com/larksuite/node-sdk/blob/main/README.zh.md)的 WebSocket 事件接收和[文字消息接口](https://open.feishu.cn/document/server-docs/im-v1/message/create)，无需公网回调地址。入站只接收配置的本人发给机器人的私聊文字，群聊、其他人、机器人消息和非文字消息会被忽略。

## 本地启动

需要 Node 24 与能够连接飞书和 DeepSeek 的网络。在仓库根目录：

```bash
npm ci
npm run build
npm run life:smoke
```

`life:smoke` 使用独立测试数据库和冻结模型/发送夹具，不连接真实模型、不发送飞书消息。重复运行复用该测试数据库，因此已有事件不会再次发送。

将 `.env.example` 复制为 `.env` 并在本机填写：

| 配置 | 内容 |
|---|---|
| `FEISHU_APP_ID` | 自建应用 App ID |
| `FEISHU_APP_SECRET` | 应用密钥 |
| `FEISHU_OWNER_OPEN_ID` | 你在该应用下的 open_id |
| `DEEPSEEK_API_KEY` | 现有 DeepSeek 模型服务密钥 |
| `GF_PROACTIVE_ENABLED` | `true` 允许基于世界经历主动联系；未设置则关闭 |
| `GF_LIFE_DB` | 持久化数据库路径 |

密钥仅从运行环境读取；`.env`、数据库、日志与密钥文件被 Git/Docker 排除。检查只输出缺失项名称，不输出密钥。

```bash
node --env-file=.env dist/gf/lifeCli.js --check-config
node --env-file=.env dist/gf/lifeCli.js
```

进程需要一直运行；电脑睡眠或关闭进程期间不会交流。重启时世界按持久化时间边界补算，未处理消息仍在队列中。一次只能运行一个实例；数据库锁阻止并行启动。

## Docker 常驻运行

```bash
docker compose -f compose.life.yml up -d --build
docker compose -f compose.life.yml logs --tail=50 gf
```

使用具备持久化磁盘的常开机器。Compose 配置了重启策略和数据卷，不开放入站端口。停止使用 `docker compose -f compose.life.yml stop`。迁移或备份前先停服务，并保存整个 `/data` 卷；不要只复制仍在写入的 SQLite 主文件。不要执行删除数据卷的命令来升级。

当前开发环境没有 Docker，镜像构建仍需在目标机器验证。

## 飞书里怎么使用

- 普通文字：进入同一认知链路。模型可以回复、行动或等待；系统不会强制每轮生成聊天文本。
- `/status`（兼容 `/stats`）：返回明确标为系统状态的世界时间、位置和当前活动。
- `/mute`：持久化冻结出向投递，不发送确认消息；已经交给平台的在途请求无法撤回。
- `/unmute`：解除冻结，允许原队列继续发送。

世界持续推进，但不是每次采样都调用模型，也不会固定“每两小时问候一次”。弱信号累计和实际完成节点决定是否开启认知。

## 恢复与排查

- 事件先持久化，再交给认知处理；模型失败保留待处理事件和系统错误码，稍后重试。不会用角色口吻编造失败原因。
- 模型调用、飞书网络请求不在数据库事务中。世界结果、活动状态、speech/outbox 在 StateManager 一次提交，过期 revision 的提案被拒绝。
- 飞书出站 UUID 从固定 outbox 标识生成。进程在发送后退出时，恢复沿用原标识；最多尝试 8 次，首次发送超过 45 分钟的未确认消息进入 `dead_letter`，停止自动重发。真实平台去重行为仍须完成现场验证，不能把本地测试称作端到端 exactly-once 保证。
- 数据库固定绑定 App ID 和本人 open_id，改成另一个人或应用时启动失败。
- `life_event_queue.last_error`：`capacity_wait` 是等待认知资源，`cognition_failed` 是模型/校验/提交失败。`life_model_attempts` 保存模型输入与结果；可能含个人对话，只在本机排查。
- `life_episodes` 保存 Working Self、行动、执行结果；`wake_decision_audit` 保存激活及未激活判断；`inference_usage_receipts` / `cognitive_energy_settlements` 保存调用与结算；`outbox` / `deliveries` 保存投递链路。
- 模型的计数单位采用明确版本的初始校准。未知模型返回标识或缺少匹配的 usage 口径会 fail closed，需要检查适配而不是跳过结算。

## 现场验收

先关闭主动投递并发一条私聊，核对回复与来源；验证 `/mute` 后没有新投递。随后启用主动投递并观察一次自然的 S-4 世界变化。保存对应 world event、observation、WakeDecision、episode、outbox 和飞书 receipt，确认消息确实来自已发生的经历。真实模型若选择沉默，这一轮合法，但不能声称已经通过“首条自主消息”验收。

没有凭据、正确收件人和常开机器前，只能完成代码及离线验收，不能声称她已在飞书上线。


## 2026-09-16 对话修复

- 同一轮最多读取 8 条、合计 8000 字符的已到重试时间的本人待处理消息（单条不截断）；快照之外的新到消息留待下一轮。每条分别通过 Perception 保存其精确来源闭包；成功 episode 在同一事务完成已读入的事件集合，失败整体保留，`result_json.consumed_event_ids` 可追溯范围。完成处理不等于强制逐条答复。
- 当前输入和历史记忆通过原始事件恢复说话者与发送时间。最近四条自身发言及其回执经 Perception 即时提供；发送队列、平台送达与已读保持区分。这些内部记录不产生递归 wake。旧事件不改写；旧回复中的误述仍是“说过的话”，不是事实证明。
- live Policy 与 compiler 使用版本化生活对话指令，读取 `prompts/slots/S1-immutable-v2.md` 的正文，保留当前角色锚为单一来源；Affect 仍 off。
- compiler v2 同时保存原始 draft 和最终 command。执行对象须由首项意图中的逐字引用支持；不支持的映射返回 capability_gap。该校验确认引用和对象绑定，不声称证明全部语义等价。
- 新活动日志只陈述实际开始的底层步骤，不把完整计划写成已经发生的生活。已存在的历史活动记录保持原样，读取时明确标注其意图区分。

离线回归覆盖合并消费、推理中新消息、失败重试、自身发言可见性、旧记忆归属、批量来源校验与错误动作映射。自然表达和长期避免语义重复仍须用真实模型试聊验收；此补丁未调用真实模型或发送飞书消息。


## 时间上下文修复（2026-09-16 后续）

事件发生、平台接收、感知处理是不同时间。飞书 create_time 有效且不晚于接收时使用其作为事件时间，received_at 仍为接收时间；缺省、无效或未来时钟回退至接收时间，旧数据不改写。

生活链路 Working Self 的历史 as_of 从来源事件 occurred_at 恢复，不使用本次重新观察时刻。持续活动保留本轮仍进行中的语义，并列出 startedAt/endsAt；初始种子明确是初始时刻的状态。观察表 observed_at 仍表示实际感知处理时间，原契约不变。

每次请求明确本轮当前时刻，并将证据标为本次触发、历史背景或发言历史。距今时间是墙钟上下文，不是情绪分档、冷却时长或强制回复开关。模型应将旧记录里的“刚才”“现在”放回原时间理解。检索先按同一来源去重，再按来源事件时间取最近 24 条，反复重新感知不再将旧来源刷成最近事件。

已完成入站事件仍由持久化队列状态保护，重启不重置；相同飞书 message_id 不重入队。世界事件仍可触发新的开放认知与主动表达。本修复不保证所有语义重复都由确定性程序拦截，真实模型效果需结合本轮 trigger 与输出验证。


## 会话基础处理（2026-09-16）

参考 [Codex 的 Thread / Turn / Item](https://openai.com/index/unlocking-the-codex-harness/) 与 [Claude Agent SDK 会话恢复](https://code.claude.com/docs/en/agent-sdk/sessions)：持久会话承载历史，新输入开启工作轮次，恢复本身不重新提交旧输入。这里复用这些边界，不声称采用其 SDK 或复现全部内部实现。

本 pilot 的持久会话由绑定本人身份的同一个 SQLite 账本承载；episode 是一次工作轮次，event/speech 是输入输出记录。保留现有 message_id 去重、冻结批次、原子消费与 outbox 恢复，不另建可能与账本失同步的会话状态。只有 pending 入站事件是待处理消息；历史仍可供理解，未成功处理的旧 pending 在恢复后仍可能执行。

Policy/Compiler v4 把已经过 Perception 且进入 Working Self 的对话原文恢复为 native user/assistant 消息；原文不加引号、不改字。历史按事件时间、同刻账本顺序排列，本轮输入单独置于 turn_boundary 之后。世界事件轮次没有边界后的 user 消息。首条 user JSON 仍是供应商兼容的运行时数据封包，system 明确其数据身份；其中已呈现为对话的 narrative 替换为来源与时间指针，避免同一话语重复出现。未经感知、未进入容量范围、当前批次之外的 pending 消息不会通过对话投影旁路进入请求。

最近最多十二条已处理的本人消息（连续最近窗口，合计至多 8000 字符，整条保留）与最近四条自身发言/回执构成短期会话证据；更早记录仍由来源记忆检索。此窗口有界，并非完整永久记忆或自动摘要。assistant 原文表示已经拟定，送达仍取决于回执；系统管理通知不冒充角色发言。角色、世界模拟、开放 Policy 和记忆机制在这个边界之上继续工作。

调试报告的完整 messages 保存角色、轮次边界、本轮 event IDs、历史时间及原话；可连同输入快照、Policy 输出、compiler 输出与投递状态一起检查。它展示可追溯的调用输入和输出，不是模型隐含思维过程。真实供应商接受多角色请求、自然表达质量和飞书端行为仍须本机试聊验收；离线模拟不替代这些检查。


## JSON 输出任务修复（2026-09-17）

现场复现为 HTTP 200、status=completed、37 output tokens，返回 52 字普通聊天文字，而 Policy 要求 OpenPolicyDraft JSON。此证据排除该次响应被截断，未证明所有历史失败均为同一原因。

Policy/compiler v5 在角色对话与 turn_boundary 之后追加可信 system 输出任务：对话是被处理的内容，最终产物分别为行动提案 JSON 和编译结果 JSON。人物口吻适用于拟表达内容，不替代内部协议。保留 provider JSON schema 和本地 schema/来源/执行校验；不通过提取、补全或将普通文字包装成动作来绕过校验。这个请求层修复需本机真实模型验证，模拟 HTTP 仅验证请求结构和失败处理。

life_model_attempts.error_code 保留 provider 具体错误码；output_json.failure 保存状态、输出哈希与已去除当前 API key 的最多 12000 字符返回摘录。该内容同样属于私人对话诊断。响应明确为 incomplete 时，即使部分 JSON 可解析也拒绝提交。历史记录不回写；旧报告中已经丢失的原文无法补回。不会额外自动发起修复调用，原有持久重试继续生效。
