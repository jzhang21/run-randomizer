#!/usr/bin/env python3
"""
Serve this folder over HTTPS (static files).

1. Install mkcert: https://github.com/FiloSottile/mkcert
   (Windows: scoop install mkcert, choco install mkcert, or download the binary.)

2. Install the local CA (once):
     mkcert -install

3. In this project directory, create certs (use these filenames so this script
   finds them; plain "mkcert localhost" may emit localhost+1.pem instead):
     mkcert -cert-file localhost.pem -key-file localhost-key.pem localhost 127.0.0.1

4. Run:
     python serve_https.py

5. In the Spotify app Redirect URIs, add exactly (127.0.0.1 — not localhost):
     https://127.0.0.1:8443/

Spotify rejects localhost in redirect URIs; use the numeric loopback IP.
"""

from __future__ import annotations

import argparse
import http.server
import os
import ssl
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent


def main() -> int:
    p = argparse.ArgumentParser(description="HTTPS static file server")
    p.add_argument("--port", type=int, default=8443)
    p.add_argument("--cert", type=Path, default=DIR / "localhost.pem")
    p.add_argument("--key", type=Path, default=DIR / "localhost-key.pem")
    args = p.parse_args()

    if not args.cert.is_file() or not args.key.is_file():
        print(
            "Missing certificate files.\n"
            f"  Expected: {args.cert}\n"
            f"            {args.key}\n"
            "From this folder run: mkcert -install\n"
            "                      mkcert localhost 127.0.0.1",
            file=sys.stderr,
        )
        return 1

    os.chdir(DIR)

    handler = http.server.SimpleHTTPRequestHandler
    httpd = http.server.HTTPServer(("", args.port), handler)

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(args.cert), str(args.key))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    host = "localhost"
    print(f"Serving {DIR}")
    print(f"  https://{host}:{args.port}/")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
