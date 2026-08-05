# 持久化迁移

本目录定义运行时 SQLite 的权威持久化结构。迁移按文件名前缀升序、每个文件恰好一次执行；应用启动时若数据库版本落后，必须先迁移再接收事件。

- `001_initial.sql`：事件账本、场景与消息、操作提交、事实声明、状态补丁、能力、关系线程、欠账、记忆、发言与 outbox。
- JSON 字段在写入前仍须通过 `../schemas/` 的 JSON Schema；数据库约束只承担第二道防线。
- `operation_commits.operation_id`、`world_events.idempotency_key` 和 `outbox.idempotency_key` 是三层不同的幂等边界，禁止复用语义。
- `claim_sources` 与 `patch_sources` 是多态证据引用。提交器必须在事务开始前验证引用闭包，不能仅依赖数据库外键。

## 提交顺序

StateManager 对每个 proposal 使用同一个事务入口：

1. `BEGIN IMMEDIATE`，按 `operation_id` 查询并返回既有提交（若有）。
2. 校验 Schema、source closure、allowed path、场景游标、privacy/capability authorization。
3. 执行 `UPDATE runtime_revision SET current_revision = :base + 1 WHERE singleton_id = 1 AND current_revision = :base`，受影响行数不为 1 就整体回滚。
4. 写 `operation_commits`、processed messages、claims、patches、debts、speech 和 outbox；`committed_state_revision` 必须恰为 `base + 1`。
5. `COMMIT` 后由 dispatcher 读取 outbox。任何外部投递都不能发生在提交前。

`PRAGMA foreign_keys = ON` 是连接级开关；连接池创建每个 SQLite 连接时都必须重新开启并检查它。

迁移文件一经进入已部署版本不得原地修改；后续结构变化应新增 `002_*.sql`。
