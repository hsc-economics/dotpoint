#!/usr/bin/env python3
"""Rebuild data/news.js: the top economics and politics headlines from trusted news sources.

Usage:
    python3 tools/update_news.py

Reads the public RSS and Atom feeds listed in FEEDS, keeps stories from the last few days, and
ranks them by how many outlets are covering the same story, how closely they link to the HSC
syllabus, and how recent they are. Only the headline, outlet, time and link are kept: the site
always sends readers to the original article.

If too few feeds answer, the old file is kept, so a bad network day never empties the section.
The file is only rewritten when the list of stories changes.
"""
import html
import json
import math
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "news.js"
UA = "Mozilla/5.0 (compatible; DotpointNews/1.0; +https://hsc-economics.github.io/dotpoint/)"
MAX_AGE = timedelta(days=4)
PER_SECTION = 12
PER_OUTLET = 4      # so no one outlet fills a section

# section: "economy" or "world". The world feeds carry everything, so only stories about economics,
# government or international affairs are kept from them (see MIN_WORLD_SCORE).
FEEDS = [
    {"outlet": "ABC News", "section": "economy", "url": "https://www.abc.net.au/news/feed/51892/rss.xml"},
    {"outlet": "The Guardian", "section": "economy", "url": "https://www.theguardian.com/au/business/rss"},
    {"outlet": "The Guardian", "section": "economy", "url": "https://www.theguardian.com/business/economics/rss"},
    {"outlet": "BBC News", "section": "economy", "url": "https://feeds.bbci.co.uk/news/business/rss.xml"},
    {"outlet": "The Conversation", "section": "economy", "url": "https://theconversation.com/au/business/articles.atom"},
    {"outlet": "Reserve Bank of Australia", "section": "economy", "url": "https://www.rba.gov.au/rss/rss-cb-media-releases.xml"},
    {"outlet": "ABC News", "section": "world", "url": "https://www.abc.net.au/news/feed/51120/rss.xml"},
    {"outlet": "The Guardian", "section": "world", "url": "https://www.theguardian.com/australia-news/australian-politics/rss"},
    {"outlet": "The Guardian", "section": "world", "url": "https://www.theguardian.com/world/rss"},
    {"outlet": "BBC News", "section": "world", "url": "https://feeds.bbci.co.uk/news/world/rss.xml"},
]
MIN_FEEDS = 6

# Words that tie a headline to a dot point. A headline names at most two dot points.
TOPICS = {
    "mp-cash-rate": ["cash rate", "rate cut", "rate cuts", "rate hike", "rate hikes", "rate rise", "rate rises",
                     "interest rate", "interest rates", "reserve bank", "rba", "central bank", "federal reserve",
                     "the fed", "ecb", "bank of england", "monetary policy"],
    "iss-inflation-measure": ["inflation", "cpi", "consumer prices", "cost of living", "price rises", "deflation"],
    "glb-protection": ["tariff", "tariffs", "protectionism", "protectionist", "quota", "quotas", "trade war",
                       "import duty", "import duties", "anti-dumping"],
    "int-trade": ["free trade", "trade deal", "trade agreement", "trade talks", "exports", "exporters", "imports"],
    "int-exchange-rates": ["australian dollar", "aussie dollar", "exchange rate", "currency", "currencies", "yuan", "yen"],
    "iss-unemployment-rate": ["unemployment", "jobless", "job losses", "job cuts", "layoffs", "redundancies", "jobs"],
    "hh-min-wage": ["minimum wage", "wage", "wages", "pay rise", "pay rises", "pay deal"],
    "fin-housing": ["housing", "house prices", "home prices", "home loan", "home loans", "mortgage", "mortgages",
                    "rent", "rents", "renters", "property market"],
    "fp-stance": ["budget", "deficit", "surplus", "government spending", "stimulus", "national debt"],
    "gov-tax-reform": ["tax", "taxes", "taxation", "gst", "negative gearing", "capital gains", "tax cut", "tax cuts"],
    "iss-growth-real-gdp": ["gdp", "economic growth", "recession", "economy grew", "economy shrank", "economic output"],
    "mkt-power-abuse": ["merger", "mergers", "takeover", "acquisition", "collusion", "cartel", "price gouging"],
    "micro-competition": ["competition", "accc", "antitrust", "monopoly"],
    "env-targets": ["emissions", "net zero", "climate", "paris agreement", "renewable", "renewables"],
    "glb-vulnerability": ["oil price", "oil prices", "supply chain", "supply chains", "sanctions", "global shock",
                          "commodity prices", "financial crisis"],
    "iss-terms-of-trade": ["iron ore", "coal price", "coal prices", "lng", "commodity", "commodities"],
    "fin-super": ["superannuation", "super fund", "super funds"],
    "iss-growth-trends": ["productivity"],
    "fin-role": ["bank", "banks", "banking", "lending", "lenders", "credit", "crypto", "stock market", "shares", "asx",
                 "bond market", "bonds"],
    "lm-safety-net": ["fair work", "enterprise agreement", "industrial action", "strike", "strikes", "union", "unions"],
    "mkt-gov-intervention": ["subsidy", "subsidies", "price cap", "price caps", "regulator", "regulation"],
}
# Government and world affairs: enough to keep a story from a world feed, but no dot point link.
POLITICS = ["election", "elections", "government", "parliament", "minister", "treasurer", "prime minister",
            "president", "senate", "policy", "legislation", "summit", "g20", "g7", "treaty", "war", "ceasefire",
            "diplomatic", "diplomacy", "united nations", "nato", "european union", "eu", "china", "beijing",
            "united states", "washington", "trump", "albanese", "chalmers", "coalition", "labor", "opposition",
            "migration", "aid", "economy", "economic", "economist", "economists", "imf", "world bank", "wto", "oecd",
            "opec", "trade", "energy", "oil", "gas", "prices", "market", "markets", "investment", "investors"]
# Stories a student of economics doesn't need, even when they mention a policy word.
OFF_TOPIC = ["cricket", "afl", "nrl", "football", "soccer", "tennis", "olympic", "olympics", "grand final",
             "murder", "murderer", "stabbing", "shooting", "missing", "crash", "celebrity", "royal", "prince",
             "princess", "king charles", "epstein", "horoscope", "recipe", "quiz", "live:", "as it happened"]
MIN_WORLD_SCORE = 2

STOP = set("a an and are as at be been but by for from has have he her his how in into is it its new of on or "
           "our out over says say said she than that the their them they this to up was we were what when who "
           "why will with after about amid more could would can may not just your you".split())


def has(text, phrase):
    return re.search(r"(?<![\w-])" + re.escape(phrase) + r"(?![\w-])", text) is not None


def topics_for(title):
    t = title.lower().replace("-", " ")
    hits = []
    for dp, words in TOPICS.items():
        n = sum(1 for w in words if has(t, w))
        if n:
            hits.append((n, dp))
    hits.sort(key=lambda x: -x[0])
    return [dp for _, dp in hits[:2]]


def relevance(title, summary):
    text = (title + " " + summary).lower().replace("-", " ")
    t = title.lower().replace("-", " ")
    score = 0.0
    for words in TOPICS.values():
        score += 2 * sum(1 for w in words if has(t, w)) + 0.5 * sum(1 for w in words if has(text, w) and not has(t, w))
    score += sum(1 for w in POLITICS if has(t, w)) + 0.25 * sum(1 for w in POLITICS if has(text, w) and not has(t, w))
    if any(w in t for w in ("live:", "as it happened")) or any(has(t, w) for w in OFF_TOPIC):
        score -= 6
    return score


def words_of(title):
    found = (w.strip(".") for w in re.findall(r"[a-z0-9$%.]+", title.lower()))
    return {w[:-1] if w.endswith("s") and len(w) > 4 else w for w in found if len(w) > 2 and w not in STOP}


def local(tag):
    return tag.rsplit("}", 1)[-1]


def child_text(el, *names):
    for c in el:
        if local(c.tag) in names and (c.text or "").strip():
            return c.text.strip()
    return ""


def parse_date(s):
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", s).strip()


def read_feed(feed):
    req = urllib.request.Request(feed["url"], headers={"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml"})
    with urllib.request.urlopen(req, timeout=25) as r:
        root = ET.fromstring(r.read())
    stories = []
    for el in root.iter():
        if local(el.tag) not in ("item", "entry"):
            continue
        title = re.sub(r"\s+\|\s+[^|]{2,40}$", "", clean(child_text(el, "title")))  # drop " | Columnist name"
        link = child_text(el, "link")
        if not link:  # Atom puts the address in an attribute
            for c in el:
                if local(c.tag) == "link" and c.get("rel", "alternate") == "alternate" and c.get("href"):
                    link = c.get("href")
                    break
        when = parse_date(child_text(el, "pubDate", "published", "updated", "date"))
        if not (title and link and link.startswith("https://") and when):
            continue
        summary = clean(child_text(el, "description", "summary", "encoded"))[:600]
        stories.append({"title": title, "url": link.split("?")[0],
                        "outlet": feed["outlet"], "section": feed["section"], "when": when, "summary": summary})
    return stories


def rank(stories, now):
    fresh = [s for s in stories if now - MAX_AGE <= s["when"] <= now + timedelta(hours=1)]
    seen, unique = set(), []
    for s in sorted(fresh, key=lambda s: s["when"], reverse=True):
        if s["url"] in seen:
            continue
        seen.add(s["url"])
        s["score"] = relevance(s["title"], s["summary"])
        s["words"] = words_of(s["title"])
        unique.append(s)

    # Group the same story told by different outlets. The most relevant telling leads. Words that
    # appear in many headlines ("rate", "economy") count for little, so two stories only match when
    # they share the unusual words too ("4.3%", "binance").
    df = {}
    for s in unique:
        for w in s["words"]:
            df[w] = df.get(w, 0) + 1
    weight = {w: math.log(len(unique) / n) for w, n in df.items()}
    def same_story(a, b):
        shared = a["words"] & b["words"]
        if len(shared) < 3:
            return False
        return sum(weight[w] for w in shared) / sum(weight[w] for w in a["words"] | b["words"]) >= 0.2
    groups = []
    for s in sorted(unique, key=lambda s: -s["score"]):
        for g in groups:
            if same_story(g[0], s):
                g.append(s)
                break
        else:
            groups.append([s])

    out = {"economy": [], "world": []}
    for g in groups:
        lead = g[0]
        outlets = []
        for s in g:
            if s["outlet"] not in [o["outlet"] for o in outlets]:
                outlets.append(s)
        section = "economy" if any(s["section"] == "economy" for s in g) else "world"
        if section == "world" and lead["score"] < MIN_WORLD_SCORE:
            continue
        if section == "economy" and lead["score"] < 0:
            continue
        hours = (now - lead["when"]).total_seconds() / 3600
        top = lead["score"] + 3 * (len(outlets) - 1) + max(0.0, 3 - hours / 12)
        out[section].append((top, {
            "title": lead["title"], "url": lead["url"], "outlet": lead["outlet"],
            "published": lead["when"].strftime("%Y-%m-%dT%H:%M:%SZ"),
            "dotpoints": topics_for(lead["title"]),
            "also": [{"outlet": s["outlet"], "url": s["url"]} for s in outlets[1:4]],
        }))
    picked = {}
    for k, v in out.items():
        picked[k], count = [], {}
        for _, item in sorted(v, key=lambda x: -x[0]):
            if count.get(item["outlet"], 0) < PER_OUTLET and len(picked[k]) < PER_SECTION:
                count[item["outlet"]] = count.get(item["outlet"], 0) + 1
                picked[k].append(item)
    return picked


def main():
    now = datetime.now(timezone.utc)
    stories, ok = [], 0
    for feed in FEEDS:
        try:
            got = read_feed(feed)
            stories += got
            ok += 1
            print(f"  {len(got):3d} stories  {feed['outlet']}  {feed['url']}")
        except Exception as e:  # one broken feed shouldn't stop the others
            print(f"  failed       {feed['outlet']}  {feed['url']}: {e}", file=sys.stderr)
    if ok < MIN_FEEDS:
        print(f"Only {ok} of {len(FEEDS)} feeds answered, so data/news.js was left as it was.", file=sys.stderr)
        return
    sections = rank(stories, now)
    if len(sections["economy"]) < 4 or len(sections["world"]) < 4:
        print("Too few recent stories, so data/news.js was left as it was.", file=sys.stderr)
        return

    sources = []
    for f in FEEDS:
        if f["outlet"] not in sources:
            sources.append(f["outlet"])
    data = {"generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "sources": sources,
            "economy": sections["economy"], "world": sections["world"]}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))
            if old.get("economy") == data["economy"] and old.get("world") == data["world"]:
                print("No change to the news list.")
                return
        except (IndexError, ValueError):
            pass
    OUT.write_text("// Generated by tools/update_news.py. Headlines link to the original articles.\n"
                   "globalThis.DP_NEWS = " + json.dumps(data, indent=1, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(OUT.parent.parent)}: {len(data['economy'])} economy and {len(data['world'])} world stories.")


if __name__ == "__main__":
    main()
