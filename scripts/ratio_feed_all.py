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

import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ratio_feed as rf  # noqa: E402
import ratio_feed_complete as complete  # noqa: E402

_BASE_COMPLETE_PEG = complete.complete_peg
_ORIGINAL_MAIN = rf.main
SA_BASE = "https://stockanalysis.com/stocks/{ticker}"


def strict_income_semantic_rank(row: dict) -> int:
    """SEC PEG derivation accepts only explicit net-income concepts, never fuzzy label matches."""
    tag = str(row.get("tag") or "")
    if tag in complete.NET_INCOME_TAGS:
        return 1000 - complete.NET_INCOME_TAGS.index(tag)
    return 0


# complete_peg() resolves income_semantic_rank through its module globals at call time.
complete.income_semantic_rank = strict_income_semantic_rank


def fetch_sa_text(url: str) -> str:
    raw = rf.get_bytes(url, retries=3, timeout=30).decode("utf-8", errors="ignore")
    text = complete.plain_text(raw)
    if len(text) < 300:
        raise rf.FetchError("StockAnalysis response too short")
    return text


def stockanalysis_current_peg(ticker: str):
    url = SA_BASE.format(ticker=ticker.lower()) + "/financials/ratios/"
    text = fetch_sa_text(url)
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


def peg_is_meaningful(peg: dict) -> bool:
    value = peg.get("value")
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        return False
    basis = str(peg.get("basis") or "")
    if basis in {"Yahoo trailing PEG", "StockAnalysis current PEG (S&P Global Market Intelligence)"}:
        return True
    pe = peg.get("pe")
    if not isinstance(pe, (int, float)) or not math.isfinite(pe) or pe <= 0:
        return False
    details = peg.get("details") if isinstance(peg.get("details"), dict) else {}
    growth = details.get("growthPct")
    if isinstance(growth, (int, float)) and math.isfinite(growth) and growth <= 0:
        return False
    if basis == "Computed signed forward PEG from analyst EPS forecast":
        eps_this = details.get("epsThisYear")
        eps_next = details.get("epsNextYear")
        return bool(
            isinstance(eps_this, (int, float)) and math.isfinite(eps_this) and eps_this > 0
            and isinstance(eps_next, (int, float)) and math.isfinite(eps_next) and eps_next > 0
        )
    return True


def final_finish_stock(ticker: str, metrics):
    info, cik, rows, capex, demand, coverage = metrics
    price, price_provider, price_url = rf.market_price(ticker)
    peg = all_sources_peg(ticker, cik, price, rows)
    values = [capex["current"], capex["prior2"], capex["growth"], demand["value"], coverage, price, peg["value"]]
    if not all(math.isfinite(v) for v in values):
        raise rf.FetchError("non-finite metric")
    pe = peg.get("pe")
    meaningful = peg_is_meaningful(peg)
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
        "score": rf.score(capex["growth"], coverage, peg["value"]) if meaningful else int(round(max(0, min(70,
            (35 if capex["growth"] >= 300 else 25 + (capex["growth"] - 150) / 15 if capex["growth"] >= 150 else max(0, capex["growth"] / 150) * 20)
            + (35 if coverage >= 3 else 25 + (coverage - 2) * 10 if coverage >= 2 else max(0, coverage / 2) * 20)
        )))),
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


def all_main():
    _ORIGINAL_MAIN()
    output = "ratio-data.json"
    for i, arg in enumerate(sys.argv[:-1]):
        if arg == "--output":
            output = sys.argv[i + 1]
            break
    path = Path(output)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["methodology"]["demand"] = (
        "Latest real issuer demand signal: SEC XBRL RPO/backlog/contract liabilities/deferred revenue; "
        "when not numerically disclosed in CompanyFacts, a numeric SEC-filed backlog/RPO or issuer revenue guidance is used and labeled."
    )
    payload["methodology"]["peg"] = (
        "Yahoo trailing PEG when available; otherwise a transparent SEC-derived PEG; otherwise a named StockAnalysis/S&P Global current PEG. "
        "If conventional PEG is unavailable for a loss-making issuer, a signed analyst-forecast PEG is retained only for completeness and marked pegMeaningful=false."
    )
    payload["methodology"]["completeness"] = (
        "Production publication is all-or-nothing: all 45 tracked companies must have finite source-backed inputs, excludedCount must be zero, "
        "and no synthetic/random/N/A fallback values are permitted."
    )
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


complete.complete_peg = all_sources_peg
rf.peg_value = all_sources_peg
rf.filing_metrics = complete.complete_filing_metrics
rf.finish_stock = final_finish_stock

if __name__ == "__main__":
    all_main()
