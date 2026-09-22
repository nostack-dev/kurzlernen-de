import fs from 'node:fs';
import assert from 'node:assert/strict';

const trend=JSON.parse(fs.readFileSync('stockstrend-data.json','utf8'));
const watch=JSON.parse(fs.readFileSync('watchlist-data.json','utf8'));
const intr=JSON.parse(fs.readFileSync('intrinsic-orcl.json','utf8'));
const source=JSON.parse(fs.readFileSync('intrinsic-orcl-input.json','utf8'));
const html=fs.readFileSync('stockstrend.html','utf8');
const methodik=fs.readFileSync('methodik.html','utf8');

const sw=trend.tick?.scrape_window;
assert(sw?.start && sw?.end);
assert(new Date(sw.start)<=new Date(sw.end),'scrape window reversed');

const o=watch.stocks?.ORCL, tail=o?.history?.at(-1);
assert(o&&tail);
assert.equal(o.latest.at,tail.at,'latest/history timestamp drift');
assert.equal(o.latest.signal,tail.signal,'latest/history signal drift');
assert.equal(o.latest.confidence,tail.confidence,'latest/history confidence drift');

assert(html.includes('return out;'));
assert(!html.includes('return out.length?out:arr.slice();'));
assert(html.includes('directionalPct'));
assert(html.includes('Investor-first compact view'),'compact investor UI missing');
assert(html.includes('<title>alantu.de · Aktien</title>'),'alantu.de title branding missing');
assert(html.includes('alantu.de · Aktien'),'alantu.de header branding missing');
assert(!html.includes('BotBot · Aktien'),'legacy BotBot visible branding must be gone');
assert(html.includes('href="methodik.html"'),'methodology info link missing');
assert(html.includes('href="methodik.html#intrinsic"'),'intrinsic methodology link missing');
assert(html.includes('class="hero-price" id="livePrice"'),'dominant live EUR price missing');
assert(html.includes("wss://streamer.finance.yahoo.com/?version=2"),'real-time Yahoo websocket missing');
assert(html.includes("subscribe:['ORCL','EURUSD=X']"),'ORCL+EURUSD live subscription missing');
assert(html.includes("style:'currency',currency:'EUR'"),'visible prices must format as EUR');
assert(html.includes("data-range=\"1m\""),'1M TR range missing');
assert(!html.includes('data-range="today"'),'Heute range should be removed');
assert(!html.includes('data-range="5m"'),'5M range should be removed');
assert(html.includes(">MAX</button>"),'MAX range missing');
assert(html.includes("function sentimentColor"),'sentiment threshold color missing');
assert(html.includes("v>55?'#00a94f':v<45?'#e94035':'#8e8e93'"),'sentiment red/gray/green thresholds missing');
assert(html.includes("priceRangeColor"),'range price color missing');
assert(html.includes('id="marketClock"'),'German market clock missing');
assert(html.includes('id="syncFooter"'),'sync footer missing');
assert(html.includes('id="syncNow"'),'manual sync button missing');
assert(html.includes("age>20*60*1000"),'stale sync threshold missing');
assert(html.includes('refreshFreshSignals'),'manual sync must perform real live signal refresh');
assert(html.includes('fetchTickerTick'),'browser live source fetch missing');
assert(html.includes('lastBrowserSyncAt=s.at'),'sync timestamp must only advance after fresh live signal calculation');
assert(!html.includes('lastBrowserSyncAt=new Date().toISOString()'),'loading a static snapshot must not fake a sync timestamp');
assert(html.includes("' · '+state"),'sync state label missing');
assert(html.includes('market-clock-core.js'),'market clock core missing');
assert(html.includes('positiv <span class="swatch neu"></span>neutral'),'clean sentiment legend missing');
assert(html.includes('pointHoverRadius:4'),'line-chart hover marker missing');
assert(!html.includes('pointHoverRadius:0'),'hover marker must not be disabled');
assert(html.includes("label:'Innerer Wert'"),'German value label missing');
assert(!html.includes('Berechnung & Grenzen'),'large inline value explainer should stay off the compact view');
assert(methodik.includes('Innerer Wert: exakte Berechnung'),'detailed intrinsic methodology page missing');
assert(methodik.includes('Owner Earnings ='),'owner earnings formula missing from methodology');
assert(methodik.includes('TickerTick API'),'live source documentation missing');
assert(methodik.includes('ApeWisdom'),'fallback Reddit source documentation missing');
assert(methodik.includes('Yahoo Finance WebSocket'),'live price source documentation missing');
assert(methodik.includes('Exakte SEC-Inputdatensätze'),'SEC input table missing');
assert(methodik.includes('exactLiveSources'),'methodology must use the same browser live/fallback source contract');
assert(methodik.includes('Aktueller Fallback-Datensatz (raw)'),'raw fallback dataset disclosure missing');
const methodikScripts=[...methodik.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
assert(methodikScripts.length,'methodology inline script missing');
new Function(methodikScripts.join('\n;\n'));
assert(!html.includes('keine Anlageberatung'),'disclaimer must stay removed');
assert(html.includes('aggregateForRange'),'range aggregation missing');
assert(html.includes("enabled:!isTouchChart()"),'mobile chart tooltip must be disabled');
assert(html.includes("function chartEvents(){return isTouchChart()?[]"),'mobile chart events must be disabled');
assert(html.includes("if(wlRange==='1w'||wlRange==='1m') mode='day'"),'1W/1M must aggregate daily');
assert(html.includes("else if(wlRange==='year') mode='week'"),'1J must aggregate weekly');
assert(html.includes("wlRange==='5y'||wlRange==='all') mode='month'"),'5J/MAX must aggregate monthly');
assert(html.includes("fill:false"),'sentiment chart must not use filled fragments');
assert(!html.includes("{label:'Bullisch %',data:"),'bull line should not clutter primary chart');
assert(!html.includes("{label:'Bearisch %',data:"),'bear line should not clutter primary chart');
assert(html.includes("label:'Innerer Wert'"),'German intrinsic-value line missing');
assert(!html.includes("{label:'Konservativer Wert',data:"),'conservative line should not clutter primary chart');
assert(!html.includes("{label:'Obere Sensitivität',data:"),'upper line should not clutter primary chart');
assert(html.includes("type:'linear'"),'charts must use a real numeric time axis');
assert(html.includes('spanGaps:false'),'charts must not bridge missing data');
assert(html.includes('coverage<0.72||startsLate||endsEarly'),'adaptive chart bounds missing');
assert(html.includes("Daten verfügbar '+fmtAxisValue(stats.xs[0])"),'coverage hint missing');
assert(html.includes("axisX(hypeAgg"),'sentiment chart must use aggregated adaptive time bounds');
assert(html.includes("axisX(mhist"),'magnitude chart must use adaptive time bounds');
assert(html.includes("axisX(priceRows"),'price chart must use selected price rows');
assert(html.includes('data-range="5y"'),'5J range missing');
assert(html.includes("style:'currency',currency:'EUR'"),'UI must format money in EUR');
assert(html.includes('function usdToEur'),'USD to EUR conversion missing');
assert(html.includes('function fxAt'),'historical FX lookup missing');
assert(html.includes('Preisalarm aktivieren'),'alarm wording regression');
assert(!html.includes("+' · same-origin'"),'internal transport wording leaked to UI');
assert(!html.includes('query1.finance.yahoo.com'),'browser must not use Yahoo REST directly');
assert(!html.includes('query2.finance.yahoo.com'),'browser must not use Yahoo REST directly');
assert(html.includes("fetch('orcl-minute.json?t='"),'price shock fallback must be same-origin');
assert(html.includes("fetchJson('orcl-history.json'"),'long-range ORCL history feed missing');
assert(html.includes('orclDailyBars'),'daily ORCL chart series missing');
assert(html.includes("else if(orclDailyBars.length)"),'1M/1J/5J/MAX must prefer fresh daily ORCL prices');
assert(html.includes('liveChartTimer=setTimeout(function(){liveChartTimer=null;renderAll();}'),'live chart must refresh in every selected range');
assert(html.includes(".chart-wrap canvas { max-height: none"),'chart canvases must not inherit 190px max-height clip');
assert(html.includes("grace:'8%'"),'price/value chart needs light y-grace');
assert(html.includes('Math.min(now,last+pad)'),'adaptive x-max must not run past now');
assert(html.includes("y:{min:0,max:100"),'sentiment chart must keep 0-100 bounds');

assert.equal(intr.currency_display,'USD');
assert.equal(intr.method,'buffett_owner_earnings_maintenance_capex_corridor');
assert(intr.latest.intrinsic_low_usd>0);
assert(intr.latest.intrinsic_low_usd<intr.latest.intrinsic_base_usd);
assert(intr.latest.intrinsic_base_usd<intr.latest.intrinsic_high_usd);
assert.equal(intr.latest.intrinsic_usd,intr.latest.intrinsic_base_usd);
assert(!('intrinsic_eur' in intr.latest));
assert.equal(intr.valuation_snapshots.length,source.filing_inputs.length);

const dcf=(ps)=>{
  const m=intr.model; let e=ps,pv=0;
  for(let y=1;y<=m.years;y++){e*=1+m.growth_10y;pv+=e/Math.pow(1+m.discount_rate,y);}
  return pv+(e*(1+m.terminal_growth)/(m.discount_rate-m.terminal_growth))/Math.pow(1+m.discount_rate,m.years);
};
for(const s of intr.valuation_snapshots){
  const base=s.operating_cash_flow_m-s.financing_like_customer_prepayments_m-s.stock_based_compensation_m-s.depreciation_m-s.preferred_dividends_m;
  assert.equal(Number(base.toFixed(1)),s.owner_earnings_m,s.label+' base owner earnings');
  assert(s.intrinsic_low_usd<=s.intrinsic_base_usd&&s.intrinsic_base_usd<=s.intrinsic_high_usd,s.label+' corridor order');
  assert(Math.abs(dcf(s.normalized_owner_earnings_ps_usd)-s.intrinsic_base_usd)<=0.02,s.label+' DCF');
}
assert(source.filing_inputs.find(x=>x.label==='FY2022').source.includes('000156459022023675'),'FY2022 must use FY2022 filing');
assert.equal(source.filing_inputs.find(x=>x.label==='FY2023').effective_at,'2023-06-21T00:00:00Z');
assert.equal(source.filing_inputs.find(x=>x.label==='FY2024').effective_at,'2024-06-21T00:00:00Z');
assert.equal(source.filing_inputs.find(x=>x.label==='FY2025').effective_at,'2025-06-20T00:00:00Z');
assert.equal(source.filing_inputs.find(x=>x.label==='FY2026').effective_at,'2026-06-23T00:00:00Z');
assert.equal(source.filing_inputs.find(x=>x.label==='TTM Q1 FY2027').effective_at,'2026-09-14T00:00:00Z');

for(const h of intr.history){
  if(!h.valuation_basis){
    assert.equal(h.intrinsic_base_usd,null);
    assert.equal(h.intrinsic_usd,null);
  }else{
    const s=intr.valuation_snapshots.find(x=>x.label===h.valuation_basis);
    assert(s);
    assert(new Date(s.effective_at)<=new Date(h.at),'look-ahead');
    assert.equal(h.intrinsic_base_usd,s.intrinsic_base_usd);
    assert.equal(h.intrinsic_usd,s.intrinsic_base_usd);
  }
}
// Critical no-look-ahead boundary checks.
assert.equal(intr.history.find(x=>x.at.startsWith('2026-09-11'))?.valuation_basis,'FY2026');
assert.equal(intr.history.find(x=>x.at.startsWith('2026-09-14'))?.valuation_basis,'TTM Q1 FY2027');


assert(!JSON.stringify(trend.tick?.sources||{}).includes('Apify'),'Apify source keys must be gone');
assert(!('user-Apify-Reddit' in (trend.tick?.sources||{})),'user-Apify-Reddit must be removed');
assert(!('user-Apify-TikTok' in (trend.tick?.sources||{})),'user-Apify-TikTok must be removed');
assert(trend.tick?.sources?.PublicReddit,'PublicReddit aggregator source missing');

console.log('stockstrend contract: OK');

// UI expects the deploy workflow to generate eurusd-history.json for EUR conversion.
