import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";
import {addTrauma} from "./camera_shake.mjs";

// People and vehicles share the street physically: a moving car / bus /
// police cruiser that reaches a pedestrian throws them as a ragdoll — every
// hit, the same articulated person — with the car's momentum. The damage
// follows the impact speed; who still has life gets up again ("reverse
// ragdoll" in world_person_ragdoll.mjs) and walks on, only a hard hit kills.
// The car feels it too (momentum exchange). Replicated: the vehicle's owner
// detects the hit and sends it, every peer throws the same person.

export const PEOPLE_IMPACTS_VERSION="vehicle-pedestrian-knockdown-v1";
const PERSON_KG=75,PAD=.32,MIN_SPEED=2.2,CHECK_MS=33;
const bridge=()=>globalThis.__arondightRealWorld||null,viewport=()=>document.getElementById("viewport");
const sources=()=>[["pop",globalThis.__arondightProceduralPopulation],["extra",globalThis.__arondightCrowdExtras]];
let last=0,serial=0;const seenFx=new Set();

function yawOf(q){return Math.atan2(2*(q[3]*q[2]+q[0]*q[1]),1-2*(q[1]*q[1]+q[2]*q[2]));}
function thump(gain){try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"bounce",{gain,playbackRate:.62,minIntervalMs:60});}catch{}}
function knock(src,id,impulse,damage){const api=sources().find(([k])=>k===src)?.[1];return api?.knockdown?.(id,{impulse,damage})||null;}

function check(){
  const R=globalThis.__arondightWorldRigidBodies;if(!R?.bodies)return;
  const vehicles=[];for(const b of R.bodies()){if(b.kind!=="car"&&b.kind!=="bus")continue;const p=R.pose(b.id);if(!p?.position||!p.velocity)continue;const sp=Math.hypot(p.velocity[0],p.velocity[1]);if(sp<MIN_SPEED)continue;vehicles.push({id:b.id,p,sp,half:b.halfExtents||[1.8,.85,.5]});}
  if(!vehicles.length)return;
  const people=[];for(const[src,api]of sources()){const list=api?.people?.();if(list)for(const person of list)people.push({...person,src});}
  if(!people.length)return;
  const drive=globalThis.__arondightVehicleDrive,mine=drive?.active?String(drive.vehicleId||""):"";
  for(const v of vehicles){const[x,y]=v.p.position,yaw=yawOf(v.p.rotation||[0,0,0,1]),c=Math.cos(yaw),s=Math.sin(yaw),reach=Math.hypot(v.half[0],v.half[1])+PAD+.5,vx=v.p.velocity[0],vy=v.p.velocity[1];
    for(const person of people){if(person.hit)continue;const dx=person.x-x,dy=person.y-y;if(Math.abs(dx)>reach||Math.abs(dy)>reach)continue;const lx=dx*c+dy*s,ly=-dx*s+dy*c;
      if(Math.abs(lx)>v.half[0]+PAD||Math.abs(ly)>v.half[1]+PAD)continue;
      // only what the car drives into (not someone it is driving away from)
      if(dx*vx+dy*vy<-.5*Math.hypot(dx,dy)*v.sp)continue;
      person.hit=true;
      const side=ly>=0?1:-1,push=1.4+v.sp*.12,up=1.2+v.sp*.16,k=1.05;let ix=vx*k-s*side*push,iy=vy*k+c*side*push,iz=up;const m=Math.hypot(ix,iy,iz);if(m>15){ix*=15/m;iy*=15/m;iz*=15/m;}
      const damage=Math.min(260,Math.max(6,(v.sp-1.5)*8.5)),impulse=[+ix.toFixed(2),+iy.toFixed(2),+iz.toFixed(2)];
      const result=knock(person.src,person.id,impulse,damage);if(!result)continue;
      // momentum exchange: the car loses what it gave the person
      try{R.applyImpulse(v.id,[-vx*PERSON_KG*.55,-vy*PERSON_KG*.55,0]);}catch{}
      thump(Math.min(.9,.25+v.sp*.04));if(v.id===mine)addTrauma?.(.18);
      if(v.id===mine){try{globalThis.__arondightWantedSystem?.reportCrime?.({id:`hit-${person.id}-${Date.now().toString(36)}`,kind:result==="dead"?"person":"person-hit",position:[person.x,person.y,0]});}catch{}if(result==="dead")window.dispatchEvent(new CustomEvent("arondight:world-kill",{detail:{id:person.id,kind:"person",position:[person.x,person.y,0],network:false,vehicle:true}}));}
      send({kind:"knock",src:person.src,pid:person.id,imp:impulse,dmg:+damage.toFixed(1)});
      const view=viewport();if(view){view.dataset.peopleImpacts=String((Number(view.dataset.peopleImpacts)||0)+1);view.dataset.peopleImpactLast=`${result}@${(v.sp*3.6).toFixed(0)}kmh`;}}}
}
function send(extra){const s=bridge()?.vsSession;if(!s?.sendFx)return;const id=`pi-${Date.now().toString(36)}-${(serial++).toString(36)}`;seenFx.add(id);try{s.sendFx({type:"impact",objectId:"people-impacts",id,p:[0,0,0],...extra});}catch{}}
function onFx(e){const pk=e?.detail?.packet;if(pk?.objectId!=="people-impacts"||pk.kind!=="knock"||seenFx.has(pk.id))return;seenFx.add(pk.id);if(seenFx.size>400)seenFx.clear();if(!Array.isArray(pk.imp))return;knock(String(pk.src||"pop"),String(pk.pid||""),pk.imp.map(Number),Number(pk.dmg)||0);}

function frame(now){requestAnimationFrame(frame);if(now-last<CHECK_MS)return;last=now;try{check();}catch(error){console.warn("people impacts",error);}}
export function installPeopleImpacts(){if(globalThis.__peopleImpacts||typeof window==="undefined")return;globalThis.__peopleImpacts={version:PEOPLE_IMPACTS_VERSION,knock,broadcast(src,id,impulse,damage){send({kind:"knock",src,pid:id,imp:impulse.map(v=>+(+v).toFixed(2)),dmg:+(+damage).toFixed(1)});}};addEventListener(VS_FX_EVENT,onFx);requestAnimationFrame(frame);const v=viewport();if(v)v.dataset.peopleImpactsVersion=PEOPLE_IMPACTS_VERSION;}
installPeopleImpacts();
