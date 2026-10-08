import * as THREE from "three";
import {requestLight} from "./dynamic_lights.mjs";
import {groundHeightAt,terrainRayDistance} from "./terrain_craters.mjs";
import {addTrauma} from "./camera_shake.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";

// Fighter jets.
//  * Ambient: every couple of minutes a pair of jets screams over the player
//    heading north — 55–85 m above the roofs at ~250 m/s. You see them before
//    you hear them: the sound is computed from the *retarded* position
//    (speed of sound 343 m/s) with real Doppler, so the roar arrives late,
//    peaks as a crushing blast and drops in pitch as they leave. Close passes
//    shake the camera; the wake throws a drone around.
//  * AIR STRIKE (sandbox power, always available, short cooldown): mark any
//    spot you look at — a red flare pops there, the jets come in from the
//    south on the north heading and drop a stick of four bombs across it.
//    Real explosions (the same blast as everything: damage, physics push,
//    scorch, wall soot, police/people, trees). Peers see the jets and bombs.

export const FIGHTER_JETS_VERSION="low-pass-jets+air-strike-v1";
const SPEED=255,SOUND=343,ALT_MIN=55,ALT_MAX=85,SPAN=2600,AMBIENT_MIN_S=75,AMBIENT_MAX_S=150,STRIKE_COOLDOWN_MS=30000,BOMB_RADIUS=15,BOMB_DAMAGE=150;
const bridge=()=>globalThis.__arondightRealWorld||null;
const walk=()=>globalThis.__arondightWalkMode||null;
const viewport=()=>document.getElementById("viewport");
let sceneRef=null,root=null,jets=[],bombs=[],flares=[],blasts=[],nextAmbient=performance.now()+40000+Math.random()*40000,lastFrame=performance.now(),lastStrike=-Infinity,serial=0;
let ctx=null,jetBuffer=null,master=null;

// ------------------------------------------------------------ model
let jetGeo=null;
function jetModel(){
  const g=new THREE.Group();g.name="FIGHTER_JET";const metal=new THREE.MeshStandardMaterial({color:0x5b636b,roughness:.45,metalness:.55}),dark=new THREE.MeshStandardMaterial({color:0x2a2f35,roughness:.5,metalness:.4}),glass=new THREE.MeshStandardMaterial({color:0x1b2a36,roughness:.08,metalness:.6,emissive:0x0a1620});
  const add=(geo,m,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{const o=new THREE.Mesh(geo,m);o.position.set(x,y,z);o.rotation.set(rx,ry,rz);o.castShadow=true;o.userData.flightFireIgnore=true;g.add(o);return o;};
  // forward = +y
  add(new THREE.CylinderGeometry(.62,.8,11,12),metal,0,0,0);                 // fuselage
  add(new THREE.ConeGeometry(.62,3.6,12),metal,0,7.3,0);                     // nose
  add(new THREE.SphereGeometry(.62,12,8,0,Math.PI*2,0,Math.PI/2),glass,0,3.4,.45,0,0,0).scale.set(.8,2.4,.9); // canopy
  const wing=new THREE.Shape();wing.moveTo(0,2.2);wing.lineTo(5.6,-2.6);wing.lineTo(5.6,-3.6);wing.lineTo(0,-3.4);wing.closePath();
  const wg=new THREE.ExtrudeGeometry(wing,{depth:.16,bevelEnabled:false});wg.translate(0,0,-.08);
  add(wg,metal,.4,-.6,-.1);const wl=add(wg,metal,-.4,-.6,-.1);wl.scale.x=-1;
  const tail=new THREE.Shape();tail.moveTo(0,0);tail.lineTo(-2.6,2.6);tail.lineTo(-3.4,2.6);tail.lineTo(-2.8,0);tail.closePath();
  const tg=new THREE.ExtrudeGeometry(tail,{depth:.12,bevelEnabled:false});tg.translate(0,0,-.06);
  for(const s of[-1,1]){const f=add(tg,dark,s*.55,-3.6,.5,0,Math.PI/2,0);f.rotation.set(0,Math.PI/2,s*.32);}
  const st=new THREE.Shape();st.moveTo(0,0);st.lineTo(2.2,-1.6);st.lineTo(2.2,-2.3);st.lineTo(0,-2.1);st.closePath();const sg=new THREE.ExtrudeGeometry(st,{depth:.1,bevelEnabled:false});
  add(sg,dark,.5,-3.6,-.1);const sl=add(sg,dark,-.5,-3.6,-.1);sl.scale.x=-1;
  for(const s of[-1,1])add(new THREE.CylinderGeometry(.42,.48,1.2,10),dark,s*.45,-5.6,-.05);
  const flame=new THREE.Mesh(new THREE.ConeGeometry(.42,3.2,10,1,true),new THREE.MeshBasicMaterial({color:0xffa047,transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false}));
  flame.rotation.x=Math.PI;flame.position.set(0,-7.6,-.05);flame.userData.flightFireIgnore=true;g.add(flame);g.userData.flame=flame;
  g.userData.glow={intensity:0};/* afterburner light via the constant light pool */
  g.traverse(n=>{n.raycast=()=>{};});return g;
}

// ------------------------------------------------------------ audio: jet roar with retarded time + Doppler
function ensureAudio(){
  try{ctx=getSharedCombatAudioContext();if(!ctx)return null;if(!master){master=ctx.createGain();master.gain.value=1;const comp=ctx.createDynamicsCompressor();comp.threshold.value=-10;comp.ratio.value=4;master.connect(comp);comp.connect(ctx.destination);}
    if(!jetBuffer){const sr=ctx.sampleRate,n=Math.floor(sr*4),b=ctx.createBuffer(1,n,sr),d=b.getChannelData(0);let lp=0,lp2=0,br=0;
      for(let i=0;i<n;i++){const t=i/sr,w=Math.random()*2-1;lp+=(w-lp)*.08;lp2+=(lp-lp2)*.02;br+=(w-br)*.6;// rumble + roar + hiss
        const whine=Math.sin(2*Math.PI*1180*t+Math.sin(2*Math.PI*3*t)*2)*.05+Math.sin(2*Math.PI*2360*t)*.025;d[i]=lp2*2.4+lp*.9+(w-br)*.18+whine;}
      // loop-safe crossfade
      const f=Math.floor(sr*.05);for(let i=0;i<f;i++){const a=i/f;d[n-f+i]=d[n-f+i]*(1-a)+d[i]*a;}
      let peak=0;for(let i=0;i<n;i++)peak=Math.max(peak,Math.abs(d[i]));for(let i=0;i<n;i++)d[i]/=peak||1;jetBuffer=b;}
    return ctx;}catch{return null;}
}
function startJetVoice(jet){const c=ensureAudio();if(!c||c.state!=="running"||jet.voice)return;const src=c.createBufferSource();src.buffer=jetBuffer;src.loop=true;src.loopStart=0;src.loopEnd=jetBuffer.duration;const lp=c.createBiquadFilter();lp.type="lowpass";lp.frequency.value=1500;const g=c.createGain();g.gain.value=0;src.connect(lp);lp.connect(g);g.connect(master);src.start(0,Math.random()*3);jet.voice={src,lp,g};}
function stopJetVoice(jet){const v=jet.voice;if(!v)return;try{v.g.gain.setTargetAtTime(0,ctx.currentTime,.3);v.src.stop(ctx.currentTime+1.2);}catch{}jet.voice=null;}
const listener=new THREE.Vector3(),tmp=new THREE.Vector3(),tmp2=new THREE.Vector3();
function listenerPos(){const w=walk();if(w?.mode==="foot"&&w.position)return listener.copy(w.position);const c=bridge()?.threeCamera;return c?listener.copy(c.position):null;}
function jetPosAt(jet,t,out){const k=(t-jet.t0)/1000;return out.set(jet.x,jet.y0+SPEED*k,jet.z);}
function updateJetAudio(jet,now){
  const L=listenerPos();if(!L||!jet.voice)return;
  // retarded time: the sound we hear now left the jet when |p(te)-L| = c (now-te)
  let te=now;for(let i=0;i<4;i++){jetPosAt(jet,te,tmp);te=now-tmp.distanceTo(L)/SOUND*1000;}
  jetPosAt(jet,te,tmp);const d=Math.max(8,tmp.distanceTo(L)),dir=tmp2.copy(L).sub(tmp).normalize(),vr=SPEED*dir.y,doppler=Math.max(.45,Math.min(2.6,SOUND/(SOUND-vr)));
  const started=te>=jet.t0-1500,gain=started?Math.min(1.8,(85/d)**1.35)*.9:0,t=ctx.currentTime;
  jet.voice.g.gain.setTargetAtTime(gain,t,.05);jet.voice.src.playbackRate.setTargetAtTime(doppler*(.92+jet.pitch*.16),t,.05);jet.voice.lp.frequency.setTargetAtTime(Math.min(9000,900+60000/d),t,.06);
  jet.heardD=d;
}

// ------------------------------------------------------------ flights
function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&root?.parent===scene)return true;root?.parent?.remove(root);sceneRef=scene;root=new THREE.Group();root.name="FIGHTER_JETS";scene.add(root);jets=[];bombs=[];return true;}
// A pair heading north over (cx,cy); strike = drop bombs on target
function launch(cx,cy,{strike=null,offset=0,alt=null,at=performance.now(),remote=false}={}){
  if(!ensureScene())return null;const ground=groundHeightAt(cx,cy),z=ground+(alt??(ALT_MIN+Math.random()*(ALT_MAX-ALT_MIN)));const id=`jet-${(++serial).toString(36)}`;const out=[];
  for(const[k,dx,dy]of[[0,0,0],[1,-26,-42]]){const m=jetModel();root.add(m);const jet={id:`${id}-${k}`,model:m,x:cx+offset+dx,y0:cy-SPAN+dy,z:z+k*6,t0:at,born:at,strike:k===0?strike:null,dropped:0,pitch:Math.random(),remote};m.position.set(jet.x,jet.y0,jet.z);jets.push(jet);out.push(jet);}
  return out;
}
function bomb(from,target,now){const b=new THREE.Mesh(new THREE.CapsuleGeometry(.22,1.1,3,8),new THREE.MeshStandardMaterial({color:0x3b4135,roughness:.6,metalness:.3}));b.rotation.x=Math.PI/2;b.userData.flightFireIgnore=true;b.raycast=()=>{};root.add(b);bombs.push({mesh:b,from:from.clone(),to:target.clone(),t0:now,dur:1500+Math.random()*250});}
function updateJets(now,dt){
  for(let i=jets.length-1;i>=0;i--){const j=jets[i];jetPosAt(j,now,tmp);j.model.position.copy(tmp);j.model.rotation.set(0,0,0);
    const fl=j.model.userData.flame;fl.scale.set(1,.8+Math.random()*.5,1);fl.material.opacity=.6+Math.random()*.35;requestLight(tmp,{color:0xff8a3a,intensity:6+Math.random()*4,distance:40});
    if(!j.voice)startJetVoice(j);updateJetAudio(j,now);
    // close pass: camera trauma + wake on the drone
    const L=listenerPos();if(L){const d=tmp.distanceTo(L);if(d<160&&!j.shook&&j.heardD<170){j.shook=true;addTrauma?.(Math.min(.85,.35+60/d));}}
    // strike run: drop a stick of 4 across the target
    if(j.strike&&j.dropped<4){const s=j.strike,ahead=s.y-tmp.y;if(ahead<380){for(let k=j.dropped;k<4;k++){const tgt=new THREE.Vector3(s.x+(Math.random()-.5)*6,s.y+(k-1.5)*16,0);tgt.z=groundHeightAt(tgt.x,tgt.y);bomb(tmp.clone().add(new THREE.Vector3(0,-2,-1.2)),tgt,now+k*110);}j.dropped=4;}}
    if(tmp.y>j.y0+2*SPAN){stopJetVoice(j);j.model.parent?.remove(j.model);jets.splice(i,1);}
  }
  for(let i=bombs.length-1;i>=0;i--){const b=bombs[i];const t=(now-b.t0)/b.dur;if(t<0){b.mesh.visible=false;continue;}b.mesh.visible=true;
    const u=Math.min(1,t),p=tmp.copy(b.from).lerp(b.to,u);p.z=b.from.z+(b.to.z-b.from.z)*u*u;b.mesh.position.copy(p);tmp2.copy(b.to).sub(b.from);tmp2.z=(b.to.z-b.from.z)*2*u;b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),tmp2.normalize().negate());
    if(t>=1){b.mesh.parent?.remove(b.mesh);bombs.splice(i,1);explode(b.to,now);}}
}
// ------------------------------------------------------------ blasts
function explode(p,now){
  const blast={group:new THREE.Group(),born:now};const core=new THREE.Mesh(new THREE.SphereGeometry(1,16,12),new THREE.MeshBasicMaterial({color:0xffc070,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false}));
  const smoke=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),new THREE.MeshStandardMaterial({color:0x2c2724,roughness:1,transparent:true,opacity:.85,depthWrite:false}));const light={intensity:40};
  blast.group.add(core,smoke);blast.core=core;blast.smoke=smoke;blast.light=light;blast.group.position.copy(p);blast.group.traverse(n=>{n.userData.flightFireIgnore=true;n.raycast=()=>{};});root.add(blast.group);blasts.push(blast);
  window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[p.x,p.y,p.z+.4],radiusM:BOMB_RADIUS,maxDamage:BOMB_DAMAGE,kind:"airstrike",id:`airstrike-${now}`}}));
  try{const c=ensureAudio(),L=listenerPos(),d=L?L.distanceTo(p):100;if(c)setTimeout(()=>playCombatAudio(c,"explosion",{destination:master,gain:Math.min(1.6,40/(10+d)),playbackRate:.7+Math.random()*.15}),d/SOUND*1000);}catch{}
}
function updateBlasts(now){for(let i=blasts.length-1;i>=0;i--){const b=blasts[i],t=(now-b.born)/1000;if(t>6){b.group.parent?.remove(b.group);blasts.splice(i,1);continue;}
  const e=1-Math.exp(-t*7);b.core.scale.setScalar(2+11*e);b.core.material.opacity=Math.max(0,1-t*1.6);b.light.intensity=Math.max(0,40*(1-t*2));if(b.light.intensity>0)requestLight(b.group.position,{color:0xffa050,intensity:b.light.intensity,distance:90});
  b.smoke.scale.setScalar(3+12*Math.min(1,t*.8));b.smoke.position.z=t*2.2;b.smoke.material.opacity=.85*Math.max(0,1-t/6);}}

// ------------------------------------------------------------ air strike (player power)
const ray=new THREE.Raycaster();
function aimPoint(){
  const b=bridge(),cam=b?.threeCamera;if(!cam)return null;const o=cam.getWorldPosition(new THREE.Vector3()),d=cam.getWorldDirection(new THREE.Vector3());ray.set(o,d);ray.far=1500;
  let best=null;const solids=[];b.threeScene.traverse(n=>{if(n.isMesh&&n.name==="WORLD_CITY_CHUNK"&&n.visible)solids.push(n);});const h=ray.intersectObjects(solids,false)[0];if(h)best=h.point.clone();
  const tr=terrainRayDistance?.(o,d,1500);if(Number.isFinite(tr)&&(!best||tr<o.distanceTo(best)))best=o.clone().addScaledVector(d,tr);
  if(!best)best=o.clone().addScaledVector(d,180);best.z=groundHeightAt(best.x,best.y);return best;
}
function flare(p,now){const m=new THREE.Mesh(new THREE.SphereGeometry(.35,10,8),new THREE.MeshBasicMaterial({color:0xff2a1a}));const smoke=new THREE.Mesh(new THREE.CylinderGeometry(.6,2.4,26,10,1,true),new THREE.MeshBasicMaterial({color:0xff3a2a,transparent:true,opacity:.35,depthWrite:false,blending:THREE.AdditiveBlending}));smoke.rotation.x=Math.PI/2;smoke.position.z=13;const l={intensity:8};const g=new THREE.Group();g.add(m,smoke);g.position.copy(p);g.traverse(n=>{n.userData.flightFireIgnore=true;n.raycast=()=>{};});root.add(g);flares.push({g,until:now+9000,l});}
function updateFlares(now){for(let i=flares.length-1;i>=0;i--){const f=flares[i];if(now>f.until){f.g.parent?.remove(f.g);flares.splice(i,1);continue;}f.l.intensity=6+Math.sin(now*.05)*3;requestLight(f.g.position,{color:0xff2a1a,intensity:f.l.intensity,distance:30});}}
export function callAirStrike(target=null){
  const now=performance.now();if(now-lastStrike<STRIKE_COOLDOWN_MS||!ensureScene())return false;const p=target||aimPoint();if(!p)return false;lastStrike=now;
  flare(p,now);const arrive=now+3500;launch(p.x,p.y,{strike:{x:p.x,y:p.y},offset:0,alt:70,at:arrive-SPAN/SPEED*1000+380/SPEED*1000});
  sendFx({kind:"strike",p:canon(p.x,p.y),t:Date.now()});renderButton();return true;
}

// ------------------------------------------------------------ multiplayer
function session(){return bridge()?.vsSession||null;}
function localOffset(){const b=bridge(),o=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(o)&&o.length===2?[Number(o[0])||0,Number(o[1])||0]:[0,0];}
const canon=(x,y)=>{const o=localOffset();return[+(x+o[0]).toFixed(2),+(y+o[1]).toFixed(2),0];};
const local=(x,y)=>{const o=localOffset();return[x-o[0],y-o[1]];};
function sendFx(extra){const s=session();if(!s?.sendFx)return;try{s.sendFx({type:"impact",objectId:"fighter-jets",id:`jets-${Date.now().toString(36)}-${serial}`,...extra});}catch{}}
function onFx(e){const pk=e?.detail?.packet;if(pk?.objectId!=="fighter-jets"||!Array.isArray(pk.p))return;const[x,y]=local(+pk.p[0]||0,+pk.p[1]||0);const now=performance.now();
  if(pk.kind==="strike"){const p=new THREE.Vector3(x,y,groundHeightAt(x,y));ensureScene();flare(p,now);launch(x,y,{strike:{x,y},alt:70,at:now+3500-SPAN/SPEED*1000+380/SPEED*1000,remote:true});}
  else if(pk.kind==="flyover")launch(x,y,{offset:+pk.o||0,alt:+pk.a||70,remote:true});}

// ------------------------------------------------------------ UI
function mountButton(){
  const view=viewport();if(!view||document.getElementById("airStrikeButton"))return;const b=document.createElement("button");b.id="airStrikeButton";b.type="button";b.setAttribute("aria-label","Call air strike on the aimed spot");b.innerHTML="<span>✈</span><small>STRIKE</small>";
  b.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();callAirStrike();});view.appendChild(b);
  const st=document.createElement("style");st.dataset.airStrike="v1";st.textContent=`#airStrikeButton{position:absolute;z-index:22;left:calc(max(12px,var(--solo-safe-left,env(safe-area-inset-left))) + min(25vw,148px)*.5 - 29px);bottom:calc(max(16px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + min(25vw,148px) + 18px);width:58px;height:58px;border-radius:50%;border:2px solid #ffffffbb;background:#0d1118b8;color:#fff;font:800 10px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;touch-action:none;pointer-events:auto;overflow:hidden}#airStrikeButton span{font-size:20px;line-height:1}#airStrikeButton[data-ready="0"]{opacity:.55}#airStrikeButton::after{content:"";position:absolute;left:0;bottom:0;height:3px;width:var(--cool,100%);background:#ff7a1a}body.player-driving #airStrikeButton{display:none}`;document.head.appendChild(st);
  addEventListener("keydown",e=>{if(e.code==="KeyJ"&&!e.repeat&&!e.metaKey&&!e.ctrlKey){callAirStrike();e.preventDefault();}});
}
function renderButton(now=performance.now()){const b=document.getElementById("airStrikeButton");if(!b)return;const k=Math.min(1,(now-lastStrike)/STRIKE_COOLDOWN_MS);const r=k>=1?"1":"0";if(b.dataset.ready!==r)b.dataset.ready=r;b.style.setProperty("--cool",`${Math.round(k*100)}%`);}

// ------------------------------------------------------------ loop
let lastUi=0;
function frame(now=performance.now()){
  requestAnimationFrame(frame);const dt=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;if(!bridge()?.active&&!bridge()?.threeScene)return;if(!ensureScene())return;
  if(now-lastUi>200){lastUi=now;mountButton();renderButton(now);}
  if(now>nextAmbient){nextAmbient=now+(AMBIENT_MIN_S+Math.random()*(AMBIENT_MAX_S-AMBIENT_MIN_S))*1000;const L=listenerPos();if(L){const off=(Math.random()-.5)*160,alt=ALT_MIN+Math.random()*(ALT_MAX-ALT_MIN);launch(L.x,L.y,{offset:off,alt});sendFx({kind:"flyover",p:canon(L.x,L.y),o:+off.toFixed(1),a:+alt.toFixed(1)});}}
  if(jets.length||bombs.length)updateJets(now,dt);if(blasts.length)updateBlasts(now);if(flares.length)updateFlares(now);
  const v=viewport();if(v)v.dataset.fighterJets=`${jets.length}j/${bombs.length}b`;
}
export function installFighterJets(){if(globalThis.__fighterJets||typeof window==="undefined")return globalThis.__fighterJets;(globalThis.__prewarmFactories??=[]).push(()=>{const g=jetModel();const b=new THREE.Mesh(new THREE.CapsuleGeometry(.22,1.1,3,8),new THREE.MeshStandardMaterial({color:0x3b4135,roughness:.6,metalness:.3}));g.add(b);g.add(new THREE.Mesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshBasicMaterial({color:0xffc070,transparent:true,opacity:1,blending:THREE.AdditiveBlending,depthWrite:false})),new THREE.Mesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshStandardMaterial({color:0x2c2724,roughness:1,transparent:true,opacity:.85,depthWrite:false})),new THREE.Mesh(new THREE.CylinderGeometry(.6,2.4,4,8,1,true),new THREE.MeshBasicMaterial({color:0xff3a2a,transparent:true,opacity:.35,depthWrite:false,blending:THREE.AdditiveBlending})));return g;});addEventListener(VS_FX_EVENT,onFx);addEventListener("pointerdown",()=>ensureAudio(),{capture:true,passive:true});
  globalThis.__fighterJets={flyover(){const L=listenerPos();return L?launch(L.x,L.y,{offset:(Math.random()-.5)*100}):null;},strike:callAirStrike,get jets(){return jets;},version:FIGHTER_JETS_VERSION};requestAnimationFrame(frame);return globalThis.__fighterJets;}
installFighterJets();
