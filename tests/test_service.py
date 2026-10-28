from http.client import HTTPConnection
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from build import BuildError, MAX_SOURCE_BYTES, compile_verilog
from server import BuildServer, MAX_REQUEST_BYTES


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.server = BuildServer(0, self.directory.name)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.port = self.server.server_port
        self.host = f"127.0.0.1:{self.port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, method="POST", path="/api/build", body=None, headers=None):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=5)
        if body is None:
            body = json.dumps({"source": "module counter; endmodule"})
        request_headers = {"Origin": f"http://{self.host}", "Content-Type": "application/json"}
        request_headers.update(headers or {})
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    @patch("server.compile_verilog")
    def test_rejects_foreign_and_missing_origins_and_rebound_host(self, compile_mock):
        for headers in (
            {"Origin": "https://untrusted.example"},
            {"Origin": ""},
            {"Host": "untrusted.example", "Origin": "http://untrusted.example"},
        ):
            self.assertEqual(self.request(headers=headers)[0], 403)
        self.assertEqual(self.request("GET", "/", headers={"Host": "untrusted.example"})[0], 403)
        compile_mock.assert_not_called()

    @patch("server.compile_verilog")
    def test_rejects_bad_requests_before_compilation(self, compile_mock):
        cases = [
            ("{", {}, 400),
            ("[]", {}, 400),
            ('{"source": 1}', {}, 400),
            ('{"source": " "}', {}, 400),
            (json.dumps({"source": "x" * (MAX_SOURCE_BYTES + 1)}), {}, 400),
            ("{}", {"Content-Type": "text/plain"}, 415),
            ("{}", {"Content-Length": str(MAX_REQUEST_BYTES + 1)}, 413),
        ]
        for body, headers, expected in cases:
            with self.subTest(expected=expected, headers=headers):
                self.assertEqual(self.request(body=body, headers=headers)[0], expected)
        compile_mock.assert_not_called()

    @patch("server.compile_verilog")
    def test_rejects_concurrent_compilation(self, compile_mock):
        with self.server.build_lock:
            self.assertEqual(self.request()[0], 429)
        compile_mock.assert_not_called()

    @patch("server.compile_verilog")
    def test_reports_build_errors_and_cleans_failed_artifacts(self, compile_mock):
        def fail(source, directory):
            directory.mkdir()
            (directory / "partial.wasm").touch()
            raise BuildError("counter.v: syntax error")

        compile_mock.side_effect = fail
        status, _, body = self.request()
        self.assertEqual(status, 422)
        self.assertIn("counter.v: syntax error", json.loads(body)["error"])
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])
        self.assertFalse(self.server.build_lock.locked())

    @patch("server.compile_verilog")
    def test_returns_only_named_public_artifacts(self, compile_mock):
        def build(source, directory):
            directory.mkdir()
            (directory / "sim.mjs").write_text("export default {};", encoding="utf-8")
            (directory / "sim.wasm").write_bytes(b"\0asm")
            (directory / "counter.v").write_text(source, encoding="utf-8")

        compile_mock.side_effect = build
        status, _, body = self.request()
        self.assertEqual(status, 200)
        url = json.loads(body)["moduleUrl"]
        self.assertEqual(self.request("GET", url)[0], 200)
        status, headers, data = self.request("GET", url.replace(".mjs", ".wasm"))
        self.assertEqual((status, data), (200, b"\0asm"))
        self.assertEqual(headers["Content-Type"], "application/wasm")
        for path in ("/../server.py", "/server.py", url.replace("sim.mjs", "counter.v")):
            self.assertEqual(self.request("GET", path)[0], 404)

    def test_example_is_repository_source(self):
        status, _, body = self.request("GET", "/example.v")
        self.assertEqual(status, 200)
        self.assertEqual(body, Path("examples/counter.v").read_bytes())


class BuildValidationTests(unittest.TestCase):
    def test_missing_toolchain_is_actionable(self):
        with patch.dict(os.environ, {"PATH": ""}):
            with self.assertRaisesRegex(BuildError, "Missing verilator.*README"):
                compile_verilog("module counter; endmodule", "unused")

    def test_rejects_empty_and_large_source(self):
        for source in (None, " ", "x" * (MAX_SOURCE_BYTES + 1)):
            with self.assertRaises(BuildError):
                compile_verilog(source, "unused")


if __name__ == "__main__":
    unittest.main()
