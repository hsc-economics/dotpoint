#!/usr/bin/env python3
"""Rebuild data/resources.js: every official HSC Economics past paper and study resource we can find.

Usage:
    python3 tools/update_resources.py

Run once a day (GitHub Actions does this). Each run re-reads the sources below and picks up anything
newly posted: a new year's HSC exam pack the day NESA publishes it, a new RBA explainer, and so on.

Sources (all public, all published for students):
  - NESA HSC exam packs: the exam paper, marking guidelines and marker feedback for each year. The
    year pages are found through the NSW Government sitemap, so a new year appears without any change here.
  - NESA HSC standards materials: real student answers at each band, with the marks they earned.
  - NESA's sample examination materials for the new Economics 11–12 Syllabus (2025).
  - RBA Education: explainers, snapshots, In a Nutshell, chart packs and student events.

Only the title, publisher, type and link are kept. Files are never copied: every link opens the document
on the publisher's own site, so students always get the current, official version, and the publishers'
robots.txt rules (which ask crawlers not to fetch the PDFs themselves) are respected. Only the HTML
pages that list the documents are read.

Each source is read on its own. If one fails, its items from the last good run are kept, so a bad
network day never empties the page. The file is only rewritten when the list changes.
"""
import hashlib
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from update_news import topics_for  # the same words-to-dot-points map the news uses

OUT = Path(__file__).resolve().parent.parent / "data" / "resources.js"
SYDNEY = ZoneInfo("Australia/Sydney")
UA = "Mozilla/5.0 (compatible; DotpointResources/1.0; +https://hsc-economics.github.io/dotpoint/)"
PAUSE = 1.0   # seconds between requests to the same site

NSW = "https://www.nsw.gov.au"
EXAM_PAGE = re.compile(r"^https://www\.nsw\.gov\.au/education-and-training/nesa/curriculum/hsc-exam-papers/economics/(\d{4})/?$")
STANDARDS_PAGE = re.compile(r"^https://www\.nsw\.gov\.au/education-and-training/nesa/curriculum/hsc-standards/economics(?:/[\w-]+)?/?$")
CURRICULUM = "https://curriculum.nsw.edu.au/learning-areas/hsie/economics-11-12-2025"
CURRICULUM_PAGES = ["/assessment/hsc-examinations", "/assessment/school-based-assessment", "/assessment/course-standards"]
RBA = "https://www.rba.gov.au"
# RBA Education index pages, and what to call the resources each one lists.
RBA_INDEXES = [
    ("/education/resources/explainers/", "Explainer"),
    ("/education/resources/in-a-nutshell/", "In a Nutshell"),
    ("/education/resources/snapshots/", "Snapshot"),
    ("/education/resources/econ-essentials/", "Econ-essentials"),
    ("/education/resources/chart-pack/", "Chart pack"),
    ("/education/resources/digital-interactives/", "Interactive"),
    ("/education/special-events-students/", "Student event"),
]
# RBA pages that are menus or about the program, not study resources.
RBA_SKIP = re.compile(r"/(?:subscription|contact-us|about-the-program|teacher-materials|professional-development|career-pathways)/")

_last = {}


def fetch(url):
    host = urllib.parse.urlsplit(url).netloc
    wait = PAUSE - (time.time() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xml"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", "replace")
    finally:
        _last[host] = time.time()


def text(s):
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s or "", flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def main_part(page):
    i = page.find("<main")
    return page[i:page.find("</main>", i)] if i >= 0 else page


def pieces(fragment):
    """Headings and links, in the order they appear: ("h2", text) or ("a", href, text, position).
    NESA's accordion titles count as h2. A link inside a heading comes after that heading."""
    found = []
    for m in re.finditer(r"<(h[1-6])\b[^>]*>(.*?)</\1>", fragment, re.S):
        found.append((m.start(), 0, (m.group(1), text(m.group(2)))))
    for m in re.finditer(r'<div class="nsw-accordion__title[^"]*">(.*?)</div>', fragment, re.S):
        found.append((m.start(), 0, ("h2", text(m.group(1)))))
    for m in re.finditer(r"<a\b([^>]*)>(.*?)</a>", fragment, re.S):
        href = re.search(r'href="([^"]+)"', m.group(1))
        if href:
            found.append((m.start(), 1, ("a", html.unescape(href.group(1)), text(m.group(2)), m.end())))
    return [p for _, _, p in sorted(found, key=lambda f: (f[0], f[1]))]


def size_of(label):
    """'Economics HSC exam 2024 (PDF 1.1MB)' -> ('Economics HSC exam 2024', 'PDF', '1.1 MB')."""
    m = re.search(r"\s*\((PDF|DOCX?|XLSX?|PPTX?|ZIP)\s*([\d.,]+\s*[KMG]B)\)\s*$", label, re.I)
    if not m:
        return label, None, None
    return label[:m.start()].strip(), m.group(1).upper(), re.sub(r"\s*([KMG]B)", r" \1", m.group(2).upper())


def item(url, title, kind, group, publisher, page, **extra):
    url = urllib.parse.urljoin(page, url)
    it = {"id": "r-" + hashlib.sha1(url.encode()).hexdigest()[:10], "title": title, "kind": kind, "group": group,
          "publisher": publisher, "url": url, "page": page}
    it.update({k: v for k, v in extra.items() if v not in (None, "", [])})
    return it


# ---------- NESA (nsw.gov.au) ----------

def sitemap_urls():
    """Every NESA Economics exam pack and standards page the NSW Government sitemap lists."""
    index = fetch(NSW + "/sitemap.xml")
    found = []
    for sub in re.findall(r"<loc>([^<]+)</loc>", index):
        if not re.search(r"/sitemaps/(?:page|resource|campaign|default)/", sub):
            continue
        for loc in re.findall(r"<loc>([^<]+)</loc>", fetch(sub)):
            loc = html.unescape(loc).strip()
            if (EXAM_PAGE.match(loc) or STANDARDS_PAGE.match(loc)) and loc not in found:
                found.append(loc)
    return found


def exam_pack(page_url, year):
    body = main_part(fetch(page_url))
    out = []
    for p in pieces(body):
        if p[0] != "a" or not re.search(r"\.(pdf|docx?)$", p[1], re.I):
            continue
        label, fmt, size = size_of(p[2])
        low = label.lower()
        if "marking guideline" in low:
            kind = "Marking guidelines"
        elif "sample answer" in low:
            kind = "Sample answers"
        elif "feedback" in low:
            kind = "Marker feedback"
        elif "exam" in low or "paper" in low:
            kind = "Exam paper"
        else:
            kind = "Exam pack document"
        out.append(item(p[1], label or f"Economics HSC {kind.lower()} {year}", kind, "hsc", "NESA", page_url,
                        year=int(year), format=fmt or "PDF", size=size, syllabus="2009"))
    if out and re.search(r"Marking feedback|Feedback on written exam", text(body), re.I):
        out.append(item(page_url + "#marking-feedback", f"Economics HSC marker feedback {year}", "Marker feedback", "hsc",
                        "NESA", page_url, year=int(year), format="Web page", syllabus="2009"))
    return out


def standards(page_url):
    body = main_part(fetch(page_url))
    out, section, band = [], "", ""
    for p in pieces(body):
        if p[0] in ("h2", "h3"):
            section, band = p[1], ""
        elif p[0] in ("h4", "h5", "h6"):
            band = p[1]
        elif re.search(r"\.(pdf|docx?)$", p[1], re.I):
            label, fmt, size = size_of(p[2])
            # "Section IV - Q28 - 2013", "Band 5/6", "Sample 1" -> "Section IV, Q28 (2013 HSC): Band 5/6, sample 1"
            m = re.match(r"(Section [IVX]+)\s*[-–]\s*(Q[\w()]+)\s*[-–]\s*(\d{4})", section)
            head = f"{m.group(1)}, {m.group(2)} ({m.group(3)} HSC)" if m else section or "Standards materials"
            year = re.search(r"\b(19|20)\d\d\b", section)
            title = ": ".join(x for x in [head, ", ".join(x for x in [band, label[:1].lower() + label[1:] if band else label] if x)] if x)
            out.append(item(p[1], title, "Exemplar" if "exemplar" in page_url else "Band sample", "standards", "NESA",
                            page_url, year=int(year.group(0)) if year else None, format=fmt or "PDF", size=size,
                            syllabus="2009", band=band or None))
    return out


def nesa():
    pages = sitemap_urls()
    exams = [(u, EXAM_PAGE.match(u).group(1)) for u in pages if EXAM_PAGE.match(u)]
    if len(exams) < 5:
        raise RuntimeError(f"only {len(exams)} exam pack pages in the sitemap")
    out = []
    for u, year in sorted(exams, key=lambda x: x[1], reverse=True):
        try:
            got = exam_pack(u, year)
            print(f"    {len(got):3d}  {u}")
            out += got
        except Exception as e:  # a year's page can be down on its own
            print(f"    failed {u}: {e}", file=sys.stderr)
            raise
    for u in pages:
        if STANDARDS_PAGE.match(u):
            got = standards(u)
            print(f"    {len(got):3d}  {u}")
            out += got
    return out


# ---------- the new syllabus (curriculum.nsw.edu.au) ----------

def new_syllabus():
    out, seen = [], set()
    for path in CURRICULUM_PAGES:
        page = CURRICULUM + path
        raw = fetch(page)
        # The page is built by a script, so the document links sit in its data as plain addresses.
        for m in re.finditer(r"https://library\.curriculum\.nsw\.edu\.au/[\w/-]+?/(economics-11-12-2025-([\w-]+))\.(pdf|docx)", raw):
            url, slug, ext = m.group(0), m.group(2), m.group(3)
            if url in seen or not re.search(r"sample|exam|marking|assessment|specification|standard", slug):
                continue
            seen.add(url)
            words = slug.replace("-", " ").replace("hsc", "HSC")
            title = "Economics 11–12 (2025): " + words[:1].upper() + words[1:]
            kind = "Sample exam" if "sample" in slug and "exam" in slug else "Syllabus support"
            out.append(item(url, title, kind, "new-syllabus", "NESA", page, format=ext.upper(), syllabus="2025"))
    if not out:
        raise RuntimeError("no new-syllabus documents found")
    return out


# ---------- RBA Education ----------

def slug(url):
    return re.sub(r"\.(html?|pdf)$", "", urllib.parse.urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1])


def rba():
    out, seen = [], set()
    for path, kind in RBA_INDEXES:
        page = RBA + path
        body = main_part(fetch(page))
        by_slug, n = {}, 0
        for p in pieces(body):
            if p[0] != "a":
                continue
            url = urllib.parse.urljoin(page, p[1]).split("#")[0]
            is_pdf = urllib.parse.urlsplit(url).path.lower().endswith(".pdf")
            if not url.startswith(page) or url.rstrip("/") == page.rstrip("/") or url in seen or RBA_SKIP.search(url):
                continue
            generic = re.match(r"download(?: explainer)?(?: pdf)?$", p[2].strip(), re.I)
            if is_pdf and (slug(url) in by_slug or (generic and out and out[-1]["page"] == page and "pdf" not in out[-1])):
                # the PDF copy of a page already listed: by name, or the "Download PDF" link right after it
                (by_slug.get(slug(url)) or out[-1])["pdf"] = url
                seen.add(url)
                continue
            # "Download Banknotes in Australia 515KB" -> "Banknotes in Australia", 515 KB
            label = p[2]
            size = re.search(r"\s*\(?(\d[\d.,]*\s*[KMG]B)\)?\s*$", label, re.I)
            label = re.sub(r"\s*\(?(?:PDF\s*)?\d[\d.,]*\s*[KMG]B\)?\s*$", "", label, flags=re.I)
            label = re.sub(r"^Download\s+(?:the\s+)?", "", label, flags=re.I).strip()
            if len(label) < 4 or re.match(r"(?:explainer )?pdf$|read more|back to top", label, re.I):
                continue
            # the RBA's own one-line description, the paragraph straight after the link
            after = body[p[3]:p[3] + 1500].split("resource-item", 1)[0]
            para = re.search(r"<p[^>]*>(.*?)</p>", after, re.S)
            desc = text(para.group(1)) if para else ""
            seen.add(url)
            it = item(url, label[:1].upper() + label[1:], kind, "rba", "Reserve Bank of Australia", page,
                      format="PDF" if is_pdf else "Web page", desc=desc[:240],
                      size=re.sub(r"\s*([KMG]B)", r" \1", size.group(1).upper()) if is_pdf and size else None,
                      dotpoints=topics_for(label))
            by_slug[slug(url)] = it
            out.append(it)
            n += 1
        print(f"    {n:3d}  {page}")
    out.append(item(RBA + "/chart-pack/", "Chart Pack: the Australian and world economy in graphs", "Chart pack", "rba",
                    "Reserve Bank of Australia", RBA + "/education/resources/chart-pack/", format="Web page",
                    desc="Graphs of the latest economic and financial data, updated after each major release."))
    if len(out) < 10:
        raise RuntimeError(f"only {len(out)} RBA resources found")
    return out


SOURCES = [
    ("nesa", "NESA HSC exam packs and standards materials", nesa),
    ("new-syllabus", "NESA new syllabus sample exam", new_syllabus),
    ("rba", "RBA Education", rba),
]
GROUP_OF = {"nesa": ("hsc", "standards"), "new-syllabus": ("new-syllabus",), "rba": ("rba",)}


def read_old():
    if not OUT.exists():
        return None
    try:
        return json.loads(OUT.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))
    except (IndexError, ValueError):
        return None


def main():
    now = datetime.now(timezone.utc)
    today = now.astimezone(SYDNEY).strftime("%Y-%m-%d")
    old = read_old()
    old_items = old["items"] if old else []
    added_on = {it["id"]: it["added"] for it in old_items}
    items, ok = [], 0
    for key, name, read in SOURCES:
        print(f"  {name}")
        try:
            got = read()
            ok += 1
        except Exception as e:
            kept = [it for it in old_items if it["group"] in GROUP_OF[key]]
            print(f"  failed: {name}: {e}. Kept {len(kept)} items from the last run.", file=sys.stderr)
            items += kept
            continue
        for it in got:
            it["added"] = added_on.get(it["id"], today)
        items += got
    if not ok:
        print("No source answered, so data/resources.js was left as it was.", file=sys.stderr)
        return

    # one entry per address, newest years first
    unique, seen = [], set()
    for it in items:
        if it["url"] not in seen:
            seen.add(it["url"])
            unique.append(it)
    order = {"new-syllabus": 0, "hsc": 1, "standards": 2, "rba": 3}
    unique.sort(key=lambda i: (order[i["group"]], -i.get("year", 0), i["kind"], i["title"]))

    if old and old.get("items") == unique:
        print(f"No change to the resources list ({len(unique)} items).")
        return
    new = [i for i in unique if i["id"] not in added_on]
    data = {
        "updated": today,
        # the day collecting started: items found on that first day aren't shown as "new"
        "since": (old or {}).get("since", today),
        "items": unique,
    }
    OUT.write_text("// Generated by tools/update_resources.py: official HSC Economics past papers and study resources.\n"
                   "// Every link opens the document on the publisher's own site; nothing is copied.\n"
                   "globalThis.DP_RESOURCES = " + json.dumps(data, indent=1, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(OUT.parent.parent)}: {len(new)} new, {len(unique)} resources in all.")
    for i in new[:20]:
        print(f"  new: {i['title']}  ({i['publisher']})")


if __name__ == "__main__":
    main()
