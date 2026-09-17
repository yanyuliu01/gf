#!/usr/bin/env python3
"""Read-only GF life database snapshot inspector. Python standard library only."""
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import argparse
import datetime
import html
import json
import os
from pathlib import Path
import sqlite3
import zipfile


def unpack(row):
    d = dict(row)
    for k, v in list(d.items()):
        if k.endswith('_json') and isinstance(v, str):
            try:
                d[k] = json.loads(v)
            except ValueError:
                pass
    return d


def collect(path, limit):
    # The Mac system SQLite URI connection failed on the Owner's existing file.
    # Fall back only for this open error; query_only protects all diagnostic SQL.
    try:
        db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=10)
    except sqlite3.OperationalError as error:
        if 'unable to open database file' not in str(error) or not path.is_file():
            raise
        db = sqlite3.connect(str(path.resolve()), timeout=10)
    db.execute("PRAGMA query_only=ON")
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    db.execute('BEGIN')
    def rows(sql, args=()):
        return [unpack(r) for r in db.execute(sql, args)]
    try:
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {'life_episodes', 'life_model_attempts', 'life_event_queue', 'world_events'}
        if not required <= tables:
            raise ValueError('不是当前 GF life 数据库，缺少：' + ', '.join(sorted(required - tables)))
        episodes = rows('SELECT * FROM life_episodes ORDER BY created_at DESC,episode_id DESC LIMIT ?', (limit,))
        # Match by exact Working Self identity, never by nearby timestamps.
        by_ws = {e['input_json']['working_self_id']: e for e in episodes}
        for e in episodes:
            e['model_attempts'] = []
            e['trigger'] = rows('SELECT * FROM world_events WHERE event_id=?', (e['trigger_event_id'],))
            e['sources'] = []
            for ref in e['input_json']['input_closure']['source_refs']:
                if ref['source_type'] == 'event':
                    e['sources'] += rows('SELECT * FROM world_events WHERE event_id=?', (ref['source_id'],))
            e['gate'] = rows('SELECT d.* FROM wake_decision_audit d JOIN wake_candidate_sources s USING(candidate_id) WHERE s.source_id=? ORDER BY d.decided_at', (e['trigger_event_id'],))
            e['speech_and_outbox'] = rows('SELECT s.speech_id,s.content,s.trigger_event_id,o.outbox_id,o.status,o.attempts,o.last_error,o.created_at,o.sent_at FROM speech_records s LEFT JOIN outbox o USING(speech_id) WHERE s.trigger_event_id=?', (e['trigger_event_id'],))
            for s in e['speech_and_outbox']:
                s['deliveries'] = rows('SELECT * FROM deliveries WHERE outbox_id=? ORDER BY observed_at', (s['outbox_id'],))
        recent = []
        for raw in db.execute('SELECT * FROM life_model_attempts ORDER BY created_at DESC,attempt_id DESC'):
            a = unpack(raw)
            if len(recent) < limit * 2:
                recent.append(a)
            try:
                msg = a['input_json']['messages']
                data = json.loads(next(m['content'] for m in msg if m['role'] == 'user'))
                ws = data.get('workingSelf', data)
                key = ws.get('working_self_id')
            except (ValueError, KeyError, TypeError, StopIteration, AttributeError):
                key = None
            if key in by_ws:
                by_ws[key]['model_attempts'].append(a)
        return {
            'exported_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'notes': ['只读一致性快照；不运行模型，不发送消息。',
                      '模型记录按 working_self_id 精确关联；同一触发的发送记录可能含多次执行，保留 ID 供区分。',
                      'PromptContext 是应用保存的 messages，不等于完整 HTTP 请求；未记录的原始响应及错误无法恢复。',
                      '当前 state 不是历史 episode 的状态；历史以该次 Working Self 为准。'],
            'episodes': episodes,
            'recent_model_attempts': recent,
            'pending_queue': rows("SELECT q.*,e.origin,e.kind,e.occurred_at,e.payload_json FROM life_event_queue q JOIN world_events e USING(event_id) WHERE q.status='pending' ORDER BY e.occurred_at"),
            'recent_events': rows('SELECT * FROM world_events ORDER BY occurred_at DESC,event_id DESC LIMIT ?', (limit * 5,)),
            'current_state_not_historical': rows('SELECT * FROM life_runtime'),
        }
    finally:
        db.rollback()
        db.close()


def render(data):
    esc = html.escape
    def detail(title, obj):
        return '<details><summary>' + esc(title) + '</summary><pre>' + esc(json.dumps(obj, ensure_ascii=False, indent=2)) + '</pre></details>'
    cards = []
    for e in data['episodes']:
        result = e['result_json']
        text = result.get('command', {}).get('text', '')
        trigger = e['trigger'][0]['payload_json'].get('summary', '') if e['trigger'] else ''
        card = '<article><h2>' + esc(e['created_at']) + '</h2><p><b>触发内容：</b>' + esc(trigger) + '</p><blockquote>' + esc(text or '本次没有生成对话文字') + '</blockquote>'
        card += detail('1 · 触发事件 / ID', e['trigger'])
        card += detail('2 · Gate 决策', e['gate'])
        card += detail('3 · 当时实际读到的 Working Self（含记忆）', e['input_json'])
        card += detail('4 · 来源事件原文', e['sources'])
        timeline = []
        for attempt in e['model_attempts']:
            messages = attempt.get('input_json', {}).get('messages', [])
            if len(messages) > 2:
                timeline.append({'phase': attempt.get('phase', attempt.get('stage', '模型调用')), 'messages_after_context': messages[2:]})
        card += detail('5a · 按角色还原的对话与本轮边界（v4）', timeline)
        card += detail('5 · 模型调用：完整 messages 与保存的输出', e['model_attempts'])
        card += detail('6 · Policy 意图 → compiler 文本 → 世界变化', result)
        card += detail('7 · 实际发送状态与回执', e['speech_and_outbox'])
        card += detail('episode 标识', {k: e[k] for k in ('episode_id', 'trigger_event_id', 'base_revision')})
        cards.append(card + '</article>')
    top = '<h1>GF 回复调试</h1><p>静态快照 · ' + esc(data['exported_at']) + '</p><p>用浏览器查找搜索“调试系统”等词；展开记录可查看其来源。更新数据时重新运行脚本。</p>'
    top += ''.join('<p>' + esc(n) + '</p>' for n in data['notes'])
    top += detail('待处理队列（含重试次数）', data['pending_queue'])
    top += detail('最近模型调用（含未提交和失败的调用）', data['recent_model_attempts'])
    top += detail('最近世界事件', data['recent_events'])
    top += detail('当前状态（不是历史状态）', data['current_state_not_historical'])
    return '<!doctype html><html lang="zh"><meta charset="utf-8"><title>GF 回复调试</title><style>body{font:16px/1.65 system-ui;max-width:1080px;margin:32px auto;padding:0 20px;background:#f4f6f8;color:#202934}article{background:white;padding:24px;margin:24px 0;border-radius:14px}h2{font-size:18px}summary{cursor:pointer;padding:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 monospace;background:#edf1f5;padding:16px}blockquote{white-space:pre-wrap;margin:16px 0;padding:18px;background:#e6f0ff;border-radius:8px}</style>' + top + ''.join(cards) + '</html>'



def serve(path, limit, host, port):
    """Serve only generated diagnostics; never expose a filesystem directory."""
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            route = urlsplit(self.path).path
            if route not in ("/", "/report.html", "/report.json", "/gf-debug-report.zip"):
                self.send_error(404)
                return
            try:
                if not path.is_file():
                    raise ValueError("数据库尚未建立，请检查机器人服务")
                data = collect(path, limit)
                page = render(data)
                if route in ("/", "/report.html"):
                    page += '<p>每 10 秒刷新；展开记录时暂停。<a href="/gf-debug-report.zip">下载排错报告</a></p><script>setInterval(()=>{if(!document.querySelector("details[open]"))location.reload()},10000)</script>'
                    payload = page.encode()
                    mime = "text/html; charset=utf-8"
                elif route == "/report.json":
                    payload = json.dumps(data, ensure_ascii=False, indent=2).encode()
                    mime = "application/json; charset=utf-8"
                else:
                    buffer = io.BytesIO()
                    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
                        archive.writestr("report.html", page)
                        archive.writestr("report.json", json.dumps(data, ensure_ascii=False, indent=2))
                    payload = buffer.getvalue()
                    mime = "application/zip"
                self.send_response(200)
            except (sqlite3.Error, ValueError) as error:
                # System errors only: no environment values or conversation in access logs.
                payload = ("读取失败：" + str(error)).encode()
                mime = "text/plain; charset=utf-8"
                self.send_response(503)
            self.send_header("Content-Type", mime)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(payload)))
            if route == "/gf-debug-report.zip" and mime == "application/zip":
                self.send_header("Content-Disposition", 'attachment; filename="gf-debug-report.zip"')
            self.end_headers()
            self.wfile.write(payload)
        def log_message(self, format, *args):
            return
    print(f"GF debug listening on {host}:{port}; use SSH forwarding, never public ingress", flush=True)
    with ThreadingHTTPServer((host, port), Handler) as server:
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--host', default='127.0.0.1', choices=['127.0.0.1', '0.0.0.0'])
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--db', default=os.environ.get('GF_LIFE_DB', 'runtime/life.db'))
    parser.add_argument('--limit', type=int, default=30)
    parser.add_argument('--out', default='gf-debug-output')
    args = parser.parse_args()
    if not 1 <= args.limit <= 500:
        parser.error('--limit 应在 1 至 500 之间')
    path = Path(args.db).expanduser()
    if args.serve:
        serve(path, args.limit, args.host, args.port)
        return
    if not path.is_file():
        parser.error('数据库不存在：' + str(path) + '；请在项目根目录运行或用 --db 指定路径。')
    try:
        data = collect(path, args.limit)
    except (sqlite3.Error, ValueError) as e:
        parser.exit(1, '读取失败：' + str(e) + '\n')
    dest = Path(args.out).expanduser()
    dest.mkdir(parents=True, exist_ok=True)
    (dest / 'report.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    (dest / 'report.html').write_text(render(data), encoding='utf-8')
    archive = dest / 'gf-debug-report.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in ('report.json', 'report.html'):
            z.write(dest / name, name)
    print('查看：' + str((dest / 'report.html').resolve()))
    print('发给我排查：' + str(archive.resolve()))
    print('报告包含所选对话、记忆与 Prompt，不读取 .env 或 API Key 配置。')

if __name__ == '__main__':
    main()
