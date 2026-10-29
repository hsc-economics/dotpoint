#!/usr/bin/env python3
"""Rebuild data/stats.js from the Reserve Bank of Australia's statistical tables.

Usage:
    python3 tools/update_stats.py                 # download fresh tables from rba.gov.au
    python3 tools/update_stats.py --from-dir DIR  # use CSVs already saved in DIR (e.g. f1.1.csv)

Every figure on the dashboard comes from these official tables. Nothing is typed in by hand,
so the numbers can only be as wrong as the source. The script refuses to write a file if a
series is missing or empty, so a broken download never replaces good data with blanks.
"""
import argparse
import csv
import io
import json
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

RBA_CSV = "https://www.rba.gov.au/statistics/tables/csv/{table}-data.csv"
RBA_PAGE = "https://www.rba.gov.au/statistics/tables/#{anchor}"
ABS_DATA = "https://data.api.abs.gov.au/rest/data/ABS,CPI,2.0.0/{key}?startPeriod=2018-01"
ABS_CPI_PAGE = "https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia"

# Each indicator: which RBA table and series ID it comes from, plus how students should read it.
INDICATORS = [
    {
        "id": "cash-rate",
        "label": "Cash rate target",
        "short": "Cash rate",
        "phrase": "the cash rate target", "verb": "was",
        "table": "f1", "series": "FIRMMCRTD", "anchor": "interest-rates",
        "unit": "%", "decimals": 2, "years": 6, "kind": "level",
        "resample": "month-end",
        "meaning": "The RBA's main monetary policy tool. A higher cash rate is contractionary: it raises "
                   "borrowing costs and slows spending to bring inflation down.",
        "dotpoints": ["mp-cash-rate", "fin-interest-rates"],
    },
    {
        "id": "cpi",
        "label": "Headline inflation (CPI, year-ended)",
        "short": "Headline inflation",
        "phrase": "headline inflation (year-ended)", "verb": "was",
        "table": "g1", "series": "GCPIAGYP", "anchor": "inflation-expectations",
        "abs": {"key": "3.10001.10.50.M", "adjustment": "Original"},
        "unit": "%", "decimals": 1, "years": 6, "kind": "rate",
        "band": [2, 3],
        "meaning": "How much consumer prices rose over the past year. The RBA aims to keep inflation "
                   "between 2 and 3 per cent.",
        "dotpoints": ["iss-inflation-measure", "mp-objectives"],
    },
    {
        "id": "trimmed-mean",
        "label": "Underlying inflation (trimmed mean, year-ended)",
        "short": "Underlying inflation",
        "phrase": "underlying inflation (trimmed mean, year-ended)", "verb": "was",
        "table": "g1", "series": "GCPIOCPMTMYP", "anchor": "inflation-expectations",
        "abs": {"key": "3.999902.20.50.M", "adjustment": "Seasonally adjusted"},
        "unit": "%", "decimals": 1, "years": 6, "kind": "rate",
        "band": [2, 3],
        "meaning": "Inflation with the most extreme price changes removed. The RBA watches it closely "
                   "because it shows the trend better than the headline rate.",
        "dotpoints": ["iss-inflation-headline-underlying"],
    },
    {
        "id": "unemployment",
        "label": "Unemployment rate",
        "short": "Unemployment",
        "phrase": "the unemployment rate", "verb": "was",
        "table": "h5", "series": "GLFSURSA", "anchor": "output-labour",
        "unit": "%", "decimals": 1, "years": 6, "kind": "rate",
        "meaning": "Unemployed people as a share of the labour force (seasonally adjusted). Low "
                   "unemployment is a sign of a tight labour market.",
        "dotpoints": ["iss-unemployment-rate"],
    },
    {
        "id": "participation",
        "label": "Labour force participation rate",
        "short": "Participation",
        "phrase": "the labour force participation rate", "verb": "was",
        "table": "h5", "series": "GLFSPRSA", "anchor": "output-labour",
        "unit": "%", "decimals": 1, "years": 6, "kind": "rate",
        "meaning": "The share of working-age people who are in the labour force, either working or "
                   "looking for work.",
        "dotpoints": ["iss-participation"],
    },
    {
        "id": "gdp-growth",
        "label": "Real GDP growth (year-ended)",
        "short": "GDP growth",
        "phrase": "real GDP growth (year-ended)", "verb": "was",
        "table": "h1", "series": "GGDPCVGDPY", "anchor": "output-labour",
        "unit": "%", "decimals": 1, "years": 6, "kind": "rate",
        "meaning": "How much the economy's real output grew over the past year, after removing the "
                   "effect of price changes.",
        "dotpoints": ["iss-growth-real-gdp", "iss-growth-trends"],
    },
    {
        "id": "terms-of-trade",
        "label": "Terms of trade (index)",
        "short": "Terms of trade",
        "phrase": "the terms of trade index", "verb": "was",
        "table": "h1", "series": "GOPITT", "anchor": "output-labour",
        "unit": "index", "decimals": 1, "years": 10, "kind": "index",
        "meaning": "Export prices relative to import prices. A higher index means each unit of exports "
                   "buys more imports, which boosts national income.",
        "dotpoints": ["iss-terms-of-trade"],
    },
    {
        "id": "current-account",
        "label": "Current account balance (% of GDP)",
        "short": "Current account",
        "phrase": "the current account balance", "verb": "was",
        "table": "i1", "series": "HCAGSCPGDP", "anchor": "intl-trade-ext-fin",
        "unit": "% of GDP", "decimals": 1, "years": 10, "kind": "balance",
        "meaning": "Australia's net income from trade and investment with the rest of the world. "
                   "Negative means a current account deficit.",
        "dotpoints": ["int-bop"],
    },
    {
        "id": "aud-usd",
        "label": "Australian dollar (US cents)",
        "short": "AUD/USD",
        "phrase": "the Australian dollar", "verb": "was worth",
        "table": "f11.1", "series": "FXRUSD", "anchor": "exchange-rates",
        "unit": "US$", "decimals": 4, "years": 6, "kind": "level",
        "resample": "month-end",
        "meaning": "How many US dollars one Australian dollar buys. A lower dollar makes Australian "
                   "exports cheaper overseas and imports dearer here.",
        "dotpoints": ["int-exchange-rates"],
    },
    {
        "id": "twi",
        "label": "Trade-weighted index (May 1970 = 100)",
        "short": "Trade-weighted index",
        "phrase": "the trade-weighted index", "verb": "was",
        "table": "f11.1", "series": "FXRTWI", "anchor": "exchange-rates",
        "unit": "index", "decimals": 1, "years": 6, "kind": "index",
        "resample": "month-end",
        "meaning": "The dollar's value against a basket of our trading partners' currencies, weighted "
                   "by how much we trade with each.",
        "dotpoints": ["int-exchange-rates"],
    },
    # ----- more indicators: shown on the Stats page, not on Home -----
    {
        "id": "wage-growth", "group": "more",
        "label": "Wage growth (Wage Price Index, year-ended)",
        "short": "Wage growth",
        "phrase": "wage growth (Wage Price Index, year-ended)", "verb": "was",
        "table": "h4", "series": "GWPIYP", "anchor": "output-labour",
        "unit": "%", "decimals": 1, "years": 10, "kind": "rate",
        "meaning": "How much hourly pay rates rose over the year, excluding bonuses. When wages grow "
                   "faster than prices, real wages rise and households can buy more.",
        "dotpoints": ["hh-min-wage", "lm-safety-net", "iss-inflation-causes"],
    },
    {
        "id": "productivity", "group": "more",
        "label": "Labour productivity growth (non-farm, per hour, year-ended)",
        "short": "Productivity growth",
        "phrase": "non-farm labour productivity growth (per hour, year-ended)", "verb": "was",
        "table": "h4", "series": "GNFPROSQP", "anchor": "output-labour",
        "unit": "%", "decimals": 1, "years": 10, "kind": "rate",
        "meaning": "How much more output each hour of work produces than a year earlier. Productivity "
                   "growth is what allows real wages and living standards to rise over time.",
        "dotpoints": ["iss-growth-trends", "micro-competition"],
    },
    {
        "id": "employment-growth", "group": "more",
        "label": "Employment growth (year-ended)",
        "short": "Employment growth",
        "phrase": "employment growth (year-ended)", "verb": "was",
        "table": "h5", "series": "GLFSEPTSYP", "anchor": "output-labour",
        "unit": "%", "decimals": 1, "years": 6, "kind": "rate",
        "meaning": "How much the number of people in work grew over the year. Employment usually needs "
                   "to grow faster than the population for unemployment to fall.",
        "dotpoints": ["iss-unemployment-rate", "iss-participation"],
    },
    {
        "id": "vacancies", "group": "more",
        "label": "Job vacancies (% of labour force)",
        "short": "Job vacancies",
        "phrase": "the job vacancy rate (vacancies as a share of the labour force)", "verb": "was",
        "table": "h5", "series": "GLFOSVTLF", "anchor": "output-labour",
        "unit": "%", "decimals": 1, "years": 10, "kind": "rate",
        "meaning": "Unfilled jobs as a share of the labour force. A high ratio means employers are "
                   "struggling to find workers, a sign of a tight labour market.",
        "dotpoints": ["iss-unemployment-rate", "mp-objectives"],
    },
    {
        "id": "bond-10y", "group": "more",
        "label": "10-year government bond yield",
        "short": "10-year bond yield",
        "phrase": "the 10-year Australian Government bond yield", "verb": "was",
        "table": "f2.1", "series": "FCMYGBAG10", "anchor": "interest-rates",
        "unit": "%", "decimals": 2, "years": 10, "kind": "level",
        "meaning": "The interest rate investors demand to lend to the government for 10 years. It "
                   "reflects expected future cash rates and inflation, and sets the cost of long-term borrowing.",
        "dotpoints": ["fin-interest-rates", "fp-stance"],
    },
    {
        "id": "mortgage-rate", "group": "more",
        "label": "Mortgage rate (discounted variable, owner-occupier)",
        "short": "Mortgage rate",
        "phrase": "the average discounted variable mortgage rate for owner-occupiers", "verb": "was",
        "table": "f5", "series": "FILRHLBVD", "anchor": "interest-rates",
        "sourceName": "Canstar",  # the table credits "CANSTAR data; RBA"
        "unit": "%", "decimals": 2, "years": 6, "kind": "level",
        "meaning": "The variable home loan rate banks typically offer owner-occupiers. It moves closely "
                   "with the cash rate, which is how monetary policy reaches household budgets.",
        "dotpoints": ["fin-interest-rates", "fin-housing", "mp-cash-rate"],
    },
    {
        "id": "housing-credit", "group": "more",
        "label": "Housing credit growth (year-ended)",
        "short": "Housing credit growth",
        "phrase": "housing credit growth (year-ended)", "verb": "was",
        "table": "d1", "series": "DGFACH12", "anchor": "money-credit",
        "unit": "%", "decimals": 1, "years": 6, "kind": "rate",
        "meaning": "How fast the total value of home loans grew over the year. Faster growth means more "
                   "borrowing for housing, which can push up home prices.",
        "dotpoints": ["fin-housing", "fin-role", "mp-cash-rate"],
    },
    {
        "id": "consumption-growth", "group": "more",
        "label": "Household consumption growth (real, year-ended)",
        "short": "Consumption growth",
        "phrase": "real household consumption growth (year-ended)", "verb": "was",
        "table": "h2", "series": "GGDPECCVPSHY", "anchor": "output-labour",
        "unit": "%", "decimals": 1, "years": 6, "kind": "rate",
        "meaning": "How much households increased their spending over the year, after inflation. "
                   "Consumption is about half of GDP, so it drives aggregate demand.",
        "dotpoints": ["iss-growth-trends", "mp-cash-rate"],
    },
    {
        "id": "saving-ratio", "group": "more",
        "label": "Household saving ratio",
        "short": "Saving ratio",
        "phrase": "the household saving ratio", "verb": "was",
        "table": "h2", "series": "GGDPICHDISR", "anchor": "output-labour",
        "unit": "%", "decimals": 1, "years": 10, "kind": "level",
        "meaning": "The share of household disposable income that is saved rather than spent. It rises "
                   "when households are cautious and falls when they spend more of their income.",
        "dotpoints": ["fin-role", "iss-growth-trends"],
    },
    {
        "id": "commodity-prices", "group": "more",
        "label": "Commodity prices (A$ index, 2024/25 = 100)",
        "short": "Commodity prices",
        "phrase": "the RBA index of commodity prices (in Australian dollars)", "verb": "was",
        "table": "i2", "series": "GRCPAIAD", "anchor": "intl-trade-ext-fin",
        "unit": "index", "decimals": 1, "years": 6, "kind": "index",
        "meaning": "The prices Australia receives for its main commodity exports, such as iron ore, coal "
                   "and gas. Higher prices lift export income and usually the terms of trade.",
        "dotpoints": ["iss-terms-of-trade", "glb-aud-factors", "int-trade"],
    },
]


# Series the RBA updates every business day, shown as "Daily numbers" on Home and Stats.
DAILY = [
    {"id": "d-cash-rate", "label": "Cash rate target", "short": "Cash rate",
     "table": "f1", "series": "FIRMMCRTD", "anchor": "interest-rates", "unit": "%", "decimals": 2},
    {"id": "d-aud-usd", "label": "Australian dollar in US cents", "short": "AUD/USD",
     "table": "f11.1", "series": "FXRUSD", "anchor": "exchange-rates", "unit": "US$", "decimals": 4},
    {"id": "d-twi", "label": "Trade-weighted index", "short": "Trade-weighted index",
     "table": "f11.1", "series": "FXRTWI", "anchor": "exchange-rates", "unit": "index", "decimals": 1},
    {"id": "d-aud-cny", "label": "Australian dollar in Chinese yuan", "short": "AUD/CNY",
     "table": "f11.1", "series": "FXRCR", "anchor": "exchange-rates", "unit": "CNY", "decimals": 4},
    {"id": "d-bond-3y", "label": "3-year government bond yield", "short": "3-year bond yield",
     "table": "f2", "series": "FCMYGBAG3D", "anchor": "interest-rates", "unit": "%", "decimals": 2},
    {"id": "d-bond-10y", "label": "10-year government bond yield", "short": "10-year bond yield",
     "table": "f2", "series": "FCMYGBAG10D", "anchor": "interest-rates", "unit": "%", "decimals": 2},
]


def parse_date(text):
    text = text.strip()
    for fmt in ("%d/%m/%Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def read_table(text):
    """Return (meta, rows): meta maps series ID -> {title, units, published, source};
    rows is a list of (date, {series ID: value string})."""
    reader = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    header = {}
    for row in reader:
        if row and row[0] in ("Title", "Units", "Source", "Publication date", "Series ID", "Frequency", "Type"):
            header[row[0]] = row
    ids = header.get("Series ID")
    if not ids:
        raise ValueError("table has no 'Series ID' row")
    meta = {}
    for col, sid in enumerate(ids):
        if col == 0 or not sid:
            continue
        def pick(name):
            row = header.get(name, [])
            return row[col] if col < len(row) else ""
        meta[sid] = {
            "col": col,
            "title": pick("Title"),
            "units": pick("Units"),
            "source": pick("Source"),
            "published": pick("Publication date"),
            "type": pick("Type"),
            "frequency": pick("Frequency"),
        }
    rows = []
    for row in reader:
        if not row:
            continue
        d = parse_date(row[0])
        if d is None:
            continue
        rows.append((d, row))
    return meta, rows


def read_abs_monthly(text):
    """Parse an ABS SDMX CSV response into [(month-end date, value)]."""
    points = []
    for row in csv.DictReader(io.StringIO(text)):
        period, value = row.get("TIME_PERIOD", ""), row.get("OBS_VALUE", "")
        if not period or value in ("", None):
            continue
        y, m = (int(x) for x in period.split("-"))
        nxt = date(y + (m == 12), m % 12 + 1, 1)
        points.append((date.fromordinal(nxt.toordinal() - 1), float(value)))
    return sorted(points)


def month_end(points):
    """Keep the last observation in each calendar month (for daily series)."""
    last = {}
    for d, v in points:
        last[(d.year, d.month)] = (d, v)
    return [last[k] for k in sorted(last)]


def build(fetch, fetch_abs=None):
    cache = {}
    out = []
    warnings = []
    for ind in INDICATORS:
        table = ind["table"]
        if table not in cache:
            cache[table] = read_table(fetch(table))
        meta, rows = cache[table]
        sid = ind["series"]
        if sid not in meta:
            raise ValueError(f"series {sid} not found in table {table}")
        col = meta[sid]["col"]
        points = []
        for d, row in rows:
            if col < len(row) and row[col].strip() not in ("", "-"):
                try:
                    points.append((d, float(row[col])))
                except ValueError:
                    pass
        if ind.get("resample") == "month-end":
            points = month_end(points)
        if not points:
            raise ValueError(f"series {sid} has no data")
        latest = points[-1][0]
        cutoff = date(latest.year - ind["years"], latest.month, 1)
        points = [(d, v) for d, v in points if d >= cutoff]
        published = parse_date(meta[sid]["published"]) if meta[sid]["published"] else None
        src = ind.get("sourceName") or meta[sid]["source"]
        record_source = ("RBA table " if src == "RBA" else src + " via RBA table ") + table.upper()
        record_url = RBA_PAGE.format(anchor=ind["anchor"])
        frequency = "Monthly (month-end)" if ind.get("resample") else meta[sid]["frequency"]
        adjustment = meta[sid]["type"]
        history = None
        if ind.get("abs") and fetch_abs:
            try:
                monthly = read_abs_monthly(fetch_abs(ind["abs"]["key"]))
                if len(monthly) < 6:
                    raise ValueError("fewer than 6 monthly observations")
                if monthly[-1][0] >= points[-1][0]:
                    history = {
                        "frequency": meta[sid]["frequency"],
                        "source": record_source,
                        "points": [[d.isoformat(), round(v, ind["decimals"])] for d, v in points],
                    }
                    points = monthly
                    record_source = "ABS Consumer Price Index (monthly)"
                    record_url = ABS_CPI_PAGE
                    frequency = "Monthly"
                    adjustment = ind["abs"]["adjustment"]
                    published = None  # the ABS API does not report a release date
            except Exception as exc:
                warnings.append(f"{ind['short']}: ABS monthly data unavailable ({exc}); using RBA {table.upper()}")
        out.append({
            "id": ind["id"],
            "group": ind.get("group", "headline"),
            "label": ind["label"],
            "short": ind["short"],
            "phrase": ind["phrase"],
            "verb": ind["verb"],
            "unit": ind["unit"],
            "decimals": ind["decimals"],
            "kind": ind["kind"],
            "band": ind.get("band"),
            "frequency": frequency,
            "adjustment": adjustment,
            "meaning": ind["meaning"],
            "dotpoints": ind["dotpoints"],
            "source": record_source,
            "sourceUrl": record_url,
            "seriesId": sid,
            "published": published.isoformat() if published else None,
            "points": [[d.isoformat(), round(v, ind["decimals"])] for d, v in points],
            "history": history,
        })
    decisions = cash_rate_decisions(cache)
    daily = build_daily(fetch, cache)
    return out, decisions, warnings, daily


def build_daily(fetch, cache):
    """The last month of each daily series (business days only), newest last."""
    out = []
    for d in DAILY:
        if d["table"] not in cache:
            cache[d["table"]] = read_table(fetch(d["table"]))
        meta, rows = cache[d["table"]]
        if d["series"] not in meta:
            raise ValueError(f"daily series {d['series']} not found in table {d['table']}")
        col = meta[d["series"]]["col"]
        points = []
        for day, row in rows:
            cell = row[col].strip() if col < len(row) else ""
            if cell not in ("", "-"):
                try:
                    points.append([day.isoformat(), round(float(cell), d["decimals"])])
                except ValueError:
                    pass
        if len(points) < 2:
            raise ValueError(f"daily series {d['series']} has too little data")
        src = meta[d["series"]]["source"]
        out.append({
            "id": d["id"], "label": d["label"], "short": d["short"], "unit": d["unit"], "decimals": d["decimals"],
            "source": ("RBA table " if src == "RBA" else src + " via RBA table ") + d["table"].upper(),
            "sourceUrl": RBA_PAGE.format(anchor=d["anchor"]),
            "points": points[-23:],
        })
    return out


def cash_rate_decisions(cache):
    """Every change to the cash rate target since 2019, from the daily F1 table."""
    meta, rows = cache["f1"]
    col = meta["FIRMMCRTD"]["col"]
    changes, prev = [], None
    for d, row in rows:
        cell = row[col].strip() if col < len(row) else ""
        if not cell:
            continue
        rate = float(cell)
        if prev is not None and rate != prev and d.year >= 2019:
            changes.append({"date": d.isoformat(), "rate": rate, "change": round(rate - prev, 2)})
        prev = rate
    return changes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-dir", help="folder holding <table>.csv files instead of downloading")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data" / "stats.js"))
    args = ap.parse_args()

    def fetch(table):
        if args.from_dir:
            return (Path(args.from_dir) / f"{table}.csv").read_text(encoding="utf-8-sig")
        req = urllib.request.Request(RBA_CSV.format(table=table), headers={"User-Agent": "dotpoint-stats/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8-sig")

    def fetch_abs(key):
        if args.from_dir:
            path = Path(args.from_dir) / f"abs-{key}.csv"
            if not path.exists():
                raise FileNotFoundError(path.name)
            return path.read_text(encoding="utf-8-sig")
        req = urllib.request.Request(ABS_DATA.format(key=key), headers={
            "User-Agent": "dotpoint-stats/1.0", "Accept": "application/vnd.sdmx.data+csv"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8-sig")

    try:
        indicators, decisions, warnings, daily = build(fetch, fetch_abs)
    except Exception as exc:  # keep the old file if anything is wrong
        print(f"Stats NOT updated: {exc}", file=sys.stderr)
        return 1

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "indicators": indicators,
        "cashRateDecisions": decisions,
        "daily": daily,
    }
    out_path = Path(args.out)
    if out_path.exists():
        try:
            old = out_path.read_text(encoding="utf-8")
            old = json.loads(old[old.index("{"):old.rindex("}") + 1])
            same = {k: v for k, v in old.items() if k != "generatedAt"} == {k: v for k, v in payload.items() if k != "generatedAt"}
        except ValueError:
            same = False
        if same:
            print("No new figures since the last refresh; data/stats.js left unchanged.")
            return 0
    body = json.dumps(payload, indent=1, ensure_ascii=False)
    Path(args.out).write_text(
        "// Generated by tools/update_stats.py from Reserve Bank of Australia statistical tables.\n"
        "// Do not edit by hand: run the script again to refresh.\n"
        f"globalThis.DP_STATS = {body};\n",
        encoding="utf-8",
    )
    for ind in indicators:
        d, v = ind["points"][-1]
        print(f"{ind['short']:<22} {v:>8} {ind['unit']:<9} as at {d} (published {ind['published']})")
    for w in warnings:
        print("Warning:", w, file=sys.stderr)
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
