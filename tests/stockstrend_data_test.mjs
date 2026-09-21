import fs from 'node:fs';
import assert from 'node:assert/strict';

const trend=JSON.parse(fs.readFileSync('stockstrend-data.json','utf8'));
const watch=JSON.parse(fs.readFileSync('watchlist-data.json','utf8'));
const intr=JSON.parse(fs.readFileSync('intrinsic-orcl.json','utf8'));
const source=JSON.parse(fs.readFileSync('intrinsic-orcl-input.json','utf8'));
const html=fs.readFileSync('stockstrend.html','utf8');

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
assert(html.includes("type:'linear'"),'charts must use a real numeric time axis');
assert(html.includes('seriesWithGaps'),'missing periods must break the line');
assert(html.includes('spanGaps:false'),'charts must not bridge missing data');
assert(html.includes('coverage<0.72||startsLate||endsEarly'),'adaptive chart bounds missing');
assert(html.includes("Daten verfügbar '+fmtAxisValue(stats.xs[0])"),'coverage hint missing');
assert(html.includes("axisX(hist"),'sentiment chart must use adaptive time bounds');
assert(html.includes("axisX(mhist"),'magnitude chart must use adaptive time bounds');
assert(html.includes("axisX(ivHist"),'intrinsic chart must use adaptive time bounds');
assert(html.includes('data-range="5y"'),'5Y range missing');
assert(!html.includes("callback:function(v){return v+' €';}"),'USD chart must not show euro axis');
assert(html.includes('Preisalarm aktivieren'),'alarm wording regression');
assert(!html.includes("+' · same-origin'"),'internal transport wording leaked to UI');
assert(!html.includes('query1.finance.yahoo.com'),'browser must not fetch Yahoo directly');
assert(!html.includes('query2.finance.yahoo.com'),'browser must not fetch Yahoo directly');
assert(html.includes("fetch('orcl-minute.json?t='"),'price shock feed must be same-origin');
assert(html.includes(".chart-wrap canvas { max-height: none"),'chart canvases must not inherit 190px max-height clip');
assert(html.includes("grace:'12%'"),'hype chart needs y-grace so lines are not clipped');
assert(html.includes("grace:'8%'"),'magnitude chart needs y-grace');
assert(html.includes("grace:'10%'"),'intrinsic chart needs y-grace');
assert(html.includes('Math.min(now,last+pad)'),'adaptive x-max must not run past now');
assert(!html.includes("y:{min:0,max:100,"),'hard 0-100 y bounds clip edge points');

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
