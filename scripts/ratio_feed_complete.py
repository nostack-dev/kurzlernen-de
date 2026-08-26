#!/usr/bin/env python3
"""Strict 45/45 RatioFinder collector.

Source cascade:
1) CapEx and normal demand metrics come from official SEC CompanyFacts.
2) If CompanyFacts has no numeric RPO/backlog/contract-liability disclosure, inspect
   recent SEC filings. Prefer contracted backlog/RPO; otherwise use issuer-filed
   next-quarter revenue guidance, annualized and explicitly labeled.
3) PEG uses Yahoo trailing PEG when available, then the base SEC annual-EPS formula,
   then a fully local TTM PEG computed from SEC quarterly diluted EPS + live price.

No ticker-specific numeric values, synthetic/random values, or silent exclusions are
allowed to publish: the workflow gate requires all tracked companies to resolve.
"""
from __future__ import annotations

import html
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ratio_feed as rf  # noqa: E402

SEC_SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_nodash}/{acc}.txt"

_ORIGINAL_PEG = rf.peg_value


def plain_text(raw: str) -> str:
    raw = re.sub(r"<script\b[^>]*>.*?</script>", " ", raw, flags=re.I | re.S)
    raw = re.sub(r"<style\b[^>]*>.*?</style>", " ", raw, flags=re.I | re.S)
    raw = re.sub(r"<[^>]+>", " ", raw)
    raw = html.unescape(raw)
    raw = raw.replace("\xa0", " ")
    return re.sub(r"\s+", " ", raw).strip()


def to_billions(value: str, unit: str) -> float:
    number = float(value.replace(",", ""))
    return number if unit.lower().startswith("b") else number / 1000.0


def recent_sec_submission_texts(cik: str, max_docs: int = 8):
    payload = rf.jget(SEC_SUBMISSIONS.format(cik=cik), sec=True, retries=3, timeout=35)
    recent = (payload.get("filings") or {}).get("recent") or {}
    accessions = recent.get("accessionNumber") or []
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    items = recent.get("items") or []

    rows = []
    for i, accession in enumerate(accessions):
        form = forms[i] if i < len(forms) else ""
        filing_date = dates[i] if i < len(dates) else ""
        item = items[i] if i < len(items) else ""
        if form not in {"8-K", "10-Q", "10-K", "8-K/A", "10-Q/A", "10-K/A"}:
            continue
        priority = 3 if form.startswith("8-K") and "2.02" in str(item) else 2 if form.startswith("8-K") else 1
        rows.append((priority, filing_date, accession, form))
    rows.sort(reverse=True)

    fetched = 0
    for _, filing_date, accession, form in rows:
        if fetched >= max_docs:
            break
        url = SEC_ARCHIVE.format(cik_int=int(cik), acc_nodash=accession.replace("-", ""), acc=accession)
        try:
            raw = rf.get_bytes(url, sec=True, retries=2, timeout=35).decode("utf-8", errors="ignore")
        except Exception:
            continue
        fetched += 1
        yield filing_date, form, url, plain_text(raw)


def filing_demand(ticker: str, cik: str):
    # Semantic patterns only: no ticker-specific numbers.
    backlog_patterns = [
        ("RPO", re.compile(r"(?:remaining performance obligations|remaining performance obligation|unsatisfied performance obligations).{0,260}?(?:was|were|total(?:ed)?|of)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(billion|million)", re.I)),
        ("Backlog", re.compile(r"(?:backlog|signed[- ]but[- ]not[- ]commenced leases).{0,260}?(?:was|were|total(?:ed)?|of)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(billion|million)", re.I)),
        ("Backlog", re.compile(r"\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(billion|million).{0,180}?(?:backlog|remaining performance obligations)", re.I)),
    ]
    guidance_single = re.compile(
        r"(?:forecasting|forecast|expect(?:ing)?|outlook.{0,80}?for)\s+revenue(?:\s+of|\s+to\s+be)?\s*\$?([0-9]+(?:\.[0-9]+)?)\s*(billion|million)",
        re.I,
    )
    guidance_range = re.compile(
        r"revenue.{0,80}?(?:range of|between)\s*\$?([0-9]+(?:\.[0-9]+)?)\s*(billion|million)\s*(?:to|and|-)\s*\$?([0-9]+(?:\.[0-9]+)?)\s*(billion|million)",
        re.I,
    )

    documents = list(recent_sec_submission_texts(cik))
    for filing_date, form, url, text in documents:
        for basis, pattern in backlog_patterns:
            match = pattern.search(text)
            if not match:
                continue
            value = to_billions(match.group(1), match.group(2))
            if value <= 0 or not math.isfinite(value):
                continue
            return {
                "value": value,
                "basis": basis,
                "concept": f"SEC filing narrative: {basis}",
                "asOf": filing_date,
                "unit": "USD",
                "provider": f"SEC EDGAR {form} filing narrative",
                "url": url,
                "transport": "sec.gov/Archives",
                "details": "Numeric contracted-demand disclosure extracted from the issuer filing.",
            }

    # If an issuer genuinely has no contracted-demand disclosure, its own filed
    # next-quarter revenue guidance is a real forward-demand signal. Annualize the
    # midpoint to keep the numerator comparable with annual CapEx and label it.
    for filing_date, form, url, text in documents:
        match = guidance_range.search(text)
        if match:
            low = to_billions(match.group(1), match.group(2))
            high = to_billions(match.group(3), match.group(4))
            midpoint = (low + high) / 2.0
            value = midpoint * 4.0
            if value > 0 and math.isfinite(value):
                return {
                    "value": value,
                    "basis": "Forward revenue run-rate",
                    "concept": "SEC filing narrative: quarterly revenue guidance midpoint × 4",
                    "asOf": filing_date,
                    "unit": "USD",
                    "provider": f"SEC EDGAR {form} issuer guidance",
                    "url": url,
                    "transport": "sec.gov/Archives",
                    "details": f"Quarter guidance range ${low:.3f}B–${high:.3f}B; midpoint annualized ×4.",
                }
        match = guidance_single.search(text)
        if match:
            quarter = to_billions(match.group(1), match.group(2))
            value = quarter * 4.0
            if value > 0 and math.isfinite(value):
                return {
                    "value": value,
                    "basis": "Forward revenue run-rate",
                    "concept": "SEC filing narrative: quarterly revenue guidance × 4",
                    "asOf": filing_date,
                    "unit": "USD",
                    "provider": f"SEC EDGAR {form} issuer guidance",
                    "url": url,
                    "transport": "sec.gov/Archives",
                    "details": f"Quarter revenue guidance ${quarter:.3f}B; annualized ×4.",
                }

    raise rf.FetchError(f"no numeric contracted demand or SEC-filed revenue guidance found for {ticker}")


def complete_filing_metrics(ticker: str, meta: dict, facts_by_cik: dict):
    info = meta[ticker]
    cik = info["cik"]
    rows = rf.flatten_facts(facts_by_cik[cik])
    capex = rf.pick_capex(rows)
    try:
        demand = rf.pick_demand(rows, capex["unit"])
        demand.update(
            provider="SEC EDGAR CompanyFacts",
            url=rf.SEC_FACTS.format(cik=cik),
            transport="data.sec.gov",
            details=None,
        )
    except Exception:
        demand = filing_demand(ticker, cik)
        if capex["unit"] != demand["unit"]:
            raise rf.FetchError(f"demand/capex currency mismatch: {demand['unit']} vs {capex['unit']}")
    coverage = demand["value"] / capex["current"]
    return info, cik, rows, capex, demand, coverage


def eps_semantic_rank(row: dict) -> int:
    tag = str(row.get("tag") or "")
    if tag in rf.EPS_TAGS:
        return 1000 - rf.EPS_TAGS.index(tag)
    text = (tag + " " + str(row.get("label") or "") + " " + str(row.get("description") or "")).lower()
    if "earnings per share" in text and "diluted" in text:
        return 700
    if "earnings" in text and "share" in text and "diluted" in text:
        return 650
    return 0


def eps_unit(unit: str) -> bool:
    low = str(unit or "").lower()
    return "share" in low and ("/" in low or "per" in low)


def discrete_quarters_for_tag(rows: list[dict], tag: str, unit: str):
    tag_rows = [r for r in rows if r.get("tag") == tag and str(r.get("unit")) == unit]
    direct: dict[str, tuple[tuple, dict, float]] = {}

    # Direct quarter-duration facts from 10-Qs. Comparing periods repeated in later
    # filings are deduplicated by end date; latest filing vintage wins.
    for row in tag_rows:
        if row.get("form") not in {"10-Q", "10-Q/A", "6-K", "6-K/A"}:
            continue
        value = rf.number(row.get("val"))
        start, end = rf.parse_date(row.get("start")), rf.parse_date(row.get("end"))
        if value is None or not start or not end:
            continue
        days = (end - start).days
        if not 55 <= days <= 125:
            continue
        end_key = end.isoformat()
        quality = (
            1 if str(row.get("fp") or "") in {"Q1", "Q2", "Q3", "Q4"} else 0,
            -abs(days - 91),
            str(row.get("filed") or ""),
        )
        old = direct.get(end_key)
        if not old or quality > old[0]:
            direct[end_key] = (quality, row, value)

    quarters: dict[str, dict] = {
        end: {"end": end, "value": value, "row": row, "derived": False}
        for end, (_, row, value) in direct.items()
    }

    # Annual EPS normally includes Q4 rather than reporting Q4 separately. Derive
    # Q4 = FY EPS - Q1 - Q2 - Q3 for each fiscal year. This uses only issuer-filed
    # SEC XBRL values and is fully reproducible; small EPS rounding differences are
    # expected and preserved in the calculation metadata.
    annual = rf.annual_series(tag_rows)
    for fy, (annual_row, annual_value) in annual.items():
        annual_start = rf.parse_date(annual_row.get("start"))
        annual_end = rf.parse_date(annual_row.get("end"))
        if not annual_start or not annual_end:
            continue
        within = []
        for item in quarters.values():
            if item["derived"]:
                continue
            row = item["row"]
            q_start = rf.parse_date(row.get("start"))
            q_end = rf.parse_date(row.get("end"))
            if q_start and q_end and annual_start <= q_start and q_end < annual_end:
                within.append(item)
        within.sort(key=lambda x: x["end"])
        # A fiscal year should contribute the first three standalone quarters.
        if len(within) < 3:
            continue
        q123 = within[-3:]
        # Reject obviously mixed fiscal periods: Q1→Q3 should span roughly 6 months.
        first_end = rf.parse_date(q123[0]["end"])
        third_end = rf.parse_date(q123[-1]["end"])
        if not first_end or not third_end or not 150 <= (third_end - first_end).days <= 220:
            continue
        q4 = annual_value - sum(q["value"] for q in q123)
        if not math.isfinite(q4):
            continue
        end_key = annual_end.isoformat()
        if end_key not in quarters:
            quarters[end_key] = {
                "end": end_key,
                "value": q4,
                "row": annual_row,
                "derived": True,
                "formula": f"FY{fy} EPS - Q1 - Q2 - Q3",
            }

    return sorted(quarters.values(), key=lambda x: x["end"])


def computed_ttm_peg(rows: list[dict], price: float, cik: str):
    best = None
    candidate_tags = sorted({str(r.get("tag") or "") for r in rows if eps_unit(r.get("unit")) and eps_semantic_rank(r) > 0})
    for tag in candidate_tags:
        rank = max(eps_semantic_rank(r) for r in rows if r.get("tag") == tag)
        units = sorted({str(r.get("unit")) for r in rows if r.get("tag") == tag and eps_unit(r.get("unit"))})
        for unit in units:
            quarters = discrete_quarters_for_tag(rows, tag, unit)
            if len(quarters) < 8:
                continue
            last8 = quarters[-8:]
            # Ensure the eight observations really represent consecutive quarters.
            dates = [rf.parse_date(q["end"]) for q in last8]
            if any(d is None for d in dates):
                continue
            gaps = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
            if any(gap < 55 or gap > 125 for gap in gaps):
                continue
            prior_ttm = sum(q["value"] for q in last8[:4])
            current_ttm = sum(q["value"] for q in last8[4:])
            if abs(current_ttm) < 1e-12 or abs(prior_ttm) < 1e-12:
                continue
            growth = (current_ttm / prior_ttm - 1.0) * 100.0
            if abs(growth) < 1e-9:
                continue
            pe = price / current_ttm
            peg = pe / growth
            if not (math.isfinite(pe) and math.isfinite(peg)):
                continue
            key = (last8[-1]["end"], rank, len(quarters))
            details = {
                "concept": f"{last8[-1]['row']['namespace']}:{tag}",
                "unit": unit,
                "currentTTMEPS": current_ttm,
                "priorTTMEPS": prior_ttm,
                "growthPct": growth,
                "quarters": [
                    {"end": q["end"], "eps": q["value"], "derivedQ4": bool(q.get("derived"))}
                    for q in last8
                ],
                "formula": "PEG = (market price / current TTM diluted EPS) / TTM EPS growth percent",
            }
            candidate = (key, peg, pe, details)
            if not best or candidate[0] > best[0]:
                best = candidate
    if not best:
        raise rf.FetchError("no computable SEC TTM EPS PEG")
    return {
        "value": best[1],
        "pe": best[2],
        "basis": "Computed SEC TTM PEG = P/E ÷ TTM EPS growth %",
        "url": rf.SEC_FACTS.format(cik=cik),
        "details": best[3],
    }


def complete_peg(ticker: str, cik: str, price: float, rows: list[dict]):
    try:
        return _ORIGINAL_PEG(ticker, cik, price, rows)
    except Exception:
        return computed_ttm_peg(rows, price, cik)


def complete_finish_stock(ticker: str, metrics):
    info, cik, rows, capex, demand, coverage = metrics
    price, price_provider, price_url = rf.market_price(ticker)
    peg = complete_peg(ticker, cik, price, rows)
    values = [capex["current"], capex["prior2"], capex["growth"], demand["value"], coverage, price, peg["value"]]
    if not all(math.isfinite(v) for v in values):
        raise rf.FetchError("non-finite metric")
    sec_url = rf.SEC_FACTS.format(cik=cik)
    return {
        "ticker": ticker,
        "name": info["name"],
        "sector": rf.SECTORS.get(ticker, "Public Company"),
        "cik": cik,
        "currency": capex["unit"],
        "capexCurrentBn": round(capex["current"], 4),
        "capex2YBn": round(capex["prior2"], 4),
        "growthPct": round(capex["growth"], 2),
        "demandBn": round(demand["value"], 4),
        "demandBasis": demand["basis"],
        "coverage": round(coverage, 3),
        "peg": round(peg["value"], 4),
        "pegMeaningful": bool(peg["value"] > 0),
        "pe": round(peg["pe"], 3) if isinstance(peg.get("pe"), (int, float)) and math.isfinite(peg["pe"]) else None,
        "price": round(price, 4),
        "score": rf.score(capex["growth"], coverage, peg["value"]),
        "sources": {
            "capex": {
                "provider": "SEC EDGAR CompanyFacts", "url": sec_url, "transport": "data.sec.gov",
                "concept": capex["concept"], "currentFY": capex["fy"], "prior2FY": capex["fy2"], "unit": capex["unit"],
            },
            "demand": {
                "provider": demand.get("provider", "SEC EDGAR CompanyFacts"),
                "url": demand.get("url", sec_url),
                "transport": demand.get("transport", "data.sec.gov"),
                "basis": demand["basis"], "concept": demand["concept"], "asOf": demand["asOf"], "unit": demand["unit"],
                "details": demand.get("details"),
            },
            "price": {"provider": price_provider, "url": price_url},
            "peg": {"provider": peg["basis"], "url": peg["url"], "details": peg.get("details")},
        },
    }


rf.filing_metrics = complete_filing_metrics
rf.finish_stock = complete_finish_stock
rf.peg_value = complete_peg

if __name__ == "__main__":
    rf.main()
