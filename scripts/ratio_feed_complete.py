#!/usr/bin/env python3
"""Strict 45/45 RatioFinder collector.

Extends ratio_feed with two source-driven fallbacks:
1) If CompanyFacts has no numeric RPO/backlog/contract-liability disclosure, inspect
   the issuer's recent SEC filings. Prefer a numeric backlog/RPO. If the issuer does
   not disclose one, use its SEC-filed next-quarter revenue guidance, annualized as
   a clearly labeled forward revenue run-rate.
2) If Yahoo and SEC annual EPS cannot produce PEG, use FinanceCharts' explicitly
   disclosed TTM PEG calculation. The source URL remains attached to the row.

No values are hardcoded by ticker.
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
FINANCECHARTS = "https://www.financecharts.com/stocks/{ticker}/value/peg-ratio"

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
        # Earnings 8-Ks first, then other 8-Ks, then periodic filings.
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
    # Patterns are semantic, not ticker-specific. We first look for contracted demand
    # (RPO/backlog). Only if none is disclosed do we use issuer revenue guidance.
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

    # Some point-of-sale businesses explicitly omit RPO because contracts are short.
    # Their own next-quarter revenue guidance is still a real forward-demand signal.
    # Convert a quarter midpoint into an annualized run-rate so the denominator remains
    # comparable to annual CapEx; preserve the raw guidance in details.
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
        # The three currently-needed filing fallbacks are USD issuers. Refuse FX mixing.
        if capex["unit"] != demand["unit"]:
            raise rf.FetchError(f"demand/capex currency mismatch: {demand['unit']} vs {capex['unit']}")
    coverage = demand["value"] / capex["current"]
    return info, cik, rows, capex, demand, coverage


def financecharts_peg(ticker: str):
    url = FINANCECHARTS.format(ticker=ticker)
    raw = rf.get_bytes(url, retries=3, timeout=25).decode("utf-8", errors="ignore")
    text = plain_text(raw)
    patterns = [
        re.compile(rf"{re.escape(ticker)}\s+PEG Ratio:\s*(-?[0-9]+(?:\.[0-9]+)?)", re.I),
        re.compile(r"current peg ratio.{0,120}?\s(-?[0-9]+(?:\.[0-9]+)?)", re.I),
        re.compile(r"peg ratio for .*? stock is\s*(-?[0-9]+(?:\.[0-9]+)?)", re.I),
        re.compile(r"PEG Ratio\s*\(?(-?[0-9]+(?:\.[0-9]+)?)\)?\s*=", re.I),
    ]
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            value = float(match.group(1))
            if math.isfinite(value):
                pe_match = re.search(r"P/E Ratio\s*\(?(-?[0-9]+(?:\.[0-9]+)?)\)?", text, re.I)
                pe = float(pe_match.group(1)) if pe_match else None
                return {
                    "value": value,
                    "pe": pe,
                    "basis": "FinanceCharts TTM PEG",
                    "url": url,
                    "details": "Provider formula: P/E divided by TTM EPS growth versus prior TTM.",
                }
    raise rf.FetchError("FinanceCharts PEG unavailable")


def complete_peg(ticker: str, cik: str, price: float, rows: list[dict]):
    try:
        return _ORIGINAL_PEG(ticker, cik, price, rows)
    except Exception:
        return financecharts_peg(ticker)


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
                "provider":"SEC EDGAR CompanyFacts", "url":sec_url, "transport":"data.sec.gov",
                "concept":capex["concept"], "currentFY":capex["fy"], "prior2FY":capex["fy2"], "unit":capex["unit"],
            },
            "demand": {
                "provider":demand.get("provider", "SEC EDGAR CompanyFacts"),
                "url":demand.get("url", sec_url),
                "transport":demand.get("transport", "data.sec.gov"),
                "basis":demand["basis"], "concept":demand["concept"], "asOf":demand["asOf"], "unit":demand["unit"],
                "details":demand.get("details"),
            },
            "price": {"provider":price_provider, "url":price_url},
            "peg": {"provider":peg["basis"], "url":peg["url"], "details":peg.get("details")},
        },
    }


rf.filing_metrics = complete_filing_metrics
rf.finish_stock = complete_finish_stock
rf.peg_value = complete_peg

if __name__ == "__main__":
    rf.main()
