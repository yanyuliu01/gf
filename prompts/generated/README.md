# Generated prompt fixtures

本目录只接收装配器生成的请求快照与 golden fixture，禁止手工复制或维护完整 prompt。

每个 fixture 必须同时记录：

- `manifest.yaml`、模板、角色资产与输入快照的 SHA-256；
- 最终 chat message 数组及每条原生 role；
- 目标模型、tokenizer、token 数与截断记录；
- unresolved-slot、source-closure、JSON Schema 与消息角色校验结果。

未带这些元数据的文件不是 golden，不得用于运行或回归。当前目录没有已批准 fixture；应在装配器和 A7 就绪后生成。

