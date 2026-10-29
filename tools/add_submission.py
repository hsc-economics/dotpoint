#!/usr/bin/env python3
"""Turn an approved "Suggest an example or statistic" GitHub issue into an example card.

    ISSUE_BODY="..." python3 tools/add_submission.py 42

Run by .github/workflows/add-submission.yml when the site owner adds the "approved" label.
The issue text is read from the ISSUE_BODY environment variable (never from the command line),
checked against the same rules as hand-written cards, and appended to data/evidence.js.
If anything is wrong, nothing is changed: the problems are written to submission-errors.md,
which the workflow posts back on the issue, and the script exits with an error.
"""
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / "data" / "evidence.js"
SYLLABUS = ROOT / "data" / "syllabus.js"
ERRORS = ROOT / "submission-errors.md"

FIELDS = {
    "Headline": "headline",
    "Type": "type",
    "Who published it?": "source_name",
    "Link to the source": "source_url",
    "Date it happened or was released": "date",
    "Key figure": "key_figure",
    "What it shows, in your own words": "summary",
    "How a student could use it in an essay": "use_for",
    "Dot points it supports": "dotpoints",
    "A short quote copied exactly from the source": "quote",
    "Who said or wrote the quote": "quote_by",
}
TYPES = {"Report", "Article", "Statistic", "Policy decision", "Speech", "Court case", "Regulation", "Research", "Trade"}


def parse_issue(body):
    """GitHub issue forms arrive as '### Label' headings, each followed by the answer."""
    out, label, buf = {}, None, []
    for line in body.replace("\r\n", "\n").split("\n"):
        heading = re.match(r"^### (.+?)\s*$", line)
        if heading:
            if label in FIELDS:
                out[FIELDS[label]] = "\n".join(buf).strip()
            label, buf = heading.group(1), []
        else:
            buf.append(line)
    if label in FIELDS:
        out[FIELDS[label]] = "\n".join(buf).strip()
    return {k: ("" if v == "_No response_" else v) for k, v in out.items()}


def one_line(text):
    return re.sub(r"\s+", " ", text).strip()


def known_dotpoints():
    text = SYLLABUS.read_text(encoding="utf-8").split("branches:")[0]
    return set(re.findall(r'\{ id: "([a-z0-9-]+)", short:', text))


def existing_ids():
    return set(re.findall(r'^\s*id: "([^"]+)",', EVIDENCE.read_text(encoding="utf-8"), re.M))


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48].strip("-")


def build_card(f, issue, today):
    problems = []
    headline = one_line(f.get("headline", ""))
    kind = one_line(f.get("type", ""))
    source_name = one_line(f.get("source_name", ""))
    url = one_line(f.get("source_url", ""))
    when = one_line(f.get("date", ""))
    key = one_line(f.get("key_figure", ""))
    summary = one_line(f.get("summary", ""))
    use_for = one_line(f.get("use_for", ""))
    quote = one_line(f.get("quote", "")).strip("\"“”")
    quote_by = one_line(f.get("quote_by", ""))
    dps = re.findall(r"\(([a-z0-9-]+)\)", f.get("dotpoints", ""))

    if not 5 <= len(headline) <= 90:
        problems.append("The headline should be between 5 and 90 characters.")
    if kind not in TYPES:
        problems.append("Pick a type from the list.")
    if not source_name:
        problems.append("Say who published the source.")
    if not re.match(r"^https://[^\s]+\.[^\s]+$", url):
        problems.append("The source link must be a full web address starting with https://.")
    try:
        when_d = date.fromisoformat(when)
        if when_d > today:
            problems.append("The date can't be in the future.")
    except ValueError:
        problems.append("Write the date as YYYY-MM-DD, for example 2026-10-15.")
    if not 1 <= len(key) <= 40:
        problems.append("The key figure should be under 40 characters.")
    if not 60 <= len(summary) <= 520:
        problems.append(f"The summary should be 60 to 520 characters (it is {len(summary)}).")
    if " — " in summary + use_for:
        problems.append("Use commas or full stops instead of dashes in the summary and the essay use.")
    if len(use_for) < 20:
        problems.append("Say how a student could use it in an essay.")
    unknown = [d for d in dps if d not in known_dotpoints()]
    if not dps or unknown:
        problems.append("Pick at least one dot point from the list.")
    if not quote or len(quote.split()) > 22 or re.search(r'["“”]', quote):
        problems.append("Add one quote copied word for word from the source, 22 words at most, without quotation marks inside it.")
    if not quote_by:
        problems.append("Say who said or wrote the quote.")
    if problems:
        return None, problems

    base = slug(headline) or "submission"
    card_id, n, taken = base, 2, existing_ids()
    while card_id in taken:
        card_id, n = f"{base}-{n}", n + 1

    card = {
        "id": card_id,
        "title": headline,
        "date": when,
        "type": kind,
        "keyFigure": key,
    }
    card["quote"] = {"text": quote, "by": quote_by, "url": url}
    card.update({
        "summary": summary,
        "useFor": use_for,
        "dotpoints": list(dict.fromkeys(dps)),
        "source": {"name": source_name, "url": url},
        "checked": today.isoformat(),
        "submission": f"#{issue}",
        "flash": {"q": f"What is the key figure from: {headline.rstrip('.?!')}?", "a": key},
    })
    return card, []


def to_js(card):
    """Write the card in the same style as the hand-written ones (unquoted keys)."""
    def val(v):
        if isinstance(v, dict):
            return "{ " + ", ".join(f"{k}: {json.dumps(x, ensure_ascii=False)}" for k, x in v.items()) + " }"
        return json.dumps(v, ensure_ascii=False)
    body = "\n".join(f"    {k}: {val(v)}," for k, v in card.items())
    return "  {\n" + body + "\n  },\n"


def main():
    issue = sys.argv[1] if len(sys.argv) > 1 else "?"
    today = datetime.now(timezone.utc).date()
    card, problems = build_card(parse_issue(os.environ.get("ISSUE_BODY", "")), issue, today)
    if problems:
        ERRORS.write_text(
            "Dotpoint couldn't add this suggestion yet:\n\n" + "\n".join(f"- {p}" for p in problems)
            + "\n\nEdit the issue to fix this, then remove and add the **approved** label again.\n", encoding="utf-8")
        print("\n".join(problems), file=sys.stderr)
        return 1
    text = EVIDENCE.read_text(encoding="utf-8").rstrip()
    if not text.endswith("];"):
        raise SystemExit("data/evidence.js does not end with '];'")
    EVIDENCE.write_text(text[:-2] + to_js(card) + "];\n", encoding="utf-8")
    print(f"Added {card['id']} to data/evidence.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
