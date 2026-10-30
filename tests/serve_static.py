"""Serve the built site with room for parallel browsers' source downloads."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class StaticServer(ThreadingHTTPServer):
    # Python 3.13 defaults to five queued connections. Concurrent Chromium
    # projects fetch 13 HDL files each and can stall against that small backlog.
    request_queue_size = 128


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    handler = partial(SimpleHTTPRequestHandler, directory=".build/pages")
    with StaticServer(("127.0.0.1", args.port), handler) as server:
        server.serve_forever()
