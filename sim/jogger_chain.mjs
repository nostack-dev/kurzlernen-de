// The running club. Every few minutes a line of joggers in matching neon shirts comes along a
// street near you, single file, chanting their own call-and-response cadence (original lines,
// spoken by the leader, the group answers) to a clap-and-stomp beat. Run the line over with a car
// (or take them out otherwise) and every jogger counts up a streak: get the whole line and the
// screen calls out "KOMPLETTE LAUFGRUPPE!" with a jingle. They run along the real road network
// (the sidewalk of a real street), turn round at its ends and jog off after a minute and a half.
import * as THREE from "three";
import {createCrowd} from "./crowd_characters.mjs";
import {staticGroundHeightAt} from "./terrain_craters.mjs";
import {spawnWorldPersonRagdoll} from "./world_person_ragdoll.mjs";
import {worldOption,WORLD_OPTIONS_EVENT} from "./world_options.mjs";

export const JOGGER_CHAIN_VERSION="running-club-v1";
const N=10,GAP_M=1.35,SPEED=3.1,LIFE_MS=95000,FIRST_MS=60000,EVERY_MS=[170000,280000],STREAK_WINDOW_MS=12000;
const SHIRT=0xd8ff3a,SHORTS=0x1c2a3a,SHOES=0xf4f4f0;
const CALLS=[["Wer läuft mit?","Wir laufen mit!"],["Links, rechts, links!","Wir sind nicht zu bremsen!"],["Eins, zwei, drei, vier!","Die Straße gehört uns hier!"],["Wie weit noch?","Bis zum See und weiter!"],["Was wollen wir?","Kilometer!"],["Schneller?","Immer schneller!"]];
let installed=false,scene=null,crowd=null,chain=null,nextAt=0,lastFrame=performance.now(),streak={n:0,at:0,chainId:0},banner=null,bannerTimer=0,chainSerial=0;
const bridge=()=>globalThis.__arondightRealWorld||null;
const viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function cam(){const b=bridge();return b?.presentedCamera?.()||b?.threeCamera||null;}
function playerPos(){const W=globalThis.__arondightWalkMode,D=globalThis.__arondightVehicleDrive;if(D?.active&&D.pose?.position)return{x:D.pose.position[0],y:D.pose.position[1]};if(W?.position)return{x:W.position.x,y:W.position.y};const c=cam();return c?{x:c.position.x,y:c.position.y}:null;}
function inWorld(){const W=globalThis.__arondightWalkMode;return Boolean(bridge()?.active!==false&&(W?.mode==="foot"||globalThis.__arondightVehicleDrive?.active))&&!globalThis.__arondightGpsLive;}
function ensureCrowd(){const s=bridge()?.threeScene;if(!s)return null;if(crowd&&scene===s)return crowd;crowd?.dispose?.();scene=s;crowd=createCrowd(s,{capacity:N,name:"JOGGER_CHAIN"});for(let i=0;i<N;i++)crowd.setColors(i,{shirt:SHIRT,vest:SHIRT,pants:SHORTS,boots:SHOES,skin:[0xe0b08c,0xc48e6c,0xa87052,0x7b4a33,0xd2a27e][i%5],gloves:[0xe0b08c,0xc48e6c,0xa87052,0x7b4a33,0xd2a27e][i%5],helmet:[0x2a211b,0x4a3324,0x6b5a3e,0x1a1614][i%4],dark:0x16181a});return crowd;}
// ---------------------------------------------------------------- the route: one real street's sidewalk
function buildPath(road,side){const pts=road.pts,off=(Number(road.w)||6)/2+1.7,out=[];for(let i=0;i<pts.length;i++){const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];let dx=b[0]-a[0],dy=b[1]-a[1];const l=Math.hypot(dx,dy)||1;dx/=l;dy/=l;out.push([pts[i][0]-dy*off*side,pts[i][1]+dx*off*side]);}
  const cum=[0];for(let i=1;i<out.length;i++)cum.push(cum[i-1]+Math.hypot(out[i][0]-out[i-1][0],out[i][1]-out[i-1][1]));return{pts:out,cum,len:cum.at(-1)};}
function sample(path,s){const L=path.len;let u=((s%(2*L))+2*L)%(2*L),dir=1;if(u>L){u=2*L-u;dir=-1;}/* run to the end, turn round, run back */let i=1;while(i<path.cum.length-1&&path.cum[i]<u)i++;const a=path.pts[i-1],b=path.pts[i],seg=(path.cum[i]-path.cum[i-1])||1,t=clamp((u-path.cum[i-1])/seg,0,1);return{x:a[0]+(b[0]-a[0])*t,y:a[1]+(b[1]-a[1])*t,yaw:Math.atan2((b[1]-a[1])*dir,(b[0]-a[0])*dir)};}
function pickRoad(p){const roads=globalThis.__streetLamps?.roads?.();if(!Array.isArray(roads)||!roads.length)return null;const cand=[];
  for(const r of roads){if(!r?.pts||r.pts.length<2||/motorway|trunk|path|track/.test(String(r.cls||"")))continue;let len=0,near=Infinity;for(let i=1;i<r.pts.length;i++)len+=Math.hypot(r.pts[i][0]-r.pts[i-1][0],r.pts[i][1]-r.pts[i-1][1]);if(len<60)continue;for(const q of r.pts)near=Math.min(near,Math.hypot(q[0]-p.x,q[1]-p.y));if(near<35||near>150)continue;cand.push({r,score:Math.min(len,260)-near*.6+Math.random()*40});}
  cand.sort((a,b)=>b.score-a.score);return cand[0]?.r||null;}
function spawn(now){const p=playerPos();if(!p||!ensureCrowd())return false;const road=pickRoad(p);if(!road)return false;const path=buildPath(road,Math.random()<.5?1:-1);if(path.len<50)return false;
  // start at the end of the street that is further from the player (they come towards you)
  const a=path.pts[0],b=path.pts.at(-1),startS=Math.hypot(a[0]-p.x,a[1]-p.y)>Math.hypot(b[0]-p.x,b[1]-p.y)?(N*GAP_M):(path.len+N*GAP_M);const g=globalThis.__spawnVisibilityGuard;const head=sample(path,startS);if(g?.canSpawnAt&&!g.canSpawnAt(head.x,head.y,staticGroundHeightAt(head.x,head.y)+1))return false;
  chain={id:++chainSerial,path,s:startS,born:now,runners:Array.from({length:N},(_,i)=>({i,alive:true,x:head.x,y:head.y,z:0,yaw:head.yaw,phase:Math.random()})),nextCallAt:now+1500,callIdx:Math.floor(Math.random()*CALLS.length),beat:0,nextBeatAt:now};
  const v=viewport();if(v){v.dataset.joggerChain=`spawned-${chain.id}`;v.dataset.joggerChainLen=path.len.toFixed(0);}return true;}
function despawn(){chain=null;const v=viewport();if(v)v.dataset.joggerChain="gone";}
// ---------------------------------------------------------------- chant & beat
function speak(text,{pitch=1,rate=1.05,vol=1}={}){try{const ss=globalThis.speechSynthesis;if(!ss||vol<.05)return;const u=new SpeechSynthesisUtterance(text);u.lang="de-DE";u.pitch=pitch;u.rate=rate;u.volume=clamp(vol,0,1);const voice=ss.getVoices?.().find(v=>/^de/i.test(v.lang));if(voice)u.voice=voice;ss.speak(u);}catch{}}
function distGain(x,y,ref=26){const c=cam();if(!c)return 0;const d=Math.hypot(x-c.position.x,y-c.position.y);return clamp(1-d/ref/3,0,1);}
function stomp(x,y,accent){const a=globalThis.__sharedAudioContext;if(!a||a.state!=="running")return;const g0=distGain(x,y)*(accent?.55:.32);if(g0<.02)return;try{const t=a.currentTime,o=a.createOscillator(),g=a.createGain();o.type="sine";o.frequency.setValueAtTime(accent?92:78,t);o.frequency.exponentialRampToValueAtTime(42,t+.12);g.gain.setValueAtTime(g0,t);g.gain.exponentialRampToValueAtTime(.001,t+.16);o.connect(g).connect(a.destination);o.start(t);o.stop(t+.18);
  if(accent){const n=a.createBuffer(1,a.sampleRate*.06,a.sampleRate),ch=n.getChannelData(0);for(let i=0;i<ch.length;i++)ch[i]=(Math.random()*2-1)*(1-i/ch.length)**2;const s=a.createBufferSource(),bp=a.createBiquadFilter(),cg=a.createGain();bp.type="bandpass";bp.frequency.value=1800;bp.Q.value=.9;cg.gain.value=g0*.9;s.buffer=n;s.connect(bp).connect(cg).connect(a.destination);s.start(t+.01);}}catch{}}
function chant(now){if(!chain)return;const lead=chain.runners.find(r=>r.alive);if(!lead)return;const vol=distGain(lead.x,lead.y,22);
  if(now>=chain.nextBeatAt){chain.nextBeatAt=now+400;chain.beat++;stomp(lead.x,lead.y,chain.beat%2===0);}
  if(now>=chain.nextCallAt){const[call,answer]=CALLS[chain.callIdx++%CALLS.length];chain.nextCallAt=now+6400;if(vol>.06){speak(call,{pitch:.85,rate:1.08,vol});setTimeout(()=>{if(chain&&chain.runners.filter(r=>r.alive).length>1)speak(answer,{pitch:1.15,rate:1.12,vol:vol*.95});},1700);}}}
// ---------------------------------------------------------------- hits & streak
function showBanner(text,big=false){const v=viewport();if(!v)return;if(!banner?.isConnected){banner=document.createElement("div");banner.id="joggerStreakBanner";banner.style.cssText="position:absolute;left:50%;top:30%;transform:translate(-50%,-50%);z-index:32;pointer-events:none;text-align:center;font:900 italic 30px/1 'Nunito',system-ui,sans-serif;letter-spacing:.06em;color:#d8ff3a;text-shadow:0 3px 0 #2a3a06,0 0 18px #d8ff3a88;transition:opacity .4s,transform .25s;opacity:0";v.appendChild(banner);}
  banner.textContent=text;banner.style.fontSize=big?"clamp(26px,5.4vw,46px)":"clamp(20px,3.6vw,30px)";banner.style.opacity="1";banner.style.transform="translate(-50%,-50%) scale(1.12)";requestAnimationFrame(()=>{banner.style.transform="translate(-50%,-50%) scale(1)";});clearTimeout(bannerTimer);bannerTimer=setTimeout(()=>{banner.style.opacity="0";},big?2600:1300);}
function jingle(){const a=globalThis.__sharedAudioContext;if(!a||a.state!=="running")return;try{const t=a.currentTime;[523,659,784,1047,784,1047].forEach((f,i)=>{const o=a.createOscillator(),g=a.createGain();o.type=i%2?"square":"triangle";o.frequency.value=f;const s=t+i*.11;g.gain.setValueAtTime(0,s);g.gain.linearRampToValueAtTime(.12,s+.01);g.gain.exponentialRampToValueAtTime(.001,s+.22);o.connect(g).connect(a.destination);o.start(s);o.stop(s+.25);});}catch{}}
function kill(r,impulse){if(!r.alive||!chain)return;r.alive=false;spawnWorldPersonRagdoll({position:[r.x,r.y,r.z+.05],yaw:r.yaw-Math.PI/2,impulse,seed:`jogger-${chain.id}-${r.i}`,id:`jogger-${chain.id}-${r.i}`,colors:{shirt:SHIRT,vest:SHIRT,pants:SHORTS,boots:SHOES,skin:0xc48e6c,gloves:0xc48e6c,helmet:0x2a211b,dark:0x16181a}});globalThis.__arondightBlood?.([r.x,r.y,r.z+1.1]);
  const now=performance.now();if(streak.chainId!==chain.id||now-streak.at>STREAK_WINDOW_MS)streak={n:0,at:now,chainId:chain.id};streak.n++;streak.at=now;const left=chain.runners.filter(x=>x.alive).length;
  window.dispatchEvent(new CustomEvent("arondight:world-kill",{detail:{id:`jogger-${chain.id}-${r.i}`,kind:"person",network:false}}));
  if(!left){showBanner(`KOMPLETTE LAUFGRUPPE! ×${streak.n}`,true);jingle();window.dispatchEvent(new CustomEvent("arondight:jogger-streak",{detail:{count:streak.n,complete:true}}));}else if(streak.n>=2)showBanner(`JOGGER ×${streak.n}`);
  const v=viewport();if(v){v.dataset.joggerStreak=String(streak.n);v.dataset.joggerAlive=String(left);}}
function checkCar(){const D=globalThis.__arondightVehicleDrive;if(!chain||!D?.active)return;const p=D.pose;if(!p?.position)return;const v=p.velocity||[0,0,0],sp=Math.hypot(v[0],v[1]);if(sp<2.5)return;const yaw=Number(p.yaw)||Math.atan2(v[1],v[0]),c=Math.cos(yaw),s=Math.sin(yaw);
  for(const r of chain.runners){if(!r.alive)continue;const dx=r.x-p.position[0],dy=r.y-p.position[1];if(dx*dx+dy*dy>9)continue;const u=dx*c+dy*s,w=-dx*s+dy*c;if(Math.abs(u)<2.15&&Math.abs(w)<1.15)kill(r,[v[0]*.8,v[1]*.8,2.4+sp*.12]);}}
function onTracer(e){if(!chain)return;const d=e?.detail||{},a=d.start,b=d.end;if(!Array.isArray(a)||!Array.isArray(b))return;const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],L2=dx*dx+dy*dy+dz*dz;if(L2<.01)return;
  for(const r of chain.runners){if(!r.alive)continue;const cz=r.z+1.15,t=clamp(((r.x-a[0])*dx+(r.y-a[1])*dy+(cz-a[2])*dz)/L2,0,1),px=a[0]+dx*t-r.x,py=a[1]+dy*t-r.y,pz=a[2]+dz*t-cz;if(px*px+py*py<.09&&Math.abs(pz)<.75){const l=Math.sqrt(L2);kill(r,[dx/l*2.5,dy/l*2.5,1.4]);break;}}}
function onBlast(e){if(!chain)return;const p=e?.detail?.position;if(!Array.isArray(p))return;const R=Math.max(3,Number(e.detail.radiusM)||8);for(const r of chain.runners){if(!r.alive)continue;const dx=r.x-p[0],dy=r.y-p[1],d=Math.hypot(dx,dy);if(d<R*.7){const k=(1-d/R)*7/(d||1);kill(r,[dx*k,dy*k,4+3*(1-d/R)]);}}}
// ---------------------------------------------------------------- frame
function frame(now=performance.now()){requestAnimationFrame(frame);const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;
  if(!worldOption("people")||!inWorld()){if(chain)despawn();if(crowd){crowd.commit();}return;}
  if(!chain){if(!nextAt)nextAt=now+FIRST_MS;if(now>=nextAt){nextAt=now+EVERY_MS[0]+Math.random()*(EVERY_MS[1]-EVERY_MS[0]);if(!spawn(now))nextAt=now+15000;}if(crowd)crowd.commit();return;}
  const p=playerPos(),alive=chain.runners.filter(r=>r.alive);if(!alive.length||now-chain.born>LIFE_MS&&p&&Math.hypot(alive[0].x-p.x,alive[0].y-p.y)>70){despawn();crowd?.commit();return;}
  chain.s+=SPEED*dt;let k=0;for(const r of chain.runners){const q=sample(chain.path,chain.s-r.i*GAP_M);r.x=q.x;r.y=q.y;r.yaw=q.yaw;r.z=staticGroundHeightAt(q.x,q.y);if(!r.alive)continue;crowd.set(r.i,{x:r.x,y:r.y,z:r.z,yaw:r.yaw-Math.PI/2,state:"run",speed:SPEED,dt});k++;}
  crowd.commit();checkCar();chant(now);}
export function installJoggerChain(){if(installed||typeof window==="undefined")return;installed=true;addEventListener("arondight:foot-tracer",onTracer);addEventListener("arondight:world-explosion",onBlast);addEventListener("arondight:world-reset",()=>{despawn();nextAt=performance.now()+FIRST_MS;streak={n:0,at:0,chainId:0};});addEventListener(WORLD_OPTIONS_EVENT,()=>{if(!worldOption("people"))despawn();});
  requestAnimationFrame(frame);globalThis.__arondightJoggerChain={spawn:()=>spawn(performance.now()),despawn,get chain(){return chain?{id:chain.id,alive:chain.runners.filter(r=>r.alive).length,runners:chain.runners.map(r=>({x:r.x,y:r.y,alive:r.alive}))}:null;},get streak(){return streak.n;},version:JOGGER_CHAIN_VERSION};}
installJoggerChain();
