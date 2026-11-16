#!/usr/bin/env python3
"""Make a standalone copy of the site with the document skeleton the Claude publisher normally adds.

    python3 tools/build_preview.py && python3 -m http.server 8765 --directory preview   # local preview
    python3 tools/build_preview.py --out site                                          # GitHub Pages build

For search engines it also:
  - puts the title, description and links in the <head>, with a fuller title and description, a canonical
    address, sharing tags and structured data (the Claude version keeps its short title)
  - writes dot-points.html and examples.html, plain pages anyone (or any search engine) can read without
    running the app: every dot point with its key terms, and every checked example
  - writes sitemap.xml listing those pages
The plain pages read data/syllabus.js and data/evidence.js with a JavaScript engine (macOS JavaScriptCore,
or Node.js on GitHub). Without one, they are skipped with a warning.
"""
import argparse
import html
import json
import shutil
import subprocess
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://hsc-economics.github.io/dotpoint/"
TITLE = "Dotpoint: HSC Economics dot points, examples and statistics"
DESC = ("Free HSC Economics study site for the 2025 syllabus: every dot point with key terms, real examples "
        "to cite, the latest RBA and ABS figures, and flashcards.")
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700'
         '&family=IBM+Plex+Sans:wght@400;600&display=swap">')
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
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
for folder in ("js", "data", "icons"):
    shutil.copytree(ROOT / folder, out / folder)
page = (ROOT / "index.html").read_text(encoding="utf-8")


def esc(t):
    return html.escape(str(t), quote=True)


# The title, description, icons and font links belong in the <head>, where browsers and search engines
# look for them. The page keeps its short title for the Claude version; this build uses the fuller one.
head_lines = [l for l in page.split("<style>", 1)[0].splitlines() if l.startswith(("<title>", "<meta ", "<link "))]
for l in head_lines:
    page = page.replace(l + "\n", "", 1)
keep = [l for l in head_lines if not l.startswith(("<title>", '<meta name="description"', '<meta name="claude:'))]
seo = [
    f"<title>{esc(TITLE)}</title>",
    f'<meta name="description" content="{esc(DESC)}">',
    f'<link rel="canonical" href="{SITE}">',
    '<meta property="og:type" content="website">',
    f'<meta property="og:site_name" content="Dotpoint Economics">',
    f'<meta property="og:title" content="{esc(TITLE)}">',
    f'<meta property="og:description" content="{esc(DESC)}">',
    f'<meta property="og:url" content="{SITE}">',
    f'<meta property="og:image" content="{SITE}icons/apple-touch-icon.png">',
    '<meta name="twitter:card" content="summary">',
    '<script type="application/ld+json">' + json.dumps([
        {"@context": "https://schema.org", "@type": "WebSite", "name": "Dotpoint Economics",
         "alternateName": ["Dotpoint", "Dot Point Economics", "Dotpoint HSC Economics"], "url": SITE,
         "description": DESC, "inLanguage": "en-AU"},
        {"@context": "https://schema.org", "@type": "LearningResource", "name": "Dotpoint Economics", "url": SITE,
         "description": DESC, "inLanguage": "en-AU", "isAccessibleForFree": True,
         "educationalLevel": "Year 11 and Year 12 (NSW HSC)", "teaches": "Economics 11–12 Syllabus (2025)",
         "learningResourceType": ["Study notes", "Flashcards", "Statistics"],
         "audience": {"@type": "EducationalAudience", "educationalRole": "student"}},
    ], ensure_ascii=False) + "</script>",
]
head = SKELETON.replace("</head>", "".join(seo + keep) + "</head>")
(out / "index.html").write_text(head + page + "</body></html>", encoding="utf-8")


# ---------- plain pages for readers and search engines ----------

def site_data():
    script = 'load("data/syllabus.js"); load("data/evidence.js"); print(JSON.stringify({sy: DP_SYLLABUS, ev: DP_EVIDENCE}));'
    runs = []
    if JSC.exists():
        runs.append([str(JSC), "-e", script])
    if shutil.which("node"):
        runs.append(["node", "-e", 'const fs=require("fs"),vm=require("vm");globalThis.print=console.log;'
                     'globalThis.load=(f)=>vm.runInThisContext(fs.readFileSync(f,"utf8"),{filename:f});' + script])
    for cmd in runs:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return json.loads(r.stdout)
    return None


PLAIN_CSS = """
:root{--paper:#f3f5f1;--ink:#18211d;--muted:#56625c;--rule:#d8ded8;--hl:#eedd3a;--soft:#fbf5cc}
@media (prefers-color-scheme:dark){:root{--paper:#121815;--ink:#e6ece7;--muted:#a0ada6;--rule:#2e3833;--hl:#e3d445;--soft:rgba(227,212,69,.13)}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 "IBM Plex Sans",system-ui,sans-serif}
.wrap{max-width:46rem;margin:0 auto;padding:0 16px 64px}
header{display:flex;align-items:center;gap:10px;min-height:64px;border-bottom:1px solid var(--rule);margin-bottom:32px}
header a{display:inline-flex;align-items:center;gap:10px;min-height:44px;color:var(--ink);text-decoration:none;font:800 22px "Bricolage Grotesque",system-ui,sans-serif;letter-spacing:-.03em}
header svg{width:30px;height:30px;overflow:visible}
h1,h2,h3{font-family:"Bricolage Grotesque",system-ui,sans-serif;line-height:1.2;text-wrap:balance}
h1{font-size:2.25rem;letter-spacing:-.03em;margin:0 0 12px}h2{font-size:1.5rem;margin:48px 0 8px}h3{font-size:1.125rem;margin:32px 0 6px}
p{margin:0 0 12px}a{color:inherit;text-underline-offset:3px}.muted{color:var(--muted)}.small{font-size:.875rem}
.lead{font-size:1.0625rem;color:var(--muted)}
.cta{display:inline-flex;align-items:center;min-height:44px;padding:8px 18px;border-radius:8px;background:var(--ink);color:var(--paper);font-weight:600;text-decoration:none;margin:8px 0 8px}
.dp{border-top:1px solid var(--rule);padding:14px 0}.dp>p:first-child{font-weight:600}
dl{margin:8px 0 0;display:grid;gap:6px}dt{font-weight:600;display:inline}dd{display:inline;margin:0;color:var(--muted)}dl div{font-size:.9375rem}
.ex{border-top:1px solid var(--rule);padding:18px 0}.fig{font:700 1.25rem "Bricolage Grotesque",system-ui,sans-serif}
blockquote{margin:10px 0;padding:2px 0 2px 16px;border-left:2px solid var(--ink);font-style:italic}
.use{background:var(--soft);border-left:4px solid var(--hl);padding:10px 14px;margin:10px 0}
footer{border-top:1px solid var(--rule);margin-top:48px;padding-top:16px}
.links{display:flex;flex-wrap:wrap;gap:0 20px}.links a{display:inline-flex;align-items:center;min-height:44px}
"""
LOGO = ('<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="37" cy="37" r="21" fill="#eedd3a"/>'
        '<path d="M40 8 C24 2 6 13 6.5 30 C7 46 20 52.5 30 51.5 C44 50.5 51.5 40 50.5 27 C49.5 14 38 5.5 24 8.5" '
        'fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round"/>'
        '<path d="M23 26 C27 24.5 33 27 39.5 25" fill="none" stroke="#18211d" stroke-width="6.5" stroke-linecap="round"/></svg>')


def plain_page(name, title, desc, body):
    doc = (f'<!doctype html><html lang="en-AU"><head><meta charset="utf-8">'
           f'<meta name="viewport" content="width=device-width,initial-scale=1">'
           f"<title>{esc(title)}</title><meta name=\"description\" content=\"{esc(desc)}\">"
           f'<link rel="canonical" href="{SITE}{name}"><link rel="icon" href="icons/favicon.svg" type="image/svg+xml">'
           f'<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}">'
           f'<meta property="og:url" content="{SITE}{name}"><meta property="og:image" content="{SITE}icons/apple-touch-icon.png">'
           f"{FONTS}<style>{PLAIN_CSS}</style></head><body><div class=\"wrap\">"
           f'<header><a href="./">{LOGO}Dotpoint</a></header><main>{body}</main>'
           '<footer class="small muted"><p>Dotpoint is a free, independent study site for NSW HSC Economics and is not '
           'affiliated with NESA. Dot point summaries are in our own words; always check the '
           f'<a href="https://curriculum.nsw.edu.au/learning-areas/hsie/economics-11-12-2025/content">official syllabus</a>.</p>'
           '<p class="links"><a href="./">Dotpoint home</a><a href="dot-points.html">All dot points</a><a href="examples.html">All examples</a></p>'
           "</footer></div></body></html>")
    (out / name).write_text(doc, encoding="utf-8")


def dot_points_page(sy, ev):
    count = {}
    for e in ev:
        for d in e["dotpoints"]:
            count[d] = count.get(d, 0) + 1
    total = sum(len(fa["dotpoints"]) for fa in sy["focusAreas"])
    parts = ['<h1>HSC Economics dot points</h1>',
             f'<p class="lead">All {total} dot points Dotpoint covers from the {esc(sy["syllabus"])}, in plain English, '
             'with the key terms for each. Use them to plan notes, check your understanding and find examples.</p>',
             '<a class="cta" href="./#syllabus">Study them in Dotpoint</a>']
    for year in (11, 12):
        parts.append(f"<h2>Year {year}</h2>")
        for fa in (f for f in sy["focusAreas"] if f["year"] == year):
            parts.append(f'<h3>{esc(fa["name"])}</h3><p class="small muted"><a href="{esc(fa["url"])}">Official wording on NESA</a></p>')
            for dp in fa["dotpoints"]:
                n = count.get(dp["id"], 0)
                terms = "".join(f"<div><dt>{esc(t)}:</dt> <dd>{esc(d)}</dd></div>" for t, d in dp.get("terms", []))
                parts.append(f'<div class="dp"><p>{esc(dp["text"])}</p>'
                             + (f"<dl>{terms}</dl>" if terms else "")
                             + (f'<p class="small muted">{n} real-world example{"s" if n != 1 else ""} in Dotpoint</p>' if n else "")
                             + "</div>")
    plain_page("dot-points.html", "HSC Economics dot points and key terms (2025 syllabus) | Dotpoint",
               f"Every HSC Economics dot point from the 2025 syllabus in plain English, with key terms and definitions for Year 11 and Year 12.",
               "".join(parts))


def examples_page(sy, ev):
    names = {dp["id"]: dp["short"] for fa in sy["focusAreas"] for dp in fa["dotpoints"]}
    parts = ['<h1>HSC Economics examples and case studies</h1>',
             f'<p class="lead">{len(ev)} recent real-world examples for HSC Economics essays, each checked against its '
             'source: RBA decisions, ABS statistics, laws, court cases and reports, with the key figure and a short quote.</p>',
             '<a class="cta" href="./#evidence">Search and filter them in Dotpoint</a>']
    for e in sorted(ev, key=lambda e: e["date"], reverse=True):
        q = e.get("quote")
        dps = ", ".join(names[d] for d in e["dotpoints"] if d in names)
        parts.append(
            f'<article class="ex"><h2 style="margin:0 0 4px;font-size:1.25rem">{esc(e["title"])}</h2>'
            f'<p class="small muted">{esc(e["type"])}, {date.fromisoformat(e["date"]).strftime("%-d %B %Y")}</p>'
            + (f'<p class="fig">{esc(e["keyFigure"])}</p>' if e.get("keyFigure") else "")
            + f'<p>{esc(e["summary"])}</p>'
            + (f'<blockquote>{esc(q["text"])}</blockquote><p class="small muted">{esc(q["by"])}</p>' if q else "")
            + f'<div class="use"><b>Use it for:</b> {esc(e["useFor"])}</div>'
            + (f'<p class="small muted">Dot points: {esc(dps)}</p>' if dps else "")
            + f'<p class="small">Source: <a href="{esc(e["source"]["url"])}">{esc(e["source"]["name"])}</a></p></article>')
    plain_page("examples.html", "HSC Economics examples and case studies (2026) | Dotpoint",
               "Recent, sourced real-world examples for HSC Economics essays: RBA decisions, ABS statistics, laws and reports, each with its key figure and dot points.",
               "".join(parts))


data = site_data()
pages = [""]
if data:
    dot_points_page(data["sy"], data["ev"])
    examples_page(data["sy"], data["ev"])
    pages += ["dot-points.html", "examples.html"]
else:
    print("No JavaScript engine found, so dot-points.html and examples.html were skipped.")
today = date.today().isoformat()
(out / "sitemap.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "".join(f"  <url><loc>{SITE}{p}</loc><lastmod>{today}</lastmod></url>\n" for p in pages)
    + "</urlset>\n", encoding="utf-8")
print(f"Site written to {out} ({len(pages)} pages in the sitemap)")
