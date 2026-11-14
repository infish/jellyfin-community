#!/usr/bin/env python3
"""Exercise the real Caddy configuration against an isolated fake Jellyfin.

Requires Docker and the pinned Caddy image used by deploy/web.Dockerfile.
No credentials, NAS access, or production changes are involved.
"""
import http.server
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d'
ADMIN = 'Bearer fixture-admin'

class Upstream(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        protected = self.path.lower().startswith('/web/configurationpages') or self.path.startswith('/user_usage_stats/')
        status = 200 if not protected or self.headers.get('Authorization') == ADMIN else 401
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        # Echo the complete target so path/query stripping is detectable.
        self.wfile.write(self.path.encode() if status == 200 else b'Unauthorized')
    def log_message(self, *_):
        pass

def request(url, auth=None):
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, headers={'Authorization': auth} if auth else {}), timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read(), response.headers

class Routing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        cls.base = f'http://127.0.0.1:{port}'
        cls.temp = tempfile.TemporaryDirectory(prefix='jellyfin-routing-')
        static = Path(cls.temp.name)
        (static / 'index.html').write_text('custom viewer')
        (static / 'app.js').write_text('custom script')
        cls.name = f'jellyfin-routing-test-{os.getpid()}'
        subprocess.run(['docker', 'run', '--rm', '-d', '--name', cls.name, '--network', 'host',
            '-e', f'LISTEN_ADDRESS=http://127.0.0.1:{port}',
            '-e', f'JELLYFIN_UPSTREAM=http://127.0.0.1:{cls.server.server_port}',
            '-v', f'{ROOT / "deploy/Caddyfile"}:/etc/caddy/Caddyfile:ro',
            '-v', f'{static}:/srv/jellyfin-web:ro', IMAGE], check=True, stdout=subprocess.DEVNULL)
        for _ in range(100):
            try:
                if request(cls.base + '/web/')[0] == 200:
                    return
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(.1)
        cls.tearDownClass()
        raise RuntimeError('Caddy did not become ready')

    @classmethod
    def tearDownClass(cls):
        subprocess.run(['docker', 'stop', cls.name], stdout=subprocess.DEVNULL, check=False)
        cls.server.shutdown(); cls.server.server_close(); cls.temp.cleanup()

    def test_plugin_discovery_and_embedded_resources_reach_upstream(self):
        for path in ['/web/ConfigurationPages?enableInMainMenu=true',
                     '/web/ConfigurationPage?name=user_report',
                     '/web/ConfigurationPage?name=user_report.js',
                     '/web/configurationpages?enableInMainMenu=false']:
            with self.subTest(path=path):
                status, body, _ = request(self.base + path, ADMIN)
                self.assertEqual(status, 200)
                self.assertEqual(body.decode(), path)

    def test_upstream_access_control_is_preserved(self):
        for path in ['/web/ConfigurationPages', '/user_usage_stats/user_activity?days=28&endDate=2026-11-14', '/user_usage_stats/UserPlaylist']:
            for auth in [None, 'Bearer fixture-regular-user']:
                with self.subTest(path=path, auth=auth):
                    self.assertEqual(request(self.base + path, auth)[0], 401)

    def test_static_viewer_and_other_server_routes_are_unchanged(self):
        for path, content in [('/web/', b'custom viewer'), ('/web/app.js', b'custom script')]:
            status, body, headers = request(self.base + path)
            self.assertEqual((status, body), (200, content))
            self.assertEqual(headers['Cache-Control'], 'no-cache')
        for path in ['/web/ConfigurationPages.js', '/web/ConfigurationPageExtra']:
            self.assertEqual(request(self.base + path, ADMIN)[0], 404)
        path = '/System/Info/Public?probe=yes'
        status, body, _ = request(self.base + path)
        self.assertEqual((status, body), (200, path.encode()))

if __name__ == '__main__':
    unittest.main(verbosity=2)
