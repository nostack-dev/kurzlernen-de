#!/usr/bin/env python3
import argparse, csv, datetime as dt, io, json, math, time, urllib.parse, urllib.request
from pathlib import Path

DOLT_API = "https://www.dolthub.com/api/v1alpha1/deeleeramone/sec-company-facts/main"
DOLT_REPO = "https://www.dolthub.com/repositories/deeleeramone/sec-company-facts"
SEC_FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart"
YAHOO_FUND = "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries"
STOOQ = "https://stooq.com/q/l/"
UA = "kurzlernen.de-ratio-data/3.1"

UNIVERSES = {
    "ai-hardware": ["NVDA","ORCL","MU","AMZN","MSFT","AVGO","TSM","SMCI","ANET","VRT","CEG","MOD","DELL","GOOGL","AMD","ASML","INTC","NBIS","PLTR","CSCO"],
    "semiconductors": ["TSM","NVDA","AVGO","ASML","AMD","MU","AMAT","LRCX","KLAC","QCOM","ARM","ADI","TXN","MRVL","NXPI"],
    "datacenter-infra": ["VRT","CEG","MOD","ANET","EQIX","DLR","SMR","VST","ETN","GE","PWR","JCI"],
    "sp500-tech": ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","AVGO","ORCL","CSCO","ACN","IBM","AMD","QCOM","INTC","NOW","AMAT","TXN","LRCX","MU","GE","CAT","DE","DELL","HPE","PLTR"],
}
TRACKED = sorted({t for xs in UNIVERSES.values() for t in xs})
ANNUAL = {"10-K","10-K/A","20-F","20-F/A","40-F","40-F/A"}
PERIODIC = ANNUAL | {"10-Q","10-Q/A","6-K","6-K/A"}
CAPEX_TAGS = [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets",
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    "PurchaseOfPropertyPlantAndEquipment",
]
EPS_TAGS = [
    "EarningsPerShareDiluted",
    "DilutedEarningsLossPerShare",
    "DilutedEarningsLossPerShareFromContinuingOperations",
]
DEMAND_EXCLUDES = ("percentage","expectedtiming","recognized","recognize","increase","decrease","changein","shareof","portion","maturity")
SECTORS = {
    "NVDA":"AI Compute & Networking","ORCL":"Cloud Infrastructure","MU":"HBM Memory","AMZN":"Cloud & Commerce","MSFT":"Cloud & Software","AVGO":"AI ASICs & Networking","TSM":"Advanced Foundry","SMCI":"AI Servers","ANET":"Data Center Networking","VRT":"Data Center Power & Cooling","CEG":"Power Generation","MOD":"Thermal Management","DELL":"Enterprise Infrastructure","GOOGL":"Cloud & AI","AMD":"AI Accelerators","ASML":"Lithography","INTC":"Foundry & Compute","NBIS":"AI Neocloud","PLTR":"Enterprise AI Software","CSCO":"Networking","AMAT":"Semiconductor Equipment","LRCX":"Semiconductor Equipment","KLAC":"Semiconductor Equipment","QCOM":"Semiconductors","ARM":"CPU IP","ADI":"Analog Semiconductors","TXN":"Analog Semiconductors","MRVL":"Data Infrastructure Semiconductors","NXPI":"Semiconductors","EQIX":"Data Centers","DLR":"Data Centers","SMR":"Nuclear Technology","VST":"Power Generation","ETN":"Power Management","GE":"Industrial Technology","PWR":"Grid Infrastructure","JCI":"Building Infrastructure","AAPL":"Consumer Technology","META":"Digital Platforms & AI","ACN":"IT Services","IBM":"Enterprise Technology","NOW":"Enterprise Software","CAT":"Industrial Equipment","DE":"Industrial Equipment","HPE":"Enterprise Infrastructure"
}

class FetchError(RuntimeError):
    pass

def sqlq(v):
    return "'" + str(v).replace("'", "''") + "'"

def chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i+n]

def get_bytes(url, retries=4):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/plain,*/*"})
            with urllib.request.urlopen(req, timeout=55) as r:
                return r.read()
        except Exception as exc:
            last = exc
            time.sleep(min(8, 0.8 * (2 ** i)))
    raise FetchError(f"GET failed {url}: {last}")

def jget(url):
    return json.loads(get_bytes(url).decode())

def dolt(sql, retries=4):
    url = DOLT_API + "?" + urllib.parse.urlencode({"q": sql})
    last = None
    for i in range(retries):
        try:
            payload = jget(url)
            status = payload.get("query_execution_status")
            if status == "Success":
                return payload.get("rows") or []
            if status == "RowLimit":
                raise FetchError("DoltHub row limit reached; refusing truncated financial data")
            raise FetchError(f"DoltHub query failed: {payload.get('query_execution_message')}")
        except Exception as exc:
            last = exc
            time.sleep(min(10, 1.0 * (2 ** i)))
    raise FetchError(str(last))

def ticker_map(tickers):
    out = {}
    for batch in chunks(tickers, 25):
        ins = ",".join(sqlq(t) for t in batch)
        rows = dolt(f"SELECT cik,ticker,name,is_primary,`rank` FROM tickers WHERE ticker IN ({ins}) ORDER BY ticker,is_primary DESC,`rank` ASC")
        for r in rows:
            t = str(r["ticker"]).upper()
            if t not in out:
                out[t] = {"cik": str(r["cik"]).zfill(10), "name": r.get("name") or t}
    return out

def fetch_financial_facts(ciks):
    result = {c: [] for c in ciks}
    tags = CAPEX_TAGS + EPS_TAGS
    tag_sql = ",".join(sqlq(t) for t in tags)
    forms = ",".join(sqlq(f) for f in ANNUAL)
    for batch in chunks(ciks, 8):
        cik_sql = ",".join(sqlq(c) for c in batch)
        sql = f"""SELECT f.cik AS cik,x.namespace AS namespace,x.tag AS tag,f.unit AS unit,
f.`start` AS start_date,f.`end` AS end_date,f.val AS val,f.val_text AS val_text,
f.fy AS fy,f.fp AS fp,f.form AS form,f.filed AS filed,f.frame AS frame
FROM facts_enc f JOIN xbrl_tags x ON x.tag_id=f.tag_id
WHERE f.cik IN ({cik_sql}) AND x.tag IN ({tag_sql}) AND f.form IN ({forms})
AND f.filed >= '2019-01-01'
ORDER BY f.cik,x.tag,f.`end`,f.filed"""
        for r in dolt(sql):
            result.setdefault(str(r["cik"]).zfill(10), []).append(r)
    return result

def fetch_demand_facts(ciks):
    result = {c: [] for c in ciks}
    forms = ",".join(sqlq(f) for f in PERIODIC)
    for batch in chunks(ciks, 8):
        cik_sql = ",".join(sqlq(c) for c in batch)
        sql = f"""SELECT f.cik AS cik,x.namespace AS namespace,x.tag AS tag,f.unit AS unit,
f.`start` AS start_date,f.`end` AS end_date,f.val AS val,f.val_text AS val_text,
f.fy AS fy,f.fp AS fp,f.form AS form,f.filed AS filed,f.frame AS frame
FROM facts_enc f JOIN xbrl_tags x ON x.tag_id=f.tag_id
WHERE f.cik IN ({cik_sql}) AND f.unit='USD' AND f.form IN ({forms})
AND f.filed >= '2022-01-01' AND (
LOWER(x.tag) LIKE '%remainingperformance%' OR LOWER(x.tag) LIKE '%unsatisfiedperformance%' OR
LOWER(x.tag) LIKE '%remainingtransactionprice%' OR LOWER(x.tag) LIKE '%backlog%' OR
LOWER(x.tag) LIKE '%orderbook%' OR LOWER(x.tag) LIKE '%unfulfilled%' OR
LOWER(x.tag) LIKE '%contractliabilit%' OR LOWER(x.tag) LIKE '%contractwithcustomerliability%' OR
LOWER(x.tag) LIKE '%deferredrevenue%')
ORDER BY f.cik,f.`end` DESC,f.filed DESC"""
        for r in dolt(sql):
            result.setdefault(str(r["cik"]).zfill(10), []).append(r)
    return result

def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None

def annual_series(rows):
    out = {}
    for r in rows:
        if r.get("form") not in ANNUAL or r.get("fp") != "FY":
            continue
        v = num(r.get("val"))
        if v is None:
            continue
        try:
            fy = int(r.get("fy"))
        except (TypeError, ValueError):
            continue
        key = (str(r.get("filed") or ""), str(r.get("end_date") or ""))
        old = out.get(fy)
        if not old or key > old[0]:
            out[fy] = (key, r, v)
    return {fy: (r, v) for fy, (_, r, v) in out.items()}

def pick_capex(rows):
    best = None
    for tag in CAPEX_TAGS:
        series = annual_series([r for r in rows if r.get("tag") == tag and r.get("unit") == "USD"])
        if len(series) < 3:
            continue
        fys = sorted(series)
        current = fys[-1]
        prior = current - 2 if current - 2 in series else fys[-3]
        cv = abs(series[current][1])
        pv = abs(series[prior][1])
        if cv <= 0 or pv <= 0:
            continue
        candidate = ((len(series), current, -CAPEX_TAGS.index(tag)), tag, series[current][0], cv, prior, pv)
        if not best or candidate[0] > best[0]:
            best = candidate
    if not best:
        raise FetchError("no 3-year annual CapEx series")
    _, tag, row, cv, prior, pv = best
    return {"current": cv / 1e9, "prior2": pv / 1e9, "growth": (cv / pv - 1) * 100, "fy": int(row["fy"]), "fy2": prior, "concept": f"{row['namespace']}:{tag}"}

def demand_priority(tag):
    t = tag.lower()
    if any(x in t for x in DEMAND_EXCLUDES): return -100
    if "remainingperformance" in t: return 110
    if "unsatisfiedperformance" in t: return 108
    if "remainingtransactionprice" in t: return 106
    if "orderbacklog" in t or ("backlog" in t and "order" in t): return 100
    if "backlog" in t: return 95
    if "orderbook" in t: return 92
    if "unfulfilled" in t: return 88
    if "contractwithcustomerliability" in t: return 74
    if "contractliabilit" in t: return 72
    if "deferredrevenue" in t: return 60
    return 0

def pick_demand(rows):
    candidates = []
    for r in rows:
        if r.get("form") not in PERIODIC:
            continue
        v = num(r.get("val"))
        if v is None or v < 0:
            continue
        tag = str(r.get("tag") or "")
        priority = demand_priority(tag)
        if priority <= 0:
            continue
        low = tag.lower()
        if "current" in low or "noncurrent" in low:
            priority -= 6
        end = str(r.get("end_date") or "")
        filed = str(r.get("filed") or "")
        candidates.append((end, filed, priority, v, r))
    if not candidates:
        raise FetchError("no real RPO/backlog/contract-liability/deferred-revenue fact")
    latest = max(x[0] for x in candidates)
    recent = [x for x in candidates if x[0] == latest]
    recent.sort(key=lambda x: (x[2], x[3], x[1]), reverse=True)
    end, filed, _, v, r = recent[0]
    tag = str(r["tag"]); low = tag.lower()
    if "remainingperformance" in low or "unsatisfiedperformance" in low or "remainingtransactionprice" in low:
        basis = "RPO"
    elif "backlog" in low or "orderbook" in low or "unfulfilled" in low:
        basis = "Backlog"
    elif "contractliabilit" in low:
        basis = "Contract liabilities"
    else:
        basis = "Deferred revenue"
    return {"value": v / 1e9, "basis": basis, "concept": f"{r['namespace']}:{tag}", "asOf": end or filed}

def yahoo_price(t):
    u = f"{YAHOO_CHART}/{urllib.parse.quote(t, safe='')}?range=5d&interval=1d&includePrePost=false"
    d = jget(u); x = d.get("chart", {}).get("result") or []
    if not x: raise FetchError("Yahoo no price")
    meta = x[0].get("meta", {}); p = meta.get("regularMarketPrice")
    if not isinstance(p, (int, float)) or p <= 0:
        closes = [z for z in x[0].get("indicators", {}).get("quote", [{}])[0].get("close", []) if isinstance(z, (int, float)) and z > 0]
        if not closes: raise FetchError("Yahoo no close")
        p = closes[-1]
    return float(p), "Yahoo Finance chart", u

def stooq_price(t):
    sym = t.lower().replace("-", ".") + ".us"
    u = f"{STOOQ}?s={urllib.parse.quote(sym)}&f=sd2t2ohlcv&h&e=csv"
    rows = list(csv.DictReader(io.StringIO(get_bytes(u).decode())))
    if not rows or rows[0].get("Close") in (None, "N/D", ""):
        raise FetchError("Stooq no price")
    return float(rows[0]["Close"]), "Stooq", u

def price(t):
    try: return yahoo_price(t)
    except Exception: return stooq_price(t)

def yahoo_peg(t):
    now = int(time.time()); qt = urllib.parse.quote(t, safe="")
    u = f"{YAHOO_FUND}/{qt}?symbol={qt}&type=trailingPegRatio,forwardPe,trailingPe&period1={now-1209600}&period2={now}"
    d = jget(u); out = {}
    for r in d.get("timeseries", {}).get("result", []):
        typ = (r.get("meta", {}).get("type") or [None])[0]
        vals = r.get(typ, []) if typ else []
        if vals:
            raw = vals[-1].get("reportedValue", {}).get("raw")
            if isinstance(raw, (int, float)): out[typ] = float(raw)
    p = out.get("trailingPegRatio")
    if not isinstance(p, (int, float)) or not math.isfinite(p):
        raise FetchError("Yahoo no PEG")
    return p, out.get("forwardPe") or out.get("trailingPe"), u

def computed_peg(rows, p):
    best = None
    for tag in EPS_TAGS:
        series = annual_series([r for r in rows if r.get("tag") == tag])
        if len(series) < 2: continue
        fys = sorted(series); a, z = fys[-1], fys[-2]
        e1, e0 = series[a][1], series[z][1]
        if abs(e0) < 1e-12 or abs(e1) < 1e-12: continue
        growth = (e1 / e0 - 1) * 100
        if abs(growth) < 1e-12: continue
        pe = p / e1; value = pe / growth
        candidate = ((a, -EPS_TAGS.index(tag)), value, pe, {"concept": f"{series[a][0]['namespace']}:{tag}", "fyCurrent": a, "fyPrevious": z, "epsCurrent": e1, "epsPrevious": e0, "growthPct": growth})
        if not best or candidate[0] > best[0]: best = candidate
    if not best: raise FetchError("no computable diluted-EPS PEG")
    return best[1], best[2], best[3]

def peg(t, cik, p, financial_rows):
    try:
        v, pe, u = yahoo_peg(t)
        return {"value": v, "pe": pe, "basis": "Yahoo trailing PEG", "url": u, "details": None}
    except Exception:
        v, pe, details = computed_peg(financial_rows, p)
        return {"value": v, "pe": pe, "basis": "Computed FY PEG = P/E ÷ diluted-EPS growth %", "url": SEC_FACTS.format(cik=cik), "details": details}

def score(g, c, p):
    s = 35 if g >= 300 else 25 + (g - 150) / 15 if g >= 150 else max(0, g / 150) * 20
    s += 35 if c >= 3 else 25 + (c - 2) * 10 if c >= 2 else max(0, c / 2) * 20
    s += 30 if 0 < p <= .5 else 20 + (1 - p) / .05 if .5 < p <= 1 else max(0, (1.5 - p) * 20) if 1 < p <= 1.5 else 5 if p > 1.5 else 0
    return int(round(max(0, min(100, s))))

def one(t, meta, financial, demand):
    if t not in meta: raise FetchError("ticker absent from SEC replica")
    info = meta[t]; cik = info["cik"]
    ca = pick_capex(financial.get(cik, []))
    de = pick_demand(demand.get(cik, []))
    pr, pr_provider, pr_url = price(t)
    pg = peg(t, cik, pr, financial.get(cik, []))
    cov = de["value"] / ca["current"]
    sc = score(ca["growth"], cov, pg["value"])
    vals = [ca["current"], ca["prior2"], ca["growth"], de["value"], cov, pr, pg["value"]]
    if not all(math.isfinite(v) for v in vals): raise FetchError("non-finite metric")
    sec = SEC_FACTS.format(cik=cik)
    return {
        "ticker": t, "name": info["name"], "sector": SECTORS.get(t, "Public Company"), "cik": cik,
        "capexCurrentBn": round(ca["current"], 4), "capex2YBn": round(ca["prior2"], 4), "growthPct": round(ca["growth"], 2),
        "demandBn": round(de["value"], 4), "demandBasis": de["basis"], "coverage": round(cov, 3),
        "peg": round(pg["value"], 4), "pegMeaningful": bool(pg["value"] > 0),
        "pe": round(pg["pe"], 3) if isinstance(pg.get("pe"), (int, float)) and math.isfinite(pg["pe"]) else None,
        "price": round(pr, 4), "score": sc,
        "sources": {
            "capex": {"provider": "SEC EDGAR XBRL via DoltHub replica", "url": sec, "transport": DOLT_REPO, "concept": ca["concept"], "currentFY": ca["fy"], "prior2FY": ca["fy2"]},
            "demand": {"provider": "SEC EDGAR XBRL via DoltHub replica", "url": sec, "transport": DOLT_REPO, "basis": de["basis"], "concept": de["concept"], "asOf": de["asOf"]},
            "price": {"provider": pr_provider, "url": pr_url},
            "peg": {"provider": pg["basis"], "url": pg["url"], "details": pg.get("details")},
        },
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="ratio-data.json")
    ap.add_argument("--tickers", default="")
    ap.add_argument("--allow-partial", action="store_true")
    args = ap.parse_args()
    tickers = [z.strip().upper() for z in args.tickers.split(",") if z.strip()] or TRACKED

    print(f"Resolving {len(tickers)} tickers...", flush=True)
    meta = ticker_map(tickers)
    ciks = sorted({v["cik"] for v in meta.values()})
    print(f"Batch loading annual CapEx/EPS facts for {len(ciks)} CIKs...", flush=True)
    financial = fetch_financial_facts(ciks)
    print("Batch loading RPO/backlog/contract-liability facts...", flush=True)
    demand = fetch_demand_facts(ciks)

    rows, errors = [], []
    for i, ticker in enumerate(tickers, 1):
        print(f"[{i}/{len(tickers)}] {ticker}", flush=True)
        try:
            rows.append(one(ticker, meta, financial, demand))
        except Exception as exc:
            errors.append({"ticker": ticker, "error": str(exc)})
            print(f"ERROR {ticker}: {exc}", flush=True)

    payload = {
        "schemaVersion": 3,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "transport": {"secFacts": "DoltHub replica of SEC CompanyFacts", "url": DOLT_REPO},
        "methodology": {
            "capex": "Latest annual SEC XBRL CapEx versus the annual value two fiscal years earlier.",
            "demand": "Latest real SEC XBRL demand fact, prioritized RPO → backlog/order book → contract liabilities → deferred revenue. Exact concept is shown per company.",
            "coverage": "Selected SEC demand fact divided by latest annual SEC CapEx.",
            "peg": "Yahoo trailing PEG when available; otherwise a disclosed PEG computed from current market price and annual diluted EPS from SEC XBRL.",
            "strictness": "No synthetic/random values. Publication aborts if any tracked ticker cannot be fully resolved.",
        },
        "universes": UNIVERSES,
        "stocks": sorted(rows, key=lambda r: r["score"], reverse=True),
        "errors": errors,
    }
    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if errors and not args.allow_partial:
        raise SystemExit("strict update failed: " + "; ".join(f"{e['ticker']}: {e['error']}" for e in errors))
    print("wrote", args.output, len(rows), "stocks", flush=True)

if __name__ == "__main__":
    main()
