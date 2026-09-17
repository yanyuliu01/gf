# 单机服务器部署与远程排错

适用：M2.1 / M21-013 单用户飞书试运行。业务与验收边界见 [pilot runbook](feishu-life-pilot.md)。本文件持有服务器操作流程，不改变角色、Gate 或模型策略。

## 配置选择

起步建议一台 Ubuntu 24.04 LTS、2 vCPU、4 GB 内存、40 GB SSD 的常开机器。这是构建与运维余量估计，不是负载测试结果。模型通过外部 API 调用，无需 GPU；按可访问飞书、DeepSeek、GitHub 与镜像仓库选择地域，不在这里固定供应商价格。安装 Docker Engine 与 Compose 插件，参考 [官方安装说明](https://docs.docker.com/engine/install/ubuntu/)。

一个 gf 容器运行机器人，一个 debug 容器只读同一个 SQLite 数据卷。维持单个 gf 实例，禁止 Mac 与服务器同时连接同一机器人。服务使用出向长连接；调试端口仅映射宿主机 127.0.0.1，经 SSH 隧道访问，不需要公开 Web 入口。SSH 使用密钥登录。不要把调试页面直接绑定到公网，页面含私人对话且没有独立登录。

## 首次部署

服务器上以自己的运维用户操作，进入固定项目目录；始终使用相同的 Compose 项目名 `gf`，避免误建另一个数据卷。

```bash
git clone --branch feat/feishu-world-mvp https://github.com/yanyuliu01/gf.git
cd gf
cp .env.example .env
chmod 600 .env
```

在服务器 `.env` 填入本人的 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_OWNER_OPEN_ID、DEEPSEEK_API_KEY 等原有配置。不要把真实配置提交到 Git。先决定是否迁移 Mac 的历史，再启动。

```bash
docker compose -p gf -f compose.life.yml -f compose.server.yml build
docker compose -p gf -f compose.life.yml -f compose.server.yml run --rm --no-deps gf node dist/gf/lifeCli.js --check-config
```

检查输出 `ready: true`。配置检查只验证字段存在，不证明凭据有效或网络畅通。

## 迁移现有记忆与聊天

先 Ctrl+C 停止 Mac 机器人。通过 SQLite backup 导出一致快照，不复制运行中的单个 .db，也不删 WAL/SHM 来处理读取问题。Mac 项目目录执行：

```bash
python3 - <<'PY'
from pathlib import Path
import sqlite3
source = Path('runtime/life.db').resolve()
target = Path.home() / 'Desktop/gf-life-migration.db'
if not source.is_file() or target.exists():
    raise SystemExit('源数据库不存在，或目标快照已存在；请检查后另取快照名')
a = sqlite3.connect(str(source))
a.execute('PRAGMA query_only=ON')
b = sqlite3.connect(str(target))
a.backup(b)
print('快照检查：', b.execute('PRAGMA integrity_check').fetchone()[0])
b.close()
a.close()
print(target)
PY
```

用 scp 将快照传到服务器用户主目录，例如 `scp ~/Desktop/gf-life-migration.db 用户@服务器:~/gf-life-migration.db`。真实 .env 单独安全传输或手填，不打进报告。服务器项目目录执行（机器人尚未启动）：

```bash
docker compose -p gf -f compose.life.yml -f compose.server.yml run --rm --no-deps --user root -v "$HOME/gf-life-migration.db:/import/life.db:ro" gf sh -eu -c 'test ! -e /data/life.db; cp /import/life.db /data/life.db; chown node:node /data/life.db; chmod 600 /data/life.db'
```

已有目标数据库时命令会停止；不要直接覆盖。如不迁移，可跳过本节，第一次启动会创建全新世界与历史。迁移后继续用同一个 App ID 与 owner open_id，数据库会验证绑定身份。保留 Mac 快照作为回退副本。

## 启动与查看

```bash
docker compose -p gf -f compose.life.yml -f compose.server.yml up -d
docker compose -p gf -f compose.life.yml -f compose.server.yml logs --tail=100 -f gf
```

Mac 新开一个终端，保持下面的 SSH 连接：

```bash
ssh -N -L 8787:127.0.0.1:8787 用户@服务器
```

浏览器打开 http://127.0.0.1:8787 。页面按 10 秒刷新；展开记录时暂停刷新，以免打断阅读。每次请求读取数据库一致快照，可以看 pending/retry、模型原始错误、输入角色与轮次、Policy/Compiler、投递结果；点击“下载排错报告”即可导出 ZIP。连接丢失后重新建立 SSH 隧道即可。数据库尚未初始化时页面返回 503，初始化后刷新。

这不是主动报警系统，也不是模型内部思维展示。服务器仅让采集与查看更稳定；本助手仍需你提供报告或授权的服务器连接，不能自动看到页面。

## 更新、备份与回退

先记录当前提交 `git rev-parse HEAD`，用 SQLite backup 定期备份数据卷并复制到另一台机器/对象存储；首次可在停机维护时用下面的一次性 Python 容器生成快照：

```bash
mkdir -p "$HOME/gf-backups"
docker compose -p gf -f compose.life.yml -f compose.server.yml stop gf
docker compose -p gf -f compose.life.yml -f compose.server.yml run --rm --no-deps --user root -v "$HOME/gf-backups:/backup" debug python -c 'import sqlite3,datetime; a=sqlite3.connect("file:/data/life.db?mode=ro",uri=True); b=sqlite3.connect("/backup/life-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")+".db"); a.backup(b); print(b.execute("PRAGMA integrity_check").fetchone()[0]); b.close(); a.close()'
```

备份确认输出 `ok` 后更新；若备份失败，先恢复原服务，勿继续更新。

```bash
git pull --ff-only
docker compose -p gf -f compose.life.yml -f compose.server.yml build
docker compose -p gf -f compose.life.yml -f compose.server.yml up -d
```

旧容器在 build 失败时不受新镜像替换；如果此前主动 stop 了服务，运行 `up -d --no-build` 恢复旧镜像。代码回退到记录的旧提交再重建，但存在数据库迁移时必须核对兼容性，不能直接拿旧代码读取新版数据库。不要运行 `down -v`，它会删除持久数据卷。日志使用 Docker local driver 轮转，上限配置为每容器 3 × 10 MB；SQLite 审计数据不会因此清理，需要另行监测磁盘增长。

每天备份、失败报警和公网 SSO 管理台可后续增加；当前交付未配置这些服务，也未在真实服务器部署或验证 Docker 镜像。离线测试与本地 HTTP 验证见 TODO。
