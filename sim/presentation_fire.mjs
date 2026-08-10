const DEFAULT_BLOCKED="#soloTopbar,#soloRaceHud,#soloLeft,#soloRight,#soloClearance,.solo-action,#cameraModes,.phone-settings-dialog,.flight-logbook-dialog,#worldLookHud,#worldMapLegend,button,input,select,dialog,a,label";
const SHOT_INTERVAL_MS=90;

function installStyle(){if(document.getElementById("presentationFireStyle"))return;const style=document.createElement("style");style.id="presentationFireStyle";style.textContent=`
body.solo-flight #viewport,body.solo-flight #viewport *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important;-webkit-user-drag:none!important}
body.solo-flight #viewport{touch-action:none!important}
.presentation-fire-stick{position:absolute;z-index:9;width:84px;height:84px;border-radius:50%;border:2px solid #50ff9c;background:#0a3b2499;box-shadow:0 0 0 2px #061d13aa inset,0 0 22px #32ff8977;pointer-events:none;transform:translate(-50%,-50%);display:none}
.presentation-fire-stick::after{content:"";position:absolute;left:50%;top:50%;width:28px;height:28px;border-radius:50%;background:#63ffad;border:2px solid #d2ffe6;box-shadow:0 0 13px #48ff9c;transform:translate(calc(-50% + var(--fire-x,0px)),calc(-50% + var(--fire-y,0px)))}
.presentation-muzzle{position:absolute;z-index:8;width:18px;height:18px;border-radius:50%;background:#d9ffe7;box-shadow:0 0 24px 9px #56ff9caa;pointer-events:none;transform:translate(-50%,-50%) scale(.2);opacity:0;animation:fireFlash .11s ease-out}
.presentation-tracer{position:absolute;z-index:7;height:1px;transform-origin:0 50%;background:linear-gradient(90deg,#dfffea,#54ff9c00);box-shadow:0 0 4px #63ffa4;pointer-events:none;animation:fireTracer .12s linear forwards}
@keyframes fireFlash{0%{opacity:1;transform:translate(-50%,-50%) scale(.3)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.8)}}@keyframes fireTracer{0%{opacity:.95}100%{opacity:0}}
`;document.head.appendChild(style);}

function audioShot(state){try{const AC=globalThis.AudioContext||globalThis.webkitAudioContext;if(!AC)return;if(!state.ctx)state.ctx=new AC();const ctx=state.ctx;if(ctx.state==="suspended")ctx.resume?.();const now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain();osc.type="square";osc.frequency.setValueAtTime(145,now);osc.frequency.exponentialRampToValueAtTime(78,now+.045);gain.gain.setValueAtTime(.055,now);gain.gain.exponentialRampToValueAtTime(.0001,now+.055);osc.connect(gain).connect(ctx.destination);osc.start(now);osc.stop(now+.06);}catch{}}

export function installPresentationFire({viewport,blockedSelector=DEFAULT_BLOCKED,onShot=()=>{}}={}){
  if(!viewport)throw Error("presentation fire viewport required");installStyle();viewport.dataset.presentationShots="0";
  const stick=document.createElement("div");stick.className="presentation-fire-stick";viewport.appendChild(stick);
  const state={pointerId:null,startX:0,startY:0,x:0,y:0,lastShot:-Infinity,timer:0,ctx:null,shots:0};
  const blocked=target=>Boolean(target?.closest?.(blockedSelector));
  const local=(clientX,clientY)=>{const r=viewport.getBoundingClientRect();return{x:clientX-r.left,y:clientY-r.top};};
  const flash=(x,y)=>{const node=document.createElement("div");node.className="presentation-muzzle";node.style.left=`${x}px`;node.style.top=`${y}px`;viewport.appendChild(node);setTimeout(()=>node.remove(),150);const r=viewport.getBoundingClientRect(),sx=r.width*.5,sy=r.height*.88,dx=x-sx,dy=y-sy,tracer=document.createElement("div");tracer.className="presentation-tracer";tracer.style.left=`${sx}px`;tracer.style.top=`${sy}px`;tracer.style.width=`${Math.hypot(dx,dy)}px`;tracer.style.transform=`rotate(${Math.atan2(dy,dx)}rad)`;viewport.appendChild(tracer);setTimeout(()=>tracer.remove(),160);};
  const shoot=()=>{if(state.pointerId==null)return;const now=performance.now();if(now-state.lastShot<SHOT_INTERVAL_MS-2)return;state.lastShot=now;const p=local(state.x,state.y);flash(p.x,p.y);audioShot(state);state.shots++;viewport.dataset.presentationShots=String(state.shots);try{onShot({clientX:state.x,clientY:state.y,x:p.x,y:p.y,shot:state.shots});}catch{};};
  const loop=()=>{state.timer=0;if(state.pointerId==null)return;shoot();state.timer=requestAnimationFrame(loop);};
  const begin=event=>{if(!document.body.classList.contains("solo-flight")||state.pointerId!=null||event.button>0||blocked(event.target))return;state.pointerId=event.pointerId;state.startX=state.x=event.clientX;state.startY=state.y=event.clientY;const p=local(event.clientX,event.clientY);stick.style.left=`${p.x}px`;stick.style.top=`${p.y}px`;stick.style.setProperty("--fire-x","0px");stick.style.setProperty("--fire-y","0px");stick.style.display="block";try{viewport.setPointerCapture?.(event.pointerId);}catch{}event.preventDefault();shoot();state.timer=requestAnimationFrame(loop);};
  const move=event=>{if(event.pointerId!==state.pointerId)return;state.x=event.clientX;state.y=event.clientY;const dx=state.x-state.startX,dy=state.y-state.startY,len=Math.hypot(dx,dy),limit=27,k=len>limit?limit/len:1;stick.style.setProperty("--fire-x",`${dx*k}px`);stick.style.setProperty("--fire-y",`${dy*k}px`);event.preventDefault();};
  const end=event=>{if(event.pointerId!==state.pointerId)return;try{viewport.releasePointerCapture?.(event.pointerId);}catch{}state.pointerId=null;stick.style.display="none";if(state.timer)cancelAnimationFrame(state.timer);state.timer=0;event.preventDefault();};
  viewport.addEventListener("pointerdown",begin,{passive:false});viewport.addEventListener("pointermove",move,{passive:false});viewport.addEventListener("pointerup",end,{passive:false});viewport.addEventListener("pointercancel",end,{passive:false});
  for(const type of ["selectstart","contextmenu","dragstart"])viewport.addEventListener(type,event=>{if(document.body.classList.contains("solo-flight")){event.preventDefault();event.stopPropagation();}},{passive:false});
  return{destroy(){if(state.timer)cancelAnimationFrame(state.timer);stick.remove();},get active(){return state.pointerId!=null;},get shots(){return state.shots;}};
}
