import * as THREE from "three";
import {jetModel,jetEngineAudio} from "./fighter_jets.mjs";
import {groundHeightAt,terrainRayDistance} from "./terrain_craters.mjs";
import {wantedPointInRing} from "./wanted_system_logic.mjs";
import {addTrauma} from "./camera_shake.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";
import {claimSticks,releaseSticks,sticks} from "./shared_sticks.mjs";
import {buildCharacter} from "./character_model.mjs";

// JET — a VTOL fighter (Harrier-style) that stands next to you at the start.
// Walk up to it, EINSTEIGEN, and it is yours:
//   * jet-borne (hover): vectored nozzles hold you up; left stick up/down =
//     climb/sink (snappy), left x = yaw, right stick tilts (push = forward,
//     nozzles swing aft and you accelerate). Past ~85 m/s the wings carry
//     you (wing-borne): left stick = throttle lever (stays put, afterburner
//     above 86 %), right stick = pitch/roll (push = nose down). Slow down
//     below ~60 m/s and the nozzles swing down again: hover, land anywhere.
//   * full flight model: density with altitude, transonic drag rise,
//     supersonic in afterburner (vapour cone + boom), G-limited pitch, stall.
//   * gun (FIRE), bombs, cockpit view (default) / chase (CAM).
//   * EJECT takes the pilot with you: seat fires, chute opens, you come
//     down on foot; the empty jet flies on and crashes. Landed: AUSSTEIGEN
//     and the jet stays parked where you left it.
//   * the same two on-screen sticks as on foot / in the car (shared_sticks).
//   * the world streams under you (map, buildings, terrain, roads follow the
//     jet) and a far satellite ground shows the real city to the horizon.
//   * multiplayer: the pilot IS the player — the regular player pose carries
//     the jet (pm:"jet"), peers see one person: the jet, then the chute.

export const JET_MODE_VERSION="vtol-jet-mode-v3-box3d-forces";
const MASS=12000,DRY_N=105000,AB_N=185000,AREA=24,CD0=.024,G=9.81,REBASE_M=6000,SOUND=340,STALL=50,GEAR_H=2.05,ENTER_M=9;
const bridge=()=>globalThis.__arondightRealWorld||null,viewport=()=>document.getElementById("viewport"),walk=()=>globalThis.__arondightWalkMode||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let active=false,jet=null,model=null,root=null,sceneRef=null,throttle=0,camMode="cockpit",keys=new Set(),firing=false,lastGun=0,lastFrame=performance.now(),camOff=new THREE.Vector3(),camInit=false,voice=null,serial=0,machWas=0,cone=null,coneUntil=0,para=null,baseFar=0,spawnPad=null,firstSeen=0,respawnAt=0;
const bombs=[],remote=new Map(),parked=[],ghosts=[];
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),fwd=new THREE.Vector3(),upv=new THREE.Vector3(),qd=new THREE.Quaternion(),X=new THREE.Vector3(1,0,0),Y=new THREE.Vector3(0,1,0),Z=new THREE.Vector3(0,0,1),eul=new THREE.Euler(0,0,0,"ZXY"),eulT=new THREE.Euler(0,0,0,"ZXY"),qt=new THREE.Quaternion();

// ------------------------------------------------------------ world helpers
function prisms(){return bridge()?.buildingCollisionSnapshot?.prisms||[];}
function hitsBuilding(p,pad=0){for(const pr of prisms()){const pts=pr.points;if(!pts||pts.length<3)continue;if(Math.abs(p.x-pts[0][0])>160||Math.abs(p.y-pts[0][1])>160)continue;
  const inside=wantedPointInRing(p.x,p.y,pts)||(pad>0&&(wantedPointInRing(p.x+pad,p.y,pts)||wantedPointInRing(p.x-pad,p.y,pts)||wantedPointInRing(p.x,p.y+pad,pts)||wantedPointInRing(p.x,p.y-pad,pts)));
  if(inside){const base=groundHeightAt(pts[0][0],pts[0][1]);if(p.z<base+(Number(pr.top)||8)&&p.z>base+(Number(pr.base)||0)-1)return true;}}return false;}
const rho=h=>1.225*Math.exp(-Math.max(0,h)/8500);
const machOf=s=>s/SOUND;
function cdOf(m){const bump=Math.exp(-(((m-1.02)/.16)**2))*.012+(m>1.02?.006:0);return CD0+bump;}
const EARTH=6378137;
function metersToLngLat(lon0,lat0,e,n){return[lon0+e/(EARTH*Math.max(.01,Math.cos(lat0*Math.PI/180)))*180/Math.PI,lat0+n/EARTH*180/Math.PI];}
function lngLatToLocal(lon,lat){const b=bridge();if(!b?.active||!Number.isFinite(b.originLon))return null;return[(lon-b.originLon)*Math.PI/180*EARTH*Math.max(.01,Math.cos(b.originLat*Math.PI/180)),(lat-b.originLat)*Math.PI/180*EARTH];}
const headingOf=q=>{tmp2.copy(Y).applyQuaternion(q);return Math.atan2(-tmp2.x,tmp2.y);};
const yawQuat=h=>new THREE.Quaternion().setFromAxisAngle(Z,h);
const walkYawOf=h=>Math.atan2(-Math.sin(h),Math.cos(h));// heading (CCW from +y) → walk yaw (forward = sin/cos)

// ------------------------------------------------------------ scene / models
function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&root?.parent===scene)return true;root?.parent?.remove(root);sceneRef=scene;root=new THREE.Group();root.name="PLAYER_JETS";scene.add(root);model=null;cone=null;chute=null;for(const p of parked)root.add(p.model);return true;}
function withGear(g){const gear=new THREE.Group();gear.name="GEAR";const m=new THREE.MeshStandardMaterial({color:0x22262b,roughness:.6,metalness:.4}),legG=new THREE.CylinderGeometry(.07,.07,1.3,6),wheelG=new THREE.CylinderGeometry(.28,.28,.2,10);
  for(const[x,y]of[[0,5.2],[1.9,-1.4],[-1.9,-1.4]]){const leg=new THREE.Mesh(legG,m);leg.rotation.x=Math.PI/2;leg.position.set(x,y,-1.35);const w=new THREE.Mesh(wheelG,m);w.rotation.z=Math.PI/2;w.position.set(x,y,-GEAR_H+.28);gear.add(leg,w);}
  gear.traverse(n=>{n.userData.flightFireIgnore=true;n.castShadow=true;});g.add(gear);g.userData.gear=gear;return g;}
function newJetModel(){return withGear(jetModel());}
function ensureModel(){if(model?.parent===root)return model;model=newJetModel();model.name="PLAYER_JET_MODEL";root.add(model);
  cone=new THREE.Mesh(new THREE.ConeGeometry(5.5,9,24,1,true),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));cone.rotation.x=Math.PI;cone.position.y=-1;cone.userData.flightFireIgnore=true;cone.raycast=()=>{};model.add(cone);return model;}
let chute=null;
function makeChute(){const c=new THREE.Group();c.name="PILOT_CHUTE";const canopy=new THREE.Mesh(new THREE.SphereGeometry(3.4,16,8,0,Math.PI*2,0,Math.PI/2.4),new THREE.MeshStandardMaterial({color:0xff7a1a,roughness:.8,side:THREE.DoubleSide}));canopy.position.z=6.2;canopy.scale.z=.55;
  const rig=buildCharacter({outfit:"player"}),pilot=rig.root;rig.gun.visible=false;rig.gunL.visible=false;for(const s of["L","R"]){rig.arms[s].sh.rotation.set(2.75,0,s==="L"?.32:-.32);rig.arms[s].el.rotation.set(.25,0,0);}rig.legs.L.hip.rotation.x=.15;rig.legs.R.hip.rotation.x=-.1;rig.legs.L.kn.rotation.x=-.2;pilot.position.z=-.3;const lines=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([0,1,2,3].flatMap(i=>{const a=i*Math.PI/2;return[new THREE.Vector3(0,0,1.45),new THREE.Vector3(Math.cos(a)*3,Math.sin(a)*3,5.7)];})),new THREE.LineBasicMaterial({color:0xdddddd}));
  c.add(canopy,pilot,lines);c.userData.canopy=canopy;c.traverse(n=>{n.userData.flightFireIgnore=true;n.raycast=()=>{};});root.add(c);return c;}
function ensureChute(){if(chute?.parent===root)return chute;chute=makeChute();return chute;}

// ------------------------------------------------------------ parked jets (the one at the start + wherever you land)
function freeSpot(x,y){for(let k=0;k<40;k++){const a=k*2.399,r=k?6+k*2.2:0,px=x+Math.cos(a)*r,py=y+Math.sin(a)*r,g=groundHeightAt(px,py);if(!hitsBuilding({x:px,y:py,z:g+2},9))return{x:px,y:py};}return{x,y};}
function park(x,y,heading,{pad=false}={}){if(!ensureScene())return null;const m=newJetModel();m.name="PARKED_JET";root.add(m);const p={x,y,heading,model:m,pad};parked.push(p);placeParked(p);return p;}
function placeParked(p){p.model.position.set(p.x,p.y,groundHeightAt(p.x,p.y)+GEAR_H);p.model.quaternion.copy(yawQuat(p.heading));p.model.userData.gear.visible=true;}
function startAnchor(){const w=walk(),h=globalThis.__arondightPlayerVehicleRuntime?.humanAnchor;if(w?.mode==="foot"&&w.position)return{x:w.position.x,y:w.position.y,yaw:Number(w.yaw)||0};if(h&&Number.isFinite(h.x))return{x:h.x,y:h.y,yaw:Number(h.yaw)||0};return null;}
function maybeSpawnPad(now){if(spawnPad||!ensureScene())return;const a=startAnchor();if(!a)return;if(!firstSeen)firstSeen=now;if(now-firstSeen<3500)return;
  // in front of the pilot, a little to the right: visible right at the start
  const fx=Math.sin(a.yaw),fy=Math.cos(a.yaw),s=freeSpot(a.x+fx*26+fy*8,a.y+fy*26-fx*8);spawnPad={x:s.x,y:s.y,heading:Math.atan2(-fx,fy)+Math.PI*.25};park(spawnPad.x,spawnPad.y,spawnPad.heading,{pad:true});}
function nearestParked(){const w=walk();if(w?.mode!=="foot"||!w.position||w.dead)return null;let best=null,bd=ENTER_M;for(const p of parked){const d=Math.hypot(p.x-w.position.x,p.y-w.position.y);if(d<bd){bd=d;best=p;}}return best;}

// ------------------------------------------------------------ enter / exit
// The jet is a Box3D rigid body (one box: fuselage + gear, real mass and
// inertia). Thrust, wing lift, drag, side force and the control torques are
// forces/torques on that body (rigid runtime setForces); gravity, contacts
// with the terrain, buildings and other vehicles are Box3D. No pose is ever
// written while flying.
const physics=()=>globalThis.__arondightWorldRigidBodies||null;
const HALF=[2.6,6.8,1.05],MODEL_LIFT=1.0,WING_S=26,SIDE_S=9,CL_ALPHA=4.3,CL_MAX=1.25;
const INERTIA=[MASS/12*((2*HALF[1])**2+(2*HALF[2])**2),MASS/12*((2*HALF[0])**2+(2*HALF[2])**2),MASS/12*((2*HALF[0])**2+(2*HALF[1])**2)];
let bodySerial=0;const bodyPos=new THREE.Vector3(),omega=new THREE.Vector3(),omegaB=new THREE.Vector3(),rightv=new THREE.Vector3(),force=new THREE.Vector3(),torque=new THREE.Vector3(),qinv=new THREE.Quaternion(),prevV=new THREE.Vector3();
function createBody(x,y,z,heading,v=null){const id=`player-jet-${(++bodySerial).toString(36)}`;const ok=physics()?.upsertBody?.({id,kind:"aircraft",position:[x,y,z],yaw:heading,halfExtents:HALF,massKg:MASS,linearDamping:0,angularDamping:.25,wheeled:false});if(!ok)return null;if(v)physics()?.setPose?.(id,{position:[x,y,z],velocity:[v.x,v.y,v.z]});return id;}
function readBody(j){const pose=physics()?.pose?.(j.id,j.pose);if(!pose)return false;j.pose=pose;j.q.set(pose.rotation[0],pose.rotation[1],pose.rotation[2],pose.rotation[3]);bodyPos.set(pose.position[0],pose.position[1],pose.position[2]);j.v.set(pose.velocity[0],pose.velocity[1],pose.velocity[2]);omega.set(...(pose.angularVelocity||[0,0,0]));upv.copy(Z).applyQuaternion(j.q);j.p.copy(bodyPos).addScaledVector(upv,MODEL_LIFT);return true;}
function enter(p=nearestParked()){
  if(active||!p||!ensureScene())return false;if(globalThis.__arondightVehicleDrive?.active)return false;
  const g=groundHeightAt(p.x,p.y),id=createBody(p.x,p.y,g+HALF[2]+.06,p.heading);if(!id)return false;
  parked.splice(parked.indexOf(p),1);p.model.parent?.remove(p.model);
  jet={id,pose:null,p:new THREE.Vector3(p.x,p.y,g+GEAR_H),q:yawQuat(p.heading),v:new THREE.Vector3(),g:1,ab:false,landed:true,wb:0,mode:"hover",rpm:0,born:performance.now(),onGround:true,weapon:"gun"};
  throttle=0;camMode="cockpit";camInit=false;para=null;active=true;ensureModel().visible=true;startVoice();prevV.set(0,0,0);
  const cam=bridge()?.threeCamera;if(cam)baseFar=cam.far;
  claimSticks({name:"jet",labels:{move:"STEIGEN / SCHUB",look:"KNÜPPEL",fire:"KANONE"},onFire:v=>{firing=Boolean(v)&&active&&!para;}});
  document.body.classList.add("jet-mode");renderButtons();window.dispatchEvent(new CustomEvent("arondight:vehicle-mode",{detail:{active:true,jet:true}}));return true;
}
function finish(x,y,heading){// back on foot at (x,y)
  active=false;firing=false;keys.clear();para=null;if(chute)chute.visible=false;stopVoice();releaseSticks();document.body.classList.remove("jet-mode");
  const s=freeSpot(x,y),w=walk();w?.setPose?.({x:s.x,y:s.y,yaw:walkYawOf(heading),pitch:0});
  const cam=bridge()?.threeCamera;if(cam&&baseFar){cam.far=baseFar;cam.updateProjectionMatrix();}farGround.hide();globalThis.__arondightFogScale=1;
  renderButtons();window.dispatchEvent(new CustomEvent("arondight:vehicle-mode",{detail:{active:false,jet:true}}));if(spawnPad&&!parked.some(p=>p.pad))respawnAt=performance.now()+25000;}
function exit(){
  if(!active||!jet||para)return false;const h=headingOf(jet.q);
  if(jet.landed||(jet.onGround&&jet.v.length()<4)){// step out: the jet stays parked right here
    physics()?.removeBody?.(jet.id);if(model){model.parent?.remove(model);model=null;cone=null;}const px=jet.p.x,py=jet.p.y;park(px,py,h);jet=null;finish(px+Math.cos(h)*5,py+Math.sin(h)*5,h);return true;}
  // EJECT: the seat takes the pilot; the empty jet keeps its body — no thrust, no controls — and goes down under real physics
  physics()?.setForces?.(jet.id,{});ghosts.push({id:jet.id,m:model,v:jet.v.clone(),pose:null});model=null;cone=null;
  upv.copy(Z).applyQuaternion(jet.q);para={p:jet.p.clone().addScaledVector(upv,2.8),v:jet.v.clone().addScaledVector(upv,jet.p.z-groundHeightAt(jet.p.x,jet.p.y)>20?22:12),t:performance.now()};jet=null;ensureChute().visible=true;firing=false;
  try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"explosion",{gain:.35,playbackRate:1.6});}catch{}addTrauma?.(.5);stopVoice();return true;
}
function crash(){const p=jet.p.clone();p.z=Math.max(p.z,groundHeightAt(p.x,p.y));physics()?.removeBody?.(jet.id);globalThis.__fighterJets?.blast?.(p);addTrauma?.(1);if(model){model.parent?.remove(model);model=null;cone=null;}const h=headingOf(jet.q);jet=null;
  try{globalThis.__arondightPlayerVitals?.damageTargets?.()?.find?.(t=>t.kind==="player")?.model?.damage?.(45);}catch{}finish(p.x+12,p.y+12,h);}
function toggleMode(){if(!jet)return;jet.mode=jet.mode==="hover"?"flight":"hover";if(jet.mode==="flight")throttle=Math.max(throttle,.85);try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"bounce",{gain:.25,playbackRate:.4});}catch{}renderButtons();}

// ------------------------------------------------------------ input
function readInputs(){
  const m=sticks.move,l=sticks.look;let lift=-m.y,yawIn=m.x,pitchIn=l.y,rollIn=l.x;// pitchIn + = stick pulled back = nose up
  if(keys.has("KeyW"))lift+=1;if(keys.has("KeyS"))lift-=1;if(keys.has("KeyA"))yawIn-=1;if(keys.has("KeyD"))yawIn+=1;if(keys.has("ArrowUp"))pitchIn-=1;if(keys.has("ArrowDown"))pitchIn+=1;if(keys.has("ArrowLeft"))rollIn-=1;if(keys.has("ArrowRight"))rollIn+=1;
  const pad=(navigator.getGamepads?.()||[]).find(g=>g&&g.connected);if(pad&&jet){const ax=a=>Math.abs(a)<.12?0:a;lift+=-ax(pad.axes[1]||0)+((pad.buttons[7]?.value||0)-(pad.buttons[6]?.value||0));yawIn+=ax(pad.axes[0]||0);rollIn+=ax(pad.axes[2]||0);pitchIn+=ax(pad.axes[3]||0);
    const a=Boolean(pad.buttons[0]?.pressed);if(a!==jet.padFire){firing=a;jet.padFire=a;}const x=Boolean(pad.buttons[2]?.pressed);if(x&&!jet.padBomb)dropBomb();jet.padBomb=x;const b=Boolean(pad.buttons[1]?.pressed);if(b&&!jet.padB)fireRocket();jet.padB=b;const lb=Boolean(pad.buttons[4]?.pressed);if(lb&&!jet.padLB)toggleMode();jet.padLB=lb;const yb=Boolean(pad.buttons[3]?.pressed);if(yb&&!jet.padY){jet.padY=yb;exit();return{lift:0,yawIn:0,pitchIn:0,rollIn:0};}jet.padY=yb;}
  return{lift:clamp(lift,-1,1),yawIn:clamp(yawIn,-1,1),pitchIn:clamp(pitchIn,-1,1),rollIn:clamp(rollIn,-1,1)};}

// ------------------------------------------------------------ flight model (forces on the Box3D body)
function toBody(out,v){return out.copy(v).applyQuaternion(qinv.copy(jet.q).invert());}
function step(dt,now){
  const j=jet;if(!readBody(j)){crash();return;}const inp=readInputs();if(!jet)return;j.rpm=Math.min(1,j.rpm+dt/1.8);
  fwd.copy(Y).applyQuaternion(j.q);upv.copy(Z).applyQuaternion(j.q);rightv.copy(X).applyQuaternion(j.q);
  const s=j.v.length(),dens=rho(j.p.z),gz=groundHeightAt(bodyPos.x,bodyPos.y),agl=bodyPos.z-HALF[2]-gz;j.onGround=agl<.25;
  // collision: a velocity change the forces did not make = we hit something
  if(now-j.born>800){const expected=tmp.copy(j.lastForce||force).multiplyScalar(dt/MASS);expected.z-=G*dt;const jump=tmp2.copy(j.v).sub(prevV).sub(expected).length();if(jump>13||(j.onGround&&upv.z<.25)){crash();return;}}prevV.copy(j.v);
  // nozzles: down = jet-borne (hover), aft = wing-borne (flight)
  j.wb+=clamp((j.mode==="flight"?1:0)-j.wb,-dt*.45,dt*.45);const phi=j.wb;
  if(j.mode==="flight")throttle=clamp(throttle+inp.lift*dt*.55,0,1);
  const vh=s>.5?tmp.copy(j.v).multiplyScalar(1/s):tmp.set(0,0,0),q=.5*dens*s*s;
  // wing: lift ⟂ airflow from the angle of attack, induced + parasitic drag, side force from sideslip
  const vf=j.v.dot(fwd),vu=j.v.dot(upv),vr=j.v.dot(rightv),alpha=Math.atan2(-vu,Math.max(.5,vf))+.035/* wing incidence */,beta=s>1?Math.asin(clamp(vr/s,-1,1)):0;
  let CL=clamp(CL_ALPHA*alpha,-CL_MAX,CL_MAX);if(Math.abs(alpha)>.32)CL*=Math.max(.3,1-(Math.abs(alpha)-.32)*3);
  force.set(0,0,0);
  if(s>1){const liftDir=tmp2.copy(upv).addScaledVector(vh,-upv.dot(vh));if(liftDir.lengthSq()>1e-6){liftDir.normalize();force.addScaledVector(liftDir,q*WING_S*CL);}
    const brake=phi>.5&&throttle<=.001&&inp.lift<-.4?.09:0,gear=j.landed||s<75?.02:0;force.addScaledVector(vh,-q*(WING_S*(cdOf(machOf(s))+.11*CL*CL+brake+gear)+.5));force.addScaledVector(rightv,-q*SIDE_S*2.5*beta);}
  const wingCarry=clamp(Math.abs(q*WING_S*CL)/(MASS*G),0,1);
  // engine: flight thrust along the nose; jet-borne thrust along the body's up, holding the commanded climb/sink rate (auto flare near the ground)
  const ab=phi>.5&&throttle>.86;j.ab=ab;const T=(ab?DRY_N+(AB_N-DRY_N)*(throttle-.86)/.14:DRY_N*throttle/.86)*Math.pow(dens/1.225,.7)*j.rpm;
  
  // below wing-borne speed part of the thrust stays vectored down (STOVL): the wings take over as they start to carry
  const support=Math.max(1-phi,s<85?(1-wingCarry)*clamp((85-s)/25,0,1):0);
  force.addScaledVector(fwd,T*phi*(1-.45*Math.min(1,support)));
  if(support>0){const vzT=Math.max(inp.lift>0?inp.lift*16:inp.lift*13,j.mode==="hover"?-(Math.max(0,agl)*.9+1.2):-30),vzCmd=j.mode==="hover"?vzT:Math.max(vzT,0)*0,aV=clamp(5.5*((j.mode==="hover"?vzCmd:0)-j.v.z),-11,24),Th=clamp(MASS*(G+aV)/Math.max(.4,upv.z),0,MASS*G*1.9)*j.rpm;force.addScaledVector(upv,Th*support);
    // jet-borne: puffer-jet translation and drag-free hover hold
    if(j.mode==="hover"){const push=Math.max(0,-inp.pitchIn);force.addScaledVector(fwd,MASS*push*9);const damp=(push>.2?.02:.35)*MASS*(1-phi);force.x-=j.v.x*damp;force.y-=j.v.y*damp;}}
  j.lastForce=(j.lastForce||new THREE.Vector3()).copy(force);
  // control torques: hover = attitude hold (tilt from the stick, heading from the rudder), flight = rate command; the body's inertia makes it real
  toBody(omegaB,omega);const target=tmp2.set(0,0,0);
  if(phi<1){eul.setFromQuaternion(j.q,"ZXY");j.heading=(j.heading??eul.z)-inp.yawIn*1.3*dt;if(Math.abs(angleTo(j.heading,eul.z))>.6)j.heading=eul.z;const pitchT=inp.pitchIn>0?inp.pitchIn*.38:inp.pitchIn*.12,rollT=inp.rollIn*.45;
    target.x+=(pitchT-eul.x)*4*(1-phi);target.y+=(rollT-eul.y)*4*(1-phi);target.z+=angleTo(eul.z,j.heading)*3*(1-phi);}
  if(phi>0){const lift=clamp(s/90,.25,1),gLim=Math.min(1.25,9*G/Math.max(60,s));target.x+=inp.pitchIn*gLim*lift*phi;// fly-by-wire: stick released = hold a level flight path (pitch toward γ = 0, more when banked)
    if(s>40&&Math.abs(inp.pitchIn)<.1){const gamma=Math.asin(clamp(j.v.z/s,-1,1)),bank=Math.acos(clamp(upv.z,0,1));target.x+=(-gamma*1.6+(1/Math.max(.35,Math.cos(bank))-1)*.08)*phi;}target.y+=inp.rollIn*3*lift*phi;target.z+=(-inp.yawIn*.35-beta*1.2*Math.min(1,s/60))*phi;j.heading=undefined;}
  if(j.onGround){target.x=-omegaB.x;target.y=-omegaB.y;}
  torque.set((target.x-omegaB.x)*6*INERTIA[0],(target.y-omegaB.y)*6*INERTIA[1],(target.z-omegaB.z)*5*INERTIA[2]).applyQuaternion(j.q);
  physics()?.setForces?.(j.id,{force:[force.x,force.y,force.z],torque:[torque.x,torque.y,torque.z]});
  // telemetry
  const dir=s>1?tmp.copy(j.v).normalize():null;if(j.dir&&dir){j.g=1+j.dir.angleTo(dir)/Math.max(dt,1e-3)*s/G;}else j.g=1;j.dir=dir?dir.clone():null;
  j.landed=j.onGround&&s<1.2&&inp.lift<=.15&&j.mode==="hover";
  const m2=machOf(s);if(m2>=1&&machWas<1){boom();coneUntil=now+1600;}machWas=m2;if(cone){const k=coneUntil>now?Math.min(1,(coneUntil-now)/600):Math.max(0,1-Math.abs(m2-1)/.05)*.5;cone.material.opacity=.45*k;cone.scale.setScalar(.8+Math.min(.6,Math.max(0,m2-.95)*2));}
  if(Math.abs(m2-1)<.06)addTrauma?.(.04);
  if(Math.hypot(bodyPos.x,bodyPos.y)>REBASE_M)rebase(bodyPos.x,bodyPos.y);
  if(firing)gun(now);
}
const angleTo=(a,b)=>{let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d;};
function stepPara(dt){const c=para,inp=readInputs(),age=(performance.now()-c.t)/1000;c.v.z-=G*dt;c.v.x*=1-.25*dt;c.v.y*=1-.25*dt;if(age>1.1){c.v.z+=(-6.5-c.v.z)*Math.min(1,dt*1.6);c.v.x+=(inp.rollIn*4-c.v.x)*Math.min(1,dt*.8);c.v.y+=(-inp.pitchIn*4-c.v.y)*Math.min(1,dt*.8);}
  c.p.addScaledVector(c.v,dt);const ch=ensureChute();ch.visible=true;ch.position.copy(c.p);ch.userData.canopy.visible=age>1.1;ch.rotation.z=Math.atan2(c.v.y,c.v.x)-Math.PI/2;const gz=groundHeightAt(c.p.x,c.p.y);
  if(c.p.z<=gz+.2||(age>1.5&&hitsBuilding(c.p))){ch.visible=false;finish(c.p.x,c.p.y,Math.atan2(-c.v.x,c.v.y||1));}}
// the empty jet after an eject: its body falls under Box3D until it hits something
function stepGhosts(dt){for(let i=ghosts.length-1;i>=0;i--){const g=ghosts[i],pose=physics()?.pose?.(g.id,g.pose);if(!pose){g.m?.parent?.remove(g.m);ghosts.splice(i,1);continue;}g.pose=pose;const v=tmp.set(...pose.velocity),q=qd.set(...pose.rotation);upv.copy(Z).applyQuaternion(q);
  if(g.m){g.m.position.set(...pose.position).addScaledVector(upv,MODEL_LIFT);g.m.quaternion.copy(q);}const hitJump=tmp2.copy(v).sub(g.v);hitJump.z+=G*dt;g.v.copy(v);
  if(hitJump.length()>9){const p=new THREE.Vector3(...pose.position);physics()?.removeBody?.(g.id);globalThis.__fighterJets?.blast?.(p);g.m?.parent?.remove(g.m);ghosts.splice(i,1);}}}
function rebase(dx,dy){const b=bridge();if(!b?.active||!Number.isFinite(b.originLon)||!Number.isFinite(b.originLat))return;const[lon,lat]=metersToLngLat(b.originLon,b.originLat,dx,dy);
  b.originLon=lon;b.originLat=lat;b.lastMapSyncMs=-Infinity;b.lastMapView=null;b.lastViewportSize="";b.minimapLastQueryMs=-Infinity;b.minimapLastDrawMs=-Infinity;b.buildingCollisionDirty=true;b.clearBuildingCollisions?.();try{b.map?.jumpTo?.({center:[lon,lat]});}catch{}
  const shiftBody=id=>{const p=physics()?.pose?.(id);if(p)physics()?.setPose?.(id,{position:[p.position[0]-dx,p.position[1]-dy,p.position[2]],velocity:[...p.velocity],angularVelocity:[...(p.angularVelocity||[0,0,0])]});};
  if(jet){shiftBody(jet.id);jet.p.x-=dx;jet.p.y-=dy;}for(const g of ghosts)shiftBody(g.id);
  const shift=o=>{if(o){o.x-=dx;o.y-=dy;}};shift(para?.p);for(const bb of bombs)shift(bb.p);for(const r of rockets)shift(r.p);for(const p of parked){p.x-=dx;p.y-=dy;placeParked(p);}if(spawnPad){spawnPad.x-=dx;spawnPad.y-=dy;}farGround.invalidate();
  const v=viewport();if(v){v.dataset.jetRebases=String((Number(v.dataset.jetRebases)||0)+1);v.dataset.worldLongitude=String(lon);v.dataset.worldLatitude=String(lat);}}

// ------------------------------------------------------------ weapons
function gun(now){if(now-lastGun<55)return;lastGun=now;fwd.copy(Y).applyQuaternion(jet.q);const o=jet.p.clone().addScaledVector(fwd,9),d=fwd.clone();d.x+=(Math.random()-.5)*.006;d.y+=(Math.random()-.5)*.006;d.z+=(Math.random()-.5)*.006;d.normalize();
  const rt=globalThis.__arondightWorldRigidBodies?.raycast?.([o.x,o.y,o.z],[d.x,d.y,d.z],1800);let dist=1800,pt=null;if(rt?.point){pt=new THREE.Vector3(...rt.point);dist=o.distanceTo(pt);}else{const tr=terrainRayDistance(o,d,1800);if(Number.isFinite(tr)){dist=tr;pt=o.clone().addScaledVector(d,tr);}}
  tracer(o,o.clone().addScaledVector(d,Math.min(dist,600)));
  if(pt){globalThis.__worldImpacts?.bullet?.({origin:o,direction:d},rt?.point?{box3d:true,point:pt,distance:dist,worldNormal:new THREE.Vector3(...(rt.normal||[0,0,1])),physicsKind:rt.kind,physicsId:rt.id}:null,{maxDistance:1800});
    if(Math.random()<.34)window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[pt.x,pt.y,pt.z],radiusM:3.2,maxDamage:70,kind:"cannon"}}));}
  try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"shot",{gain:.32,playbackRate:.7,minIntervalMs:40});}catch{}}
const tracerPool=[];function tracer(a,b){let t=tracerPool.find(x=>!x.m.visible);if(!t){if(tracerPool.length>24)t=tracerPool[0];else{const m=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,1,5,1,true),new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));m.userData.flightFireIgnore=true;m.raycast=()=>{};root.add(m);t={m,until:0};tracerPool.push(t);}}
  tmp.subVectors(b,a);const len=tmp.length();t.m.position.copy(a).addScaledVector(tmp,.5);t.m.quaternion.setFromUnitVectors(Y,tmp.normalize());t.m.scale.set(1,len,1);t.m.visible=true;t.until=performance.now()+45;}
function dropBomb(){if(!active||!jet||jet.landed||(jet.lastBomb&&performance.now()-jet.lastBomb<450))return;jet.lastBomb=performance.now();const m=new THREE.Mesh(new THREE.CapsuleGeometry(.25,1.4,3,8),new THREE.MeshStandardMaterial({color:0x3b4135,roughness:.6}));m.userData.flightFireIgnore=true;m.raycast=()=>{};root.add(m);
  bombs.push({m,p:jet.p.clone().addScaledVector(Z.clone().applyQuaternion(jet.q),-1.2),v:jet.v.clone()});try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"bounce",{gain:.4,playbackRate:.5});}catch{}}
// unguided rockets from the wing pods: fast, straight, a real blast where they hit
const rockets=[];let rocketSide=1;
function fireRocket(){if(!active||!jet||jet.onGround||(jet.lastRocket&&performance.now()-jet.lastRocket<350))return;jet.lastRocket=performance.now();fwd.copy(Y).applyQuaternion(jet.q);rightv.copy(X).applyQuaternion(jet.q);rocketSide=-rocketSide;
  const m=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,1.4,6),new THREE.MeshBasicMaterial({color:0xfff0c0}));m.userData.flightFireIgnore=true;m.raycast=()=>{};const fl=new THREE.Mesh(new THREE.SphereGeometry(.25,6,4),new THREE.MeshBasicMaterial({color:0xffa040,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));fl.position.y=-.8;m.add(fl);root.add(m);
  rockets.push({m,p:jet.p.clone().addScaledVector(rightv,rocketSide*2.2).addScaledVector(Z.clone().applyQuaternion(jet.q),-.4),v:jet.v.clone().addScaledVector(fwd,260),life:5});try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"explosion",{gain:.25,playbackRate:1.8});}catch{}}
function stepRockets(dt){for(let i=rockets.length-1;i>=0;i--){const r=rockets[i],prev=r.p.clone();r.v.z-=G*.15*dt;r.p.addScaledVector(r.v,dt);r.life-=dt;r.m.position.copy(r.p);r.m.quaternion.setFromUnitVectors(Y,tmp.copy(r.v).normalize());const gz=groundHeightAt(r.p.x,r.p.y);
  const d=tmp.copy(r.v).normalize(),rt=globalThis.__arondightWorldRigidBodies?.raycast?.([prev.x,prev.y,prev.z],[d.x,d.y,d.z],prev.distanceTo(r.p)+.5);let hit=rt?.point?new THREE.Vector3(...rt.point):null;if(!hit&&(r.p.z<=gz+.2||hitsBuilding(r.p)))hit=r.p.clone().setZ(Math.max(r.p.z,gz));
  if(hit||r.life<=0){if(hit)globalThis.__fighterJets?.blast?.(hit,{radiusM:8,maxDamage:120,scale:.55,kind:"jet-rocket"});r.m.parent?.remove(r.m);rockets.splice(i,1);}}}
function stepBombs(dt){for(let i=bombs.length-1;i>=0;i--){const b=bombs[i];b.v.z-=G*dt;b.v.multiplyScalar(1-.04*dt);b.p.addScaledVector(b.v,dt);b.m.position.copy(b.p);if(b.v.lengthSq()>1)b.m.quaternion.setFromUnitVectors(Z,tmp.copy(b.v).normalize().negate());const gz=groundHeightAt(b.p.x,b.p.y);
  if(b.p.z<=gz+.3||hitsBuilding(b.p)){b.p.z=Math.max(b.p.z,gz);globalThis.__fighterJets?.blast?.(b.p.clone());b.m.parent?.remove(b.m);bombs.splice(i,1);}}}
function boom(){try{const c=getSharedCombatAudioContext();if(c?.state==="running"){playCombatAudio(c,"explosion",{gain:.9,playbackRate:.55});setTimeout(()=>playCombatAudio(c,"explosion",{gain:.6,playbackRate:.62}),120);}}catch{}addTrauma?.(.6);sendFx({kind:"jet-boom",p:canon(jet.p)});}

// ------------------------------------------------------------ engine sound
function startVoice(){const a=jetEngineAudio();if(!a||voice)return;const c=a.ctx,src=c.createBufferSource();src.buffer=a.buffer;src.loop=true;const lp=c.createBiquadFilter();lp.type="lowpass";lp.frequency.value=1200;const g=c.createGain();g.gain.value=0;src.connect(lp);lp.connect(g);g.connect(a.master||c.destination);src.start();voice={src,lp,g,c};}
function stopVoice(){if(!voice)return;try{voice.g.gain.setTargetAtTime(0,voice.c.currentTime,.2);voice.src.stop(voice.c.currentTime+.8);}catch{}voice=null;}
function updateVoice(){if(!voice)startVoice();if(!voice||!jet)return;const t=voice.c.currentTime,ab=jet.ab,pw=Math.max(throttle*jet.wb,(1-jet.wb)*.75)*jet.rpm,cockpit=camMode==="cockpit";voice.g.gain.setTargetAtTime((.1+pw*.4+(ab?.25:0))*(cockpit?.55:1)*jet.rpm,t,.08);voice.src.playbackRate.setTargetAtTime(.4+pw*.7+(ab?.12:0),t,.08);voice.lp.frequency.setTargetAtTime((700+pw*2800+(ab?2500:0))*(cockpit?.6:1),t,.08);}

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
  if(!jet)return{active:false};const m=ensureModel();m.position.copy(jet.p);m.quaternion.copy(jet.q);m.userData.gear.visible=jet.landed||(jet.v.length()<75&&jet.p.z-groundHeightAt(jet.p.x,jet.p.y)<160);
  const fl=m.userData.flame;if(fl){fl.scale.set(1,(.3+throttle*jet.wb*1.1+(jet.ab?1.2:0))*(.9+Math.random()*.2),1);fl.material.opacity=jet.ab?.95:.2+throttle*jet.wb*.4;}if(m.userData.glow)m.userData.glow.intensity=0;
  fwd.copy(Y).applyQuaternion(jet.q);upv.copy(Z).applyQuaternion(jet.q);m.visible=true;
  if(camMode==="cockpit"){camera.position.copy(cockpitEye).applyQuaternion(jet.q).add(jet.p);camera.up.copy(upv);camLook.copy(camera.position).add(fwd);camera.lookAt(camLook);camera.rotateY(-ly);camera.rotateX(lp);}
  else{const s=jet.v.length(),dist=22+Math.min(14,s/40);tmp.copy(fwd).multiplyScalar(-dist).addScaledVector(upv,6.5);if(ly)tmp.applyAxisAngle(upv,-ly);if(!camInit){camOff.copy(tmp);camInit=true;}camOff.lerp(tmp,1-Math.exp(-((now-(applyCamera.t||now))/1000||1/60)*6));applyCamera.t=now;camera.position.copy(jet.p).add(camOff);camera.up.copy(upv).lerp(Z,.35).normalize();camLook.copy(jet.p).addScaledVector(fwd,30);camera.lookAt(camLook);camera.rotateX(lp*.6);}
  camera.fov=clamp(66+jet.v.length()/30,66,90);camera.near=camMode==="cockpit"?.5:1;camera.far=Math.max(camera.far,20000);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  return{active:true,mode:camMode==="cockpit"?"jet-cockpit":"jet"};
}

// ------------------------------------------------------------ UI
function ui(){
  const view=viewport();if(!view)return;
  if(!document.getElementById("jetHud")){const h=document.createElement("div");h.id="jetHud";h.innerHTML=`<div class="jet-read"><b data-k="spd">0</b><small>KM/H</small><b data-k="mach">M 0.00</b><b data-k="alt">0</b><small>M</small><b data-k="g">1.0 G</b><b data-k="mode">HOVER</b></div><div class="jet-thr"><i></i><span>SCHUB</span></div>
<div class="jet-btns"><button type="button" data-a="mode">⇄ FLUG</button><button type="button" data-a="rocket">RAKETE</button><button type="button" data-a="bomb">BOMBE</button><button type="button" data-a="cam">CAM</button><button type="button" data-a="exit">EJECT</button></div>`;view.appendChild(h);
    const st=document.createElement("style");st.dataset.jetMode="v2";st.textContent=`#jetHud{display:none;position:absolute;inset:0;z-index:31;pointer-events:none;font-family:Inter,system-ui,sans-serif;color:#fff}body.jet-mode #jetHud{display:block}
html body.jet-mode #soloLeft,html body.jet-mode #soloRight,html body.jet-mode #soloClearance,html body.jet-mode .solo-action,html body.jet-mode #vehicleHud,html body.jet-mode #airStrikeButton,html body.jet-mode #enterCarButton,html body.jet-mode #zombieRepair,html body.jet-mode #viewport #footHud #footWeaponToggle,html body.jet-mode #viewport #footWeaponToggle,html body.jet-mode #droneWeaponToggle,html body.jet-mode #viewport #footHud #footJump,html body.jet-mode #viewport #mobileGameplayDock #mobileGameplayWeapon,html body.jet-mode #viewport #mobileGameplayDock #mobileGameplayMode,html body.jet-mode #playerModeButton{display:none!important}#jetHud .jet-btns [data-a=mode]{border-color:#7fd3ff}#jetHud .jet-btns [data-a=mode][data-flight="1"]{background:#1d4c6be0}
#jetHud .jet-read{position:absolute;left:50%;top:max(56px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 50px));transform:translateX(-50%);display:flex;gap:10px;align-items:baseline;font:800 18px/1 "Barlow Condensed",Inter,sans-serif;text-shadow:0 2px 4px #000;white-space:nowrap}#jetHud .jet-read small{font:700 10px/1 Inter;opacity:.7;margin-left:-6px}#jetHud [data-k=mach][data-super="1"]{color:#ffb27a}#jetHud [data-k=mode]{font-size:13px;padding:3px 6px;border:1.5px solid #ffffffaa;border-radius:6px}
#jetHud .jet-thr{position:absolute;left:calc(max(12px,var(--solo-safe-left,env(safe-area-inset-left))) + min(25vw,148px) + 26px);bottom:calc(max(16px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + 8px);width:12px;height:min(25vw,148px);border-radius:6px;background:#0d1118b8;border:1.5px solid #ffffff88;overflow:hidden}#jetHud .jet-thr i{position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(#ff7a1a,#f4d27a 25%,#8fa0ad)}#jetHud .jet-thr span{display:none}
#jetHud .jet-btns{position:absolute;left:50%;transform:translateX(-50%);bottom:max(16px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));display:flex;gap:8px;pointer-events:auto}#jetHud .jet-btns button{height:42px;min-width:62px;padding:0 10px;border-radius:12px;border:2px solid #ffffffaa;background:#0d1118c8;color:#fff;font:900 12px/1 Inter;letter-spacing:.08em;touch-action:none}#jetHud .jet-btns [data-a=exit]{border-color:#ff5a4a}
#enterJetButton{position:absolute;z-index:30;left:50%;transform:translateX(-50%);bottom:calc(max(14px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + 118px);min-width:170px;height:46px;padding:0 18px;border-radius:14px;font:900 15px/1 "Nunito","Trebuchet MS",system-ui,sans-serif;letter-spacing:.06em;color:#0f2433;background:#7fd3ff;border:2.5px solid #fff;box-shadow:0 4px 0 #2d86b5;pointer-events:auto;touch-action:manipulation}body.jet-mode #enterJetButton{display:none!important}html body.jet-mode #viewport #footHud #footFire{display:block!important;pointer-events:auto!important}`;document.head.appendChild(st);
    for(const btn of h.querySelectorAll(".jet-btns button")){const a=btn.dataset.a;btn.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();if(a==="bomb")dropBomb();else if(a==="rocket")fireRocket();else if(a==="mode")toggleMode();else if(a==="cam"){camMode=camMode==="chase"?"cockpit":"chase";camInit=false;}else if(a==="exit")exit();});}}
  if(!document.getElementById("enterJetButton")){const b=document.createElement("button");b.id="enterJetButton";b.type="button";b.hidden=true;b.textContent="✈ JET EINSTEIGEN";b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();enter();});view.appendChild(b);}
}
function renderButtons(){const b=document.getElementById("enterJetButton");if(b){const show=!active&&Boolean(nearestParked())&&!globalThis.__arondightVehicleDrive?.active;if(b.hidden===show)b.hidden=!show;}const mb=document.querySelector('#jetHud [data-a=mode]');if(mb&&jet){const t=jet.mode==='flight'?'⇄ SCHWEBEN':'⇄ FLUG';if(mb.textContent!==t)mb.textContent=t;mb.dataset.flight=jet.mode==='flight'?'1':'0';}const e=document.querySelector('#jetHud [data-a=exit]');if(e){const t=!jet||jet.landed?"AUSSTEIGEN":"EJECT";if(e.textContent!==t)e.textContent=t;const hide=Boolean(para);if(e.hidden!==hide)e.hidden=hide;}}
function renderHud(){const h=document.getElementById("jetHud");if(!h)return;if(para){h.querySelector('[data-k=mode]').textContent="FALLSCHIRM";return;}if(!jet)return;const s=jet.v.length(),m=machOf(s);h.querySelector('[data-k=spd]').textContent=String(Math.round(s*3.6));const mb=h.querySelector('[data-k=mach]');mb.textContent=`M ${m.toFixed(2)}`;mb.dataset.super=m>=1?"1":"0";h.querySelector('[data-k=alt]').textContent=String(Math.max(0,Math.round(jet.p.z-GEAR_H-groundHeightAt(jet.p.x,jet.p.y))));h.querySelector('[data-k=g]').textContent=`${(jet.g||1).toFixed(1)} G`;
  h.querySelector('[data-k=mode]').textContent=jet.landed?"GELANDET":jet.mode==="flight"?(jet.wb<.95?"ÜBERGANG":jet.ab?"FLUG · AB":"FLUG"):"SCHWEBEN";h.querySelector(".jet-thr i").style.height=`${Math.round((jet.wb>.5?throttle:(1-jet.wb)*.6*jet.rpm)*100)}%`;}

// ------------------------------------------------------------ multiplayer: the player pose carries the jet (player_vehicle_runtime_v2)
function session(){return bridge()?.vsSession||null;}
function selfId(){try{return String(session()?.getSelfId?.()||"");}catch{return"";}}
function localOffset(){const b=bridge(),o=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(o)&&o.length===2?[Number(o[0])||0,Number(o[1])||0]:[0,0];}
function canon(p){const o=localOffset();return[+(p.x+o[0]).toFixed(1),+(p.y+o[1]).toFixed(1),+p.z.toFixed(1)];}
function sendFx(extra){const s=session();if(!s?.sendFx)return;try{s.sendFx({type:"impact",objectId:"player-jet",id:`pj-${Date.now().toString(36)}-${(serial++).toString(36)}`,p:[0,0,0],playerId:selfId()||undefined,...extra});}catch{}}
function geoOf(x,y){const b=bridge();return b?.active&&Number.isFinite(b.originLon)?metersToLngLat(b.originLon,b.originLat,x,y):null;}
function poseOut(){if(!active)return null;if(para){const c=para.p;return{x:c.x,y:c.y,z:c.z,q:[0,0,0,1],t:0,ab:0,gear:0,para:1,geo:geoOf(c.x,c.y)};}
  if(!jet)return null;return{x:jet.p.x,y:jet.p.y,z:jet.p.z,q:[jet.q.x,jet.q.y,jet.q.z,jet.q.w],t:jet.wb>.5?throttle:0,ab:jet.ab?1:0,gear:jet.landed||jet.v.length()<75?1:0,para:0,geo:geoOf(jet.p.x,jet.p.y)};}
function peer(id,pose){let r=remote.get(id);if(!pose){if(r){r.model.parent?.remove(r.model);r.chute?.parent?.remove(r.chute);remote.delete(id);}return;}if(!ensureScene())return;
  if(!r){r={model:newJetModel(),chute:null,p:new THREE.Vector3(),q:new THREE.Quaternion(),tp:new THREE.Vector3(),tq:new THREE.Quaternion(),seen:0,init:false};r.model.name="PEER_JET";r.model.traverse(n=>{n.userData.vsPlayerId=id;});root.add(r.model);remote.set(id,r);}
  r.tp.set(+pose.x||0,+pose.y||0,+pose.z||0);if(Array.isArray(pose.q))r.tq.set(+pose.q[0]||0,+pose.q[1]||0,+pose.q[2]||0,Number.isFinite(+pose.q[3])?+pose.q[3]:1).normalize();r.t=+pose.t||0;r.ab=Number(pose.ab)===1;r.gear=Number(pose.gear)===1;r.para=Number(pose.para)===1;r.seen=performance.now();if(!r.init){r.p.copy(r.tp);r.q.copy(r.tq);r.init=true;}}
function renderRemote(dt){const now=performance.now(),a=1-Math.exp(-dt*8);for(const[id,r]of remote){if(now-r.seen>3000){peer(id,null);continue;}r.p.lerp(r.tp,a);r.q.slerp(r.tq,a);
  if(r.para){r.model.visible=false;if(!r.chute)r.chute=makeChute();r.chute.visible=true;r.chute.position.copy(r.p);continue;}if(r.chute)r.chute.visible=false;
  r.model.visible=true;r.model.position.copy(r.p);r.model.quaternion.copy(r.q);r.model.userData.gear.visible=r.gear;const fl=r.model.userData.flame;if(fl){fl.scale.set(1,.4+r.t+(r.ab?1.2:0),1);fl.material.opacity=r.ab?.95:.5;}}}
function onFx(e){const pk=e?.detail?.packet;if(pk?.objectId!=="player-jet")return;if(pk.kind==="jet-boom"){try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"explosion",{gain:.5,playbackRate:.55});}catch{}}}

// ------------------------------------------------------------ loop
let lastUi=0;
function frame(now=performance.now()){
  requestAnimationFrame(frame);const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;if(!bridge()?.threeScene)return;ensureScene();ensureProvider();
  if(now-lastUi>250){lastUi=now;ui();renderButtons();maybeSpawnPad(now);if(respawnAt&&now>respawnAt&&spawnPad&&!parked.some(p=>p.pad)){respawnAt=0;park(spawnPad.x,spawnPad.y,spawnPad.heading,{pad:true});}for(const p of parked)placeParked(p);}
  if(active){globalThis.__arondightWeaponLockUntil=Math.max(Number(globalThis.__arondightWeaponLockUntil)||0,now+250);// foot weapons stay holstered in the cockpit
    if(para)stepPara(dt);else if(jet){const sub=Math.max(1,Math.ceil(dt/.0125));for(let i=0;i<sub&&active&&jet&&!para;i++)step(dt/sub,now);}
    if(active){const p=para?para.p:jet?.p,v=para?para.v:jet?.v;if(p){// the pilot is here: walker pose (streaming, MP, police), haze, far ground
        const w=walk(),h=jet?headingOf(jet.q):0;w?.setPose?.({x:p.x,y:p.y,yaw:walkYawOf(h),pitch:0});
        const alt=p.z-groundHeightAt(p.x,p.y);globalThis.__arondightFogScale=clamp(1-(alt-80)/1400,.14,1);farGround.update(p,v,now);}
      if(jet&&!para)updateVoice();renderHud();}}
  if(bombs.length)stepBombs(dt);if(rockets.length)stepRockets(dt);if(ghosts.length)stepGhosts(dt);for(const t of tracerPool)if(t.m.visible&&performance.now()>t.until)t.m.visible=false;if(remote.size)renderRemote(dt);
  const v=viewport();if(v)v.dataset.jetMode=active?(para?"chute":jet?`${jet.landed?"landed":jet.wb>.5?"flight":"hover"}/M${machOf(jet.v.length()).toFixed(2)}/${Math.round(jet.p.z)}m`:"on"):`off/${parked.length}p`;
}
export function installJetMode(){if(globalThis.__jetMode||typeof window==="undefined")return globalThis.__jetMode;
  addEventListener("keydown",e=>{if(e.metaKey||e.ctrlKey)return;if(!active){if(e.code==="KeyE"&&!e.repeat&&nearestParked()&&!globalThis.__arondightVehicleDrive?.active){if(enter()){e.preventDefault();e.stopImmediatePropagation();}}return;}
    if(["KeyW","KeyS","KeyA","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)){keys.add(e.code);e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="Space"){firing=!para;e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="KeyB"){dropBomb();e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="KeyR"){fireRocket();e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="KeyV"&&!e.repeat){toggleMode();e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="KeyC"){camMode=camMode==="chase"?"cockpit":"chase";camInit=false;e.stopImmediatePropagation();}else if(e.code==="KeyE"&&!e.repeat){exit();e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  addEventListener("keyup",e=>{keys.delete(e.code);if(e.code==="Space")firing=false;},{capture:true});addEventListener(VS_FX_EVENT,onFx);
  addEventListener("arondight:world-reset",()=>{if(active){if(model){model.parent?.remove(model);model=null;}jet=null;para=null;finish(walk()?.position?.x||0,walk()?.position?.y||0,0);}for(const p of parked.splice(0))p.model.parent?.remove(p.model);spawnPad=null;firstSeen=0;respawnAt=0;});
  globalThis.__arondightStreamFocus=()=>{if(!active)return null;const p=para?para.p:jet?.p,v=para?para.v:jet?.v;return p?{x:p.x+(v?.x||0)*1.5,y:p.y+(v?.y||0)*1.5,z:p.z}:null;};
  globalThis.__jetMode={enter,exit,get active(){return active;},get cockpit(){return active&&camMode==="cockpit"&&!para;},get pose(){return poseOut();},peer,get parked(){return parked.map(p=>({x:p.x,y:p.y}));},
    get state(){return jet?{p:jet.p.clone(),speed:jet.v.length(),mach:machOf(jet.v.length()),throttle,g:jet.g,wb:jet.wb,landed:jet.landed}:para?{para:true,p:para.p.clone()}:null;},set throttle(v){throttle=clamp(+v||0,0,1);},version:JET_MODE_VERSION};
  requestAnimationFrame(frame);return globalThis.__jetMode;}
installJetMode();
