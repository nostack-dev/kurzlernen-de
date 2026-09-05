#!/usr/bin/env python3
"""Build the RatioFinder feed from real SEC CompanyFacts + market data.

Rules:
- No synthetic/random values.
- A published stock row is complete or it is not published.
- Missing issuer disclosures are recorded under `excluded`, never fabricated.
- SEC CompanyFacts are fetched directly from data.sec.gov.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import math
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DOLT_API = "https://www.dolthub.com/api/v1alpha1/deeleeramone/sec-company-facts/main"
SEC_FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart"
YAHOO_FUND = "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries"
STOOQ = "https://stooq.com/q/l/"
SEC_UA = "kurzlernen.de ratio-data admin@kurzlernen.de"
WEB_UA = "Mozilla/5.0 kurzlernen.de-ratio-data/5.0"

UNIVERSES = {
    "ai-hardware": ["NVDA","ORCL","MU","AMZN","MSFT","AVGO","TSM","SMCI","ANET","VRT","CEG","MOD","DELL","GOOGL","AMD","ASML","INTC","NBIS","PLTR","CSCO"],
    "semiconductors": ["TSM","NVDA","AVGO","ASML","AMD","MU","AMAT","LRCX","KLAC","QCOM","ARM","ADI","TXN","MRVL","NXPI"],
    "datacenter-infra": ["VRT","CEG","MOD","ANET","EQIX","DLR","SMR","VST","ETN","GE","PWR","JCI"],
    "sp500-tech": ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","AVGO","ORCL","CSCO","ACN","IBM","AMD","QCOM","INTC","NOW","AMAT","TXN","LRCX","MU","GE","CAT","DE","DELL","HPE","PLTR"],
}
TRACKED = sorted({ticker for group in UNIVERSES.values() for ticker in group})
ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}
PERIODIC_FORMS = ANNUAL_FORMS | {"10-Q", "10-Q/A", "6-K", "6-K/A"}

# Explicit SEC taxonomy concepts commonly used for cash capital expenditure.
CAPEX_TAGS = [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsToAcquireOtherPropertyPlantAndEquipment",
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    "PurchaseOfPropertyPlantAndEquipment",
    "PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssets",
]
EPS_TAGS = [
    "EarningsPerShareDiluted",
    "DilutedEarningsLossPerShare",
    "DilutedEarningsLossPerShareFromContinuingOperations",
    "BasicAndDilutedEarningsPerShare",
    "EarningsPerShareBasicAndDiluted",
    "EarningsPerShareBasic",
    "BasicEarningsLossPerShare",
]
DEMAND_EXCLUDES = (
    "percentage", "expectedtiming", "recognized", "recognize", "increase", "decrease",
    "changein", "shareof", "portion", "maturity", "amortization",
)
SECTORS = {
    "NVDA":"AI Compute & Networking","ORCL":"Cloud Infrastructure","MU":"HBM Memory","AMZN":"Cloud & Commerce","MSFT":"Cloud & Software","AVGO":"AI ASICs & Networking","TSM":"Advanced Foundry","SMCI":"AI Servers","ANET":"Data Center Networking","VRT":"Data Center Power & Cooling","CEG":"Power Generation","MOD":"Thermal Management","DELL":"Enterprise Infrastructure","GOOGL":"Cloud & AI","AMD":"AI Accelerators","ASML":"Lithography","INTC":"Foundry & Compute","NBIS":"AI Neocloud","PLTR":"Enterprise AI Software","CSCO":"Networking","AMAT":"Semiconductor Equipment","LRCX":"Semiconductor Equipment","KLAC":"Semiconductor Equipment","QCOM":"Semiconductors","ARM":"CPU IP","ADI":"Analog Semiconductors","TXN":"Analog Semiconductors","MRVL":"Data Infrastructure Semiconductors","NXPI":"Semiconductors","EQIX":"Data Centers","DLR":"Data Centers","SMR":"Nuclear Technology","VST":"Power Generation","ETN":"Power Management","GE":"Industrial Technology","PWR":"Grid Infrastructure","JCI":"Building Infrastructure","AAPL":"Consumer Technology","META":"Digital Platforms & AI","ACN":"IT Services","IBM":"Enterprise Technology","NOW":"Enterprise Software","CAT":"Industrial Equipment","DE":"Industrial Equipment","HPE":"Enterprise Infrastructure"
}


class FetchError(RuntimeError):
    pass


def get_bytes(url: str, *, sec: bool = False, retries: int = 3, timeout: int = 35) -> bytes:
    headers = {
        "User-Agent": SEC_UA if sec else WEB_UA,
        "Accept": "application/json,text/plain,*/*",
        "Accept-Encoding": "identity",
    }
    last: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as response:
                body = response.read()
            if sec:
                time.sleep(0.12)
            return body
        except Exception as exc:  # network boundary
            last = exc
            if attempt + 1 < retries:
                time.sleep(min(5, 0.7 * 2**attempt))
    raise FetchError(f"GET failed {url}: {last}")


def jget(url: str, *, sec: bool = False, retries: int = 3, timeout: int = 35):
    return json.loads(get_bytes(url, sec=sec, retries=retries, timeout=timeout).decode())


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def resolve_tickers(tickers: list[str]) -> dict[str, dict[str, str]]:
    # SEC's company_tickers file returns 403 from GitHub-hosted runners. This tiny
    # replicated metadata lookup is only symbol->CIK/name; all financial facts below
    # come directly from official data.sec.gov.
    symbols = ",".join(sql_quote(t) for t in tickers)
    sql = (
        "SELECT cik,ticker,name,is_primary,`rank` FROM tickers "
        f"WHERE ticker IN ({symbols}) ORDER BY ticker,is_primary DESC,`rank` ASC"
    )
    url = DOLT_API + "?" + urllib.parse.urlencode({"q": sql})
    payload = jget(url, retries=3, timeout=35)
    if payload.get("query_execution_status") != "Success":
        raise FetchError(f"ticker metadata query failed: {payload.get('query_execution_message')}")
    result: dict[str, dict[str, str]] = {}
    for row in payload.get("rows") or []:
        ticker = str(row["ticker"]).upper()
        result.setdefault(ticker, {"cik": str(row["cik"]).zfill(10), "name": row.get("name") or ticker})
    missing = sorted(set(tickers) - set(result))
    if missing:
        raise FetchError("ticker metadata absent: " + ", ".join(missing))
    return result


def fetch_companyfacts(cik: str):
    url = SEC_FACTS.format(cik=cik)
    payload = jget(url, sec=True, retries=3, timeout=40)
    if not isinstance(payload.get("facts"), dict):
        raise FetchError(f"malformed SEC CompanyFacts payload for CIK {cik}")
    return payload


def flatten_facts(payload) -> list[dict]:
    result: list[dict] = []
    for namespace, tags in (payload.get("facts") or {}).items():
        if not isinstance(tags, dict):
            continue
        for tag, node in tags.items():
            if not isinstance(node, dict):
                continue
            label = str(node.get("label") or "")
            description = str(node.get("description") or "")
            for unit, records in (node.get("units") or {}).items():
                if not isinstance(records, list):
                    continue
                for record in records:
                    if not isinstance(record, dict):
                        continue
                    row = dict(record)
                    row.update(namespace=namespace, tag=tag, unit=unit, label=label, description=description)
                    result.append(row)
    return result


def number(value):
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value)
            return parsed if math.isfinite(parsed) else None
        except ValueError:
            return None
    return None


def parse_date(value):
    try:
        return dt.date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def money_unit(unit: str) -> bool:
    low = str(unit or "").lower()
    return bool(low) and "/" not in low and "share" not in low and low not in {"pure", "shares"}


def annual_duration(row: dict) -> bool:
    if row.get("form") not in ANNUAL_FORMS:
        return False
    if row.get("fp") == "FY":
        return True
    start, end = parse_date(row.get("start")), parse_date(row.get("end"))
    if not start or not end:
        return False
    days = (end - start).days
    return 300 <= days <= 380


def fiscal_year(row: dict):
    try:
        return int(row.get("fy"))
    except (TypeError, ValueError):
        end = parse_date(row.get("end"))
        return end.year if end else None


def annual_series(rows: list[dict]) -> dict[int, tuple[dict, float]]:
    result: dict[int, tuple[tuple, dict, float]] = {}
    for row in rows:
        if not annual_duration(row):
            continue
        value = number(row.get("val"))
        fy = fiscal_year(row)
        if value is None or fy is None:
            continue
        start, end = parse_date(row.get("start")), parse_date(row.get("end"))
        duration = (end - start).days if start and end else 0
        # Prefer an explicitly FY-tagged record, then annual-period closeness to 365,
        # then latest filing vintage. This prevents quarter/YTD facts from winning.
        quality = (1 if row.get("fp") == "FY" else 0, -abs(duration - 365), str(row.get("filed") or ""), str(row.get("end") or ""))
        old = result.get(fy)
        if not old or quality > old[0]:
            result[fy] = (quality, row, value)
    return {fy: (row, value) for fy, (_, row, value) in result.items()}


def capex_semantic_rank(row: dict) -> int:
    tag = str(row.get("tag") or "")
    if tag in CAPEX_TAGS:
        return 1000 - CAPEX_TAGS.index(tag)
    text = (tag + " " + str(row.get("label") or "") + " " + str(row.get("description") or "")).lower()
    if "capital expenditure" in text and ("cash" in text or "payment" in text or "purchase" in text):
        return 700
    if ("payment" in text or "purchase" in text) and ("property plant" in text or "productive asset" in text or "property, plant" in text):
        return 650
    return 0


def pick_capex(rows: list[dict]):
    best = None
    candidate_tags = sorted({str(r.get("tag")) for r in rows if money_unit(r.get("unit")) and capex_semantic_rank(r) > 0})
    for tag in candidate_tags:
        tag_rows = [r for r in rows if r.get("tag") == tag and money_unit(r.get("unit"))]
        rank = max(capex_semantic_rank(r) for r in tag_rows)
        for unit in sorted({str(r.get("unit")) for r in tag_rows}):
            series = annual_series([r for r in tag_rows if str(r.get("unit")) == unit])
            if len(series) < 3:
                continue
            years = sorted(series)
            current = years[-1]
            prior = current - 2 if current - 2 in series else years[-3]
            current_value = abs(series[current][1]); prior_value = abs(series[prior][1])
            if current_value <= 0 or prior_value <= 0:
                continue
            key = (current, rank, len(series))
            if not best or key > best[0]:
                best = (key, tag, unit, series[current][0], current_value, prior, prior_value)
    if not best:
        raise FetchError("no defensible 3-year annual CapEx series")
    _, tag, unit, row, current_value, prior, prior_value = best
    return {
        "current": current_value / 1e9,
        "prior2": prior_value / 1e9,
        "growth": (current_value / prior_value - 1) * 100,
        "fy": fiscal_year(row),
        "fy2": prior,
        "concept": f"{row['namespace']}:{tag}",
        "unit": unit,
    }


def demand_priority(tag: str) -> int:
    low = tag.lower()
    if any(term in low for term in DEMAND_EXCLUDES):
        return -100
    if "remainingperformance" in low: return 110
    if "unsatisfiedperformance" in low: return 108
    if "remainingtransactionprice" in low: return 106
    if "orderbacklog" in low or ("backlog" in low and "order" in low): return 100
    if "backlog" in low: return 95
    if "orderbook" in low: return 92
    if "unfulfilled" in low: return 88
    if "contractwithcustomerliability" in low: return 74
    if "contractliabilit" in low: return 72
    if "deferredrevenue" in low: return 60
    return 0


def demand_basis(tag: str) -> str:
    low = tag.lower()
    if "remainingperformance" in low or "unsatisfiedperformance" in low or "remainingtransactionprice" in low:
        return "RPO"
    if "backlog" in low or "orderbook" in low or "unfulfilled" in low:
        return "Backlog"
    if "contractliabilit" in low:
        return "Contract liabilities"
    return "Deferred revenue"


def pick_demand(rows: list[dict], unit: str):
    candidates = []
    for row in rows:
        if row.get("form") not in PERIODIC_FORMS or str(row.get("unit")) != unit:
            continue
        value = number(row.get("val"))
        tag = str(row.get("tag") or "")
        priority = demand_priority(tag)
        if value is None or value <= 0 or priority <= 0:
            continue
        end = str(row.get("end") or "")
        filed = str(row.get("filed") or "")
        low = tag.lower()
        component = "noncurrent" if "noncurrent" in low else "current" if "current" in low else "aggregate"
        candidates.append({"end": end, "filed": filed, "priority": priority, "value": value, "row": row, "component": component})
    if not candidates:
        raise FetchError(f"issuer does not disclose a numeric RPO/backlog/contract-liability fact in {unit}")

    # Prefer the latest date with the strongest semantic class. Aggregate concepts
    # win over split current/non-current components. If only split contract-liability
    # components exist, sum current + non-current for that exact date.
    latest = max(c["end"] for c in candidates)
    recent = [c for c in candidates if c["end"] == latest]
    aggregate = [c for c in recent if c["component"] == "aggregate"]
    if aggregate:
        winner = max(aggregate, key=lambda c: (c["priority"], c["value"], c["filed"]))
        row = winner["row"]
        return {
            "value": winner["value"] / 1e9,
            "basis": demand_basis(str(row["tag"])),
            "concept": f"{row['namespace']}:{row['tag']}",
            "asOf": winner["end"] or winner["filed"],
            "unit": unit,
        }

    split = [c for c in recent if demand_basis(str(c["row"]["tag"])) == "Contract liabilities"]
    by_component = {}
    for candidate in split:
        comp = candidate["component"]
        old = by_component.get(comp)
        if not old or (candidate["priority"], candidate["filed"]) > (old["priority"], old["filed"]):
            by_component[comp] = candidate
    if "current" in by_component and "noncurrent" in by_component:
        parts = [by_component["current"], by_component["noncurrent"]]
        return {
            "value": sum(c["value"] for c in parts) / 1e9,
            "basis": "Contract liabilities",
            "concept": "+".join(f"{c['row']['namespace']}:{c['row']['tag']}" for c in parts),
            "asOf": latest,
            "unit": unit,
        }

    winner = max(recent, key=lambda c: (c["priority"], c["value"], c["filed"]))
    row = winner["row"]
    return {
        "value": winner["value"] / 1e9,
        "basis": demand_basis(str(row["tag"])),
        "concept": f"{row['namespace']}:{row['tag']}",
        "asOf": winner["end"] or winner["filed"],
        "unit": unit,
    }


def yahoo_price(ticker: str):
    encoded = urllib.parse.quote(ticker, safe="")
    url = f"{YAHOO_CHART}/{encoded}?range=5d&interval=1d&includePrePost=false"
    payload = jget(url, retries=2, timeout=20)
    results = payload.get("chart", {}).get("result") or []
    if not results:
        raise FetchError("Yahoo price unavailable")
    price = results[0].get("meta", {}).get("regularMarketPrice")
    if not isinstance(price, (int, float)) or price <= 0:
        closes = [v for v in results[0].get("indicators", {}).get("quote", [{}])[0].get("close", []) if isinstance(v, (int, float)) and v > 0]
        if not closes:
            raise FetchError("Yahoo close unavailable")
        price = closes[-1]
    return float(price), "Yahoo Finance chart", url


def stooq_price(ticker: str):
    symbol = ticker.lower().replace("-", ".") + ".us"
    url = f"{STOOQ}?s={urllib.parse.quote(symbol)}&f=sd2t2ohlcv&h&e=csv"
    rows = list(csv.DictReader(io.StringIO(get_bytes(url, retries=2, timeout=20).decode())))
    if not rows or rows[0].get("Close") in (None, "N/D", ""):
        raise FetchError("Stooq price unavailable")
    return float(rows[0]["Close"]), "Stooq", url


def market_price(ticker: str):
    try:
        return yahoo_price(ticker)
    except Exception:
        return stooq_price(ticker)


def yahoo_peg(ticker: str):
    now = int(time.time()); encoded = urllib.parse.quote(ticker, safe="")
    url = f"{YAHOO_FUND}/{encoded}?symbol={encoded}&type=trailingPegRatio,forwardPe,trailingPe&period1={now-1209600}&period2={now}"
    payload = jget(url, retries=2, timeout=20); values = {}
    for result in payload.get("timeseries", {}).get("result", []):
        typ = (result.get("meta", {}).get("type") or [None])[0]
        points = result.get(typ, []) if typ else []
        if points:
            raw = points[-1].get("reportedValue", {}).get("raw")
            if isinstance(raw, (int, float)):
                values[typ] = float(raw)
    peg = values.get("trailingPegRatio")
    if not isinstance(peg, (int, float)) or not math.isfinite(peg):
        raise FetchError("Yahoo PEG unavailable")
    return peg, values.get("forwardPe") or values.get("trailingPe"), url


def computed_peg(rows: list[dict], price: float):
    best = None
    for tag_index, tag in enumerate(EPS_TAGS):
        tag_rows = [r for r in rows if r.get("tag") == tag]
        for unit in sorted({str(r.get("unit")) for r in tag_rows}):
            if "/" not in unit.lower() and "share" not in unit.lower():
                continue
            series = annual_series([r for r in tag_rows if str(r.get("unit")) == unit])
            if len(series) < 2:
                continue
            years = sorted(series); current, previous = years[-1], years[-2]
            eps_current, eps_previous = series[current][1], series[previous][1]
            if abs(eps_current) < 1e-12 or abs(eps_previous) < 1e-12:
                continue
            growth = (eps_current / eps_previous - 1) * 100
            if abs(growth) < 1e-12:
                continue
            pe = price / eps_current; value = pe / growth
            candidate = ((current, -tag_index), value, pe, {
                "concept": f"{series[current][0]['namespace']}:{tag}",
                "fyCurrent": current, "fyPrevious": previous,
                "epsCurrent": eps_current, "epsPrevious": eps_previous,
                "growthPct": growth, "unit": unit,
            })
            if not best or candidate[0] > best[0]:
                best = candidate
    if not best:
        raise FetchError("no computable annual EPS PEG")
    return best[1], best[2], best[3]


def peg_value(ticker: str, cik: str, price: float, rows: list[dict]):
    try:
        value, pe, url = yahoo_peg(ticker)
        return {"value": value, "pe": pe, "basis": "Yahoo trailing PEG", "url": url, "details": None}
    except Exception:
        value, pe, details = computed_peg(rows, price)
        return {"value": value, "pe": pe, "basis": "Computed FY PEG = P/E ÷ annual EPS growth %", "url": SEC_FACTS.format(cik=cik), "details": details}


def score(growth: float, coverage: float, peg: float) -> int:
    result = 35 if growth >= 300 else 25 + (growth - 150) / 15 if growth >= 150 else max(0, growth / 150) * 20
    result += 35 if coverage >= 3 else 25 + (coverage - 2) * 10 if coverage >= 2 else max(0, coverage / 2) * 20
    result += 30 if 0 < peg <= .5 else 20 + (1 - peg) / .05 if .5 < peg <= 1 else max(0, (1.5 - peg) * 20) if 1 < peg <= 1.5 else 5 if peg > 1.5 else 0
    return int(round(max(0, min(100, result))))


def filing_metrics(ticker: str, meta: dict, facts_by_cik: dict):
    info = meta[ticker]; cik = info["cik"]
    rows = flatten_facts(facts_by_cik[cik])
    capex = pick_capex(rows)
    demand = pick_demand(rows, capex["unit"])
    coverage = demand["value"] / capex["current"]
    return info, cik, rows, capex, demand, coverage


def finish_stock(ticker: str, metrics):
    info, cik, rows, capex, demand, coverage = metrics
    price, price_provider, price_url = market_price(ticker)
    peg = peg_value(ticker, cik, price, rows)
    values = [capex["current"], capex["prior2"], capex["growth"], demand["value"], coverage, price, peg["value"]]
    if not all(math.isfinite(v) for v in values):
        raise FetchError("non-finite metric")
    sec_url = SEC_FACTS.format(cik=cik)
    return {
        "ticker": ticker, "name": info["name"], "sector": SECTORS.get(ticker, "Public Company"), "cik": cik,
        "currency": capex["unit"],
        "capexCurrentBn": round(capex["current"], 4), "capex2YBn": round(capex["prior2"], 4), "growthPct": round(capex["growth"], 2),
        "demandBn": round(demand["value"], 4), "demandBasis": demand["basis"], "coverage": round(coverage, 3),
        "peg": round(peg["value"], 4), "pegMeaningful": bool(peg["value"] > 0),
        "pe": round(peg["pe"], 3) if isinstance(peg.get("pe"), (int, float)) and math.isfinite(peg["pe"]) else None,
        "price": round(price, 4), "score": score(capex["growth"], coverage, peg["value"]),
        "sources": {
            "capex": {"provider":"SEC EDGAR CompanyFacts","url":sec_url,"transport":"data.sec.gov","concept":capex["concept"],"currentFY":capex["fy"],"prior2FY":capex["fy2"],"unit":capex["unit"]},
            "demand": {"provider":"SEC EDGAR CompanyFacts","url":sec_url,"transport":"data.sec.gov","basis":demand["basis"],"concept":demand["concept"],"asOf":demand["asOf"],"unit":demand["unit"]},
            "price": {"provider":price_provider,"url":price_url},
            "peg": {"provider":peg["basis"],"url":peg["url"],"details":peg.get("details")},
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="ratio-data.json")
    parser.add_argument("--tickers", default="")
    parser.add_argument("--min-complete", type=int, default=30)
    args = parser.parse_args()
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()] or TRACKED

    print(f"Resolving {len(tickers)} ticker identities...", flush=True)
    meta = resolve_tickers(tickers)
    ciks = sorted({info["cik"] for info in meta.values()})

    print(f"Loading {len(ciks)} official SEC CompanyFacts payloads...", flush=True)
    facts_by_cik = {}; fatal_errors = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_companyfacts, cik): cik for cik in ciks}
        for i, future in enumerate(as_completed(futures), 1):
            cik = futures[future]
            try:
                facts_by_cik[cik] = future.result()
                print(f"SEC [{i}/{len(ciks)}] CIK {cik}", flush=True)
            except Exception as exc:
                fatal_errors.append({"cik": cik, "error": str(exc)})
    if fatal_errors:
        raise SystemExit("SEC transport failed: " + "; ".join(f"{e['cik']}: {e['error']}" for e in fatal_errors))

    print("Resolving filing metrics...", flush=True)
    filing_results = {}; excluded = []
    for ticker in tickers:
        try:
            filing_results[ticker] = filing_metrics(ticker, meta, facts_by_cik)
        except Exception as exc:
            excluded.append({"ticker": ticker, "stage": "filing", "reason": str(exc)})
            print(f"EXCLUDE {ticker}: {exc}", flush=True)

    print("Loading price / PEG data...", flush=True)
    rows = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(finish_stock, ticker, filing_results[ticker]): ticker for ticker in filing_results}
        for i, future in enumerate(as_completed(futures), 1):
            ticker = futures[future]
            try:
                rows.append(future.result())
                print(f"MARKET [{i}/{len(futures)}] {ticker}", flush=True)
            except Exception as exc:
                excluded.append({"ticker": ticker, "stage": "market", "reason": str(exc)})
                print(f"EXCLUDE {ticker}: {exc}", flush=True)

    if len(rows) < args.min_complete:
        raise SystemExit(f"only {len(rows)} complete stocks; minimum is {args.min_complete}")

    payload = {
        "schemaVersion": 3,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "trackedCount": len(tickers),
        "completeCount": len(rows),
        "excludedCount": len(excluded),
        "transport": {"secFacts":"Official SEC CompanyFacts","url":"https://data.sec.gov"},
        "methodology": {
            "capex":"Latest defensible annual SEC XBRL cash CapEx versus the annual value two fiscal years earlier. Annual periods are recognized from FY metadata or a 300–380 day filing duration.",
            "demand":"Latest numeric SEC XBRL demand disclosure in the same currency as CapEx, prioritized RPO → backlog/order book → contract liabilities → deferred revenue. Exact concept is shown per company.",
            "coverage":"Selected SEC demand disclosure divided by latest annual SEC CapEx in the same currency.",
            "peg":"Yahoo trailing PEG when available; otherwise a disclosed calculation from current market price and annual EPS from SEC XBRL.",
            "completeness":"Only complete rows are published. If an issuer does not disclose a numeric input, it is excluded from the ranking rather than filled with N/A or a synthetic estimate.",
        },
        "universes": UNIVERSES,
        "stocks": sorted(rows, key=lambda row: row["score"], reverse=True),
        "excluded": sorted(excluded, key=lambda row: row["ticker"]),
        "errors": [],
    }
    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.output}: {len(rows)} complete, {len(excluded)} excluded", flush=True)

if __name__ == "__main__":
    main()
