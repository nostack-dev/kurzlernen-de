import fs from 'node:fs';
import assert from 'node:assert/strict';

const trend=JSON.parse(fs.readFileSync('stockstrend-data.json','utf8'));
const watch=JSON.parse(fs.readFileSync('watchlist-data.json','utf8'));
const intr=JSON.parse(fs.readFileSync('intrinsic-orcl.json','utf8'));
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
assert(!html.includes('query1.finance.yahoo.com'), 'browser must not fetch Yahoo directly');
assert(!html.includes('query2.finance.yahoo.com'), 'browser must not fetch Yahoo directly');
assert(html.includes("fetch('orcl-minute.json?t='"), 'price shock feed must be same-origin');
assert.equal(intr.currency_display,'USD');
assert(intr.latest.intrinsic_usd>0);
assert(!('intrinsic_eur' in intr.latest));
assert(intr.valuation_snapshots.length>=6);

for(const s of intr.valuation_snapshots){
  const oe=s.operating_cash_flow_m-s.financing_like_customer_prepayments_m-s.stock_based_compensation_m-s.depreciation_m-s.preferred_dividends_m;
  assert.equal(Number(oe.toFixed(1)),s.owner_earnings_m,s.label+' owner earnings');
}
for(const h of intr.history){
  if(!h.valuation_basis) assert.equal(h.intrinsic_usd,null);
  else{
    const s=intr.valuation_snapshots.find(x=>x.label===h.valuation_basis);
    assert(s);
    assert(new Date(s.effective_at)<=new Date(h.at),'look-ahead');
    assert.equal(h.intrinsic_usd,s.intrinsic_usd);
  }
}
console.log('stockstrend contract: OK');
