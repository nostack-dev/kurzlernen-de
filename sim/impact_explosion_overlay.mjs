const POOL_SIZE=12;
const SPARKS=9;
const LIFE_MS=330;
let installed=false,pool=null,cursor=0,style=null;
const lastExplosionAt=new WeakMap();

function ensureStyle(){
  if(style)return;style=document.createElement("style");style.textContent=`
    .bullet-impact-explosion{position:absolute;z-index:14;width:0;height:0;pointer-events:none;display:none;contain:layout style paint}
    .bullet-impact-explosion.active{display:block}
    .bullet-impact-explosion .impact-core{position:absolute;left:-7px;top:-7px;width:14px;height:14px;border-radius:50%;background:radial-gradient(circle,#fff 0 12%,#fff39a 18%,#ff9e31 42%,#ff3d20aa 62%,transparent 76%);box-shadow:0 0 12px #ffbe49,0 0 28px #ff5b2a}
    .bullet-impact-explosion .impact-ring{position:absolute;left:-8px;top:-8px;width:16px;height:16px;border-radius:50%;border:2px solid #ffd46f;box-shadow:0 0 8px #ff7a32}
    .bullet-impact-explosion .impact-spark{position:absolute;left:-2px;top:-2px;width:4px;height:4px;border-radius:50%;background:#fff0a0;box-shadow:0 0 6px #ff9a32;transform:rotate(var(--a)) translateX(0) scale(1)}
    .bullet-impact-explosion.active .impact-core{animation:impactCoreBurst .33s ease-out forwards}
    .bullet-impact-explosion.active .impact-ring{animation:impactRingBurst .33s ease-out forwards}
    .bullet-impact-explosion.active .impact-spark{animation:impactSparkBurst .33s cubic-bezier(.15,.7,.2,1) forwards;animation-delay:var(--d)}
    @keyframes impactCoreBurst{0%{transform:scale(.35);opacity:1}38%{transform:scale(1.8);opacity:1}100%{transform:scale(3.6);opacity:0}}
    @keyframes impactRingBurst{0%{transform:scale(.25);opacity:1}100%{transform:scale(5.2);opacity:0}}
    @keyframes impactSparkBurst{0%{transform:rotate(var(--a)) translateX(1px) scale(1.2);opacity:1}100%{transform:rotate(var(--a)) translateX(var(--r)) scale(.35);opacity:0}}
  `;document.head.appendChild(style);
}
function ensurePool(viewport){
  if(pool&&pool.every(item=>item.el.isConnected))return pool;ensureStyle();pool=Array.from({length:POOL_SIZE},(_,poolIndex)=>{
    const el=document.createElement("i");el.className="bullet-impact-explosion";el.setAttribute("aria-hidden","true");
    const core=document.createElement("i");core.className="impact-core";const ring=document.createElement("i");ring.className="impact-ring";el.append(core,ring);
    for(let i=0;i<SPARKS;i++){const spark=document.createElement("i");spark.className="impact-spark";spark.style.setProperty("--a",`${(i*360/SPARKS+poolIndex*11)%360}deg`);spark.style.setProperty("--r",`${25+(i%4)*9}px`);spark.style.setProperty("--d",`${(i%3)*7}ms`);el.appendChild(spark);}
    viewport.appendChild(el);return{el,timer:0};
  });return pool;
}
function explode(marker){
  const now=performance.now(),previous=lastExplosionAt.get(marker)||-Infinity;if(now-previous<20)return;lastExplosionAt.set(marker,now);
  const viewport=marker.closest("#viewport");if(!viewport)return;const x=Number.parseFloat(marker.style.left),y=Number.parseFloat(marker.style.top);if(!Number.isFinite(x)||!Number.isFinite(y))return;
  const items=ensurePool(viewport),item=items[cursor++%items.length];clearTimeout(item.timer);item.el.classList.remove("active");item.el.style.left=`${x}px`;item.el.style.top=`${y}px`;void item.el.offsetWidth;item.el.classList.add("active");item.timer=setTimeout(()=>item.el.classList.remove("active"),LIFE_MS+30);viewport.dataset.fireImpactExplosions=String((Number(viewport.dataset.fireImpactExplosions)||0)+1);
}
function install(){
  if(installed||typeof MutationObserver!=="function")return;installed=true;
  const observer=new MutationObserver(records=>{for(const record of records){const target=record.target;if(target instanceof Element&&target.classList.contains("flight-fire-impact")&&target.classList.contains("active"))explode(target);}});
  const start=()=>document.body&&observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:["class"]});if(document.body)start();else addEventListener("DOMContentLoaded",start,{once:true});
}

install();
export{install as installImpactExplosionOverlay};
