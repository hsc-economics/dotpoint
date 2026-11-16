#!/usr/bin/env python3
"""Make a standalone copy of the site with the document skeleton the Claude publisher normally adds.

    python3 tools/build_preview.py && python3 -m http.server 8765 --directory preview   # local preview
    python3 tools/build_preview.py --out site                                          # GitHub Pages build

For search engines it also:
  - puts the title, description and links in the <head>, with a fuller title and description, a canonical
    address, sharing tags and structured data (the Claude version keeps its short title)
  - writes dot-points.html, examples.html and past-papers.html, plain pages anyone (or any search engine) can
    read without running the app: every dot point with its key terms, every checked example, and every
    official past paper and resource
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
for proof in ROOT.glob("google*.html"):  # Google Search Console's ownership file; it must stay published
    shutil.copy(proof, out / proof.name)
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
    script = ('load("data/syllabus.js"); load("data/evidence.js"); load("data/resources.js");'
              'print(JSON.stringify({sy: DP_SYLLABUS, ev: DP_EVIDENCE, res: DP_RESOURCES}));')
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
:root{--paper:#f3f5f1;--surface:#fff;--ink:#18211d;--muted:#56625c;--rule:#d8ded8;--strong:#87928b;--hl:#eedd3a;--soft:#fbf5cc;--bad:#b3352b}
@media (prefers-color-scheme:dark){:root{--paper:#121815;--surface:#19201c;--ink:#e6ece7;--muted:#a0ada6;--rule:#2e3833;--strong:#6b7870;--hl:#e3d445;--soft:rgba(227,212,69,.13);--bad:#f08f84;color-scheme:dark}}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 "IBM Plex Sans",system-ui,sans-serif}
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
form,.sent{display:grid;gap:22px;margin-top:28px}fieldset{border:0;margin:0;padding:0;display:grid;gap:6px}
legend,.q{font-weight:600;padding:0;margin-bottom:6px}.q{display:block}.hint{display:block;font-weight:400;font-size:.875rem;color:var(--muted)}
.choice{display:flex;align-items:center;gap:10px;min-height:40px;cursor:pointer}.choice input{width:18px;height:18px;margin:0;accent-color:var(--ink)}
input[type=text],input[type=url],select,textarea{width:100%;min-height:46px;padding:10px 12px;border:1px solid var(--strong);border-radius:8px;
background:var(--surface);color:var(--ink);font:inherit}textarea{min-height:130px;resize:vertical}
input:focus-visible,select:focus-visible,textarea:focus-visible{outline:none;border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
.go{justify-self:start;min-height:48px;padding:10px 22px;border:0;border-radius:8px;background:var(--ink);color:var(--paper);font:600 1rem "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}
.go:disabled{opacity:.55;cursor:default}.again{background:none;color:var(--ink);border:1px solid var(--strong)}
[data-status]{margin:0;min-height:1.5em;font-size:.9375rem}[data-status][data-kind=error]{color:var(--bad)}
.honey{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.sent{border:1px solid var(--rule);border-radius:12px;padding:24px;background:var(--surface)}.sent h2{margin:0}
.sent h2:focus{outline:none}[data-fallback]{display:grid;gap:8px}[data-fallback] textarea{min-height:150px;font:14px/1.5 ui-monospace,Menlo,monospace}
body.wide .wrap{max-width:80rem;min-height:100vh;min-height:100dvh;display:grid;grid-template-rows:auto 1fr auto;padding:0 clamp(16px,4vw,48px)}
body.wide header{justify-content:space-between;margin-bottom:0}
.back{font-weight:600;font-size:.9375rem;color:var(--muted);min-height:44px;display:inline-flex;align-items:center}
body.wide main{padding-block:clamp(28px,6vw,72px)}
.form-layout{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:clamp(32px,6vw,96px);align-items:start}
.form-intro{position:sticky;top:32px;display:grid;gap:14px}
.form-intro h1{font-size:clamp(2.25rem,1.5rem + 2.6vw,3.6rem);line-height:1.04;margin:0}
.form-intro h2{font-size:1.0625rem;margin:22px 0 0}
.steps{list-style:none;padding:0;margin:0;display:grid;gap:16px;counter-reset:s}
.steps li{display:grid;grid-template-columns:34px minmax(0,1fr);gap:14px;align-items:start;counter-increment:s}
.steps li::before{content:counter(s);width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--hl);color:#18211d;font-weight:700;font-size:.875rem;box-shadow:0 0 0 1.5px var(--ink)}
.steps b{display:block;line-height:1.35}.steps span{display:block;color:var(--muted);font-size:.9375rem}
.form-card{background:var(--surface);border:1px solid var(--rule);border-radius:18px;padding:clamp(20px,3.2vw,40px);box-shadow:0 24px 48px -32px rgba(24,33,29,.45);min-width:0}
.form-card form{margin-top:0}.form-card .sent{margin:0;border:0;padding:0;background:none}
.choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:10px}
.choice{border:1px solid var(--rule);border-radius:12px;padding:12px 14px;min-height:52px;background:var(--surface);
transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease,transform .12s ease;user-select:none}
.choice span{display:grid;gap:2px}.choice small{color:var(--muted);font-size:.8125rem;line-height:1.35}
.choice:hover{border-color:var(--strong)}.choice:active{transform:scale(.98)}
.choice:has(input:checked){border-color:var(--ink);background:var(--soft);box-shadow:inset 0 0 0 1px var(--ink)}
.choice:has(input:focus-visible){outline:3px solid var(--hl);outline-offset:2px}
.send-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px}.send-row [data-status]{min-height:0}
.fallback-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0}.fallback-actions .cta,.fallback-actions .go{margin:0}
.cta.quiet{background:none;color:var(--ink);text-decoration:underline}
.go:active:not(:disabled),.cta:active{transform:scale(.97)}.go,.cta{transition:transform .12s ease,opacity .15s ease}
@media (max-width:860px){.form-layout{grid-template-columns:minmax(0,1fr)}.form-intro{position:static}}
@media (prefers-reduced-motion:reduce){.choice,.go,.cta{transition:none}.choice:active,.go:active,.cta:active{transform:none}}
"""
LOGO = ('<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="37" cy="37" r="21" fill="#eedd3a"/>'
        '<path d="M40 8 C24 2 6 13 6.5 30 C7 46 20 52.5 30 51.5 C44 50.5 51.5 40 50.5 27 C49.5 14 38 5.5 24 8.5" '
        'fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round"/>'
        '<path d="M23 26 C27 24.5 33 27 39.5 25" fill="none" stroke="#18211d" stroke-width="6.5" stroke-linecap="round"/></svg>')


def plain_page(name, title, desc, body, scripts=(), index=True, wide=False):
    doc = (f'<!doctype html><html lang="en-AU"><head><meta charset="utf-8">'
           f'<meta name="viewport" content="width=device-width,initial-scale=1">'
           + ('' if index else '<meta name="robots" content="noindex">') +
           f"<title>{esc(title)}</title><meta name=\"description\" content=\"{esc(desc)}\">"
           f'<link rel="canonical" href="{SITE}{name}"><link rel="icon" href="icons/favicon.svg" type="image/svg+xml">'
           f'<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}">'
           f'<meta property="og:url" content="{SITE}{name}"><meta property="og:image" content="{SITE}icons/apple-touch-icon.png">'
           f"{FONTS}<style>{PLAIN_CSS}</style></head>" + ('<body class="wide">' if wide else "<body>") + '<div class="wrap">'
           f'<header><a href="./">{LOGO}Dotpoint</a>'
           + ('<a class="back" href="./">Back to Dotpoint</a>' if wide else '') + f'</header><main>{body}</main>'
           '<footer class="small muted"><p>Dotpoint is a free, independent study site for NSW HSC Economics and is not '
           'affiliated with NESA. Dot point summaries are in our own words; always check the '
           f'<a href="https://curriculum.nsw.edu.au/learning-areas/hsie/economics-11-12-2025/content">official syllabus</a>.</p>'
           '<p class="links"><a href="./">Dotpoint home</a><a href="dot-points.html">All dot points</a><a href="examples.html">All examples</a><a href="past-papers.html">Past papers</a>'
           '<a href="suggest.html">Suggest an example</a><a href="report.html">Report a problem</a></p>'
           "</footer></div>" + "".join(f'<script src="{s}"></script>' for s in scripts) + "</body></html>")
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


def papers_page(res):
    items = res["items"]
    hsc = [i for i in items if i["group"] == "hsc"]
    years = sorted({i["year"] for i in hsc}, reverse=True)
    parts = ['<h1>HSC Economics past papers</h1>',
             f'<p class="lead">Every official HSC Economics exam paper from {years[-1]} to {years[0]}, with marking guidelines '
             'and marker feedback, plus real answers at every band and the Reserve Bank\'s study guides. Links open each '
             'file on NESA\'s or the RBA\'s own site. Checked for new papers every day.</p>' if years else '<p class="lead">Official HSC Economics past papers and study guides.</p>',
             '<a class="cta" href="./#resources">Open them in Dotpoint</a>']
    ns = [i for i in items if i["group"] == "new-syllabus"]
    if ns:
        parts.append("<h2>New syllabus sample exam (first examined in the 2028 HSC)</h2>")
        parts += [f'<p><a href="{esc(i["url"])}">{esc(i["title"])}</a> <span class="small muted">{esc(i.get("format", ""))}</span></p>' for i in ns]
    if years:
        parts.append("<h2>HSC exam papers and marking guidelines</h2>")
        for y in years:
            links = [f'<a href="{esc(i["url"])}">{esc(i["kind"])}</a>' for i in sorted((i for i in hsc if i["year"] == y), key=lambda i: i["kind"] != "Exam paper")]
            parts.append(f'<div class="dp"><p>{y} HSC Economics</p><p class="small">{" · ".join(links)}</p></div>')
    st = [i for i in items if i["group"] == "standards"]
    if st:
        parts.append("<h2>Band samples: real HSC answers at every band</h2>")
        groups = {}
        for i in st:
            groups.setdefault(i["title"].split(": ")[0], []).append(i)
        for name, its in groups.items():
            links = " · ".join(f'<a href="{esc(i["url"])}">{esc(i["title"].split(": ", 1)[-1])}</a>' for i in its)
            parts.append(f'<div class="dp"><p>{esc(name)}</p><p class="small">{links}</p></div>')
    rba = [i for i in items if i["group"] == "rba"]
    if rba:
        parts.append("<h2>Reserve Bank study guides</h2>")
        for i in rba:
            parts.append(f'<div class="dp"><p><a href="{esc(i["url"])}">{esc(i["title"])}</a></p>'
                         + (f'<p class="small muted">{esc(i["desc"])}</p>' if i.get("desc") else "") + "</div>")
    parts.append('<p class="small muted">Dotpoint isn\'t affiliated with NESA or the RBA and doesn\'t host their files.</p>')
    plain_page("past-papers.html", "HSC Economics past papers, marking guidelines and band samples | Dotpoint",
               "Every official HSC Economics past paper with marking guidelines and marker feedback, real answers at every band, "
               "and RBA study guides. Updated daily.", "".join(parts))


FORM_TAIL = ('<div class="honey" aria-hidden="true"><label>Leave this empty <input type="text" name="_honey" tabindex="-1" autocomplete="off"></label></div>'
             '<div class="send-row"><button type="submit" class="go">{button}</button><p data-status role="status" aria-live="polite"></p></div>'
             '<div data-fallback hidden><textarea readonly aria-label="Your message, to copy"></textarea>'
             '<p class="fallback-actions"><a class="cta" hidden>Email it instead</a><button type="button" class="go again" data-copy>Copy message</button></p>'
             '<p class="small muted">Or send it from your own email<span data-to></span>.</p></div>')
FORM_SCRIPTS = ("data/config.js", "js/contact.js", "js/forms.js")


def sent_panel(pid, text):
    return (f'<div class="sent" id="{pid}" hidden><h2 tabindex="-1">Sent. Thank you.</h2><p class="muted">{text}</p>'
            '<p class="fallback-actions"><button type="button" class="go again" data-again>Send another</button><a class="cta quiet" href="./">Back to Dotpoint</a></p></div>')


def form_page(name, title, desc, heading, lead, steps, form, sent):
    items = "".join(f"<li><div><b>{esc(a)}</b><span>{esc(b)}</span></div></li>" for a, b in steps)
    body = (f'<div class="form-layout"><div class="form-intro"><h1>{heading}</h1><p class="lead">{lead}</p>'
            f'<h2>What happens next</h2><ol class="steps">{items}</ol>'
            '<p class="small muted">Please don\'t include your name or other personal details. Messages go straight to the '
            'person who runs Dotpoint and aren\'t published.</p></div>'
            f'<div class="form-card">{form}{sent}</div></div>')
    plain_page(name, title, desc, body, FORM_SCRIPTS, index=False, wide=True)


def suggest_page(sy):
    opts = ['<option value="">Not sure</option>']
    for fa in (sy or {}).get("focusAreas", []):
        opts.append(f'<optgroup label="Year {fa["year"]}: {esc(fa["name"])}">')
        opts += [f'<option value="{esc(dp["id"])}">{esc(dp.get("short") or dp["text"])}</option>' for dp in fa["dotpoints"]]
        opts.append("</optgroup>")
    form = ('<form id="suggest-form" data-done="suggest-sent" novalidate>'
            '<fieldset><legend>What are you suggesting?</legend><div class="choices">'
            '<label class="choice"><input type="radio" name="kind" value="Example" checked><span><b>A real-world example</b><small>A decision, law, report or event</small></span></label>'
            '<label class="choice"><input type="radio" name="kind" value="Statistic"><span><b>A statistic</b><small>A figure from the RBA, ABS or similar</small></span></label>'
            '</div></fieldset>'
            '<label><span class="q">What is it?<span class="hint">For example: RBA keeps the cash rate at 4.85% in November</span></span>'
            '<input type="text" name="title" maxlength="200" required></label>'
            '<label><span class="q">Link to the source<span class="hint">The original page: the RBA, ABS, a government site or a news report</span></span>'
            '<input type="url" name="source" maxlength="500" inputmode="url" placeholder="https://" required></label>'
            f'<label><span class="q">Which dot point does it help with?</span><select name="dotpoint">{"".join(opts)}</select></label>'
            '<label><span class="q">How would you use it in an answer? <span class="hint">Optional</span></span>'
            '<textarea name="use" maxlength="800"></textarea></label>'
            + FORM_TAIL.format(button="Send suggestion") + "</form>")
    form_page("suggest.html", "Suggest an example or statistic | Dotpoint",
              "Suggest a real-world example or statistic for an HSC Economics dot point.",
              "Suggest an example or statistic",
              "Found a recent decision, report or figure that would help explain a dot point? Send it in.",
              [("It arrives by email", "Straight to the person who runs Dotpoint."),
               ("It's checked against the source", "Every example and figure is read against the original before it goes on."),
               ("It goes on the site", "If it fits a dot point, it's added for everyone to use.")],
              form, sent_panel("suggest-sent", "It will be checked against the source and, if it fits, added to Dotpoint."))


def report_page():
    reasons = [("A fact is wrong", True), ("It's out of date", False), ("A link is broken", False),
               ("Something isn't working", False), ("Something else", False)]
    radios = "".join(f'<label class="choice"><input type="radio" name="reason" value="{esc(r)}"{" checked" if c else ""}><span><b>{esc(r)}</b></span></label>'
                     for r, c in reasons)
    form = ('<form id="report-page-form" data-done="report-sent" novalidate>'
            f'<fieldset><legend>What\'s wrong?</legend><div class="choices">{radios}</div></fieldset>'
            '<label><span class="q">Where is it? <span class="hint">Optional. For example: Stats page, cash rate</span></span>'
            '<input type="text" name="where" maxlength="200"></label>'
            '<label><span class="q">What happened?<span class="hint">What you expected, and what you saw instead</span></span>'
            '<textarea name="details" maxlength="1200" required></textarea></label>'
            + FORM_TAIL.format(button="Send report") + "</form>")
    form_page("report.html", "Report a problem | Dotpoint", "Report a problem with Dotpoint.",
              "Report a problem",
              "Spotted a wrong figure, an old example, a broken link or something that doesn't work? Tell us here.",
              [("It arrives by email", "Straight to the person who runs Dotpoint."),
               ("It's checked", "The fact, figure or link is looked up again at its source."),
               ("It's fixed", "The correction goes live for everyone as soon as it's confirmed.")],
              form, sent_panel("report-sent", "Thanks for helping keep Dotpoint accurate."))


data = site_data()
report_page()
suggest_page(data["sy"] if data else None)
pages = [""]
if data:
    dot_points_page(data["sy"], data["ev"])
    examples_page(data["sy"], data["ev"])
    papers_page(data["res"])
    pages += ["dot-points.html", "examples.html", "past-papers.html"]
else:
    print("No JavaScript engine found, so dot-points.html, examples.html and past-papers.html were skipped.")
today = date.today().isoformat()
(out / "sitemap.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "".join(f"  <url><loc>{SITE}{p}</loc><lastmod>{today}</lastmod></url>\n" for p in pages)
    + "</urlset>\n", encoding="utf-8")
print(f"Site written to {out} ({len(pages)} pages in the sitemap)")
