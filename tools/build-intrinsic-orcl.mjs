import fs from 'node:fs';

const input=JSON.parse(fs.readFileSync('intrinsic-orcl-input.json','utf8'));
const round=(n,d=2)=>Number(Number(n).toFixed(d));
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
function dcf(ps,m){
  let e=ps,pv=0;
  for(let y=1;y<=m.years;y++){
    e*=1+m.growth_10y;
    pv+=e/Math.pow(1+m.discount_rate,y);
  }
  const terminal=e*(1+m.terminal_growth)/(m.discount_rate-m.terminal_growth);
  return pv+terminal/Math.pow(1+m.discount_rate,m.years);
}
const scenarios=[
  ['low','conservative',input.model.maintenance_capex_scenarios.conservative],
  ['base','base',input.model.maintenance_capex_scenarios.base],
  ['high','upper_sensitivity',input.model.maintenance_capex_scenarios.upper_sensitivity]
];
const raw={low:[],base:[],high:[]};
const snapshots=input.filing_inputs.map((f,i)=>{
  const s={...f};
  for(const [key,,factor] of scenarios){
    const oe=f.operating_cash_flow_m-f.financing_like_customer_prepayments_m-f.stock_based_compensation_m-factor*f.depreciation_m-f.preferred_dividends_m;
    const ps=oe/f.diluted_shares_m;
    raw[key].push(ps);
    const norm=mean(raw[key].slice(-input.model.normalization_periods));
    s[key+'_maintenance_capex_m']=round(factor*f.depreciation_m,1);
    s[key+'_owner_earnings_m']=round(oe,1);
    s[key+'_owner_earnings_ps_usd']=round(ps,4);
    s[key+'_normalized_owner_earnings_ps_usd']=round(norm,4);
    s['intrinsic_'+key+'_usd']=round(dcf(norm,input.model),2);
  }
  s.owner_earnings_m=s.base_owner_earnings_m;
  s.owner_earnings_ps_usd=s.base_owner_earnings_ps_usd;
  s.normalized_owner_earnings_ps_usd=s.base_normalized_owner_earnings_ps_usd;
  s.intrinsic_usd=s.intrinsic_base_usd;
  s.no_growth_value_usd=round(s.normalized_owner_earnings_ps_usd/input.model.discount_rate,2);
  return s;
});
function snapAt(at){
  const t=new Date(at).getTime();
  let found=null;
  for(const s of snapshots){
    if(new Date(s.effective_at).getTime()<=t) found=s;
  }
  return found;
}
const history=input.price_history.map(p=>{
  const s=snapAt(p.at);
  if(!s) return {...p,intrinsic_low_usd:null,intrinsic_base_usd:null,intrinsic_high_usd:null,intrinsic_usd:null,owner_earnings_ps_usd:null,normalized_owner_earnings_ps_usd:null,valuation_basis:null};
  return {
    ...p,
    intrinsic_low_usd:s.intrinsic_low_usd,
    intrinsic_base_usd:s.intrinsic_base_usd,
    intrinsic_high_usd:s.intrinsic_high_usd,
    intrinsic_usd:s.intrinsic_base_usd,
    owner_earnings_ps_usd:s.owner_earnings_ps_usd,
    normalized_owner_earnings_ps_usd:s.normalized_owner_earnings_ps_usd,
    valuation_basis:s.label
  };
});
const last=history.at(-1)||null;
const lastSnap=last&&last.valuation_basis?snapshots.find(s=>s.label===last.valuation_basis):null;
const latest=last&&lastSnap?{
  at:last.at,price_usd:last.price_usd,
  owner_earnings_ps_usd:lastSnap.owner_earnings_ps_usd,
  normalized_owner_earnings_ps_usd:lastSnap.normalized_owner_earnings_ps_usd,
  intrinsic_low_usd:lastSnap.intrinsic_low_usd,
  intrinsic_base_usd:lastSnap.intrinsic_base_usd,
  intrinsic_high_usd:lastSnap.intrinsic_high_usd,
  intrinsic_usd:lastSnap.intrinsic_base_usd,
  no_growth_value_usd:lastSnap.no_growth_value_usd,
  valuation_basis:lastSnap.label,
  filing_period_end:lastSnap.period_end
}:null;
const out={
  symbol:input.symbol,
  currency_display:input.currency_display,
  method:'buffett_owner_earnings_maintenance_capex_corridor',
  model:{
    ...input.model,
    maintenance_capex_proxy:'reported depreciation with 0.8x / 1.0x / 1.2x sensitivity',
    formula:'Owner Earnings = operating cash flow - financing-like customer prepayments - stock-based compensation - estimated maintenance capex - preferred dividends',
    summary_de:'Owner-Earnings-Wertkorridor aus veröffentlichten Cashflows. Basis: Erhaltungs-CapEx = Abschreibung; konservativ: 1,2× Abschreibung; obere Sensitivität: 0,8×. Keine EBITDA- oder Adjusted-Earnings-Basis.'
  },
  latest,
  filing_inputs:input.filing_inputs,
  valuation_snapshots:snapshots,
  limitations_de:'Der Korridor ist eine konservative Modellrechnung, kein beobachtbarer Marktpreis. Oracle weist Erhaltungs-CapEx nicht separat aus; deshalb wird genau diese Unsicherheit als Korridor gezeigt. Die letzten drei veröffentlichten Owner-Earnings-Werte werden normalisiert. Finanzierungsähnliche Kunden-Vorauszahlungen und Aktienvergütung werden als Eigentümerkosten abgezogen. Nach Börsenschluss veröffentlichte SEC-Filings wirken erst ab dem nächsten Handelstag; spätere Filings werden nie rückwirkend angewandt.',
  history
};
const text=JSON.stringify(out,null,2)+'\n';
if(process.argv.includes('--check')){
  const actual=fs.readFileSync('intrinsic-orcl.json','utf8');
  if(actual!==text){
    console.error('intrinsic-orcl.json is not reproducible from intrinsic-orcl-input.json');
    process.exit(1);
  }
  console.log('intrinsic ORCL build: OK');
}else{
  fs.writeFileSync('intrinsic-orcl.json',text);
}
