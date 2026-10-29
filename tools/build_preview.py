#!/usr/bin/env python3
"""Make a standalone copy of the site with the document skeleton the Claude publisher normally adds.

    python3 tools/build_preview.py && python3 -m http.server 8765 --directory preview   # local preview
    python3 tools/build_preview.py --out site                                          # GitHub Pages build
"""
import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKELETON = ('<!doctype html><html lang="en-AU"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}'
            'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
            '</head><body>')

ap = argparse.ArgumentParser()
ap.add_argument("--out", default="preview", help="folder to write, relative to the project (default: preview)")
out = ROOT / ap.parse_args().out

if out.exists():
    shutil.rmtree(out)
out.mkdir()
for folder in ("js", "data"):
    shutil.copytree(ROOT / folder, out / folder)
(out / "index.html").write_text(SKELETON + (ROOT / "index.html").read_text(encoding="utf-8") + "</body></html>", encoding="utf-8")
print(f"Site written to {out}")
