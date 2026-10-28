"""Development-only, loopback-only build service for trusted local HDL."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import shutil
import tempfile
import threading
from urllib.parse import urlsplit
import uuid

from build import BuildError, MAX_SOURCE_BYTES, ROOT, compile_verilog

MAX_REQUEST_BYTES = MAX_SOURCE_BYTES * 6 + 1024  # JSON escaping overhead
STATIC = {
    "/": (ROOT / "web/index.html", "text/html; charset=utf-8"),
    "/app.js": (ROOT / "web/app.js", "text/javascript; charset=utf-8"),
    "/style.css": (ROOT / "web/style.css", "text/css; charset=utf-8"),
    "/example.v": (ROOT / "examples/counter.v", "text/plain; charset=utf-8"),
}


class BuildServer(ThreadingHTTPServer):
    # Finish bounded in-flight builds before deleting their temporary directories.
    daemon_threads = False

    def __init__(self, port, build_root):
        super().__init__(("127.0.0.1", port), Handler)
        self.build_root = Path(build_root)
        self.build_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body, content_type="application/json"):
        if isinstance(body, dict):
            body = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(body)

    def local_request(self):
        # Check the authority as well as the bind address to reject DNS rebinding.
        port = self.server.server_port
        host = self.headers.get("Host")
        if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
            self.reply(403, {"error": "Use the local URL printed by server.py."})
            return False
        return True

    def do_GET(self):
        if not self.local_request():
            return
        path = urlsplit(self.path).path
        resource = STATIC.get(path)
        match = re.fullmatch(r"/builds/([0-9a-f]{32})/(sim\.mjs|sim\.wasm)", path)
        if match:
            resource = (
                self.server.build_root / match[1] / match[2],
                "application/wasm" if match[2].endswith(".wasm") else "text/javascript",
            )
        if resource and resource[0].is_file():
            self.reply(200, resource[0].read_bytes(), resource[1])
        else:
            self.reply(404, {"error": "Not found."})

    def do_POST(self):
        if not self.local_request():
            return
        origin = self.headers.get("Origin")
        if origin != f"http://{self.headers.get('Host')}":
            self.reply(403, {"error": "Builds require a same-origin request from the local UI."})
            return
        if self.path != "/api/build":
            self.reply(404, {"error": "Not found."})
            return
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self.reply(415, {"error": "Send application/json with a 'source' string."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_REQUEST_BYTES:
            self.reply(413, {"error": "Missing or oversized request body (source limit: 64 KiB)."})
            return
        try:
            payload = json.loads(self.rfile.read(length))
            source = payload.get("source") if isinstance(payload, dict) else None
            if not isinstance(source, str) or not source.strip():
                raise ValueError("Provide a nonempty 'source' string.")
            if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
                raise ValueError("Verilog source exceeds the 64 KiB limit.")
        except (ValueError, UnicodeError) as error:
            self.reply(400, {"error": str(error)})
            return
        if not self.server.build_lock.acquire(blocking=False):
            self.reply(429, {"error": "A build is already running. Try again when it finishes."})
            return
        build_id = uuid.uuid4().hex
        directory = self.server.build_root / build_id
        try:
            compile_verilog(source, directory)
        except (BuildError, OSError) as error:
            shutil.rmtree(directory, ignore_errors=True)
            self.reply(422, {"error": str(error)})
        else:
            self.reply(200, {"moduleUrl": f"/builds/{build_id}/sim.mjs"})
        finally:
            self.server.build_lock.release()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trusted-local", action="store_true", help="Acknowledge native execution of trusted HDL.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not args.trusted_local:
        parser.error("Pass --trusted-local only for HDL you trust. Read README.md before starting.")
    with tempfile.TemporaryDirectory(prefix="webrtl-") as directory:
        with BuildServer(args.port, directory) as server:
            print(f"WebRTL: http://127.0.0.1:{server.server_port} (trusted local development only)", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
