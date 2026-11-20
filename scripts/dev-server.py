#!/usr/bin/env python3
"""Serve site/ for local testing, with browser caching turned off.

Why this exists (2026-11-20, Switchboard 5.5): `python3 -m http.server` sends Last-Modified but
no Cache-Control, so Chrome caches CSS/JS heuristically (about 10% of the file's age) and an
ordinary reload re-checks only the HTML. After Phase 2 changed index.html, styles.css, and
app.js, a normal reload paired the NEW page with the OLD Phase 1 stylesheet and script: the
sidebar stacked on top, the header was pushed down, and the composer fell off-screen.
Reproduced in scripts/ephemeral/2026-11-20-layout-diagnosis.mjs.

`Cache-Control: no-cache` makes the browser revalidate every file on every load; unchanged
files still come back as cheap 304s (If-Modified-Since). Local tooling only — GitHub Pages
sets its own caching (see ADR-0001, QST-PAGES-CACHE).

Binds all interfaces, like `python3 -m http.server`, so a phone on the same Wi-Fi can open
http://<this-machine's-LAN-IP>:<port>/ (storage.js has a fallback for the insecure-origin
crypto.randomUUID gap).

Usage: python3 scripts/dev-server.py [port]   (or: just serve [port])
"""

import functools
import http.server
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=str(SITE))
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        print(f"Serving {SITE} at http://localhost:{port}/ (Cache-Control: no-cache). Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
