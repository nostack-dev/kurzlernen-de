import * as THREE from "three";
import {jetModel,jetEngineAudio} from "./fighter_jets.mjs";
import {groundHeightAt,terrainRayDistance} from "./terrain_craters.mjs";
import {wantedPointInRing} from "./wanted_system_logic.mjs";
import {addTrauma} from "./camera_shake.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";

// JET — fly a fighter. A full flight model (not an arcade glide):
//   * thrust from a throttle lever (Schubhebel) with an afterburner detent,
//     altitude-dependent air density, drag with the transonic drag rise, so
//     the jet goes supersonic in afterburner and tops out near Mach 2 high up;
//   * lift follows the airspeed: banked turns pull the velocity round, too
//     slow and the wing stalls and the nose drops; turn rate is G-limited;
//   * Mach 1: vapour cone and a sonic boom;
//   * guns (20 mm, real impacts) and free-fall bombs (the same blasts as all
//     explosions); crash into the ground or a building = fireball, you bail
//     out at the crash site; EXIT/EJECT puts you down on foot below the jet.
//   * the whole world: past 6 km from the origin the world is re-centred on
//     the jet (map, buildings, terrain follow) — fly as far as you like.
// Controls: touch — throttle lever left, flight stick right, GUN/BOMB/CAM;
// keyboard — W/S throttle, arrows pitch/roll, A/D rudder, Space gun, B bomb,
// C camera; gamepad — left stick, RT/LT throttle, A gun, X bomb.
// Multiplayer: pose sent at 10 Hz, peers see the jet (same model).

export const JET_MODE_VERSION="fighter-jet-mode-v1";
const MASS=15000,DRY_N=120000,AB_N=205000,AREA=28,CD0=.024,G=9.81,REBASE_M=6000,SOUND=340,STALL=68;
const bridge=()=>globalThis.__arondightRealWorld||null,viewport=()=>document.getElementById("viewport"),walk=()=>globalThis.__arondightWalkMode||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let active=false,jet=null,model=null,root=null,sceneRef=null,throttle=.72,stick={x:0,y:0},rudder=0,camMode="chase",keys=new Set(),firing=false,lastGun=0,lastFrame=performance.now(),camPos=new THREE.Vector3(),camInit=false,voice=null,lastPoseTx=0,serial=0,crashedAt=0,groundStableAt=0,lastGroundGrid=null,machWas=0,cone=null,coneUntil=0;
const bombs=[],tracers=[],remote=new Map();
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),fwd=new THREE.Vector3(),upv=new THREE.Vector3(),right=new THREE.Vector3(),qd=new THREE.Quaternion(),X=new THREE.Vector3(1,0,0),Y=new THREE.Vector3(0,1,0),Z=new THREE.Vector3(0,0,1);

// ------------------------------------------------------------ world helpers
function prisms(){return bridge()?.buildingCollisionSnapshot?.prisms||[];}
function hitsBuilding(p){for(const pr of prisms()){const pts=pr.points;if(!pts||pts.length<3)continue;if(Math.abs(p.x-pts[0][0])>150||Math.abs(p.y-pts[0][1])>150)continue;if(wantedPointInRing(p.x,p.y,pts)){const base=groundHeightAt(pts[0][0],pts[0][1]);if(p.z<base+(Number(pr.top)||8)&&p.z>base+(Number(pr.base)||0)-1)return true;}}return false;}
const rho=h=>1.225*Math.exp(-Math.max(0,h)/8500);
function machOf(s){return s/SOUND;}
function cdOf(m){const bump=Math.exp(-(((m-1.02)/.16)**2))*.012+(m>1.02?.006:0);return CD0+bump;}
const EARTH=6378137;
function metersToLngLat(lon0,lat0,e,n){return[lon0+e/(EARTH*Math.max(.01,Math.cos(lat0*Math.PI/180)))*180/Math.PI,lat0+n/EARTH*180/Math.PI];}

// ------------------------------------------------------------ scene
function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&root?.parent===scene)return true;root?.parent?.remove(root);sceneRef=scene;root=new THREE.Group();root.name="PLAYER_JET";scene.add(root);model=null;cone=null;return true;}
function ensureModel(){if(model?.parent===root)return model;model=jetModel();model.name="PLAYER_JET_MODEL";root.add(model);
  cone=new THREE.Mesh(new THREE.ConeGeometry(5.5,9,24,1,true),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));cone.rotation.x=Math.PI;cone.position.y=-1;cone.userData.flightFireIgnore=true;cone.raycast=()=>{};model.add(cone);return model;}

// ------------------------------------------------------------ enter / exit
function enter(){
  if(active||!ensureScene())return false;globalThis.__arondightVehicleDrive?.active&&globalThis.__arondightVehicleDrive.exit?.();
  const w=walk(),cam=bridge()?.threeCamera,base=w?.mode==="foot"&&w.position?w.position:cam?.position||new THREE.Vector3();
  const yaw=w?.mode==="foot"?Number(w.yaw)||0:(()=>{const d=new THREE.Vector3();cam?.getWorldDirection(d);return Math.atan2(d.x,d.y);})();
  const g=groundHeightAt(base.x,base.y);jet={p:new THREE.Vector3(base.x,base.y,g+320),q:new THREE.Quaternion().setFromAxisAngle(Z,-yaw),v:new THREE.Vector3(),g:1,ab:false,returnMode:w?.mode==="foot"?"foot":"drone"};
  fwd.copy(Y).applyQuaternion(jet.q);jet.v.copy(fwd).multiplyScalar(170);throttle=.72;camInit=false;active=true;ensureModel().visible=true;startVoice();
  document.body.classList.add("jet-mode");renderButton();window.dispatchEvent(new CustomEvent("arondight:vehicle-mode",{detail:{active:true,jet:true}}));groundStableAt=performance.now();return true;
}
function exit({crash=false}={}){
  if(!active)return false;active=false;const p=jet.p.clone();stopVoice();if(model)model.visible=false;document.body.classList.remove("jet-mode");stick.x=stick.y=0;rudder=0;firing=false;
  const g=groundHeightAt(p.x,p.y);const w=walk();
  // you come down on foot right below (bail out): a free spot near the jet's ground track
  let x=p.x,y=p.y;for(let k=0;k<12&&hitsBuilding({x,y,z:g+1});k++){const a=k*2.1;x=p.x+Math.cos(a)*(6+k*3);y=p.y+Math.sin(a)*(6+k*3);}
  w?.setMode?.("foot",{persist:false,reason:"jet-exit"});setTimeout(()=>w?.setPose?.({x,y,yaw:Math.atan2(jet?.v.x||0,jet?.v.y||1),pitch:0}),60);
  globalThis.__arondightPlayerVehicleRuntime?.teleportDrone?.({x,y,yaw:0});
  if(!crash&&p.z-g>12){// pilotless jet goes down
    const ghost={p:p.clone(),v:jet.v.clone()};setTimeout(()=>{const t=Math.max(1,ghost.p.z-g)/Math.max(30,-ghost.v.z+20);const hit=ghost.p.clone().addScaledVector(ghost.v,Math.min(4,t));hit.z=groundHeightAt(hit.x,hit.y);globalThis.__fighterJets?.blast?.(hit);},2500);}
  renderButton();window.dispatchEvent(new CustomEvent("arondight:vehicle-mode",{detail:{active:false,jet:true}}));sendPose(true);return true;
}
function crash(){const p=jet.p.clone();p.z=Math.max(p.z,groundHeightAt(p.x,p.y));globalThis.__fighterJets?.blast?.(p);addTrauma?.(1);crashedAt=performance.now();exit({crash:true});}

// ------------------------------------------------------------ flight model
function step(dt,now){
  const j=jet,s=j.v.length()||1;fwd.copy(Y).applyQuaternion(j.q);upv.copy(Z).applyQuaternion(j.q);right.copy(X).applyQuaternion(j.q);
  // controls (stick + keyboard + gamepad)
  let px=stick.x,py=stick.y,yawIn=rudder;if(keys.has("ArrowLeft"))px-=1;if(keys.has("ArrowRight"))px+=1;if(keys.has("ArrowUp"))py-=1;if(keys.has("ArrowDown"))py+=1;if(keys.has("KeyA"))yawIn-=1;if(keys.has("KeyD"))yawIn+=1;
  if(keys.has("KeyW"))throttle=clamp(throttle+dt*.45,0,1);if(keys.has("KeyS"))throttle=clamp(throttle-dt*.45,0,1);
  const pad=(navigator.getGamepads?.()||[]).find(g=>g&&g.connected);if(pad){const ax=a=>Math.abs(a)<.1?0:a;px+=ax(pad.axes[0]||0);py+=ax(pad.axes[1]||0);yawIn+=ax(pad.axes[2]||0)*.6;throttle=clamp(throttle+((pad.buttons[7]?.value||0)-(pad.buttons[6]?.value||0))*dt*.6,0,1);if(pad.buttons[0]?.pressed)firing=true;else if(j.padFire)firing=false;j.padFire=pad.buttons[0]?.pressed;if(pad.buttons[2]?.pressed&&!j.padBomb)dropBomb();j.padBomb=pad.buttons[2]?.pressed;}
  px=clamp(px,-1,1);py=clamp(py,-1,1);yawIn=clamp(yawIn,-1,1);
  const h=j.p.z,dens=rho(h),q=.5*dens*s*s,lift=clamp((s/105)**2,0,1)*clamp(dens/1.225*1.6,.35,1);
  // angular rates: roll fast, pitch G-limited, rudder slow; stalled = nose falls
  const gMax=9,pitchRate=-py*Math.min(1.25,gMax*G/Math.max(60,s))*lift,rollRate=px*3.1*clamp(s/90,.35,1),yawRate=-yawIn*.32;
  qd.setFromAxisAngle(X,pitchRate*dt);j.q.multiply(qd);qd.setFromAxisAngle(Y,rollRate*dt);j.q.multiply(qd);qd.setFromAxisAngle(Z,yawRate*dt);j.q.multiply(qd);
  if(s<STALL){const t=1-s/STALL;tmp.copy(Y).applyQuaternion(j.q);const dn=tmp.z;qd.setFromAxisAngle(X,-(.9*t)*dt*(dn>-.9?1:0));j.q.multiply(qd);}
  j.q.normalize();fwd.copy(Y).applyQuaternion(j.q);upv.copy(Z).applyQuaternion(j.q);
  // forces
  const mach=machOf(s),ab=throttle>.86;j.ab=ab;const thrust=(ab?DRY_N+(AB_N-DRY_N)*(throttle-.86)/.14:DRY_N*throttle/.86)*Math.pow(dens/1.225,.7);
  const drag=q*AREA*(cdOf(mach)+.08*(1-lift)*Math.abs(py));
  const acc=tmp.copy(fwd).multiplyScalar(thrust/MASS);acc.addScaledVector(j.v,-drag/MASS/s);acc.z-=G;
  // lift along the wing's up, enough to hold 1 g level at speed, more when pulling
  const liftG=lift*(1+Math.max(0,-py)*(Math.min(gMax,(s*s)/(G*180))-1)*.9);acc.addScaledVector(upv,G*liftG*clamp(upv.z>0?1:.6,0,1)/Math.max(.3,1));
  j.v.addScaledVector(acc,dt);
  // velocity follows the nose (aerodynamic alignment, weaker when slow)
  const sp=j.v.length();const align=1-Math.exp(-dt*2.4*lift);tmp2.copy(fwd).multiplyScalar(sp);j.v.lerp(tmp2,align);
  const before=j.dir?.clone();j.dir=j.v.clone().normalize();if(before){const turn=before.angleTo(j.dir)/Math.max(dt,1e-3);j.g=1+turn*sp/G;}
  j.p.addScaledVector(j.v,dt);
  // sonic boom / vapour cone
  const m2=machOf(j.v.length());if(m2>=1&&machWas<1){boom();coneUntil=now+1600;}machWas=m2;if(cone){const k=coneUntil>now?Math.min(1,(coneUntil-now)/600):Math.max(0,1-Math.abs(m2-1)/.05)*.5;cone.material.opacity=.45*k;cone.scale.setScalar(.8+Math.min(.6,(m2-.95)*2));}
  if(Math.abs(m2-1)<.06)addTrauma?.(.04);
  // ground / buildings
  const gz=groundHeightAt(j.p.x,j.p.y);if(lastGroundGrid!==globalThis.__terrainElevation?.grid){lastGroundGrid=globalThis.__terrainElevation?.grid;groundStableAt=now;if(j.p.z<gz+60)j.p.z=gz+250;}
  if(now-groundStableAt>1500&&(j.p.z<gz+1.2||hitsBuilding(j.p))){crash();return;}
  if(j.p.z<gz+1.2)j.p.z=gz+1.2;
  // the whole world: keep the jet near the origin (float precision, map/buildings/terrain follow)
  if(Math.hypot(j.p.x,j.p.y)>REBASE_M)rebase();
  if(firing)gun(now);
}
function rebase(){const b=bridge();if(!b?.active||!Number.isFinite(b.originLon)||!Number.isFinite(b.originLat))return;const dx=jet.p.x,dy=jet.p.y,[lon,lat]=metersToLngLat(b.originLon,b.originLat,dx,dy);
  b.originLon=lon;b.originLat=lat;b.lastMapSyncMs=-Infinity;b.lastMapView=null;b.lastViewportSize="";b.minimapLastQueryMs=-Infinity;b.minimapLastDrawMs=-Infinity;b.buildingCollisionDirty=true;b.clearBuildingCollisions?.();try{b.map?.jumpTo?.({center:[lon,lat]});}catch{}
  jet.p.x-=dx;jet.p.y-=dy;for(const bb of bombs){bb.p.x-=dx;bb.p.y-=dy;}groundStableAt=performance.now();jet.p.z=Math.max(jet.p.z,250);
  const v=viewport();if(v){v.dataset.jetRebases=String((Number(v.dataset.jetRebases)||0)+1);v.dataset.worldLongitude=String(lon);v.dataset.worldLatitude=String(lat);}}

// ------------------------------------------------------------ weapons
function gun(now){if(now-lastGun<55)return;lastGun=now;const o=jet.p.clone().addScaledVector(fwd.copy(Y).applyQuaternion(jet.q),9),d=fwd.clone().addScaledVector(jet.v,0).normalize();d.x+=(Math.random()-.5)*.006;d.y+=(Math.random()-.5)*.006;d.z+=(Math.random()-.5)*.006;d.normalize();
  const rt=globalThis.__arondightWorldRigidBodies?.raycast?.([o.x,o.y,o.z],[d.x,d.y,d.z],1800);let dist=1800,pt=null;if(rt?.point){pt=new THREE.Vector3(...rt.point);dist=o.distanceTo(pt);}else{const tr=terrainRayDistance(o,d,1800);if(Number.isFinite(tr)){dist=tr;pt=o.clone().addScaledVector(d,tr);}}
  tracer(o,o.clone().addScaledVector(d,Math.min(dist,600)));
  if(pt){globalThis.__worldImpacts?.bullet?.({origin:o,direction:d},rt?.point?{box3d:true,point:pt,distance:dist,worldNormal:new THREE.Vector3(...(rt.normal||[0,0,1])),physicsKind:rt.kind,physicsId:rt.id}:null,{maxDistance:1800});
    if(Math.random()<.34)window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[pt.x,pt.y,pt.z],radiusM:3.2,maxDamage:70,kind:"cannon"}}));}
  try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"shot",{gain:.32,playbackRate:.7,minIntervalMs:40});}catch{}
}
let tracerPool=[];function tracer(a,b){let t=tracerPool.find(x=>!x.m.visible);if(!t){if(tracerPool.length>24)t=tracerPool[0];else{const m=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,1,5,1,true),new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));m.userData.flightFireIgnore=true;m.raycast=()=>{};root.add(m);t={m,until:0};tracerPool.push(t);}}
  tmp.subVectors(b,a);const len=tmp.length();t.m.position.copy(a).addScaledVector(tmp,.5);t.m.quaternion.setFromUnitVectors(Y,tmp.normalize());t.m.scale.set(1,len,1);t.m.visible=true;t.until=performance.now()+45;}
function dropBomb(){if(!active||(jet.lastBomb&&performance.now()-jet.lastBomb<450))return;jet.lastBomb=performance.now();const m=new THREE.Mesh(new THREE.CapsuleGeometry(.25,1.4,3,8),new THREE.MeshStandardMaterial({color:0x3b4135,roughness:.6}));m.userData.flightFireIgnore=true;m.raycast=()=>{};root.add(m);
  bombs.push({m,p:jet.p.clone().addScaledVector(Z.clone().applyQuaternion(jet.q),-1.2),v:jet.v.clone()});try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"bounce",{gain:.4,playbackRate:.5});}catch{}}
function stepBombs(dt){for(let i=bombs.length-1;i>=0;i--){const b=bombs[i];b.v.z-=G*dt;b.v.multiplyScalar(1-.04*dt);b.p.addScaledVector(b.v,dt);b.m.position.copy(b.p);b.m.quaternion.setFromUnitVectors(Z,tmp.copy(b.v).normalize().negate());const gz=groundHeightAt(b.p.x,b.p.y);
    if(b.p.z<=gz+.3||hitsBuilding(b.p)){b.p.z=Math.max(b.p.z,gz);globalThis.__fighterJets?.blast?.(b.p.clone());b.m.parent?.remove(b.m);bombs.splice(i,1);}}}
function boom(){try{const c=getSharedCombatAudioContext();if(c?.state==="running"){playCombatAudio(c,"explosion",{gain:.9,playbackRate:.55});setTimeout(()=>playCombatAudio(c,"explosion",{gain:.6,playbackRate:.62}),120);}}catch{}addTrauma?.(.6);sendFx({kind:"jet-boom",p:canon(jet.p)});}

// ------------------------------------------------------------ engine sound
function startVoice(){const a=jetEngineAudio();if(!a||voice)return;const c=a.ctx,src=c.createBufferSource();src.buffer=a.buffer;src.loop=true;const lp=c.createBiquadFilter();lp.type="lowpass";lp.frequency.value=2200;const g=c.createGain();g.gain.value=0;src.connect(lp);lp.connect(g);g.connect(a.master||c.destination);src.start();voice={src,lp,g,c};}
function stopVoice(){if(!voice)return;try{voice.g.gain.setTargetAtTime(0,voice.c.currentTime,.2);voice.src.stop(voice.c.currentTime+.8);}catch{}voice=null;}
function updateVoice(){if(!voice)startVoice();if(!voice)return;const t=voice.c.currentTime,ab=jet.ab;voice.g.gain.setTargetAtTime(.18+throttle*.35+(ab?.25:0),t,.08);voice.src.playbackRate.setTargetAtTime(.55+throttle*.6+(ab?.12:0),t,.08);voice.lp.frequency.setTargetAtTime(900+throttle*2600+(ab?2500:0),t,.08);}

// ------------------------------------------------------------ camera
const camLook=new THREE.Vector3();
const provider={isActive:()=>active||Boolean(base?.isActive?.()),apply:args=>active?applyCamera(args):base?.apply?.(args)};let base=null,installedOn=null;
// install once: other modes wrap us afterwards (a chain), never re-wrap them (that would loop)
function ensureProvider(){const b=bridge();if(!b||typeof b.attachPresentationCameraProvider!=="function"||installedOn===b)return;const cur=b.presentationCameraProvider;if(!cur||cur===provider)return;base=cur;b.attachPresentationCameraProvider(provider);installedOn=b;}
function applyCamera({camera,now}){
  if(!jet)return{active:false};const m=ensureModel();m.position.copy(jet.p);m.quaternion.copy(jet.q);const fl=m.userData.flame;if(fl){fl.scale.set(1,(.4+throttle*1.1+(jet.ab?1.2:0))*(.9+Math.random()*.2),1);fl.material.opacity=jet.ab?.95:.35+throttle*.4;}if(m.userData.glow)m.userData.glow.intensity=0;
  fwd.copy(Y).applyQuaternion(jet.q);upv.copy(Z).applyQuaternion(jet.q);const b=bridge(),ly=(Number(b?.lookYawDeg)||0)*Math.PI/180,lp=(Number(b?.lookPitchDeg)||0)*Math.PI/180;
  if(camMode==="cockpit"){camera.position.copy(jet.p).addScaledVector(fwd,4.2).addScaledVector(upv,1.05);camera.up.copy(upv);camLook.copy(camera.position).add(fwd);camera.lookAt(camLook);camera.rotateY(-ly);camera.rotateX(lp);m.visible=false;}
  else{m.visible=true;const s=jet.v.length(),dist=24+Math.min(14,s/40);tmp.copy(jet.p).addScaledVector(fwd,-dist).addScaledVector(upv,6.5);if(ly){tmp.sub(jet.p).applyAxisAngle(upv,-ly).add(jet.p);}
    tmp.sub(jet.p);if(!camInit){camPos.copy(tmp);camInit=true;}camPos.lerp(tmp,1-Math.exp(-((now-(applyCamera.t||now))/1000||1/60)*6));applyCamera.t=now;camera.position.copy(jet.p).add(camPos);camera.up.copy(upv).lerp(Z,.35).normalize();camLook.copy(jet.p).addScaledVector(fwd,30);camera.lookAt(camLook);camera.rotateX(lp*.6);}
  camera.fov=clamp(68+jet.v.length()/30,68,92);camera.near=camMode==="cockpit"?.3:1;camera.far=Math.max(camera.far,6000);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  return{active:true,mode:"jet"};
}

// ------------------------------------------------------------ UI
function ui(){
  const view=viewport();if(!view)return;
  if(!document.getElementById("jetHud")){const h=document.createElement("div");h.id="jetHud";h.innerHTML=`<div class="jet-throttle"><div class="jt-track"><div class="jt-ab">AB</div><div class="jt-fill"></div><div class="jt-thumb"></div></div><span>SCHUB</span></div>
<div class="jet-stick"><div class="js-ring"></div><div class="js-knob"></div><span>STICK</span></div>
<div class="jet-read"><b data-k="spd">0</b><small>KM/H</small><b data-k="mach">M 0.00</b><b data-k="alt">0</b><small>M ALT</small><b data-k="g">1.0 G</b></div>
<div class="jet-btns"><button type="button" data-a="gun">GUN</button><button type="button" data-a="bomb">BOMB</button><button type="button" data-a="cam">CAM</button><button type="button" data-a="exit">EJECT</button></div>`;view.appendChild(h);
    const st=document.createElement("style");st.dataset.jetMode="v1";st.textContent=`#jetHud{display:none;position:absolute;inset:0;z-index:30;pointer-events:none;font-family:Inter,system-ui,sans-serif;color:#fff}body.jet-mode #jetHud{display:block}
body.jet-mode #footHud,body.jet-mode #soloLeft,body.jet-mode #soloRight,body.jet-mode #soloClearance,body.jet-mode .solo-action,body.jet-mode #vehicleHud,body.jet-mode #airStrikeButton,body.jet-mode #enterCarButton,body.jet-mode #zombieRepair{display:none!important}
#jetHud .jet-throttle{position:absolute;left:max(18px,var(--solo-safe-left,env(safe-area-inset-left)));bottom:max(18px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));width:64px;height:min(46vh,240px);pointer-events:auto;touch-action:none}
#jetHud .jt-track{position:absolute;inset:0 8px 22px;border-radius:12px;background:#0d1118b8;border:2px solid #ffffff99;overflow:hidden}#jetHud .jt-fill{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(#ff7a1a,#f4d27a 30%,#5c6b78);opacity:.55}#jetHud .jt-ab{position:absolute;left:0;right:0;top:0;height:14%;background:#ff3a1a44;border-bottom:2px dashed #ff7a1a;font:900 10px/1 Inter;display:flex;align-items:center;justify-content:center;color:#ffb27a}
#jetHud .jt-thumb{position:absolute;left:-2px;right:-2px;height:16px;border-radius:6px;background:#fff;box-shadow:0 2px 6px #0008}#jetHud .jet-throttle span,#jetHud .jet-stick span{position:absolute;left:0;right:0;bottom:0;text-align:center;font:800 10px/1 Inter;letter-spacing:.1em;opacity:.8}
#jetHud .jet-stick{position:absolute;right:max(18px,var(--solo-safe-right,env(safe-area-inset-right)));bottom:max(18px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));width:min(28vw,170px);height:min(28vw,170px);pointer-events:auto;touch-action:none}#jetHud .js-ring{position:absolute;inset:0;border-radius:50%;border:2px solid #ffffff88;background:#0d111866}#jetHud .js-knob{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px;border-radius:50%;background:#ffffffd0}
#jetHud .jet-read{position:absolute;left:50%;top:max(56px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 50px));transform:translateX(-50%);display:flex;gap:10px;align-items:baseline;font:800 18px/1 "Barlow Condensed",Inter,sans-serif;text-shadow:0 2px 4px #000}#jetHud .jet-read small{font:700 10px/1 Inter;opacity:.7;margin-left:-6px}#jetHud [data-k=mach][data-super="1"]{color:#ffb27a}
#jetHud .jet-btns{position:absolute;right:calc(max(18px,var(--solo-safe-right,env(safe-area-inset-right))) + min(28vw,170px) + 14px);bottom:max(18px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));display:grid;grid-template-columns:repeat(2,64px);gap:8px;pointer-events:auto}#jetHud .jet-btns button{height:46px;border-radius:12px;border:2px solid #ffffffaa;background:#0d1118c8;color:#fff;font:900 12px/1 Inter;letter-spacing:.08em;touch-action:none}#jetHud .jet-btns [data-a=gun]{border-color:#ffb27a}#jetHud .jet-btns [data-a=exit]{border-color:#ff5a4a}
#jetModeButton[data-on="1"]{background:#ff7a1a!important;color:#111!important}`;document.head.appendChild(st);
    // throttle lever: stays where you leave it
    const tr=h.querySelector(".jet-throttle"),track=h.querySelector(".jt-track");const setT=e=>{const r=track.getBoundingClientRect();throttle=clamp(1-(e.clientY-r.top)/r.height,0,1);};tr.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();tr.setPointerCapture?.(e.pointerId);setT(e);tr.dataset.drag="1";});tr.addEventListener("pointermove",e=>{if(tr.dataset.drag==="1"){e.preventDefault();setT(e);}});for(const t of["pointerup","pointercancel"])tr.addEventListener(t,()=>{tr.dataset.drag="0";});
    // stick: springs back
    const sk=h.querySelector(".jet-stick"),knob=h.querySelector(".js-knob");const setS=e=>{const r=sk.getBoundingClientRect(),dx=(e.clientX-(r.left+r.width/2))/(r.width/2),dy=(e.clientY-(r.top+r.height/2))/(r.height/2),l=Math.hypot(dx,dy);const k=l>1?1/l:1;stick.x=dx*k;stick.y=dy*k;knob.style.transform=`translate(${stick.x*r.width*.36}px,${stick.y*r.height*.36}px)`;};
    sk.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();sk.setPointerCapture?.(e.pointerId);sk.dataset.drag="1";setS(e);});sk.addEventListener("pointermove",e=>{if(sk.dataset.drag==="1"){e.preventDefault();setS(e);}});for(const t of["pointerup","pointercancel"])sk.addEventListener(t,()=>{sk.dataset.drag="0";stick.x=stick.y=0;knob.style.transform="";});
    for(const btn of h.querySelectorAll(".jet-btns button")){const a=btn.dataset.a;btn.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();if(a==="gun")firing=true;else if(a==="bomb")dropBomb();else if(a==="cam")camMode=camMode==="chase"?"cockpit":"chase";else if(a==="exit")exit();});if(a==="gun")for(const t of["pointerup","pointercancel","pointerleave"])btn.addEventListener(t,()=>{firing=false;});}}
  // JET button: mobile dock + desktop top bar
  for(const host of[document.getElementById("mobileGameplayDock"),document.getElementById("soloTopbarActions")]){if(!host||host.querySelector(".jet-mode-btn"))continue;const b=document.createElement("button");b.type="button";b.className="jet-mode-btn";if(host.id==="mobileGameplayDock")b.id="jetModeButton";b.textContent="✈ JET";b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();active?exit():enter();});host.appendChild(b);
    if(host.id==="mobileGameplayDock"&&!document.querySelector("style[data-jet-dock]")){const st=document.createElement("style");st.dataset.jetDock="v1";st.textContent="body.mobile-gameplay-compact.solo-flight #mobileGameplayDock{grid-template-columns:repeat(4,minmax(0,1fr))!important;width:min(calc(100% - 170px),420px)!important}";document.head.appendChild(st);}}
}
function renderButton(){for(const b of document.querySelectorAll(".jet-mode-btn")){b.dataset.on=active?"1":"0";b.textContent=active?"✈ EXIT JET":"✈ JET";}}
function renderHud(){const h=document.getElementById("jetHud");if(!h||!jet)return;const s=jet.v.length(),m=machOf(s);h.querySelector('[data-k=spd]').textContent=String(Math.round(s*3.6));const mb=h.querySelector('[data-k=mach]');mb.textContent=`M ${m.toFixed(2)}`;mb.dataset.super=m>=1?"1":"0";h.querySelector('[data-k=alt]').textContent=String(Math.round(jet.p.z-groundHeightAt(jet.p.x,jet.p.y)));h.querySelector('[data-k=g]').textContent=`${(jet.g||1).toFixed(1)} G`;
  h.querySelector(".jt-fill").style.height=`${throttle*100}%`;const track=h.querySelector(".jt-track");h.querySelector(".jt-thumb").style.top=`calc(${(1-throttle)*100}% - 8px)`;void track;}

// ------------------------------------------------------------ multiplayer
function session(){return bridge()?.vsSession||null;}
function selfId(){try{return String(session()?.getSelfId?.()||"");}catch{return"";}}
function localOffset(){const b=bridge(),o=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(o)&&o.length===2?[Number(o[0])||0,Number(o[1])||0]:[0,0];}
function geoOf(p){const b=bridge();return b?.active&&Number.isFinite(b.originLon)?metersToLngLat(b.originLon,b.originLat,p.x,p.y):null;}
function canon(p){const o=localOffset();return[+(p.x+o[0]).toFixed(1),+(p.y+o[1]).toFixed(1),+p.z.toFixed(1)];}
function sendFx(extra){const s=session();if(!s?.sendFx)return;try{s.sendFx({type:"impact",objectId:"player-jet",id:`pj-${Date.now().toString(36)}-${(serial++).toString(36)}`,p:[0,0,0],playerId:selfId()||undefined,...extra});}catch{}}
function sendPose(force=false){const now=performance.now();if(!force&&now-lastPoseTx<100)return;lastPoseTx=now;const s=session();const peers=Number(s?.peerCount)||s?.getPeerIds?.()?.length||0;if(!s?.sendFx||!peers)return;
  if(!active){sendFx({kind:"jet-off"});return;}sendFx({kind:"jet-pose",g:geoOf(jet.p),p:canon(jet.p),z:+jet.p.z.toFixed(1),q:[jet.q.x,jet.q.y,jet.q.z,jet.q.w].map(v=>+v.toFixed(4)),t:+throttle.toFixed(2),ab:jet.ab?1:0});}
function lngLatToLocal(lon,lat){const b=bridge();if(!b?.active)return null;const x=(lon-b.originLon)*Math.PI/180*EARTH*Math.max(.01,Math.cos(b.originLat*Math.PI/180)),y=(lat-b.originLat)*Math.PI/180*EARTH;return[x,y];}
function onFx(e){const pk=e?.detail?.packet,peer=String(e?.detail?.peerId||pk?.playerId||"");if(pk?.objectId!=="player-jet"||!peer)return;ensureScene();let r=remote.get(peer);
  if(pk.kind==="jet-off"){if(r){r.model.parent?.remove(r.model);remote.delete(peer);}return;}
  if(pk.kind==="jet-boom"){try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"explosion",{gain:.5,playbackRate:.55});}catch{}return;}
  if(pk.kind!=="jet-pose")return;if(!r){r={model:jetModel(),p:new THREE.Vector3(),q:new THREE.Quaternion(),tp:new THREE.Vector3(),tq:new THREE.Quaternion(),seen:0,init:false};r.model.name="PEER_JET";root.add(r.model);remote.set(peer,r);}
  let lx,ly;const ll=Array.isArray(pk.g)?lngLatToLocal(+pk.g[0],+pk.g[1]):null;if(ll){[lx,ly]=ll;}else{const o=localOffset();lx=(+pk.p?.[0]||0)-o[0];ly=(+pk.p?.[1]||0)-o[1];}
  r.tp.set(lx,ly,+pk.z||0);if(Array.isArray(pk.q))r.tq.set(+pk.q[0],+pk.q[1],+pk.q[2],+pk.q[3]).normalize();r.ab=pk.ab===1;r.t=+pk.t||0;r.seen=performance.now();if(!r.init){r.p.copy(r.tp);r.q.copy(r.tq);r.init=true;}}
function renderRemote(dt){const now=performance.now(),a=1-Math.exp(-dt*8);for(const[peer,r]of remote){if(now-r.seen>3000){r.model.parent?.remove(r.model);remote.delete(peer);continue;}r.p.lerp(r.tp,a);r.q.slerp(r.tq,a);r.model.position.copy(r.p);r.model.quaternion.copy(r.q);const fl=r.model.userData.flame;if(fl){fl.scale.set(1,.5+r.t+(r.ab?1.2:0),1);fl.material.opacity=r.ab?.95:.5;}}}

// ------------------------------------------------------------ loop
let lastUi=0;
function frame(now=performance.now()){
  requestAnimationFrame(frame);const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;if(!bridge()?.threeScene)return;ensureScene();ensureProvider();
  if(now-lastUi>500){lastUi=now;ui();renderButton();}
  if(active&&jet){const sub=Math.max(1,Math.ceil(dt/.0125));for(let i=0;i<sub&&active;i++)step(dt/sub,now);if(active){updateVoice();renderHud();sendPose();}}
  if(bombs.length)stepBombs(dt);for(const t of tracerPool)if(t.m.visible&&now>t.until)t.m.visible=false;if(remote.size)renderRemote(dt);
  const v=viewport();if(v)v.dataset.jetMode=active&&jet?`M${machOf(jet.v.length()).toFixed(2)}/${Math.round(jet.p.z)}m`:"off";
}
export function installJetMode(){if(globalThis.__jetMode||typeof window==="undefined")return globalThis.__jetMode;
  addEventListener("keydown",e=>{if(!active||e.metaKey||e.ctrlKey)return;if(["KeyW","KeyS","KeyA","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)){keys.add(e.code);e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="Space"){firing=true;e.preventDefault();e.stopImmediatePropagation();}else if(e.code==="KeyB"){dropBomb();e.preventDefault();}else if(e.code==="KeyC"){camMode=camMode==="chase"?"cockpit":"chase";}else if(e.code==="KeyE"){exit();}},{capture:true});
  addEventListener("keyup",e=>{keys.delete(e.code);if(e.code==="Space")firing=false;},{capture:true});addEventListener(VS_FX_EVENT,onFx);addEventListener("arondight:world-reset",()=>{if(active)exit({crash:true});});
  globalThis.__jetMode={enter,exit,get active(){return active;},get state(){return jet?{p:jet.p.clone(),speed:jet.v.length(),mach:machOf(jet.v.length()),throttle,g:jet.g}:null;},set throttle(v){throttle=clamp(+v||0,0,1);},set stick(v){stick.x=clamp(+v?.x||0,-1,1);stick.y=clamp(+v?.y||0,-1,1);},version:JET_MODE_VERSION};
  requestAnimationFrame(frame);return globalThis.__jetMode;}
installJetMode();
