"""Local test server: serves the repo and lets test/index.html save its output workbook.

    python tools/dev_server.py [port] [output_dir]

POST /__save?name=<file> writes the request body to output_dir (default: test-output/).
"""
import http.server, os, sys, urllib.parse
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
OUT = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(ROOT, "test-output")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if url.path != "/__save":
            self.send_error(404)
            return
        name = os.path.basename(urllib.parse.parse_qs(url.query).get("name", ["output.xlsx"])[0])
        os.makedirs(OUT, exist_ok=True)
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(body)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(os.path.join(OUT, name).encode())


if __name__ == "__main__":
    print(f"Serving {ROOT} on http://localhost:{PORT}  (saves to {OUT})", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=ROOT)).serve_forever()
