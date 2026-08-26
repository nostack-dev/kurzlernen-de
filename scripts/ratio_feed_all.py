#!/usr/bin/env python3
"""Final no-gap resolver for RatioFinder.

Extends the SEC-first collector with a real public market-data fallback for PEG:
- StockAnalysis current PEG when the provider publishes one.
- If conventional PEG is absent (typically negative earnings), compute a signed
  forward PEG from published analyst EPS forecasts and the already fetched live
  market price. Such values remain numeric but are flagged pegMeaningful=false.

No synthetic values, constants, ticker-specific financial numbers, or exclusions.
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ratio_feed as rf  # noqa: E402
import ratio_feed_complete as complete  # noqa: E402

_BASE_COMPLETE_PEG = complete.complete_peg
SA_BASE = "https://stockanalysis.com/stocks/{ticker}"


def fetch_sa_text(url: str) -> str:
    raw = rf.get_bytes(url, retries=3, timeout=30).decode("utf-8", errors="ignore")
    text = complete.plain_text(raw)
    if len(text) < 300:
        raise rf.FetchError("StockAnalysis response too short")
    return text


def stockanalysis_current_peg(ticker: str):
    url = SA_BASE.format(ticker=ticker.lower()) + "/financials/ratios/"
    text = fetch_sa_text(url)
    # The current column is the first PEG value after the PEG Ratio label.
    patterns = [
        r"PEG Ratio\s+(-?[0-9]+(?:\.[0-9]+)?)",
        r"PEG Ratio.{0,120}?(-?[0-9]+(?:\.[0-9]+)?)",
    ]
    for pattern in patterns:
        m = re.search(pattern, text, re.I | re.S)
        if not m:
            continue
        value = float(m.group(1))
        if math.isfinite(value):
            return {
                "value": value,
                "pe": None,
                "basis": "StockAnalysis current PEG (S&P Global Market Intelligence)",
                "url": url,
                "details": {
                    "provider": "StockAnalysis / S&P Global Market Intelligence",
                    "formula": "Provider-published current PEG ratio",
                },
            }
    raise rf.FetchError("StockAnalysis does not publish a current PEG")


def _extract_eps_forecast(text: str, label: str):
    # Supports rendered text such as: EPS This Year -0.48 from -2.17
    # and tolerates currency signs/thousands separators.
    label_re = re.escape(label)
    m = re.search(label_re + r"\s*\$?([+-]?[0-9][0-9,]*(?:\.[0-9]+)?)", text, re.I)
    if not m:
        return None
    return float(m.group(1).replace(",", ""))


def stockanalysis_forward_peg(ticker: str, price: float):
    url = SA_BASE.format(ticker=ticker.lower()) + "/forecast/"
    text = fetch_sa_text(url)
    eps_this = _extract_eps_forecast(text, "EPS This Year")
    eps_next = _extract_eps_forecast(text, "EPS Next Year")
    if eps_this is None or eps_next is None:
        raise rf.FetchError("StockAnalysis analyst EPS forecast not found")
    if abs(eps_this) < 1e-12 or abs(eps_next) < 1e-12:
        raise rf.FetchError("analyst EPS forecast contains zero")
    growth = (eps_next / eps_this - 1.0) * 100.0
    if abs(growth) < 1e-12:
        raise rf.FetchError("analyst EPS growth is zero")
    forward_pe = price / eps_next
    peg = forward_pe / growth
    if not (math.isfinite(forward_pe) and math.isfinite(peg)):
        raise rf.FetchError("non-finite forward PEG")
    return {
        "value": peg,
        "pe": forward_pe,
        "basis": "Computed signed forward PEG from analyst EPS forecast",
        "url": url,
        "details": {
            "provider": "StockAnalysis analyst consensus",
            "epsThisYear": eps_this,
            "epsNextYear": eps_next,
            "growthPct": growth,
            "formula": "PEG = (live price / next-year EPS) / ((next-year EPS / this-year EPS - 1) × 100)",
            "economicMeaning": "Conventional PEG is not meaningful when P/E or forecast earnings are non-positive; signed value is retained for completeness and marked accordingly.",
        },
    }


def all_sources_peg(ticker: str, cik: str, price: float, rows: list[dict]):
    errors = []
    for resolver in (
        lambda: _BASE_COMPLETE_PEG(ticker, cik, price, rows),
        lambda: stockanalysis_current_peg(ticker),
        lambda: stockanalysis_forward_peg(ticker, price),
    ):
        try:
            result = resolver()
            if not isinstance(result.get("value"), (int, float)) or not math.isfinite(result["value"]):
                raise rf.FetchError("PEG resolver returned non-finite value")
            return result
        except Exception as exc:
            errors.append(str(exc))
    raise rf.FetchError("PEG all-source cascade failed: " + " | ".join(errors))


def final_finish_stock(ticker: str, metrics):
    info, cik, rows, capex, demand, coverage = metrics
    price, price_provider, price_url = rf.market_price(ticker)
    peg = all_sources_peg(ticker, cik, price, rows)
    values = [capex["current"], capex["prior2"], capex["growth"], demand["value"], coverage, price, peg["value"]]
    if not all(math.isfinite(v) for v in values):
        raise rf.FetchError("non-finite metric")
    pe = peg.get("pe")
    meaningful = bool(peg["value"] > 0 and isinstance(pe, (int, float)) and math.isfinite(pe) and pe > 0)
    # Provider-published PEGs may not expose P/E in this response; a positive
    # published PEG is still a conventional PEG and therefore meaningful.
    if peg["basis"].startswith("StockAnalysis current PEG") and peg["value"] > 0:
        meaningful = True
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
        "pegMeaningful": meaningful,
        "pe": round(pe, 3) if isinstance(pe, (int, float)) and math.isfinite(pe) else None,
        "price": round(price, 4),
        "score": rf.score(capex["growth"], coverage, peg["value"]) if meaningful else 0,
        "sources": {
            "capex": {
                "provider": "SEC EDGAR CompanyFacts",
                "url": sec_url,
                "transport": "data.sec.gov",
                "concept": capex["concept"],
                "currentFY": capex["fy"],
                "prior2FY": capex["fy2"],
                "unit": capex["unit"],
            },
            "demand": {
                "provider": demand.get("provider", "SEC EDGAR CompanyFacts"),
                "url": demand.get("url", sec_url),
                "transport": demand.get("transport", "data.sec.gov"),
                "basis": demand["basis"],
                "concept": demand["concept"],
                "asOf": demand["asOf"],
                "unit": demand["unit"],
                "details": demand.get("details"),
            },
            "price": {"provider": price_provider, "url": price_url},
            "peg": {"provider": peg["basis"], "url": peg["url"], "details": peg.get("details")},
        },
    }


complete.complete_peg = all_sources_peg
rf.peg_value = all_sources_peg
rf.filing_metrics = complete.complete_filing_metrics
rf.finish_stock = final_finish_stock

if __name__ == "__main__":
    rf.main()
