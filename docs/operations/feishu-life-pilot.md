# S-4 世界与飞书私聊试运行

对应任务：M2.1 / M21-013。代码入口：`src/gf/lifeCli.ts`。

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
- `/status`：返回明确标为系统状态的世界时间、位置和当前活动。
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
