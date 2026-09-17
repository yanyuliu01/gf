"""Local HTTP smoke test; synthetic SQLite only, no model or Feishu calls."""
import hashlib
import io
import json
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import urlopen
from urllib.error import HTTPError, URLError
import zipfile

ROOT = Path(__file__).resolve().parents[1]

class DebugServerTest(unittest.TestCase):
    def test_private_snapshot_routes_and_no_database_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / 'life.db'
            db = sqlite3.connect(db_path)
            db.executescript('''
              CREATE TABLE life_episodes(episode_id TEXT, created_at TEXT);
              CREATE TABLE world_events(event_id TEXT, origin TEXT, kind TEXT, occurred_at TEXT, payload_json TEXT);
              CREATE TABLE life_event_queue(event_id TEXT, status TEXT);
              CREATE TABLE life_model_attempts(attempt_id TEXT, created_at TEXT, phase TEXT, error_code TEXT, input_json TEXT, output_json TEXT);
              CREATE TABLE life_runtime(state TEXT);
            ''')
            db.execute('INSERT INTO world_events VALUES (?,?,?,?,?)', ('event:1', 'user', 'life.user.message', '2026-09-17', json.dumps({'summary':'<script>unsafe()</script>'})))
            db.execute('INSERT INTO life_event_queue VALUES (?,?)', ('event:1','pending'))
            db.execute('INSERT INTO life_model_attempts VALUES (?,?,?,?,?,?)', ('a','2026-09-17','policy','invalid_json','{}',json.dumps({'failure':{'diagnostic':{'outputText':'plain reply'}}})))
            db.commit()
            db.close()
            before = hashlib.sha256(db_path.read_bytes()).digest()
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0))
                port = sock.getsockname()[1]
            process = subprocess.Popen([sys.executable,str(ROOT/'scripts/gf_debug.py'),'--serve','--port',str(port),'--db',str(db_path)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            base = f'http://127.0.0.1:{port}'
            try:
                for _ in range(100):
                    try:
                        with urlopen(base,timeout=1) as response:
                            page=response.read().decode()
                            self.assertEqual(response.headers['Cache-Control'],'no-store')
                        break
                    except URLError:
                        if process.poll() is not None: self.fail(process.stderr.read().decode())
                        time.sleep(.05)
                else: self.fail('debug server startup timed out')
                self.assertIn('&lt;script&gt;',page)
                self.assertNotIn('<script>unsafe()',page)
                with urlopen(base+'/report.json') as response:
                    report=json.load(response)
                self.assertEqual(report['recent_model_attempts'][0]['error_code'],'invalid_json')
                with urlopen(base+'/gf-debug-report.zip') as response:
                    with zipfile.ZipFile(io.BytesIO(response.read())) as archive:
                        self.assertEqual(set(archive.namelist()),{'report.json','report.html'})
                with self.assertRaises(HTTPError) as error:
                    urlopen(base+'/.env')
                self.assertEqual(error.exception.code,404)
                self.assertEqual(before,hashlib.sha256(db_path.read_bytes()).digest())
            finally:
                process.terminate()
                process.communicate(timeout=5)

if __name__ == '__main__': unittest.main()
