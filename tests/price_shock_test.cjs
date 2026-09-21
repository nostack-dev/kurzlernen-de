const assert=require('node:assert/strict');
const Shock=require('../price-shock-core.js');

function baseBars(days=5,perDay=90){
  const out=[];
  let price=100;
  for(let d=0;d<days;d++){
    const start=Date.UTC(2026,8,14+d,14,30,0);
    for(let i=0;i<perDay;i++){
      const tiny=Math.sin((d*perDay+i)*1.73)*0.00022;
      price*=1+tiny;
      out.push({at:new Date(start+i*60000).toISOString(),close:price,volume:100000+Math.round(8000*Math.sin(i/7))});
    }
  }
  return out;
}
function append(bars,pcts,volume=110000){
  let p=bars.at(-1).close,t=new Date(bars.at(-1).at).getTime();
  for(const r of pcts){p*=1+r/100;t+=60000;bars.push({at:new Date(t).toISOString(),close:p,volume});}
  return bars;
}

let b=baseBars();
let n=Shock.analyze(b);
assert.equal(n.triggered,false,'normal noise must not trigger');

b=baseBars(); append(b,[-1.15],420000);
let drop=Shock.analyze(b);
assert.equal(drop.triggered,true,'hard drop must trigger');
assert.equal(drop.direction,'down');
assert.equal(drop.pattern,'sprung');
assert(drop.score>=70);

b=baseBars(); append(b,[-0.19,-0.19,-0.19,-0.19,-0.19],150000);
let ramp=Shock.analyze(b);
assert.equal(ramp.triggered,true,'linear selloff ramp must trigger');
assert.equal(ramp.direction,'down');
assert.equal(ramp.pattern,'rampe');

b=baseBars(); append(b,[0.18,0.18,0.18,0.18,0.18],160000);
let up=Shock.analyze(b);
assert.equal(up.triggered,true,'linear upside ramp must trigger');
assert.equal(up.direction,'up');

b=baseBars(); append(b,[0.01],2000000);
let volumeOnly=Shock.analyze(b);
assert.equal(volumeOnly.triggered,false,'volume without price shock must not trigger');

console.log('price shock detector: OK', {drop, ramp, up, volumeOnly});
