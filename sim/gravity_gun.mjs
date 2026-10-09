// GRAVITY GUN — Half-Life 2 style, done with real forces on Box3D bodies.
//
//   secondary (RMB · LT · GRAB on touch): pull the body you aim at (up to 18 m) and hold it in front
//       of you; again: let go.
//   primary (LMB · RT · tap): punt — throw what you hold, or shove what is in front of you (7 m).
//
// Holding is a force, not a teleport: every physics step the gun pushes the body towards the hold
// point with a critically damped spring (ω = 12 rad/s) plus the force that carries its weight, and
// all of it is limited to what the emitter can deliver (3.5 kN). So a cone snaps into place, an oil
// drum follows a little behind, a 250 kg load barely lifts and a car just gets dragged. The punt is
// an impulse of at most 1100 N·s along the view — a 3 kg cone leaves at 25 m/s (the cap), an
// 80 kg person gets ~14 m/s at the bone it hits, a car hardly notices.
import * as THREE from "three";

export const GRAVITY_GUN_VERSION="force-limited-gravity-gun-v1";
const GRAB_RANGE_M=18,PUNT_RANGE_M=7,HOLD_GAP_M=1.25,FMAX_N=3500,OMEGA=12,PUNT_V=25,PUNT_JMAX=1100,G=9.81;
let installed=false,held=null,beam=null,beamScene=null,lastRmb=false,lastLt=false,audio=null;
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),dir=new THREE.Vector3();
const bridge=()=>globalThis.__arondightRealWorld||null;
const rigid=()=>globalThis.__arondightWorldRigidBodies||null;
const walk=()=>globalThis.__arondightWalkMode||null;
const viewport=()=>document.getElementById("viewport");
const isGravity=()=>walk()?.mode==="foot"&&!walk()?.dead&&String(globalThis.__arondightFootWeapons?.mode||"")==="gravity";
function setData(k,v){const e=viewport();if(e)e.dataset[k]=String(v);}

// the view ray as it is on screen right now
function viewRay(){const cam=bridge()?.presentedCamera?.()||bridge()?.threeCamera;if(!cam)return null;cam.updateMatrixWorld?.();const o=new THREE.Vector3(),d=new THREE.Vector3();cam.getWorldPosition(o);cam.getWorldDirection(d);return{origin:o,direction:d.normalize()};}
function bodyHit(ray,range){const R=rigid();if(!R?.raycast||!ray)return null;const h=R.raycast([ray.origin.x,ray.origin.y,ray.origin.z],[ray.direction.x,ray.direction.y,ray.direction.z],range);if(!h?.id||h.kind==="terrain")return null;const rec=R.engine?.records?.get?.(h.id);if(!rec)return null;return{...h,massKg:rec.massKg,record:rec};}

function sound(kind){try{const ctx=audio||(audio=new (globalThis.AudioContext||globalThis.webkitAudioContext)());if(ctx.state==="suspended")ctx.resume();const t=ctx.currentTime,o=ctx.createOscillator(),g=ctx.createGain();o.type=kind==="punt"?"sawtooth":"sine";o.frequency.setValueAtTime(kind==="punt"?180:kind==="grab"?320:220,t);o.frequency.exponentialRampToValueAtTime(kind==="punt"?45:kind==="grab"?640:90,t+(kind==="punt"?.18:.12));g.gain.setValueAtTime(kind==="punt"?.35:.18,t);g.gain.exponentialRampToValueAtTime(.001,t+(kind==="punt"?.25:.16));o.connect(g).connect(ctx.destination);o.start(t);o.stop(t+.3);}catch{}}

// the hold point: in front of the eye, far enough that the body's own size clears the camera
function holdPoint(out){const ray=viewRay();if(!ray||!held)return null;return out.copy(ray.origin).addScaledVector(ray.direction,HOLD_GAP_M+held.radius);}
function holdController(state,dt){if(!held)return null;const t=held.target,m=held.massKg,p=state.position,v=state.velocity,k=OMEGA*OMEGA,c=2*OMEGA;
  let fx=m*(k*(t[0]-p[0])+c*(held.targetV[0]-v[0])),fy=m*(k*(t[1]-p[1])+c*(held.targetV[1]-v[1])),fz=m*(k*(t[2]-p[2])+c*(held.targetV[2]-v[2]))+m*G*(held.gravityScale??1);
  const f=Math.hypot(fx,fy,fz);if(f>FMAX_N){const s=FMAX_N/f;fx*=s;fy*=s;fz*=s;}
  const w=state.angularVelocity,tq=-Math.min(m,60)*.8;return{force:[fx,fy,fz],torque:[w[0]*tq,w[1]*tq,w[2]*tq]};}

function grab(){const ray=viewRay(),hit=bodyHit(ray,GRAB_RANGE_M);if(!hit){sound("miss");return false;}
  const rec=hit.record,h=rec.halfExtents||[.3,.3,.3];held={id:hit.id,massKg:hit.massKg,radius:Math.min(2.5,Math.hypot(h[0],h[1],h[2])),target:[...hit.point],targetV:[0,0,0],gravityScale:rec.gravityScale??1,last:null};
  rigid()?.setController?.(hit.id,holdController);globalThis.__arondightWorldProps?.claim?.(hit.id,1e9);sound("grab");setData("gravityHeld",hit.id);setData("gravityGrabs",(Number(viewport()?.dataset.gravityGrabs)||0)+1);return true;}
function release(){if(!held)return false;const id=held.id;held=null;rigid()?.setController?.(id,null);globalThis.__arondightWorldProps?.claim?.(id);setData("gravityHeld","");sound("drop");return true;}
export function toggleGrab(){if(!isGravity())return false;return held?release():grab();}
// punt: what we hold, or the thing / person in front of us (the caller passes the screen hit)
export function punt({ray=null,hit=null}={}){if(!isGravity())return false;const r=ray||viewRay();if(!r)return false;dir.copy(r.direction).normalize();
  if(held){const id=held.id,m=held.massKg;release();const J=Math.min(m*PUNT_V,PUNT_JMAX);rigid()?.applyImpulse?.(id,[dir.x*J,dir.y*J,dir.z*J]);globalThis.__arondightWorldProps?.claim?.(id);flash();sound("punt");setData("gravityPunts",(Number(viewport()?.dataset.gravityPunts)||0)+1);return true;}
  const body=bodyHit(r,PUNT_RANGE_M);
  if(body&&(!hit||Number(hit.distance??Infinity)>=body.distanceM-.05)){const J=Math.min(body.massKg*PUNT_V,PUNT_JMAX);rigid()?.applyImpulse?.(body.id,[dir.x*J,dir.y*J,dir.z*J],{point:body.point});globalThis.__arondightWorldProps?.claim?.(body.id);flash();sound("punt");setData("gravityPunts",(Number(viewport()?.dataset.gravityPunts)||0)+1);return true;}
  // a person: the full punt goes into them (ragdoll, at the struck bone)
  const u=hit?.object?.userData||{},pid=String(u.worldPopulationId||u.worldProceduralId||""),kind=String(u.worldPopulationKind||"");
  if(hit?.point&&Number(hit.distance)<=PUNT_RANGE_M&&kind==="person"&&pid){const J=PUNT_JMAX,pt=[hit.point.x,hit.point.y,hit.point.z];globalThis.__arondightProceduralPopulation?.knockdown?.(pid,{impulse:[dir.x*J/80,dir.y*J/80,Math.max(.5,dir.z*J/80+1)],damage:35});queueMicrotask(()=>rigid()?.impulseHumanAt?.(pt,[dir.x*J*.3,dir.y*J*.3,dir.z*J*.3]));flash();sound("punt");return true;}
  // a lying ragdoll
  if(hit?.point&&Number(hit.distance)<=PUNT_RANGE_M&&rigid()?.impulseHumanAt?.([hit.point.x,hit.point.y,hit.point.z],[dir.x*PUNT_JMAX*.3,dir.y*PUNT_JMAX*.3,dir.z*PUNT_JMAX*.3],1.2)){flash();sound("punt");return true;}
  sound("miss");flash(.4);return true;}

// ---- visuals: the beam to what we hold, claws, punt flash
let flashUntil=0,flashK=1;function flash(k=1){flashUntil=performance.now()+120;flashK=k;}
function ensureBeam(scene){if(beam&&beamScene===scene)return beam;beamScene=scene;const g=new THREE.CylinderGeometry(.018,.05,1,8,1,true);g.translate(0,.5,0);beam=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0xffa640,transparent:true,opacity:.5,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));beam.frustumCulled=false;beam.visible=false;beam.renderOrder=9997;beam.userData.flightFireIgnore=true;beam.userData.walkWeaponPart=true;scene.add(beam);return beam;}
const up=new THREE.Vector3(0,1,0);
function visuals(now){const b=bridge(),scene=b?.threeScene;if(!scene)return;const gun=scene.getObjectByName?.("WALK_GRAVITY_3D");const claws=gun?.getObjectByName?.("WALK_GRAVITY_CLAWS"),core=gun?.getObjectByName?.("WALK_GRAVITY_CORE");
  if(claws){const open=held?.55:flashUntil>now?.4:0;for(const arm of claws.children){const prong=arm.children[0];if(prong){const want=arm.userData.clawBase-open;prong.rotation.x+=(want-prong.rotation.x)*.35;}}claws.rotation.z+=held?.08:.01;}
  if(core)core.scale.setScalar(1+(held?.35+.15*Math.sin(now/60):0)+(flashUntil>now?.9*flashK:0));
  const bm=ensureBeam(scene);const pose=held?rigid()?.pose?.(held.id):null,muzzle=gun?.getObjectByName?.("WALK_GRAVITY_MUZZLE_NODE");
  if(held&&pose&&muzzle&&gun.visible!==false){muzzle.getWorldPosition(tmp);tmp2.set(...pose.position);const L=tmp.distanceTo(tmp2);bm.position.copy(tmp);bm.quaternion.setFromUnitVectors(up,tmp2.sub(tmp).normalize());bm.scale.set(1,L,1);bm.material.opacity=.32+.18*Math.sin(now/45);bm.visible=true;}else bm.visible=false;}

function frame(now){requestAnimationFrame(frame);try{
  if(held&&!isGravity())release();
  if(held){const p=holdPoint(tmp);if(p){const t=[p.x,p.y,p.z];if(held.last){const dt=Math.max(.008,(now-held.lastAt)/1000);held.targetV=[(t[0]-held.last[0])/dt,(t[1]-held.last[1])/dt,(t[2]-held.last[2])/dt].map(v=>Math.max(-20,Math.min(20,v)));}held.last=t;held.lastAt=now;held.target=t;}
    const pose=rigid()?.pose?.(held.id);if(!pose)release();else if(Math.hypot(pose.position[0]-tmp.x,pose.position[1]-tmp.y,pose.position[2]-tmp.z)>GRAB_RANGE_M+6)release();}
  // secondary: RMB (desktop, pointer locked) or LT (pad), edge-triggered
  if(isGravity()){const d=globalThis.__arondightDesktopInput,rmb=Boolean(d?.active&&d.locked&&d.rmb);if(rmb&&!lastRmb)toggleGrab();lastRmb=rmb;
    let lt=false;if(!globalThis.__arondightPadBlocked?.())for(const p of navigator.getGamepads?.()||[]){if(p?.connected&&p.mapping==="standard"){const b=p.buttons?.[6];lt=Number(typeof b==="number"?b:b?.value)>.5;break;}}if(lt&&!lastLt)toggleGrab();lastLt=lt;}
  else{lastRmb=false;lastLt=false;}
  visuals(now);}catch(error){console.warn("gravity gun",error);}}
export function installGravityGun(){if(installed||typeof window==="undefined")return;installed=true;requestAnimationFrame(frame);
  globalThis.__arondightGravityGun={version:GRAVITY_GUN_VERSION,punt,toggleGrab,release,get heldId(){return held?.id||"";},get holding(){return Boolean(held);}};}
installGravityGun();
