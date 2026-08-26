# GF Concordia Sandbox Sidecar

这是 GF 的第一个外部 World POC。它的目标不是成为最终客观世界权威，而是尽快跑通：

```text
GF observe -> cognition -> open action -> Concordia GM resolve
           -> world observation -> GF
```

GF 仍然拥有 memory / belief / affect / Working Self / wake / Policy。

## Windows / PowerShell

在仓库根目录：

```powershell
python -m venv .venv-concordia
.\.venv-concordia\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r sidecars/concordia/requirements.txt

$env:DEEPSEEK_API_KEY="你的 key"
$env:GF_WORLD_MODEL="deepseek-chat"
python sidecars/concordia/server.py
```

默认监听：

```text
http://127.0.0.1:8765
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

## API

### `POST /v1/observe`

```json
{
  "actorId": "muelsyse",
  "afterCursor": "0"
}
```

### `POST /v1/resolve`

```json
{
  "id": "action-1",
  "actorId": "muelsyse",
  "proposedAt": "2026-08-26T09:00:00+08:00",
  "intent": "去生态园东侧看看刚才的异常。"
}
```

### `POST /v1/advance`

```json
{
  "to": "2026-08-26T10:00:00+08:00"
}
```

## 可配置环境变量

- `DEEPSEEK_API_KEY`：必需。
- `DEEPSEEK_API_BASE`：默认 `https://api.deepseek.com`。
- `GF_WORLD_MODEL`：默认 `DEEPSEEK_MODEL`，再 fallback 到 `deepseek-chat`。
- `GF_WORLD_ACTOR_ID`：默认 `muelsyse`。
- `GF_WORLD_START_TIME`：默认 `2026-08-26T09:00:00+08:00`。
- `GF_WORLD_PREMISE`：覆盖 POC 初始世界说明。
- `GF_WORLD_LOCATIONS`：覆盖 POC 地点说明。
- `GF_CONCORDIA_HOST` / `GF_CONCORDIA_PORT`：默认 `127.0.0.1:8765`。

## 已知限制

1. Concordia 原生 situated world 的 clock/location/world state 有 LLM generative 成分，因此本 sidecar 只用于 sandbox。
2. `/advance` 当前把时间推进作为 world event 注入 GM；它不是最终 deterministic clock。
3. `status` 暂时由 resolution 文本做轻量分类，真实 outcome 以 `happened` 为准。
4. 首版只有 GF 主体作为 Concordia player；NPC 由 GM 世界层生成。后续需要具有稳定自主性的 NPC 时，再决定哪些 NPC 进入 Concordia entity 层。
5. 当前 lexical hash embedder 只用于 GM 自己的事件检索，不参与 GF memory/retrieval。

这些限制都不能反向修改 GF 已冻结的认识边界与客观事实写入权。
