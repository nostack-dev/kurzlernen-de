#!/usr/bin/env python3
import argparse, csv, datetime as dt, html, io, json, math, os, re, time, urllib.parse, urllib.request
from pathlib import Path

SEC_BASE="https://data.sec.gov"; SEC_TICKERS="https://www.sec.gov/files/company_tickers.json"; SEC_ARCHIVES="https://www.sec.gov/Archives/edgar/data"
YAHOO_CHART="https://query1.finance.yahoo.com/v8/finance/chart"
YAHOO_FUND="https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries"
STOOQ="https://stooq.com/q/l/"
UA=os.environ.get("SEC_USER_AGENT","kurzlernen.de-ratio-data/2.0 https://github.com/nostack-dev/kurzlernen-de")
UNIVERSES={
 "ai-hardware":["NVDA","ORCL","MU","AMZN","MSFT","AVGO","TSM","SMCI","ANET","VRT","CEG","MOD","DELL","GOOGL","AMD","ASML","INTC","NBIS","PLTR","CSCO"],
 "semiconductors":["TSM","NVDA","AVGO","ASML","AMD","MU","AMAT","LRCX","KLAC","QCOM","ARM","ADI","TXN","MRVL","NXPI"],
 "datacenter-infra":["VRT","CEG","MOD","ANET","EQIX","DLR","SMR","VST","ETN","GE","PWR","JCI"],
 "sp500-tech":["AAPL","MSFT","NVDA","AMZN","GOOGL","META","AVGO","ORCL","CSCO","ACN","IBM","AMD","QCOM","INTC","NOW","AMAT","TXN","LRCX","MU","GE","CAT","DE","DELL","HPE","PLTR"]}
TRACKED=sorted({t for xs in UNIVERSES.values() for t in xs})
ANNUAL={"10-K","10-K/A","20-F","20-F/A","40-F","40-F/A"}; PERIODIC=ANNUAL|{"10-Q","10-Q/A"}
CAPEX=[("us-gaap","PaymentsToAcquirePropertyPlantAndEquipment"),("us-gaap","PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets"),("ifrs-full","PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"),("ifrs-full","PurchaseOfPropertyPlantAndEquipment")]
EPS=[("us-gaap","EarningsPerShareDiluted"),("ifrs-full","DilutedEarningsLossPerShare"),("ifrs-full","DilutedEarningsLossPerShareFromContinuingOperations")]
CL=[("us-gaap","ContractWithCustomerLiability"),("us-gaap","ContractWithCustomerLiabilityCurrent"),("us-gaap","ContractWithCustomerLiabilityNoncurrent"),("ifrs-full","ContractLiabilities"),("ifrs-full","ContractLiabilitiesCurrent"),("ifrs-full","ContractLiabilitiesNoncurrent")]
SECTORS={"NVDA":"AI Compute & Networking","ORCL":"Cloud Infrastructure","MU":"HBM Memory","AMZN":"Cloud & Commerce","MSFT":"Cloud & Software","AVGO":"AI ASICs & Networking","TSM":"Advanced Foundry","SMCI":"AI Servers","ANET":"Data Center Networking","VRT":"Data Center Power & Cooling","CEG":"Power Generation","MOD":"Thermal Management","DELL":"Enterprise Infrastructure","GOOGL":"Cloud & AI","AMD":"AI Accelerators","ASML":"Lithography","INTC":"Foundry & Compute","NBIS":"AI Neocloud","PLTR":"Enterprise AI Software","CSCO":"Networking","AMAT":"Semiconductor Equipment","LRCX":"Semiconductor Equipment","KLAC":"Semiconductor Equipment","QCOM":"Semiconductors","ARM":"CPU IP","ADI":"Analog Semiconductors","TXN":"Analog Semiconductors","MRVL":"Data Infrastructure Semiconductors","NXPI":"Semiconductors","EQIX":"Data Centers","DLR":"Data Centers","SMR":"Nuclear Technology","VST":"Power Generation","ETN":"Power Management","GE":"Industrial Technology","PWR":"Grid Infrastructure","JCI":"Building Infrastructure","AAPL":"Consumer Technology","META":"Digital Platforms & AI","ACN":"IT Services","IBM":"Enterprise Technology","NOW":"Enterprise Software","CAT":"Industrial Equipment","DE":"Industrial Equipment","HPE":"Enterprise Infrastructure"}
class FetchError(RuntimeError): pass

def req(url,sec=False,retries=4):
 h={"User-Agent":UA if sec else "Mozilla/5.0 kurzlernen.de-ratio-data/2.0","Accept":"application/json,text/plain,text/html,*/*"}; last=None
 for i in range(retries):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers=h),timeout=30) as r: b=r.read(); headers=dict(r.headers)
   if sec: time.sleep(.13)
   return b,headers
  except Exception as e: last=e; time.sleep(min(8,.8*(2**i)))
 raise FetchError(f"GET failed {url}: {last}")
def jget(url,sec=False): return json.loads(req(url,sec)[0].decode())
def tget(url,sec=False): return req(url,sec)[0].decode("utf-8",errors="replace")
def ticker_map():
 d=jget(SEC_TICKERS,True); return {str(x["ticker"]).upper():{"cik":int(x["cik_str"]),"name":x["title"]} for x in d.values()}
def facts(cik): return jget(f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik:010d}.json",True)
def units(f,ns,c):
 n=f.get("facts",{}).get(ns,{}).get(c,{}).get("units",{})
 for u in ("USD","USD/shares","shares"):
  if u in n:return u,n[u]
 return next(iter(n.items())) if n else (None,[])
def annual_rows(rows):
 out={}
 for r in rows:
  if isinstance(r.get("fy"),int) and r.get("form") in ANNUAL and r.get("fp")=="FY" and isinstance(r.get("val"),(int,float)):
   fy=r["fy"]; old=out.get(fy)
   if not old or (r.get("filed","") ,r.get("end",""))>(old.get("filed","") ,old.get("end","")): out[fy]=r
 return out
def annual_best(f,concepts,n=2):
 best=None
 for ns,c in concepts:
  u,rows=units(f,ns,c); by=annual_rows(rows)
  if len(by)>=n:
   key=(len(by),max(by)); cand=(key,ns,c,u,by)
   if not best or key>best[0]: best=cand
 return best
def capex(f):
 b=annual_best(f,CAPEX,3)
 if not b: raise FetchError("no 3-year annual CapEx series")
 _,ns,c,u,by=b; fys=sorted(by); a=fys[-1]; z=a-2 if a-2 in by else fys[-3]; cur=abs(float(by[a]["val"])); old=abs(float(by[z]["val"]))
 if cur<=0 or old<=0: raise FetchError("invalid CapEx")
 scale=1e9 if u=="USD" else 1
 return {"current":cur/scale,"prior2":old/scale,"growth":(cur/old-1)*100,"fy":a,"fy2":z,"concept":f"{ns}:{c}"}
def latest_fact(f,pred):
 best=None
 for ns,cs in f.get("facts",{}).items():
  for c,node in cs.items():
   if not pred(ns,c,node): continue
   for u,rows in node.get("units",{}).items():
    if u!="USD":continue
    for r in rows:
     if r.get("form") in PERIODIC and isinstance(r.get("val"),(int,float)) and r["val"]>=0:
      k=(r.get("end","") ,r.get("filed","") ,float(r["val"]));
      if not best or k>best[0]: best=(k,ns,c,r)
 return best
def std_rpo(f,cik):
 hit=latest_fact(f,lambda ns,c,n:"remainingperformanceobligation" in c.lower() and "expectedtiming" not in c.lower() and "percentage" not in c.lower())
 if not hit:return None
 _,ns,c,r=hit; return {"value":float(r["val"])/1e9,"basis":"RPO","concept":f"{ns}:{c}","asOf":r.get("end"),"url":f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik:010d}.json"}
def contract_liability(f,cik):
 vals=[]
 for ns,c in CL:
  u,rows=units(f,ns,c)
  if u!="USD":continue
  x=[r for r in rows if r.get("form") in PERIODIC and isinstance(r.get("val"),(int,float)) and r["val"]>=0]
  if x: x.sort(key=lambda r:(r.get("end","") ,r.get("filed",""))); vals.append((ns,c,x[-1]))
 if not vals:return None
 agg=[v for v in vals if v[1] in {"ContractWithCustomerLiability","ContractLiabilities"}]
 if agg:
  ns,c,r=max(agg,key=lambda v:(v[2].get("end","") ,v[2].get("filed",""))); val=float(r["val"])/1e9; end=r.get("end"); concept=f"{ns}:{c}"
 else:
  end=max(v[2].get("end","") for v in vals); parts=[v for v in vals if v[2].get("end","")==end]; val=sum(float(v[2]["val"]) for v in parts)/1e9; concept="+".join(f"{a}:{b}" for a,b,_ in parts)
 return {"value":val,"basis":"Contract liabilities","concept":concept,"asOf":end,"url":f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik:010d}.json"}
def filings(cik):
 r=jget(f"{SEC_BASE}/submissions/CIK{cik:010d}.json",True).get("filings",{}).get("recent",{}); out=[]
 for form,acc,doc,date in zip(r.get("form",[]),r.get("accessionNumber",[]),r.get("primaryDocument",[]),r.get("filingDate",[])):
  if form in PERIODIC and acc and doc:
   out.append({"form":form,"acc":acc,"doc":doc,"filed":date})
   if len(out)>=8:break
 return out
def filing_url(cik,x): return f"{SEC_ARCHIVES}/{cik}/{x['acc'].replace('-','')}/{x['doc']}"
def textify(s):
 s=re.sub(r"(?is)<script.*?</script>|<style.*?</style>"," ",s); s=re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</li>",". ",s); s=re.sub(r"(?s)<[^>]+>"," ",s); return re.sub(r"\s+"," ",html.unescape(s).replace("\xa0"," "))
MONEY=r"\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(billion|million|thousand|bn|mm|m)\b"
PATS=[("RPO",re.compile(r"(?is)remaining performance obligations.{0,220}?"+MONEY)),("RPO",re.compile(r"(?is)\bRPO\b.{0,160}?"+MONEY)),("Backlog",re.compile(r"(?is)\bbacklog\b.{0,180}?"+MONEY))]
def bn(v,u): return float(v) if u.lower() in {"billion","bn"} else float(v)/1000 if u.lower() in {"million","mm","m"} else float(v)/1_000_000
def filing_demand(cik):
 for x in filings(cik):
  url=filing_url(cik,x)
  try:s=textify(tget(url,True))
  except Exception:continue
  cand=[]
  for basis,p in PATS:
   for m in p.finditer(s):
    val=bn(m.group(1),m.group(2)); ctx=s[max(0,m.start()-100):min(len(s),m.end()+160)]; penalty=2 if re.search(r"(?i)(recognized|recognize|next\s+12\s+months|within\s+one\s+year|percentage)",ctx) else 0
    if val>0:cand.append(({"RPO":3,"Backlog":2}[basis]-penalty,val,basis,ctx))
  if cand:
   cand.sort(key=lambda z:(z[0],z[1]),reverse=True); _,val,basis,ctx=cand[0]; return {"value":val,"basis":basis,"concept":"filing-text","asOf":x["filed"],"url":url,"evidence":ctx[:420]}
 return None
def demand(f,cik):
 x=std_rpo(f,cik) or filing_demand(cik) or contract_liability(f,cik)
 if not x: raise FetchError("no RPO/backlog/contract liability")
 return x
def yahoo_price(t):
 q=urllib.parse.quote(t,safe=""); url=f"{YAHOO_CHART}/{q}?range=5d&interval=1d&includePrePost=false"; d=jget(url); x=d.get("chart",{}).get("result")
 if not x:raise FetchError("Yahoo no price")
 meta=x[0].get("meta",{}); p=meta.get("regularMarketPrice")
 if not isinstance(p,(int,float)) or p<=0:
  z=[v for v in x[0].get("indicators",{}).get("quote",[{}])[0].get("close",[]) if isinstance(v,(int,float)) and v>0]
  if not z:raise FetchError("Yahoo no close")
  p=z[-1]
 return float(p),"Yahoo Finance chart",url
def stooq_price(t):
 sym=t.lower().replace("-",".")+".us"; url=f"{STOOQ}?s={urllib.parse.quote(sym)}&f=sd2t2ohlcv&h&e=csv"; rows=list(csv.DictReader(io.StringIO(tget(url))))
 if not rows:raise FetchError("Stooq no price")
 return float(rows[0]["Close"]),"Stooq",url
def price(t):
 try:return yahoo_price(t)
 except Exception:return stooq_price(t)
def yahoo_peg(t):
 now=int(time.time()); q=urllib.parse.quote(t,safe=""); url=f"{YAHOO_FUND}/{q}?symbol={q}&type=trailingPegRatio,forwardPe,trailingPe&period1={now-1209600}&period2={now}"; d=jget(url); out={}
 for r in d.get("timeseries",{}).get("result",[]):
  typ=(r.get("meta",{}).get("type") or [None])[0]; vals=r.get(typ,[]) if typ else []
  if vals:
   raw=vals[-1].get("reportedValue",{}).get("raw")
   if isinstance(raw,(int,float)):out[typ]=float(raw)
 p=out.get("trailingPegRatio")
 if not isinstance(p,(int,float)) or not math.isfinite(p):raise FetchError("Yahoo no PEG")
 return p,out.get("forwardPe") or out.get("trailingPe"),url
def calc_peg(f,p):
 b=annual_best(f,EPS,2)
 if not b:raise FetchError("no diluted EPS")
 _,ns,c,u,by=b; fys=sorted(by); a,z=fys[-1],fys[-2]; e1=float(by[a]["val"]); e0=float(by[z]["val"])
 if not e1 or not e0:raise FetchError("zero EPS")
 g=(e1/e0-1)*100; pe=p/e1
 if abs(g)<1e-9:raise FetchError("zero EPS growth")
 return pe/g,pe,{"concept":f"{ns}:{c}","fyCurrent":a,"fyPrevious":z,"epsCurrent":e1,"epsPrevious":e0,"growthPct":g,"unit":u}
def peg(t,f,p,cik):
 try:v,pe,url=yahoo_peg(t); return {"value":v,"pe":pe,"basis":"Yahoo trailing PEG","url":url,"details":None}
 except Exception:
  v,pe,d=calc_peg(f,p); return {"value":v,"pe":pe,"basis":"Computed FY PEG = P/E ÷ diluted-EPS growth %","url":f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik:010d}.json","details":d}
def score(g,c,p):
 s=35 if g>=300 else 25+(g-150)/15 if g>=150 else max(0,g/150)*20; s+=35 if c>=3 else 25+(c-2)*10 if c>=2 else max(0,c/2)*20
 s+=0 if p<=0 else 30 if p<=.5 else 20+(1-p)/.05 if p<=1 else max(0,(1.5-p)*20) if p<=1.5 else 5
 return int(round(max(0,min(100,s))))
def one(t,m):
 if t not in m:raise FetchError("ticker absent from SEC map")
 info=m[t]; cik=info["cik"]; f=facts(cik); ca=capex(f); de=demand(f,cik); pr,prb,pru=price(t); pg=peg(t,f,pr,cik); cov=de["value"]/ca["current"]; sc=score(ca["growth"],cov,pg["value"])
 vals=[ca["current"],ca["prior2"],ca["growth"],de["value"],cov,pr,pg["value"]]
 if not all(math.isfinite(v) for v in vals):raise FetchError("non-finite metric")
 return {"ticker":t,"name":info["name"],"sector":SECTORS.get(t,"Public Company"),"cik":cik,"capexCurrentBn":round(ca["current"],4),"capex2YBn":round(ca["prior2"],4),"growthPct":round(ca["growth"],2),"demandBn":round(de["value"],4),"demandBasis":de["basis"],"coverage":round(cov,3),"peg":round(pg["value"],4),"pegMeaningful":bool(pg["value"]>0),"pe":round(pg["pe"],3) if isinstance(pg.get("pe"),(int,float)) and math.isfinite(pg["pe"]) else None,"price":round(pr,4),"score":sc,"sources":{"capex":{"provider":"SEC EDGAR XBRL","url":f"{SEC_BASE}/api/xbrl/companyfacts/CIK{cik:010d}.json","concept":ca["concept"],"currentFY":ca["fy"],"prior2FY":ca["fy2"]},"demand":{"provider":"SEC EDGAR","url":de["url"],"basis":de["basis"],"concept":de.get("concept"),"asOf":de.get("asOf"),"evidence":de.get("evidence")},"price":{"provider":prb,"url":pru},"peg":{"provider":pg["basis"],"url":pg["url"],"details":pg.get("details")}}}
def main():
 a=argparse.ArgumentParser(); a.add_argument("--output",default="ratio-data.json"); a.add_argument("--tickers",default=os.environ.get("RATIO_TICKERS","")); a.add_argument("--allow-partial",action="store_true"); x=a.parse_args(); ts=[q.strip().upper() for q in x.tickers.split(",") if q.strip()] or TRACKED; m=ticker_map(); rows=[]; errs=[]
 for i,t in enumerate(ts,1):
  print(f"[{i}/{len(ts)}] {t}",flush=True)
  try:rows.append(one(t,m))
  except Exception as e:errs.append({"ticker":t,"error":str(e)}); print(f"ERROR {t}: {e}",flush=True)
 if errs and not x.allow_partial:raise SystemExit("strict update failed: "+"; ".join(f"{e['ticker']}: {e['error']}" for e in errs))
 payload={"schemaVersion":2,"generatedAt":dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00","Z"),"methodology":{"capex":"Latest annual SEC XBRL CapEx versus the annual value two fiscal years earlier.","demand":"SEC RPO when available; otherwise filing-stated backlog; final fallback is SEC XBRL contract liabilities. The basis is shown per company.","coverage":"Demand metric divided by latest annual CapEx.","peg":"Yahoo trailing PEG when available; otherwise a disclosed FY PEG computed from current price, diluted annual EPS and annual diluted-EPS growth.","strictness":"No synthetic values. Publication aborts if any tracked ticker cannot be fully resolved."},"universes":UNIVERSES,"stocks":sorted(rows,key=lambda r:r["score"],reverse=True),"errors":errs}
 Path(x.output).write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"); print("wrote",x.output,len(rows))
if __name__=="__main__":main()
