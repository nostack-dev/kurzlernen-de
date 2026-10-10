import * as THREE from "three";
import {jetModel,jetEngineAudio} from "./fighter_jets.mjs";
import {groundHeightAt,terrainRayDistance} from "./terrain_craters.mjs";
import {wantedPointInRing} from "./wanted_system_logic.mjs";
import {addTrauma} from "./camera_shake.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";
import {claimSticks,releaseSticks,sticks} from "./shared_sticks.mjs";
import {buildCharacter} from "./character_model.mjs";
import {JET_SPEC,createAirframe,airframeStep,setFlightMode} from "./jet_flight_dynamics.mjs";
import {WORLD_PHYSICS_CATEGORIES} from "./world_rigid_body_physics.mjs";
import {startWorldCriticalDamage,stopWorldCriticalDamage} from "./world_critical_damage_fx.mjs";
import {setText} from "./dom_mutation_filter.mjs";

// JET — a VTOL fighter (Harrier / F-35B style) that stands next to you at the start.
//
// Every jet — parked, flown, ejected from, wrecked — is ONE Box3D rigid body
// (fuselage + wing hulls, real mass and inertia). jet_flight_dynamics.mjs
// computes the aerodynamic, engine, reaction-control and landing-gear forces
// inside every physics step from the body's live state; Box3D integrates and
// resolves every contact. Nothing ever writes the jet's pose.
//   * walk up to it, EINSTEIGEN: jet-borne (hover) — left stick up/down =
//     vertical speed, left x = yaw, right stick = where to go (the flight
//     computer tilts the jet: translational-rate command); FLUG: the nozzles
//     swing aft, wing-borne: left stick = throttle lever (reheat above 86 %),
//     right stick = roll / pitch rate (g- and AoA-limited, flight path held
//     when released). SCHWEBEN at speed: airbrake + nozzle braking stop.
//   * desktop: W/S lift/throttle, A/D yaw, mouse = pitch/roll, LMB/Space gun,
//     R rocket, B bomb, V hover/flight, C camera, E exit / eject.
//   * damage: hull HP from bullets (any weapon, Box3D or scene ray), blasts
//     (grenades, missiles, rockets, bombs, cars — distance to the airframe),
//     collisions (Box3D contact approach speed) and hard landings (gear sink
//     rate). Low HP: the engine loses thrust; burning: it blows up. Destroyed:
//     a wreck that burns out; the pilot dies unless ejected.
//   * EJECT: the seat fires, chute opens; the empty jet flies on unpowered and
//     comes down under physics. Landed: AUSSTEIGEN, the jet stays parked.
//   * multiplayer: the pilot's pose carries the flying jet; every jet a
//     player owns (parked / ejected / wreck) rides along in the pose; hits on
//     another player's jet are sent to its owner, who applies them.
export const JET_MODE_VERSION="vtol-jet-mode-v4-6dof-aero-damage";
const G=9.81,REBASE_M=6000,SOUND=340,ENTER_M=9,HP_MAX=400,DEBRIS_MS=45000,PAD_RESPAWN_MS=75000,PAD_RADIUS_M=30,MAX_AIRFRAMES=4;
const bridge=()=>globalThis.__arondightRealWorld||null,viewport=()=>document.getElementById("viewport"),walk=()=>globalThis.__arondightWalkMode||null,physics=()=>globalThis.__arondightWorldRigidBodies||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let active=false,jet=null,root=null,sceneRef=null,camMode="cockpit",keys=new Set(),firing=false,lastGun=0,lastFrame=performance.now(),camOff=new THREE.Vector3(),camInit=false,voice=null,serial=0,machWas=0,coneUntil=0,para=null,baseFar=0,spawnPad=null,firstSeen=0,respawnAt=0,airSerial=0;
const bombs=[],remote=new Map(),peerAir=new Map(),airframes=new Map(),debris=[],mouseStick={x:0,y:0};let padEmptySince=0,debrisSerial=0;
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),fwd=new THREE.Vector3(),upv=new THREE.Vector3(),rightv=new THREE.Vector3(),qd=new THREE.Quaternion(),X=new THREE.Vector3(1,0,0),Y=new THREE.Vector3(0,1,0),Z=new THREE.Vector3(0,0,1);

// ------------------------------------------------------------ world helpers
function prisms(){return bridge()?.buildingCollisionSnapshot?.prisms||[];}
function hitsBuilding(p,pad=0){for(const pr of prisms()){const pts=pr.points;if(!pts||pts.length<3)continue;if(Math.abs(p.x-pts[0][0])>160||Math.abs(p.y-pts[0][1])>160)continue;
  const inside=wantedPointInRing(p.x,p.y,pts)||(pad>0&&(wantedPointInRing(p.x+pad,p.y,pts)||wantedPointInRing(p.x-pad,p.y,pts)||wantedPointInRing(p.x,p.y+pad,pts)||wantedPointInRing(p.x,p.y-pad,pts)));
  if(inside){const base=groundHeightAt(pts[0][0],pts[0][1]);if(p.z<base+(Number(pr.top)||8)&&p.z>base+(Number(pr.base)||0)-1)return true;}}return false;}
const machOf=s=>s/SOUND;
const EARTH=6378137;
function metersToLngLat(lon0,lat0,e,n){return[lon0+e/(EARTH*Math.max(.01,Math.cos(lat0*Math.PI/180)))*180/Math.PI,lat0+n/EARTH*180/Math.PI];}
function lngLatToLocal(lon,lat){const b=bridge();if(!b?.active||!Number.isFinite(b.originLon))return null;return[(lon-b.originLon)*Math.PI/180*EARTH*Math.max(.01,Math.cos(b.originLat*Math.PI/180)),(lat-b.originLat)*Math.PI/180*EARTH];}
const headingOf=q=>{tmp2.copy(Y).applyQuaternion(q);return Math.atan2(-tmp2.x,tmp2.y);};
const yawQuat=h=>new THREE.Quaternion().setFromAxisAngle(Z,h);
const walkYawOf=h=>Math.atan2(-Math.sin(h),Math.cos(h));// heading (CCW from +y) → walk yaw (forward = sin/cos)
function geoOf(x,y){const b=bridge();return b?.active&&Number.isFinite(b.originLon)?metersToLngLat(b.originLon,b.originLat,x,y):null;}
function sfx(name,opts){try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,name,opts);}catch{}}

// ------------------------------------------------------------ scene / models
function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&root?.parent===scene)return true;root?.parent?.remove(root);sceneRef=scene;root=new THREE.Group();root.name="PLAYER_JETS";scene.add(root);chute=null;for(const A of airframes.values())root.add(A.model);for(const r of peerAir.values())root.add(r.model);return true;}
function withGear(g){const gear=new THREE.Group();gear.name="GEAR";const m=new THREE.MeshStandardMaterial({color:0x22262b,roughness:.6,metalness:.4}),legG=new THREE.CylinderGeometry(.07,.07,1.3,6),wheelG=new THREE.CylinderGeometry(.28,.28,.2,10);
  for(const[x,y]of[[0,5.2],[1.9,-1.4],[-1.9,-1.4]]){const leg=new THREE.Mesh(legG,m);leg.rotation.x=Math.PI/2;leg.position.set(x,y,-1.35);const w=new THREE.Mesh(wheelG,m);w.rotation.z=Math.PI/2;w.position.set(x,y,-JET_SPEC.gearHeight+.28);gear.add(leg,w);}
  gear.traverse(n=>{n.userData.flightFireIgnore=true;n.castShadow=true;n.raycast=()=>{};});g.add(gear);g.userData.gear=gear;return g;}
// A jet model that weapons can hit: the hull meshes take ray hits and name their airframe.
function newJetModel(tag={}){const g=withGear(jetModel());const cone=new THREE.Mesh(new THREE.ConeGeometry(5.5,9,24,1,true),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));cone.rotation.x=Math.PI;cone.position.y=-1;cone.userData.flightFireIgnore=true;cone.raycast=()=>{};g.add(cone);g.userData.cone=cone;
  g.traverse(n=>{if(!n.isMesh||n===g.userData.flame||n===cone||n.parent?.name==="GEAR")return;n.raycast=THREE.Mesh.prototype.raycast;n.userData.flightFireIgnore=false;Object.assign(n.userData,tag);});return g;}
function scorch(model){model.traverse(n=>{if(!n.isMesh||n.parent?.name==="GEAR"||n===model.userData.cone||n===model.userData.flame)return;if(!n.userData.scorched){n.material=n.material.clone();n.material.color?.multiplyScalar(.18);n.material.emissive?.setHex(0x1a0800);n.userData.scorched=true;}});if(model.userData.flame)model.userData.flame.visible=false;}
let chute=null;
function makeChute(){const c=new THREE.Group();c.name="PILOT_CHUTE";const canopy=new THREE.Mesh(new THREE.SphereGeometry(3.4,16,8,0,Math.PI*2,0,Math.PI/2.4),new THREE.MeshStandardMaterial({color:0xff7a1a,roughness:.8,side:THREE.DoubleSide}));canopy.position.z=6.2;canopy.scale.z=.55;
  const rig=buildCharacter({outfit:"player"}),pilot=rig.root;rig.gun.visible=false;rig.gunL.visible=false;for(const s of["L","R"]){rig.arms[s].sh.rotation.set(2.75,0,s==="L"?.32:-.32);rig.arms[s].el.rotation.set(.25,0,0);}rig.legs.L.hip.rotation.x=.15;rig.legs.R.hip.rotation.x=-.1;rig.legs.L.kn.rotation.x=-.2;pilot.position.z=-.3;const lines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([0,1,2,3].flatMap(i=>{const a=i*Math.PI/2;return[new THREE.Vector3(0,0,1.45),new THREE.Vector3(Math.cos(a)*3,Math.sin(a)*3,5.7)];})),new THREE.LineBasicMaterial({color:0xdddddd}));
  c.add(canopy,pilot,lines);c.userData.canopy=canopy;c.traverse(n=>{n.userData.flightFireIgnore=true;n.raycast=()=>{};});root.add(c);return c;}
function ensureChute(){if(chute?.parent===root)return chute;chute=makeChute();return chute;}

// ------------------------------------------------------------ airframes: every jet is a Box3D body
const TERRAIN_RAY={maskBits:WORLD_PHYSICS_CATEGORIES.terrain};
// distance from (x,y) to the nearest house wall (0 inside one): a jet (17 m long, 12 m wide) needs a
// free circle around it, not just a free centre — otherwise a wing or the tail sits in a wall
function clearance(x,y,limit=40){let best=limit;for(const pr of prisms()){const pts=pr.points;if(!pts||pts.length<3)continue;if(Math.abs(x-pts[0][0])>limit+120||Math.abs(y-pts[0][1])>limit+120)continue;if(wantedPointInRing(x,y,pts))return 0;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[j],b=pts[i],dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy||1,t=clamp(((x-a[0])*dx+(y-a[1])*dy)/L2,0,1),d=Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);if(d<best)best=d;}}return best;}
// trees, lamps and parked jets are obstacles too (the jet must be able to roll and lift off)
function obstacleNear(x,y,r){for(const A of airframes.values())if(A.state!=="wreck"&&Math.hypot(A.p.x-x,A.p.y-y)<r+6)return true;
  for(const l of globalThis.__streetLamps?.lamps?.()||[]){const lx=Number(l?.x??l?.p?.x??l?.[0]),ly=Number(l?.y??l?.p?.y??l?.[1]);if(Number.isFinite(lx)&&Math.hypot(lx-x,ly-y)<r)return true;}return false;}
const JET_CLEAR_M=11.5;
function spotOk(x,y){return clearance(x,y,JET_CLEAR_M+2)>=JET_CLEAR_M&&!obstacleNear(x,y,9)&&Math.abs(groundHeightAt(x+6,y)-groundHeightAt(x-6,y))<1.6&&Math.abs(groundHeightAt(x,y+6)-groundHeightAt(x,y-6))<1.6;}
function freeSpot(x,y){for(let k=0;k<90;k++){const a=k*2.399,r=k?6+k*2.4:0,px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;if(spotOk(px,py))return{x:px,y:py};}
  for(let k=0;k<40;k++){const a=k*2.399,r=k?6+k*2.2:0,px=x+Math.cos(a)*r,py=y+Math.sin(a)*r,g=groundHeightAt(px,py);if(!hitsBuilding({x:px,y:py,z:g+2},9))return{x:px,y:py};}return{x,y};}
function createAirframeBody(x,y,heading,{pad=false,z=null,velocity=null}={}){
  if(!ensureScene()||!physics())return null;const id=`jet-${(++airSerial).toString(36)}-${Date.now().toString(36).slice(-4)}`,af=createAirframe(JET_SPEC);af.pilot=false;af.engineOn=false;af.input.brake=1;
  const A={id,af,hp:HP_MAX,state:"parked",pad,model:newJetModel({airframeId:id}),p:new THREE.Vector3(x,y,0),q:yawQuat(heading),v:new THREE.Vector3(),pose:null,gearImpact:0,born:performance.now(),wreckAt:0,burning:false,lastHitBy:""};
  A.model.name="JET_AIRFRAME";root.add(A.model);
  const gz=z??groundHeightAt(x,y)+JET_SPEC.gearHeight+.04;A.p.set(x,y,gz);
  const controller=(st,dt,eng)=>{const out=airframeStep(af,st,dt,{raycast:(o,d,l)=>eng.raycast(o,d,l,TERRAIN_RAY)});if(af.gearImpact>A.gearImpact)A.gearImpact=af.gearImpact;return out;};
  const ok=physics().upsertBody({id,kind:"aircraft",position:[x,y,gz],yaw:heading,massKg:JET_SPEC.massKg,hulls:JET_SPEC.hulls,inertia:JET_SPEC.inertia,halfExtents:[1,7,.8],linearDamping:0,angularDamping:0,wheeled:false,friction:.35,controller});
  if(!ok){A.model.parent?.remove(A.model);return null;}
  if(velocity)physics().setPose?.(id,{position:[x,y,gz],velocity});
  airframes.set(id,A);syncAirframe(A);return A;
}
function removeAirframe(A){if(!A)return;physics()?.removeBody?.(A.id);stopWorldCriticalDamage(A.id);A.model.parent?.remove(A.model);airframes.delete(A.id);}
function syncAirframe(A){const pose=physics()?.pose?.(A.id,A.pose);if(pose){A.pose=pose;A.p.set(pose.position[0],pose.position[1],pose.position[2]);A.q.set(pose.rotation[0],pose.rotation[1],pose.rotation[2],pose.rotation[3]);A.v.set(pose.velocity[0],pose.velocity[1],pose.velocity[2]);}
  const m=A.model;m.position.copy(A.p);m.quaternion.copy(A.q);m.visible=true;m.userData.gear.visible=A.state==="wreck"?false:A.af.gearDown;
  const fl=m.userData.flame;if(fl&&A.state!=="wreck"){const t=A.af.thrust/JET_SPEC.thrustMax,ab=A.af.mode==="flight"&&A.af.lever>.86;fl.visible=t>.02&&Math.cos(A.af.nozzle)>.3;fl.scale.set(1,(.3+t*1.3+(ab?1.0:0))*(.9+Math.random()*.2),1);fl.material.opacity=ab?.95:.2+t*.5;}
  return Boolean(pose);}
function nearestParked(){const w=walk();if(w?.mode!=="foot"||!w.position||w.dead)return null;let best=null,bd=ENTER_M;for(const A of airframes.values()){if(A.state!=="parked")continue;const d=Math.hypot(A.p.x-w.position.x,A.p.y-w.position.y);if(d<bd&&A.p.z-groundHeightAt(A.p.x,A.p.y)<8){bd=d;best=A;}}return best;}
function startAnchor(){const w=walk(),h=globalThis.__arondightPlayerVehicleRuntime?.humanAnchor;if(w?.mode==="foot"&&w.position)return{x:w.position.x,y:w.position.y,yaw:Number(w.yaw)||0};if(h&&Number.isFinite(h.x))return{x:h.x,y:h.y,yaw:Number(h.yaw)||0};return null;}
function maybeSpawnPad(now){if(spawnPad||!ensureScene()||!physics()?.ready)return;const a=startAnchor();if(!a)return;if(!firstSeen)firstSeen=now;if(now-firstSeen<3500)return;if(!prisms().length&&now-firstSeen<15000)return;/* houses still streaming in */
  // in front of the pilot, a little to the right: visible right at the start
  const fx=Math.sin(a.yaw),fy=Math.cos(a.yaw),s=freeSpot(a.x+fx*26+fy*8,a.y+fy*26-fx*8);spawnPad={x:s.x,y:s.y,heading:Math.atan2(-fx,fy)+Math.PI*.25};createAirframeBody(spawnPad.x,spawnPad.y,spawnPad.heading,{pad:true});}

// ------------------------------------------------------------ damage
function damageAirframe(A,amount,source="world"){
  if(!A||A.state==="wreck"||!(amount>0))return;A.hp=Math.max(0,A.hp-amount);A.lastHitBy=source;A.af.thrustScale=clamp(.35+A.hp/(HP_MAX*.5)*.65,.35,1);
  if(A===jet){addTrauma?.(Math.min(.6,amount/120));if(amount>8)sfx("bounce",{gain:.3,playbackRate:.6,minIntervalMs:60});}
  if(A.hp<=HP_MAX*.15&&!A.burning&&A.hp>0){A.burning=true;startWorldCriticalDamage({id:A.id,object:A.model,kind:"jet",offset:[0,-6,.4],scale:2.2,delayMs:12000,onExpire:()=>destroyAirframe(A,"fire")});}
  if(A.hp<=0)destroyAirframe(A,source);
}
function destroyAirframe(A,source="world"){
  if(!A||A.state==="wreck")return;const wasPlayer=A===jet,p=A.p.clone(),v=A.v.clone(),q=A.q.clone();A.state="wreck";A.hp=0;A.burning=false;stopWorldCriticalDamage(A.id);
  A.ignoreBlastUntil=performance.now()+400;sendFx({kind:"jet-destroyed",aid:A.id,g:geoOf(p.x,p.y),p:canon(p),v:[+v.x.toFixed(1),+v.y.toFixed(1),+v.z.toFixed(1)]});
  // the airframe comes apart: its body is gone, the pieces fly under physics
  physics()?.removeBody?.(A.id);airframes.delete(A.id);breakApart(A.model,p,q,v);
  globalThis.__fighterJets?.blast?.(p,{radiusM:14,maxDamage:180,scale:1.25,kind:"jet-wreck"});addTrauma?.(wasPlayer?1:.4);
  if(wasPlayer){const h=headingOf(q);jet=null;try{globalThis.__arondightPlayerDamageModel?.damage?.(1000,`jet-destroyed:${source}`);}catch{}finish(p.x+Math.cos(h)*6,p.y+Math.sin(h)*6,h);}
}
// Break a jet model into its real parts (nose, centre fuselage, tail, both wings): each part becomes a
// Box3D body with the jet's velocity plus the blast's push; they burn, tumble, come to rest and burn out.
function breakApart(model,p,q,v){
  if(!model)return;scorch(model);model.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(model.matrixWorld).invert(),groups=new Map();
  for(const mesh of[...model.children]){if(!mesh.isMesh||mesh===model.userData.cone||mesh===model.userData.flame)continue;mesh.geometry.computeBoundingBox?.();const bb=mesh.geometry.boundingBox?.clone();if(!bb)continue;bb.applyMatrix4(mesh.matrix);const c=bb.getCenter(new THREE.Vector3());
    const key=Math.abs(c.x)>1.4?(c.x>0?"wingR":"wingL"):c.y>3.2?"nose":c.y<-3.2?"tail":"body";let g=groups.get(key);if(!g){g={meshes:[],box:new THREE.Box3()};groups.set(key,g);}g.meshes.push(mesh);g.box.union(bb);}
  void inv;const now=performance.now();let i=0;
  for(const[key,g]of groups){const c=g.box.getCenter(new THREE.Vector3()),size=g.box.getSize(new THREE.Vector3()),grp=new THREE.Group();grp.name=`JET_DEBRIS_${key}`;
    for(const mesh of g.meshes){mesh.parent?.remove(mesh);mesh.position.sub(c);mesh.raycast=()=>{};mesh.userData.flightFireIgnore=true;grp.add(mesh);}
    const wp=c.clone().applyQuaternion(q).add(p);grp.position.copy(wp);grp.quaternion.copy(q);root?.add(grp);
    const id=`jet-debris-${(++debrisSerial).toString(36)}`,half=[Math.max(.15,size.x/2),Math.max(.15,size.y/2),Math.max(.12,size.z/2)],mass=key==="body"?4200:key.startsWith("wing")?1300:2200;
    const out=c.clone().applyQuaternion(q).normalize(),push=8+Math.random()*7,vel=[v.x+out.x*push+(Math.random()-.5)*3,v.y+out.y*push+(Math.random()-.5)*3,v.z+Math.abs(out.z)*push+5+Math.random()*5];
    const yaw=Math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.y*q.y+q.z*q.z));
    const ok=physics()?.upsertBody?.({id,kind:"debris",position:[wp.x,wp.y,wp.z],yaw,halfExtents:half,massKg:mass,wheeled:false,linearDamping:.05,angularDamping:.3,friction:.6});
    if(ok)physics()?.setPose?.(id,{position:[wp.x,wp.y,wp.z],velocity:vel,angularVelocity:[(Math.random()-.5)*4,(Math.random()-.5)*4,(Math.random()-.5)*3]});
    const d={id:ok?id:null,group:grp,offset:new THREE.Quaternion().copy(q).premultiply(qd.setFromAxisAngle(Z,-yaw)),until:now+DEBRIS_MS+i*1500,v:new THREE.Vector3(...vel)};debris.push(d);
    if(key==="body"||i===0)startWorldCriticalDamage({id:`${id}-fire`,object:grp,kind:"jet-debris",offset:[0,0,.3],scale:1.6,delayMs:DEBRIS_MS*.6,onExpire:null});i++;}
  model.parent?.remove(model);
}
// a body pose follows Box3D; the parts are created with the airframe's full attitude, the body with yaw only: keep that offset
function debrisFrame(now,dt){for(let k=debris.length-1;k>=0;k--){const d=debris[k];if(now>d.until){if(d.id)physics()?.removeBody?.(d.id);stopWorldCriticalDamage(`${d.id}-fire`);d.group.parent?.remove(d.group);debris.splice(k,1);continue;}
  const pose=d.id?physics()?.pose?.(d.id):null;if(pose){d.group.position.set(pose.position[0],pose.position[1],pose.position[2]);d.group.quaternion.set(pose.rotation[0],pose.rotation[1],pose.rotation[2],pose.rotation[3]).multiply(d.offset);}
  else{d.v.z-=G*dt;d.group.position.addScaledVector(d.v,dt);const gz=groundHeightAt(d.group.position.x,d.group.position.y);if(d.group.position.z<gz+.3){d.group.position.z=gz+.3;d.v.set(0,0,0);}}
  const left=d.until-now;if(left<4000)d.group.scale.setScalar(Math.max(.01,left/4000));}}
// distance from a point to the airframe (its body-frame bounding box: fuselage + wing span)
function distanceToAirframe(A,x,y,z){tmp.set(x-A.p.x,y-A.p.y,z-A.p.z).applyQuaternion(qd.copy(A.q).invert());const dx=Math.max(0,Math.abs(tmp.x)-6),dy=Math.max(0,tmp.y>9?tmp.y-9:tmp.y<-7.6?-7.6-tmp.y:0),dz=Math.max(0,Math.abs(tmp.z)-.9);return Math.hypot(dx,dy,dz);}
function blastDamage(dist,radius,maxDamage){if(dist>=radius)return 0;return(Number(maxDamage)||60)*1.2*Math.pow(1-dist/radius,1.3);}
function onExplosion(e){const d=e?.detail||{},p=d.position;if(!Array.isArray(p)&&!p)return;const x=Array.isArray(p)?+p[0]:+p.x,y=Array.isArray(p)?+p[1]:+p.y,z=Array.isArray(p)?+p[2]:+p.z;if(![x,y,z].every(Number.isFinite))return;
  if(d.remote&&d.kind!=="nuke")return;// a replayed blast: the client where it happened already sent its hits
  const r=Math.max(1.5,Number(d.radiusM)||6),maxD=d.kind==="nuke"?99999:Number(d.maxDamage)||60,now=performance.now();
  for(const A of[...airframes.values()]){if(A.ignoreBlastUntil>now)continue;const dmg=blastDamage(distanceToAirframe(A,x,y,z),d.kind==="nuke"?Math.max(r,600):r,maxD);if(dmg>0)damageAirframe(A,dmg,String(d.kind||"blast"));}
  // jets of other players: the owner applies the damage
  for(const[key,r2]of peerAir){const dist=Math.max(0,Math.hypot(r2.p.x-x,r2.p.y-y,r2.p.z-z)-5),dmg=blastDamage(dist,r,maxD);if(dmg>0)sendHit(r2.owner,r2.aid,dmg);}
  for(const[id,r3]of remote){if(r3.para||!r3.init)continue;const dist=Math.max(0,r3.p.distanceTo(tmp.set(x,y,z))-5),dmg=blastDamage(dist,r,maxD);if(dmg>0)sendHit(id,"flying",dmg);}
}
function onBodyHit(e){const d=e?.detail||{};const A=airframes.get(String(d.id||""));if(A)damageAirframe(A,Number(d.damage)||5,String(d.source||"bullet"));}
function onRemoteHit(e){const d=e?.detail||{};if(d.owner)sendHit(String(d.owner),String(d.id||"flying"),Number(d.damage)||5);}
function onPhysicsImpact(e){const d=e?.detail||{},A=airframes.get(String(d.id||""));if(!A)return;const v=Number(d.approachSpeedMps??d.deltaVelocityMps)||0;if(v>5)damageAirframe(A,Math.pow(v-5,1.7)*4,"impact");if(A===jet&&v>2)addTrauma?.(Math.min(1,v/15));}

// ------------------------------------------------------------ enter / exit
function enter(A=nearestParked()){
  if(active||!A||A.state!=="parked"||!ensureScene())return false;if(globalThis.__arondightVehicleDrive?.active)return false;
  jet=A;A.state="flying";A.flown=true;const af=A.af;af.pilot=true;af.engineOn=true;af.input.brake=0;setFlightMode(af,"hover");af.lever=0;
  camMode="cockpit";camInit=false;para=null;active=true;startVoice();
  const cam=bridge()?.threeCamera;if(cam)baseFar=cam.far;
  claimSticks({name:"jet",labels:{move:"STEIGEN / SCHUB",look:"KNÜPPEL",fire:"KANONE"},onFire:v=>{firing=Boolean(v)&&active&&!para;}});
  document.body.classList.add("jet-mode");renderButtons();window.dispatchEvent(new CustomEvent("arondight:vehicle-mode",{detail:{active:true,jet:true}}));return true;
}
function finish(x,y,heading){// back on foot at (x,y)
  active=false;firing=false;tapFire=null;keys.clear();para=null;if(chute)chute.visible=false;stopVoice();releaseSticks();document.body.classList.remove("jet-mode");
  const s=freeSpot(x,y),w=walk();w?.setPose?.({x:s.x,y:s.y,yaw:walkYawOf(heading),pitch:0});
  const cam=bridge()?.threeCamera;if(cam&&baseFar){cam.far=baseFar;cam.updateProjectionMatrix();}farGround.hide();globalThis.__arondightFogScale=1;
  renderButtons();window.dispatchEvent(new CustomEvent("arondight:vehicle-mode",{detail:{active:false,jet:true}}));}
function park(A){A.state="parked";const af=A.af;af.pilot=false;af.engineOn=false;af.input={lift:0,yawIn:0,pitchIn:0,rollIn:0,brake:1};setFlightMode(af,"hover");}
function exit(){
  if(!active||!jet||para)return false;const A=jet,h=headingOf(A.q),af=A.af,speed=A.v.length();
  if(af.landed||(af.contacts>=2&&speed<4)){// step out: the jet stays parked right here, on its gear
    park(A);jet=null;finish(A.p.x+Math.cos(h)*5,A.p.y+Math.sin(h)*5,h);return true;}
  // EJECT: the seat takes the pilot; the empty jet keeps its body — no pilot, engine winding down — and comes down under physics
  A.state="ghost";af.pilot=false;af.engineOn=false;af.input={lift:0,yawIn:0,pitchIn:0,rollIn:0,brake:0};
  upv.copy(Z).applyQuaternion(A.q);const agl=A.p.z-groundHeightAt(A.p.x,A.p.y);para={p:A.p.clone().addScaledVector(upv,2.8),v:A.v.clone().addScaledVector(upv,28),t:performance.now()};jet=null;ensureChute().visible=true;firing=false;
  sfx("explosion",{gain:.35,playbackRate:1.6});addTrauma?.(.5);stopVoice();return true;
}
function toggleMode(){if(!jet)return;setFlightMode(jet.af,jet.af.mode==="hover"?"flight":"hover");sfx("bounce",{gain:.25,playbackRate:.4});renderButtons();}

// ------------------------------------------------------------ input
function readInputs(dt){
  const m=sticks.move,l=sticks.look;let lift=-m.y,yawIn=m.x,pitchIn=l.y,rollIn=l.x;// pitchIn + = stick pulled back = nose up
  if(keys.has("KeyW"))lift+=1;if(keys.has("KeyS"))lift-=1;if(keys.has("KeyA"))yawIn-=1;if(keys.has("KeyD"))yawIn+=1;if(keys.has("ArrowUp"))pitchIn-=1;if(keys.has("ArrowDown"))pitchIn+=1;if(keys.has("ArrowLeft"))rollIn-=1;if(keys.has("ArrowRight"))rollIn+=1;
  // desktop mouse: a rate stick (mouse up = nose up, right = roll right); LMB = gun
  const desk=globalThis.__arondightDesktopInput;if(desk?.active&&desk.locked&&dt>0){const d=desk.takeMouseDelta(),a=1-Math.exp(-dt/.06);mouseStick.x+=(clamp(d.x/dt/1100,-1,1)-mouseStick.x)*a;mouseStick.y+=(clamp(d.y/dt/1100,-1,1)-mouseStick.y)*a;rollIn+=mouseStick.x;pitchIn-=mouseStick.y;firing=Boolean(desk.lmb)||keys.has("Space");}else{mouseStick.x=mouseStick.y=0;}
  // Xbox, Battlefield jet layout: LS ↑↓ throttle/lift, LS ←→ rudder, RS pitch + roll, RT gun,
  // LT rockets, RB bombs, LB VTOL hover/flight. X exits / ejects and VIEW switches the camera
  // (both handled by the shared pad actions, same as E and C on the keyboard). Under the
  // parachute the sticks steer the canopy.
  const pad=globalThis.__arondightPadBlocked?.()?null:(navigator.getGamepads?.()||[]).find(g=>g&&g.connected);if(pad&&(jet||para)){const ax=a=>Math.abs(a)<.12?0:a;lift+=-ax(pad.axes[1]||0);yawIn+=ax(pad.axes[0]||0);rollIn+=ax(pad.axes[2]||0);pitchIn+=ax(pad.axes[3]||0);
    if(jet){const rt=(pad.buttons[7]?.value||0)>.4;if(rt!==jet.padFire){firing=rt;jet.padFire=rt;}const lt=(pad.buttons[6]?.value||0)>.5;if(lt&&!jet.padLT)fireRocket();jet.padLT=lt;const rb=Boolean(pad.buttons[5]?.pressed);if(rb&&!jet.padRB)dropBomb();jet.padRB=rb;const lb=Boolean(pad.buttons[4]?.pressed);if(lb&&!jet.padLB)toggleMode();jet.padLB=lb;}}
  return{lift:clamp(lift,-1,1),yawIn:clamp(yawIn,-1,1),pitchIn:clamp(pitchIn,-1,1),rollIn:clamp(rollIn,-1,1)};}

// ------------------------------------------------------------ the flown jet, every frame (the forces run in the physics step)
function flyFrame(dt,now){
  const A=jet,af=A.af,inp=readInputs(dt);if(!jet||!inp)return;
  const onGround=af.contacts>=2,brake=onGround&&((af.mode==="hover"&&inp.lift<=.05)||(af.mode==="flight"&&af.lever<.05&&inp.lift<0))?1:0;
  af.input={lift:inp.lift,yawIn:inp.yawIn,pitchIn:inp.pitchIn,rollIn:inp.rollIn,brake};
  // hard landing: the gear's sink rate at touchdown
  if(A.gearImpact>4){damageAirframe(A,(A.gearImpact-4)*80,"hard-landing");addTrauma?.(.5);}A.gearImpact=0;if(!jet)return;
  const s=A.v.length(),m2=machOf(s);if(m2>=1&&machWas<1){boom();coneUntil=now+1600;}machWas=m2;const cone=A.model.userData.cone;if(cone){const k=coneUntil>now?Math.min(1,(coneUntil-now)/600):Math.max(0,1-Math.abs(m2-1)/.05)*.5;cone.material.opacity=.45*k;cone.scale.setScalar(.8+Math.min(.6,Math.max(0,m2-.95)*2));}
  if(Math.abs(m2-1)<.06)addTrauma?.(.04);
  if(Math.hypot(A.p.x,A.p.y)>REBASE_M)rebase(A.p.x,A.p.y);
  if(firing)gun(now);
}
const angleTo=(a,b)=>{let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d;};
function stepPara(dt){const c=para,inp=readInputs(dt)||{pitchIn:0,rollIn:0},age=(performance.now()-c.t)/1000;c.v.z-=G*dt;c.v.x*=1-.25*dt;c.v.y*=1-.25*dt;if(age>1.1){c.v.z+=(-6.5-c.v.z)*Math.min(1,dt*1.6);c.v.x+=(inp.rollIn*4-c.v.x)*Math.min(1,dt*.8);c.v.y+=(-inp.pitchIn*4-c.v.y)*Math.min(1,dt*.8);}
  c.p.addScaledVector(c.v,dt);const ch=ensureChute();ch.visible=true;ch.position.copy(c.p);ch.userData.canopy.visible=age>1.1;ch.rotation.z=Math.atan2(c.v.y,c.v.x)-Math.PI/2;const gz=groundHeightAt(c.p.x,c.p.y);
  if(c.p.z<=gz+.2||(age>1.5&&hitsBuilding(c.p))){ch.visible=false;finish(c.p.x,c.p.y,Math.atan2(-c.v.x,c.v.y||1));}}
// ejected / wrecked jets: a ghost that comes to rest on its gear is parked again; wrecks burn out
function airframesFrame(now){for(const A of[...airframes.values()]){syncAirframe(A);
  if(A.state==="ghost"&&A.af.contacts>=2&&A.v.length()<1)park(A);}}
// The start pad always gets its jet back: 75 s after it is empty (destroyed, or flown away and left
// somewhere) a new one stands there. Left-behind jets stay where they were put — up to a few; then the
// oldest unused one far from the player (out of sight) is taken away.
let padCheckAt=0;
function relocatePadJets(now){if(now<padCheckAt)return;padCheckAt=now+2000;for(const A of[...airframes.values()]){if(!A.pad||A.state!=="parked"||A===jet||A.flown)continue;if(spotOk(A.p.x,A.p.y))continue;const w=walk()?.position,s=freeSpot(A.p.x,A.p.y);if(Math.hypot(s.x-A.p.x,s.y-A.p.y)<1)continue;const h=headingOf(A.q);removeAirframe(A);const B=createAirframeBody(s.x,s.y,h,{pad:true});if(B&&spawnPad){spawnPad.x=s.x;spawnPad.y=s.y;}const v=viewport();if(v)v.dataset.jetPadRelocated=String((Number(v.dataset.jetPadRelocated)||0)+1);void w;}}
function padFrame(now){
  if(!spawnPad)return;relocatePadJets(now);const occupied=[...airframes.values()].some(A=>A.state!=="wreck"&&Math.hypot(A.p.x-spawnPad.x,A.p.y-spawnPad.y)<PAD_RADIUS_M&&A.p.z-groundHeightAt(A.p.x,A.p.y)<12);
  if(occupied){padEmptySince=0;return;}if(!padEmptySince){padEmptySince=now;return;}if(now-padEmptySince<PAD_RESPAWN_MS)return;
  const w=walk()?.position;if(w&&Math.hypot(w.x-spawnPad.x,w.y-spawnPad.y)<14)return;// never on top of the player
  padEmptySince=0;for(const A of airframes.values())A.pad=false;const s=freeSpot(spawnPad.x,spawnPad.y);createAirframeBody(s.x,s.y,spawnPad.heading,{pad:true});
  const spare=[...airframes.values()].filter(A=>A!==jet&&A.state==="parked"&&!A.pad).sort((a,b)=>a.born-b.born);while(airframes.size>MAX_AIRFRAMES&&spare.length){const A=spare.shift(),d=w?Math.hypot(A.p.x-w.x,A.p.y-w.y):1e9;if(d>150)removeAirframe(A);}
}
function rebase(dx,dy){const b=bridge();if(!b?.active||!Number.isFinite(b.originLon)||!Number.isFinite(b.originLat))return;if(b.vsSession)return;/* a shared multiplayer frame never moves (everybody's positions are in it) */const[lon,lat]=metersToLngLat(b.originLon,b.originLat,dx,dy);
  b.originLon=lon;b.originLat=lat;b.lastMapSyncMs=-Infinity;b.lastMapView=null;b.lastViewportSize="";b.minimapLastQueryMs=-Infinity;b.minimapLastDrawMs=-Infinity;b.buildingCollisionDirty=true;b.clearBuildingCollisions?.();try{b.map?.jumpTo?.({center:[lon,lat]});}catch{}
  for(const A of airframes.values()){const p=physics()?.pose?.(A.id);if(p)physics()?.setPose?.(A.id,{position:[p.position[0]-dx,p.position[1]-dy,p.position[2]],velocity:[...p.velocity],angularVelocity:[...(p.angularVelocity||[0,0,0])]});A.p.x-=dx;A.p.y-=dy;}
  const shift=o=>{if(o){o.x-=dx;o.y-=dy;}};shift(para?.p);for(const bb of bombs)shift(bb.p);for(const r of rockets)shift(r.p);if(spawnPad){spawnPad.x-=dx;spawnPad.y-=dy;}farGround.invalidate();
  const v=viewport();if(v){v.dataset.jetRebases=String((Number(v.dataset.jetRebases)||0)+1);v.dataset.worldLongitude=String(lon);v.dataset.worldLatitude=String(lat);}}

// ------------------------------------------------------------ weapons
// touch: the gun fires where you tap and hold (like on foot) — within the reach of the nose guns
let tapFire=null;const tapRay=new THREE.Raycaster(),tapNdc=new THREE.Vector2();
function tapAim(out){const v=viewport(),c=bridge()?.presentedCamera?.()||bridge()?.threeCamera;if(!tapFire||!v||!c)return false;const r=v.getBoundingClientRect(),rot=v.dataset.soloOrientation==="css-landscape",x=rot?tapFire.cy-r.top:tapFire.cx-r.left,y=rot?r.right-tapFire.cx:tapFire.cy-r.top;
  tapNdc.set(x/Math.max(1,v.clientWidth)*2-1,-(y/Math.max(1,v.clientHeight))*2+1);tapRay.setFromCamera(tapNdc,c);out.copy(tapRay.ray.direction).normalize();
  const cos=out.dot(fwd);if(cos<Math.cos(.62)){/* clamp to a 35° cone around the nose */const perp=tmp2.copy(out).addScaledVector(fwd,-cos).normalize();out.copy(fwd).multiplyScalar(Math.cos(.62)).addScaledVector(perp,Math.sin(.62)).normalize();}return true;}
function tapUi(t){return!(t instanceof Element)||Boolean(t.closest("button,input,select,textarea,a,label,dialog,#footMove,#footLook,#footFire,#worldLookHud,#mobileGameplayDock,#soloTopbar,#gpsLiveHud"));}
function onTapDown(e){if(!active||!jet||para||e.pointerType==="mouse"||document.body.classList.contains("desktop-input")||tapUi(e.target)||tapFire)return;if(!e.target?.closest?.("#viewport"))return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();tapFire={id:e.pointerId,cx:e.clientX,cy:e.clientY};firing=true;}
function onTapMove(e){if(tapFire&&e.pointerId===tapFire.id){tapFire.cx=e.clientX;tapFire.cy=e.clientY;e.stopPropagation();}}
function onTapUp(e){if(tapFire&&e.pointerId===tapFire.id){tapFire=null;firing=false;}}
function gun(now){if(!jet||now-lastGun<55)return;lastGun=now;fwd.copy(Y).applyQuaternion(jet.q);const o=jet.p.clone().addScaledVector(fwd,10.5),d=fwd.clone();if(tapFire)tapAim(d);d.x+=(Math.random()-.5)*.006;d.y+=(Math.random()-.5)*.006;d.z+=(Math.random()-.5)*.006;d.normalize();
  const rt=physics()?.raycast?.([o.x,o.y,o.z],[d.x,d.y,d.z],1800);let dist=1800,pt=null;if(rt?.point){pt=new THREE.Vector3(...rt.point);dist=o.distanceTo(pt);}else{const tr=terrainRayDistance(o,d,1800);if(Number.isFinite(tr)){dist=tr;pt=o.clone().addScaledVector(d,tr);}}
  // other players' jets are not Box3D bodies here: test the cannon ray against them
  let peerHit=null;for(const[id,r]of remote){if(r.para||!r.init)continue;const t=tmp.copy(r.p).sub(o).dot(d);if(t>0&&t<dist&&tmp2.copy(o).addScaledVector(d,t).distanceTo(r.p)<5){dist=t;peerHit={owner:id,aid:"flying"};pt=o.clone().addScaledVector(d,t);}}
  for(const r of peerAir.values()){const t=tmp.copy(r.p).sub(o).dot(d);if(t>0&&t<dist&&tmp2.copy(o).addScaledVector(d,t).distanceTo(r.p)<5){dist=t;peerHit={owner:r.owner,aid:r.aid};pt=o.clone().addScaledVector(d,t);}}
  tracer(o,o.clone().addScaledVector(d,Math.min(dist,600)));
  if(peerHit){sendHit(peerHit.owner,peerHit.aid,30);globalThis.__worldImpacts?.chips?.(pt,d.clone().negate(),"vehicle",5,5);}
  else if(pt){globalThis.__worldImpacts?.bullet?.({origin:o,direction:d},rt?.point?{box3d:true,point:pt,distance:dist,worldNormal:new THREE.Vector3(...(rt.normal||[0,0,1])),physicsKind:rt.kind,physicsId:rt.id}:null,{maxDistance:1800,bodyDamage:30,source:"jet-cannon"});
    if(Math.random()<.34)window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[pt.x,pt.y,pt.z],radiusM:3.2,maxDamage:70,kind:"cannon"}}));}
  sfx("shot",{gain:.32,playbackRate:.7,minIntervalMs:40});}
const tracerPool=[];function tracer(a,b){let t=tracerPool.find(x=>!x.m.visible);if(!t){if(tracerPool.length>24)t=tracerPool[0];else{const m=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,1,5,1,true),new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));m.userData.flightFireIgnore=true;m.raycast=()=>{};root.add(m);t={m,until:0};tracerPool.push(t);}}
  tmp.subVectors(b,a);const len=tmp.length();t.m.position.copy(a).addScaledVector(tmp,.5);t.m.quaternion.setFromUnitVectors(Y,tmp.normalize());t.m.scale.set(1,len,1);t.m.visible=true;t.until=performance.now()+45;}
function dropBomb(){if(!active||!jet||jet.af.contacts>0||(jet.lastBomb&&performance.now()-jet.lastBomb<450))return;jet.lastBomb=performance.now();const m=new THREE.Mesh(new THREE.CapsuleGeometry(.25,1.4,3,8),new THREE.MeshStandardMaterial({color:0x3b4135,roughness:.6}));m.userData.flightFireIgnore=true;m.raycast=()=>{};root.add(m);
  bombs.push({m,p:jet.p.clone().addScaledVector(Z.clone().applyQuaternion(jet.q),-1.6),v:jet.v.clone()});sfx("bounce",{gain:.4,playbackRate:.5});}
// unguided rockets from the wing pods: fast, straight, a real blast where they hit
const rockets=[];let rocketSide=1;
function fireRocket(){if(!active||!jet||jet.af.contacts>0||(jet.lastRocket&&performance.now()-jet.lastRocket<350))return;jet.lastRocket=performance.now();fwd.copy(Y).applyQuaternion(jet.q);rightv.copy(X).applyQuaternion(jet.q);rocketSide=-rocketSide;
  const m=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,1.4,6),new THREE.MeshBasicMaterial({color:0xfff0c0}));m.userData.flightFireIgnore=true;m.raycast=()=>{};const fl=new THREE.Mesh(new THREE.SphereGeometry(.25,6,4),new THREE.MeshBasicMaterial({color:0xffa040,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));fl.position.y=-.8;m.add(fl);root.add(m);
  rockets.push({m,p:jet.p.clone().addScaledVector(rightv,rocketSide*3.2).addScaledVector(fwd,2).addScaledVector(Z.clone().applyQuaternion(jet.q),-.6),v:jet.v.clone().addScaledVector(fwd,260),life:5});sfx("explosion",{gain:.25,playbackRate:1.8});}
function stepRockets(dt){for(let i=rockets.length-1;i>=0;i--){const r=rockets[i],prev=r.p.clone();r.v.z-=G*.15*dt;r.p.addScaledVector(r.v,dt);r.life-=dt;r.m.position.copy(r.p);r.m.quaternion.setFromUnitVectors(Y,tmp.copy(r.v).normalize());const gz=groundHeightAt(r.p.x,r.p.y);
  const d=tmp.copy(r.v).normalize(),rt=physics()?.raycast?.([prev.x,prev.y,prev.z],[d.x,d.y,d.z],prev.distanceTo(r.p)+.5);let hit=rt?.point?new THREE.Vector3(...rt.point):null;if(!hit&&(r.p.z<=gz+.2||hitsBuilding(r.p)))hit=r.p.clone().setZ(Math.max(r.p.z,gz));
  if(hit||r.life<=0){if(hit)globalThis.__fighterJets?.blast?.(hit,{radiusM:8,maxDamage:120,scale:.55,kind:"jet-rocket"});r.m.parent?.remove(r.m);rockets.splice(i,1);}}}
function stepBombs(dt){for(let i=bombs.length-1;i>=0;i--){const b=bombs[i],prev=b.p.clone();b.v.z-=G*dt;b.v.multiplyScalar(1-.04*dt);b.p.addScaledVector(b.v,dt);b.m.position.copy(b.p);if(b.v.lengthSq()>1)b.m.quaternion.setFromUnitVectors(Z,tmp.copy(b.v).normalize().negate());const gz=groundHeightAt(b.p.x,b.p.y);
  const step=prev.distanceTo(b.p),d=tmp.copy(b.p).sub(prev).normalize(),rt=step>.01?physics()?.raycast?.([prev.x,prev.y,prev.z],[d.x,d.y,d.z],step+.3):null;
  if(rt?.point||b.p.z<=gz+.3||hitsBuilding(b.p)){const at=rt?.point?new THREE.Vector3(...rt.point):b.p.clone().setZ(Math.max(b.p.z,gz));globalThis.__fighterJets?.blast?.(at);b.m.parent?.remove(b.m);bombs.splice(i,1);}}}
function boom(){sfx("explosion",{gain:.9,playbackRate:.55});setTimeout(()=>sfx("explosion",{gain:.6,playbackRate:.62}),120);addTrauma?.(.6);if(jet)sendFx({kind:"jet-boom",p:canon(jet.p)});}

// ------------------------------------------------------------ engine sound
function startVoice(){const a=jetEngineAudio();if(!a||voice)return;const c=a.ctx,src=c.createBufferSource();src.buffer=a.buffer;src.loop=true;const lp=c.createBiquadFilter();lp.type="lowpass";lp.frequency.value=1200;const g=c.createGain();g.gain.value=0;src.connect(lp);lp.connect(g);g.connect(a.master||c.destination);src.start();voice={src,lp,g,c};}
function stopVoice(){if(!voice)return;try{voice.g.gain.setTargetAtTime(0,voice.c.currentTime,.2);voice.src.stop(voice.c.currentTime+.8);}catch{}voice=null;}
function updateVoice(){if(!voice)startVoice();if(!voice||!jet)return;const af=jet.af,t=voice.c.currentTime,ab=af.mode==="flight"&&af.lever>.86&&Math.cos(af.nozzle)>.8,pw=clamp(af.thrust/JET_SPEC.thrustDry,0,1.3),cockpit=camMode==="cockpit";voice.g.gain.setTargetAtTime((.12+pw*.36+(ab?.22:0))*(cockpit?.55:1),t,.08);voice.src.playbackRate.setTargetAtTime(.45+pw*.6+(ab?.12:0),t,.08);voice.lp.frequency.setTargetAtTime((700+pw*2600+(ab?2500:0))*(cockpit?.6:1),t,.08);}

// ------------------------------------------------------------ far ground: the real city to the horizon
// A 16 km satellite plane under the detailed ground (which covers ±800 m):
// from altitude you see streets, blocks, parks and water instead of haze.
const farGround=(()=>{let mesh=null,center=null,busy=false,lastTry=0;const TILE=(z,x,y)=>`https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,ZOOM=13,SPAN=16000;
  const toTile=(lon,lat,z)=>{const n=2**z,r=lat*Math.PI/180;return[(lon+180)/360*n,(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n];};
  const fromTile=(x,y,z)=>{const n=2**z;return[x/n*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI];};
  const load=(z,x,y)=>new Promise(res=>{const img=new Image();img.crossOrigin="anonymous";img.onload=()=>res(img);img.onerror=()=>res(null);img.src=TILE(z,x,y);setTimeout(()=>res(null),12000);});
  function drop(){if(!mesh)return;mesh.parent?.remove(mesh);mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose();mesh=null;}
  async function build(cx,cy){const b=bridge();if(!b?.active||!Number.isFinite(b.originLon))return;busy=true;try{const[lon0,lat0]=metersToLngLat(b.originLon,b.originLat,cx-SPAN/2,cy+SPAN/2),[lon1,lat1]=metersToLngLat(b.originLon,b.originLat,cx+SPAN/2,cy-SPAN/2);
      const[a0,b0]=toTile(lon0,lat0,ZOOM),[a1,b1]=toTile(lon1,lat1,ZOOM),ix0=Math.floor(a0),iy0=Math.floor(b0),nx=Math.floor(a1)-ix0+1,ny=Math.floor(b1)-iy0+1;if(nx*ny>49)return;
      const imgs=await Promise.all(Array.from({length:nx*ny},(_,i)=>load(ZOOM,ix0+i%nx,iy0+Math.floor(i/nx))));if(imgs.every(i=>!i)||!active)return;const P=256,cv=document.createElement("canvas");cv.width=nx*P;cv.height=ny*P;const ctx=cv.getContext("2d");ctx.fillStyle="#56604c";ctx.fillRect(0,0,cv.width,cv.height);imgs.forEach((im,i)=>{if(im)ctx.drawImage(im,(i%nx)*P,Math.floor(i/nx)*P,P,P);});
      // a grid whose vertices sit on the mosaic's lon/lat (Mercator rows stay exact)
      const SEG=24,pos=[],uv=[],idx=[];for(let j=0;j<=SEG;j++)for(let i=0;i<=SEG;i++){const[lo,la]=fromTile(ix0+i/SEG*nx,iy0+j/SEG*ny,ZOOM),m=lngLatToLocal(lo,la);pos.push(m[0],m[1],0);uv.push(i/SEG,1-j/SEG);}
      for(let j=0;j<SEG;j++)for(let i=0;i<SEG;i++){const a=j*(SEG+1)+i;idx.push(a,a+1,a+SEG+1,a+1,a+SEG+2,a+SEG+1);}
      const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
      const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
      const mat=new THREE.MeshLambertMaterial({map:tex,color:0x8e8e8e,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:6,polygonOffsetUnits:6});
      drop();mesh=new THREE.Mesh(g,mat);mesh.name="JET_FAR_GROUND";mesh.renderOrder=0;mesh.frustumCulled=false;mesh.userData.flightFireIgnore=true;mesh.raycast=()=>{};root.add(mesh);center={x:cx,y:cy};}
    finally{busy=false;}}
  return{update(p,v,now){if(!root)return;if(mesh){const gz=groundHeightAt(p.x,p.y);mesh.position.z=gz-5;mesh.visible=p.z-gz>45;}if(busy||now-lastTry<1500)return;const cx=Math.round((p.x+v.x*6)/1000)*1000,cy=Math.round((p.y+v.y*6)/1000)*1000;if(center&&Math.hypot(cx-center.x,cy-center.y)<3000)return;lastTry=now;build(cx,cy);},
    hide(){if(mesh)mesh.visible=false;},invalidate(){center=null;drop();}};})();

// ------------------------------------------------------------ camera
const camLook=new THREE.Vector3(),cockpitEye=new THREE.Vector3(0,3.5,1.42);
const provider={isActive:()=>active||Boolean(base?.isActive?.()),apply:args=>active?applyCamera(args):base?.apply?.(args)};let base=null,installedOn=null;
// install once: other modes wrap us afterwards (a chain), never re-wrap them (that would loop)
function ensureProvider(){const b=bridge();if(!b||typeof b.attachPresentationCameraProvider!=="function"||installedOn===b)return;const cur=b.presentationCameraProvider;if(!cur||cur===provider)return;base=cur;b.attachPresentationCameraProvider(provider);installedOn=b;}
function applyCamera({camera,now}){
  const b=bridge(),ly=(Number(b?.lookYawDeg)||0)*Math.PI/180,lp=(Number(b?.lookPitchDeg)||0)*Math.PI/180;
  if(para){const c=para.p;camera.up.set(0,0,1);camera.position.set(c.x,c.y-14,c.z+7);camera.lookAt(c.x,c.y,c.z+2);camera.fov=70;camera.near=.5;camera.far=Math.max(camera.far,20000);camera.updateProjectionMatrix();camera.updateMatrixWorld();return{active:true,mode:"jet-chute"};}
  if(!jet)return{active:false};syncAirframe(jet);
  fwd.copy(Y).applyQuaternion(jet.q);upv.copy(Z).applyQuaternion(jet.q);
  if(camMode==="cockpit"){camera.position.copy(cockpitEye).applyQuaternion(jet.q).add(jet.p);camera.up.copy(upv);camLook.copy(camera.position).add(fwd);camera.lookAt(camLook);camera.rotateY(-ly);camera.rotateX(lp);}
  else{const s=jet.v.length(),dist=22+Math.min(14,s/40);tmp.copy(fwd).multiplyScalar(-dist).addScaledVector(upv,6.5);if(ly)tmp.applyAxisAngle(upv,-ly);if(!camInit){camOff.copy(tmp);camInit=true;}camOff.lerp(tmp,1-Math.exp(-((now-(applyCamera.t||now))/1000||1/60)*6));applyCamera.t=now;camera.position.copy(jet.p).add(camOff);camera.up.copy(upv).lerp(Z,.35).normalize();camLook.copy(jet.p).addScaledVector(fwd,30);camera.lookAt(camLook);camera.rotateX(lp*.6);}
  camera.fov=clamp(66+jet.v.length()/30,66,90);camera.near=camMode==="cockpit"?.5:1;camera.far=Math.max(camera.far,20000);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  return{active:true,mode:camMode==="cockpit"?"jet-cockpit":"jet"};
}

// ------------------------------------------------------------ UI
function ui(){
  const view=viewport();if(!view)return;
  if(!document.getElementById("jetHud")){const h=document.createElement("div");h.id="jetHud";h.innerHTML=`<svg class="jet-svg" aria-hidden="true"><line class="jet-city-line" x1="0" y1="0" x2="0" y2="0"/><circle class="jet-city-dot" r="3.5" cx="-20" cy="-20"/><g class="jet-fpm"><circle r="7" cx="0" cy="0"/><line x1="-17" y1="0" x2="-7" y2="0"/><line x1="7" y1="0" x2="17" y2="0"/><line x1="0" y1="-7" x2="0" y2="-13"/></g></svg><div class="jet-city"><b data-k="city"></b><small data-k="cityd"></small></div><div class="jet-read jet-left"><small>SPD</small><b data-k="spd">0</b><small>KM/H</small><b data-k="mach">M 0.00</b><b data-k="aoa">α 0°</b></div><div class="jet-read jet-right"><small>ALT</small><b data-k="alt">0</b><small>M</small><b data-k="g">1.0 G</b><b data-k="hp">HP 100</b></div><div class="jet-mode-row"><b data-k="mode">HOVER</b></div><div class="jet-thr"><i></i><span>SCHUB</span></div>
<div class="jet-btns"><button type="button" data-a="mode">⇄ FLUG</button><button type="button" data-a="rocket">RAKETE</button><button type="button" data-a="bomb">BOMBE</button><button type="button" data-a="cam">CAM</button><button type="button" data-a="exit">EJECT</button></div>`;view.appendChild(h);
    const st=document.createElement("style");st.dataset.jetMode="v3";st.textContent=`#jetHud{display:none;position:absolute;inset:0;z-index:31;pointer-events:none;font-family:Inter,system-ui,sans-serif;color:#fff}body.jet-mode #jetHud{display:block}
html body.jet-mode #soloLeft,html body.jet-mode #soloRight,html body.jet-mode #soloClearance,html body.jet-mode .solo-action,html body.jet-mode #vehicleHud,html body.jet-mode #airStrikeButton,html body.jet-mode #enterCarButton,html body.jet-mode #zombieRepair,html body.jet-mode #viewport #footHud #footWeaponToggle,html body.jet-mode #viewport #footWeaponToggle,html body.jet-mode #droneWeaponToggle,html body.jet-mode #viewport #footHud #footJump,html body.jet-mode #viewport #mobileGameplayDock #mobileGameplayWeapon,html body.jet-mode #viewport #mobileGameplayDock #mobileGameplayMode,html body.jet-mode #playerModeButton{display:none!important}#jetHud .jet-btns [data-a=mode]{border-color:#7fd3ff}#jetHud .jet-btns [data-a=mode][data-flight="1"]{background:#1d4c6be0}
#jetHud{--hud:#7dff9a;--hud-dim:#7dff9a99}#jetHud .jet-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}#jetHud .jet-svg line,#jetHud .jet-svg circle{stroke:var(--hud);stroke-width:1.4;fill:none;vector-effect:non-scaling-stroke}#jetHud .jet-city-line{stroke-dasharray:6 7;opacity:.55}#jetHud .jet-city-dot{fill:var(--hud)!important;opacity:.8}#jetHud .jet-fpm{opacity:.85}#jetHud .jet-city{position:absolute;left:50%;top:calc(max(8px,var(--solo-safe-top,env(safe-area-inset-top))) + 50px);transform:translateX(-50%);text-align:center;color:var(--hud);text-shadow:0 0 4px #000c,0 1px 2px #000;pointer-events:none;white-space:nowrap}#jetHud .jet-city b{display:block;font:700 13px/1.1 "Barlow Condensed",Inter,system-ui,sans-serif;letter-spacing:.22em}#jetHud .jet-city small{display:block;font:600 10px/1.2 Inter,system-ui,sans-serif;letter-spacing:.12em;opacity:.75}#jetHud .jet-read{position:absolute;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:3px;color:var(--hud);font:700 13px/1 "Barlow Condensed",Inter,system-ui,sans-serif;letter-spacing:.06em;text-shadow:0 0 4px #000c,0 1px 2px #000;pointer-events:none}#jetHud .jet-read b[data-k=spd],#jetHud .jet-read b[data-k=alt]{font-size:22px;padding:3px 6px;border:1.3px solid var(--hud-dim);border-radius:3px;min-width:54px;text-align:center}#jetHud .jet-read small{font:700 9px/1 Inter,system-ui,sans-serif;letter-spacing:.14em;opacity:.7}#jetHud .jet-left{left:calc(max(12px,var(--solo-safe-left,env(safe-area-inset-left))) + min(25vw,148px) + 52px);align-items:flex-end;text-align:right}#jetHud .jet-right{right:calc(max(12px,var(--solo-safe-right,env(safe-area-inset-right))) + min(25vw,148px) + 26px);align-items:flex-start}#jetHud [data-k=mach][data-super="1"]{color:#ffd27a}#jetHud [data-k=hp][data-low="1"]{color:#ff6a5a}#jetHud [data-k=aoa][data-high="1"]{color:#ffd27a}#jetHud .jet-mode-row{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(max(16px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + 52px);color:var(--hud);font:700 12px/1 "Barlow Condensed",Inter,system-ui,sans-serif;letter-spacing:.18em;text-shadow:0 0 4px #000c;pointer-events:none}body.jet-mode #navGuide{top:calc(max(8px,var(--solo-safe-top,env(safe-area-inset-top))) + 88px)}html body.jet-mode #viewport #worldLookHud{opacity:.8}#jetHud .jet-thr{position:absolute;left:calc(max(12px,var(--solo-safe-left,env(safe-area-inset-left))) + min(25vw,148px) + 26px);bottom:calc(max(16px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + 8px);width:12px;height:min(25vw,148px);border-radius:6px;background:#0d1118b8;border:1.5px solid #ffffff88;overflow:hidden}#jetHud .jet-thr i{position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(#ff7a1a,#f4d27a 25%,#8fa0ad)}#jetHud .jet-thr span{display:none}
#jetHud .jet-btns{position:absolute;left:50%;transform:translateX(-50%);bottom:max(16px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));display:flex;gap:8px;pointer-events:auto}#jetHud .jet-btns button{height:40px;min-width:60px;padding:0 10px;border-radius:10px;border:1.5px solid #7dff9a88;background:#08140cc0;color:#c9ffd6;font:900 12px/1 Inter;letter-spacing:.08em;touch-action:none}#jetHud .jet-btns [data-a=exit]{border-color:#ff5a4a}
#enterJetButton{position:absolute;z-index:30;left:50%;transform:translateX(-50%);bottom:calc(max(14px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + 118px);min-width:170px;height:46px;padding:0 18px;border-radius:14px;font:900 15px/1 "Nunito","Trebuchet MS",system-ui,sans-serif;letter-spacing:.06em;color:#0f2433;background:#7fd3ff;border:2.5px solid #fff;box-shadow:0 4px 0 #2d86b5;pointer-events:auto;touch-action:manipulation}body.jet-mode #enterJetButton{display:none!important}html body.jet-mode #viewport #footHud #footFire{display:block!important;pointer-events:auto!important}`;document.head.appendChild(st);
    for(const btn of h.querySelectorAll(".jet-btns button")){const a=btn.dataset.a;btn.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();if(a==="bomb")dropBomb();else if(a==="rocket")fireRocket();else if(a==="mode")toggleMode();else if(a==="cam"){camMode=camMode==="chase"?"cockpit":"chase";camInit=false;}else if(a==="exit")exit();});}}
  if(!document.getElementById("enterJetButton")){const b=document.createElement("button");b.id="enterJetButton";b.type="button";b.hidden=true;b.textContent="✈ JET EINSTEIGEN";b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();enter();});view.appendChild(b);}
}
function renderButtons(){const b=document.getElementById("enterJetButton");if(b){const show=!active&&Boolean(nearestParked())&&!globalThis.__arondightVehicleDrive?.active;if(b.hidden===show)b.hidden=!show;const cls=document.body.classList,t=cls.contains("pad-input")?"Ⓧ  ✈ JET EINSTEIGEN":cls.contains("desktop-input")?"F · ✈ JET EINSTEIGEN":"✈ JET EINSTEIGEN";if(b.textContent!==t)b.textContent=t;}
  const mb=document.querySelector('#jetHud [data-a=mode]');if(mb&&jet){const t=jet.af.mode==='flight'?'⇄ SCHWEBEN':'⇄ FLUG';if(mb.textContent!==t)mb.textContent=t;mb.dataset.flight=jet.af.mode==='flight'?'1':'0';}
  const e=document.querySelector('#jetHud [data-a=exit]');if(e){const landed=jet&&(jet.af.landed||(jet.af.contacts>=2&&jet.v.length()<4));const t=!jet||landed?"AUSSTEIGEN":"EJECT";if(e.textContent!==t)e.textContent=t;const hide=Boolean(para);if(e.hidden!==hide)e.hidden=hide;}}
// ------------------------------------------------------------ HUD: town below / ahead and a line to its centre
let city=null,cityBusy=false,cityAt=-Infinity,cityFrom=null;const hudP=new THREE.Vector3();
async function lookupCity(lon,lat){cityBusy=true;cityAt=performance.now();try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=de&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`,{signal:AbortSignal.timeout?.(8000)});if(r.ok){const j=await r.json(),a=j.address||{},name=j.name||a.city||a.town||a.village||a.municipality;if(name&&Number.isFinite(+j.lon)&&Number.isFinite(+j.lat))city={name:String(name).toUpperCase(),lon:+j.lon,lat:+j.lat};}}catch{}finally{cityBusy=false;}}
function screenOf(x,y,z,W,H){const c=bridge()?.presentedCamera?.()||bridge()?.threeCamera;if(!c)return null;hudP.set(x,y,z).project(c);const front=hudP.z<1;let sx=(hudP.x*.5+.5)*W,sy=(-hudP.y*.5+.5)*H;if(!front){sx=W-sx;sy=H-sy;}return{x:sx,y:sy,front};}
const svgCache=new Map();function svgEl(svg,sel){let e=svgCache.get(sel);if(!e||!e.isConnected){e=svg.querySelector(sel);svgCache.set(sel,e);}return e;}
function renderCityCue(h){const v=viewport(),svg=svgEl(h,".jet-svg");if(!v||!svg)return;const W=v.clientWidth,H=v.clientHeight;if(svg.dataset.vb!==`${W}x${H}`){svg.dataset.vb=`${W}x${H}`;svg.setAttribute("viewBox",`0 0 ${W} ${H}`);}
  const p=para?para.p:jet?.p;const line=svgEl(svg,".jet-city-line"),dot=svgEl(svg,".jet-city-dot"),fpm=svgEl(svg,".jet-fpm"),nameEl=hk(h,"city"),dEl=hk(h,"cityd");
  // flight path marker: where the jet is actually going
  if(jet&&!para&&jet.v.length()>15){const t=screenOf(jet.p.x+jet.v.x*4,jet.p.y+jet.v.y*4,jet.p.z+jet.v.z*4,W,H);if(t?.front){fpm.setAttribute("transform",`translate(${t.x.toFixed(1)},${t.y.toFixed(1)})`);fpm.style.display="";}else fpm.style.display="none";}else fpm.style.display="none";
  const g=p?geoOf(p.x,p.y):null;if(!g){line.style.display=dot.style.display="none";setText(nameEl,"");setText(dEl,"");return;}
  const now=performance.now();if(!cityBusy&&(now-cityAt>25000||!cityFrom||Math.hypot(p.x-cityFrom.x,p.y-cityFrom.y)>1500)){cityFrom={x:p.x,y:p.y};lookupCity(g[0],g[1]);}
  if(!city){line.style.display=dot.style.display="none";return;}const m=lngLatToLocal(city.lon,city.lat);if(!m){line.style.display=dot.style.display="none";return;}
  const dist=Math.hypot(m[0]-p.x,m[1]-p.y),gz=groundHeightAt(m[0],m[1]);setText(nameEl,city.name);const dt=dist<600?"ÜBER DEM ZENTRUM":`${(dist/1000).toFixed(dist>=10000?0:1).replace(".",",")} KM`;setText(dEl,dt);
  const t=screenOf(m[0],m[1],gz+20,W,H);if(!t||dist<600){line.style.display=dot.style.display="none";return;}
  let x=t.x,y=t.y;const cx=W/2,cy=H/2;if(!t.front||x<0||x>W||y<0||y>H){const dx=x-cx,dy=y-cy,k=Math.min((W*.46)/Math.max(1,Math.abs(dx)),(H*.42)/Math.max(1,Math.abs(dy)));x=cx+dx*k;y=cy+dy*k;}
  // the line runs from the centre ring (r 26) toward the town; the dot sits on the town centre
  const L=Math.hypot(x-cx,y-cy)||1,sx=cx+(x-cx)/L*26,sy=cy+(y-cy)/L*26;line.setAttribute("x1",sx.toFixed(1));line.setAttribute("y1",sy.toFixed(1));line.setAttribute("x2",x.toFixed(1));line.setAttribute("y2",y.toFixed(1));dot.setAttribute("cx",x.toFixed(1));dot.setAttribute("cy",y.toFixed(1));line.style.display=L>34?"":"none";dot.style.display="";}
const hudCache=new Map();function hk(h,k){let e=hudCache.get(k);if(!e||!e.isConnected){e=h.querySelector(`[data-k=${k}]`);hudCache.set(k,e);}return e;}
function renderHud(){const h=document.getElementById("jetHud");if(!h)return;try{renderCityCue(h);}catch{}if(para){setText(hk(h,'mode'),"FALLSCHIRM");return;}if(!jet)return;const af=jet.af,T=af.tele||{},s=jet.v.length(),m=machOf(s);
  setText(hk(h,'spd'),String(Math.round(s*3.6)));const mb=hk(h,'mach');mb.textContent=`M ${m.toFixed(2)}`;mb.dataset.super=m>=1?"1":"0";setText(hk(h,'alt'),String(Math.round(Number(T.agl)||0)));setText(hk(h,'g'),`${(Number(T.nz)||1).toFixed(1)} G`);
  const aoa=hk(h,'aoa'),a=s>20?(Number(T.alpha)||0)*57.3:0;aoa.textContent=`α ${Math.round(a)}°`;aoa.dataset.high=a>19?"1":"0";
  const ab=af.mode==="flight"&&af.lever>.86;setText(hk(h,'mode'),af.landed?"GELANDET":af.mode==="flight"?(Math.cos(af.nozzle)<.95?"ÜBERGANG":ab?"FLUG · AB":"FLUG"):(s>30?"BREMSEN":"SCHWEBEN"));
  const hp=hk(h,'hp'),pct=Math.round(jet.hp/HP_MAX*100);hp.textContent=jet.burning?`FEUER ${pct}`:`HP ${pct}`;hp.dataset.low=pct<40?"1":"0";
  h.querySelector(".jet-thr i").style.height=`${Math.round((af.mode==="flight"?af.lever:clamp(af.thrust/JET_SPEC.thrustMax,0,1))*100)}%`;}

// ------------------------------------------------------------ multiplayer
function session(){return bridge()?.vsSession||null;}
function selfId(){try{return String(session()?.getSelfId?.()||"");}catch{return"";}}
function localOffset(){const b=bridge(),o=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(o)&&o.length===2?[Number(o[0])||0,Number(o[1])||0]:[0,0];}
function canon(p){const o=localOffset();return[+(p.x+o[0]).toFixed(1),+(p.y+o[1]).toFixed(1),+p.z.toFixed(1)];}
function sendFx(extra){const s=session();if(!s?.sendFx)return;try{s.sendFx({type:"impact",objectId:"player-jet",id:`pj-${Date.now().toString(36)}-${(serial++).toString(36)}`,p:[0,0,0],playerId:selfId()||undefined,...extra});}catch{}}
// hits on another player's jet go to its owner (batched a little so a burst is one packet)
const pendingHits=new Map();let hitFlushAt=0;
function sendHit(owner,aid,dmg){if(!owner||!(dmg>0))return;const k=`${owner}|${aid}`;pendingHits.set(k,(pendingHits.get(k)||0)+dmg);if(!hitFlushAt)hitFlushAt=performance.now()+90;}
function flushHits(now){if(!hitFlushAt||now<hitFlushAt)return;hitFlushAt=0;for(const[k,dmg]of pendingHits){const[target,aid]=k.split("|");sendFx({kind:"jet-hit",target,aid,dmg:+dmg.toFixed(1)});}pendingHits.clear();}
function poseOut(){if(!active)return null;if(para){const c=para.p;return{x:c.x,y:c.y,z:c.z,q:[0,0,0,1],t:0,ab:0,gear:0,para:1,geo:geoOf(c.x,c.y)};}
  if(!jet)return null;const af=jet.af;return{x:jet.p.x,y:jet.p.y,z:jet.p.z,q:[jet.q.x,jet.q.y,jet.q.z,jet.q.w],t:+clamp(af.thrust/JET_SPEC.thrustMax,0,1).toFixed(2),ab:af.mode==="flight"&&af.lever>.86?1:0,gear:af.gearDown?1:0,para:0,hp:Math.round(jet.hp),geo:geoOf(jet.p.x,jet.p.y)};}
// every other jet this player owns (parked / ejected / wreck) rides in the pose
function ownedOut(){const out=[];for(const A of airframes.values()){if(A===jet)continue;const g=geoOf(A.p.x,A.p.y);if(!g)continue;out.push({i:A.id,g:[+g[0].toFixed(7),+g[1].toFixed(7)],z:+A.p.z.toFixed(2),q:[A.q.x,A.q.y,A.q.z,A.q.w].map(v=>+v.toFixed(4)),s:A.state==="wreck"?"w":A.state==="ghost"?"g":"p",gear:A.af.gearDown?1:0});if(out.length>=4)break;}return out;}
function peer(id,pose){let r=remote.get(id);if(!pose){if(r){r.model.parent?.remove(r.model);r.chute?.parent?.remove(r.chute);remote.delete(id);}return;}if(!ensureScene())return;
  if(!r){r={model:newJetModel({remoteAirframe:{owner:id,id:"flying"}}),chute:null,p:new THREE.Vector3(),q:new THREE.Quaternion(),tp:new THREE.Vector3(),tq:new THREE.Quaternion(),seen:0,init:false};r.model.name="PEER_JET";r.model.traverse(n=>{n.userData.vsPlayerId=id;});root.add(r.model);remote.set(id,r);}
  r.tp.set(+pose.x||0,+pose.y||0,+pose.z||0);if(Array.isArray(pose.q))r.tq.set(+pose.q[0]||0,+pose.q[1]||0,+pose.q[2]||0,Number.isFinite(+pose.q[3])?+pose.q[3]:1).normalize();r.t=+pose.t||0;r.ab=Number(pose.ab)===1;r.gear=Number(pose.gear)===1;r.para=Number(pose.para)===1;r.seen=performance.now();if(!r.init){r.p.copy(r.tp);r.q.copy(r.tq);r.init=true;}}
function peerAirframes(owner,list){if(!ensureScene())return;const seen=new Set(),now=performance.now();
  for(const e of Array.isArray(list)?list:[]){if(!e?.i||!Array.isArray(e.g))continue;const loc=lngLatToLocal(+e.g[0],+e.g[1]);if(!loc)continue;const key=`${owner}|${e.i}`;seen.add(key);let r=peerAir.get(key);
    if(!r){r={owner,aid:String(e.i),model:newJetModel({remoteAirframe:{owner,id:String(e.i)}}),p:new THREE.Vector3(loc[0],loc[1],+e.z||0),q:new THREE.Quaternion(),tp:new THREE.Vector3(),tq:new THREE.Quaternion(),wreck:false};r.model.name="PEER_JET_AIRFRAME";root.add(r.model);peerAir.set(key,r);}
    r.tp.set(loc[0],loc[1],+e.z||0);if(Array.isArray(e.q))r.tq.set(+e.q[0]||0,+e.q[1]||0,+e.q[2]||0,Number.isFinite(+e.q[3])?+e.q[3]:1).normalize();r.gear=Number(e.gear)===1;r.seen=now;if(e.s==="w"&&!r.wreck){r.wreck=true;scorch(r.model);}}
  for(const[key,r]of peerAir)if(r.owner===owner&&!seen.has(key)){r.model.parent?.remove(r.model);peerAir.delete(key);}}
function renderRemote(dt){const now=performance.now(),a=1-Math.exp(-dt*8);for(const[id,r]of remote){if(now-r.seen>3000){peer(id,null);continue;}r.p.lerp(r.tp,a);r.q.slerp(r.tq,a);
  if(r.para){r.model.visible=false;if(!r.chute)r.chute=makeChute();r.chute.visible=true;r.chute.position.copy(r.p);continue;}if(r.chute)r.chute.visible=false;
  r.model.visible=true;r.model.position.copy(r.p);r.model.quaternion.copy(r.q);r.model.userData.gear.visible=r.gear;const fl=r.model.userData.flame;if(fl){fl.scale.set(1,.4+r.t+(r.ab?1.2:0),1);fl.material.opacity=r.ab?.95:.5;}}
  for(const[key,r]of peerAir){if(now-r.seen>4000){r.model.parent?.remove(r.model);peerAir.delete(key);continue;}if(r.p.distanceTo(r.tp)>60)r.p.copy(r.tp);else r.p.lerp(r.tp,a);r.q.slerp(r.tq,a);r.model.position.copy(r.p);r.model.quaternion.copy(r.q);r.model.userData.gear.visible=r.gear&&!r.wreck;if(r.model.userData.flame)r.model.userData.flame.visible=false;}}
function onFx(e){const pk=e?.detail?.packet;if(pk?.objectId!=="player-jet")return;
  if(pk.kind==="jet-boom"){sfx("explosion",{gain:.5,playbackRate:.55});return;}
  if(pk.kind==="jet-hit"){const me=selfId();if(!me||String(pk.target)!==me)return;const A=String(pk.aid)==="flying"?jet:airframes.get(String(pk.aid||""));if(A)damageAirframe(A,clamp(Number(pk.dmg)||0,0,2000),`player:${String(pk.playerId||e?.detail?.peerId||"")}`);return;}
  if(pk.kind==="jet-destroyed"){const loc=Array.isArray(pk.g)?lngLatToLocal(+pk.g[0],+pk.g[1]):null,p=loc?new THREE.Vector3(loc[0],loc[1],Array.isArray(pk.p)?+pk.p[2]||0:groundHeightAt(loc[0],loc[1])):null;if(!p)return;
    // the same break-up here: the owner's jet (parked proxy or the flying one) comes apart where it was
    const owner=String(pk.playerId||e?.detail?.peerId||""),v=Array.isArray(pk.v)?new THREE.Vector3(+pk.v[0]||0,+pk.v[1]||0,+pk.v[2]||0):new THREE.Vector3();let model=null,q=null;
    const key=`${owner}|${pk.aid}`,pa=peerAir.get(key);if(pa){model=pa.model;q=pa.q.clone();peerAir.delete(key);}else{const r=remote.get(owner);if(r&&!r.para){model=r.model;q=r.q.clone();remote.delete(owner);}}
    if(model&&q)breakApart(model,p,q,v);globalThis.__fighterJets?.blast?.(p,{radiusM:14,maxDamage:180,scale:1.25,kind:"jet-wreck",remote:true});}}

// ------------------------------------------------------------ loop
let lastUi=0;
function frame(now=performance.now()){
  requestAnimationFrame(frame);const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;if(!bridge()?.threeScene)return;ensureScene();ensureProvider();
  if(now-lastUi>250){lastUi=now;ui();renderButtons();maybeSpawnPad(now);padFrame(now);}
  airframesFrame(now);if(debris.length)debrisFrame(now,dt);
  if(active){globalThis.__arondightWeaponLockUntil=Math.max(Number(globalThis.__arondightWeaponLockUntil)||0,now+250);// foot weapons stay holstered in the cockpit
    if(para)stepPara(dt);else if(jet)flyFrame(dt,now);
    if(active){const p=para?para.p:jet?.p,v=para?para.v:jet?.v;if(p){// the pilot is here: walker pose (streaming, MP, police), haze, far ground
        const w=walk(),h=jet?headingOf(jet.q):0;w?.setPose?.({x:p.x,y:p.y,yaw:walkYawOf(h),pitch:0});
        const alt=p.z-groundHeightAt(p.x,p.y);globalThis.__arondightFogScale=clamp(1-(alt-80)/1400,.14,1);farGround.update(p,v,now);}
      if(jet&&!para)updateVoice();renderHud();}}
  if(bombs.length)stepBombs(dt);if(rockets.length)stepRockets(dt);for(const t of tracerPool)if(t.m.visible&&performance.now()>t.until)t.m.visible=false;if(remote.size||peerAir.size)renderRemote(dt);flushHits(now);
  const v=viewport();if(v){const T=jet?.af?.tele;v.dataset.jetMode=active?(para?"chute":jet?`${jet.af.landed?"landed":jet.af.mode}/M${machOf(jet.v.length()).toFixed(2)}/${Math.round(Number(T?.agl)||0)}m/hp${Math.round(jet.hp)}`:"on"):`off/${airframes.size}a`;v.dataset.jetPhysics="box3d-6dof-aero-fbw-gear";}
}
export function installJetMode(){if(globalThis.__jetMode||typeof window==="undefined")return globalThis.__jetMode;
  addEventListener("pointerdown",onTapDown,{capture:true,passive:false});addEventListener("pointermove",onTapMove,{capture:true,passive:true});for(const t of["pointerup","pointercancel"])addEventListener(t,onTapUp,{capture:true,passive:true});
  addEventListener("keydown",e=>{if(e.metaKey||e.ctrlKey)return;if(!active){if(e.code==="KeyE"&&!e.repeat&&nearestParked()&&!globalThis.__arondightVehicleDrive?.active){if(enter()){e.preventDefault();e.stopImmediatePropagation();}}return;}
    if(["KeyW","KeyS","KeyA","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)){keys.add(e.code);e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="Space"){keys.add("Space");firing=!para;e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="KeyB"){dropBomb();e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="KeyR"){fireRocket();e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="KeyV"&&!e.repeat){toggleMode();e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="KeyC"){camMode=camMode==="chase"?"cockpit":"chase";camInit=false;e.stopImmediatePropagation();}else if(e.code==="KeyE"&&!e.repeat){exit();e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  addEventListener("keyup",e=>{keys.delete(e.code);if(e.code==="Space")firing=false;},{capture:true});addEventListener(VS_FX_EVENT,onFx);
  addEventListener("arondight:world-explosion",onExplosion);addEventListener("arondight:physics-body-hit",onBodyHit);addEventListener("arondight:remote-airframe-hit",onRemoteHit);addEventListener("arondight:world-physics-impact",onPhysicsImpact);
  addEventListener("arondight:world-reset",()=>{if(active){jet=null;para=null;finish(walk()?.position?.x||0,walk()?.position?.y||0,0);}for(const A of[...airframes.values()])removeAirframe(A);for(const d of debris.splice(0)){if(d.id)physics()?.removeBody?.(d.id);stopWorldCriticalDamage(`${d.id}-fire`);d.group.parent?.remove(d.group);}spawnPad=null;firstSeen=0;padEmptySince=0;});
  globalThis.__arondightStreamFocus=()=>{if(!active)return null;const p=para?para.p:jet?.p,v=para?para.v:jet?.v;return p?{x:p.x+(v?.x||0)*1.5,y:p.y+(v?.y||0)*1.5,z:p.z}:null;};
  globalThis.__jetMode={enter,exit,get active(){return active;},get landed(){return Boolean(jet&&(jet.af.landed||(jet.af.contacts>=2&&jet.v.length()<4)));},get parachute(){return Boolean(para);},get cockpit(){return active&&camMode==="cockpit"&&!para;},get pose(){return poseOut();},get pilotPosition(){return para?{x:para.p.x,y:para.p.y,z:para.p.z}:null;},get ownedAirframes(){return ownedOut();},peer,peerAirframes,
    get parked(){return[...airframes.values()].filter(A=>A.state==="parked").map(A=>({x:A.p.x,y:A.p.y,id:A.id,hp:A.hp,pad:Boolean(A.pad)}));},get airframes(){return[...airframes.values()].map(A=>({id:A.id,state:A.state,hp:A.hp,x:A.p.x,y:A.p.y,z:A.p.z}));},
    get state(){return jet?{p:jet.p.clone(),speed:jet.v.length(),mach:machOf(jet.v.length()),throttle:jet.af.lever,thrust:jet.af.thrust,g:jet.af.tele?.nz,mode:jet.af.mode,landed:jet.af.landed,hp:jet.hp,tele:{...jet.af.tele}}:para?{para:true,p:para.p.clone()}:null;},
    damage(id,amount,source="script"){const A=airframes.get(String(id))||(id==="flying"?jet:null);if(A)damageAirframe(A,Number(amount)||0,source);return A?A.hp:null;},
    set throttle(v){if(jet)jet.af.lever=clamp(+v||0,0,1);},version:JET_MODE_VERSION};
  requestAnimationFrame(frame);return globalThis.__jetMode;}
installJetMode();
