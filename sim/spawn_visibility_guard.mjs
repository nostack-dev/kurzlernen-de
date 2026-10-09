import * as THREE from "three";
import {wantedLineBlockedByPrisms} from "./wanted_system_logic.mjs";

// Nothing may come into existence where a player sees it happen. Two services:
//  canSpawnAt(x,y,z) — the gate every spawner asks BEFORE something appears (people, traffic,
//    animals, police, zombies, soldiers): not closer than MIN_SPAWN_DISTANCE_M to any viewer and
//    not inside any viewer's view (the local presented camera — the pose that was actually DRAWN,
//    walk / car / jet / free-look, not the drone camera the scene holds between frames — and peers'
//    view cones), unless a building stands in between. Out to the camera's far plane.
//  a safety net for people roots: one that turns up (or jumps) inside a view is held back
//    (userData.spawnHeld) until it is out of view; its owner shows it again, the guard never does.
const MIN_SPAWN_DISTANCE_M=24;
const CONE_MARGIN_RAD=20*Math.PI/180;
const JUMP_M=6,PEER_SCAN_MS=400,OCCLUSION_MAX_M=420,GRID_M=40,DEFAULT_FAR_M=1500;
const projectionView=new THREE.Matrix4(),candidatePos=new THREE.Vector3(),peerPos=new THREE.Vector3(),peerQuat=new THREE.Quaternion(),toCandidate=new THREE.Vector3(),sphere=new THREE.Sphere(new THREE.Vector3(),1.5);
const local={kind:"local",position:new THREE.Vector3(),forward:new THREE.Vector3(),halfAngle:Math.PI/2,frustum:new THREE.Frustum(),far:DEFAULT_FAR_M},lookFrom={x:0,y:0,z:0},lookTo={x:0,y:0,z:0};
const rootState=new WeakMap(),viewerList=[],holdLog=[];// holdLog: the last people held back (diagnostics)
let installed=false,lastPublish=-Infinity,localKey=NaN,localValid=false,peerViewers=[],peerScanAt=-Infinity,gridSnapshot=null,occluderCandidates=[];
const grid=new Map(),gridSeen=new Set();

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function presentedCamera(){const b=bridge();return b?.presentedCamera?.()||b?.threeCamera||null;}
// Only people are held back by hiding. Vehicles are physical bodies: hiding a
// spawned car would leave an invisible car driving (and its wheels, drawn on
// their own, rolling alone). The population asks canSpawnAt() BEFORE a vehicle
// comes into existence instead (spawn gate), so nothing physical is ever hidden.
function dynamicRoot(node){if(!node?.isGroup)return false;const kind=String(node.userData?.worldPopulationKind||"");return kind==="person"&&!node.userData?.worldPopulationClone;}
// the presented camera is re-captured once per drawn frame: rebuild the local viewer only then
function localViewer(){const b=bridge(),camera=presentedCamera();if(!camera?.projectionMatrix||!camera.matrixWorld){localValid=false;return null;}
  const key=Number(b?.viewCameraAt)||performance.now();if(localValid&&key===localKey)return local;localKey=key;localValid=true;
  camera.updateMatrixWorld?.(true);local.position.setFromMatrixPosition(camera.matrixWorld);local.forward.set(0,0,-1).transformDirection(camera.matrixWorld);
  projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);local.frustum.setFromProjectionMatrix(projectionView);
  const vfov=(Number(camera.fov)||78)*Math.PI/180,aspect=Math.max(.2,Number(camera.aspect)||16/9),hfov=2*Math.atan(Math.tan(vfov/2)*aspect);local.halfAngle=Math.min(Math.PI*.92,Math.max(vfov,hfov)/2+CONE_MARGIN_RAD);local.far=Math.max(200,Number(camera.far)||DEFAULT_FAR_M);return local;}
// peers: a scene scan, but only in multiplayer and at most every PEER_SCAN_MS
function peerCount(b){const s=b?.vsSession;if(!s)return 0;try{return typeof s.peerCount==="function"?s.peerCount():Number(s.peerCount)||s.getPeerIds?.()?.length||0;}catch{return 0;}}
function collectPeerViewers(scene,halfAngle,far){const byId=new Map();scene?.traverse?.(node=>{if(node.visible===false)return;const id=String(node.userData?.vsPlayerId||"");if(!id)return;const u=node.userData||{},isDrone=Boolean(u.vsMultiplayerPeer||u.vsLegacyPrimary||u.vsPeer),isHuman=Boolean(u.vsHumanAvatar&&!u.localHumanAvatar);if(!isDrone&&!isHuman)return;const priority=isDrone?2:1,existing=byId.get(id);if(existing&&existing.priority>=priority)return;node.getWorldPosition?.(peerPos);node.getWorldQuaternion?.(peerQuat);
  // a drone's nose (and camera) is its body -X axis; an avatar looks along +Y
  const forward=(isDrone?new THREE.Vector3(-1,0,0):new THREE.Vector3(0,1,0)).applyQuaternion(peerQuat).normalize(),position=peerPos.clone();if(isHuman)position.z+=1.55;byId.set(id,{kind:isDrone?"peer-drone":"peer-human",priority,position,forward,halfAngle,far});});return[...byId.values()];}
function viewers(){const b=bridge(),me=localViewer();viewerList.length=0;if(me)viewerList.push(me);const now=performance.now();
  if(peerCount(b)>0){if(now-peerScanAt>PEER_SCAN_MS){peerScanAt=now;peerViewers=collectPeerViewers(b?.threeScene,me?.halfAngle??Math.PI*.6,me?.far??DEFAULT_FAR_M);}for(const v of peerViewers)viewerList.push(v);}else peerViewers=[];
  return viewerList;}
// buildings hide what is behind them: a coarse grid over the collision prisms
function refreshGrid(){const snapshot=bridge()?.buildingCollisionSnapshot;if(snapshot===gridSnapshot)return;gridSnapshot=snapshot;grid.clear();
  for(const prism of Array.isArray(snapshot?.prisms)?snapshot.prisms:[]){if(prism?.leveled)continue;let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of prism.points||[]){x0=Math.min(x0,+p[0]);y0=Math.min(y0,+p[1]);x1=Math.max(x1,+p[0]);y1=Math.max(y1,+p[1]);}if(!Number.isFinite(x0))continue;
    for(let ix=Math.floor(x0/GRID_M);ix<=Math.floor(x1/GRID_M);ix++)for(let iy=Math.floor(y0/GRID_M);iy<=Math.floor(y1/GRID_M);iy++){const k=ix*73856093^iy*19349663,list=grid.get(k);if(list)list.push(prism);else grid.set(k,[prism]);}}}
function occluders(ax,ay,bx,by){occluderCandidates.length=0;gridSeen.clear();const x0=Math.floor(Math.min(ax,bx)/GRID_M),x1=Math.floor(Math.max(ax,bx)/GRID_M),y0=Math.floor(Math.min(ay,by)/GRID_M),y1=Math.floor(Math.max(ay,by)/GRID_M);
  for(let ix=x0;ix<=x1;ix++)for(let iy=y0;iy<=y1;iy++)for(const prism of grid.get(ix*73856093^iy*19349663)||[]){if(gridSeen.has(prism))continue;gridSeen.add(prism);occluderCandidates.push(prism);}return occluderCandidates;}
function hiddenBehindBuildings(eye,point,height){refreshGrid();if(!grid.size)return false;const list=occluders(eye.x,eye.y,point.x,point.y);if(!list.length)return false;lookFrom.x=eye.x;lookFrom.y=eye.y;lookFrom.z=eye.z;
  for(const dz of[.3,height]){lookTo.x=point.x;lookTo.y=point.y;lookTo.z=point.z+dz;if(!wantedLineBlockedByPrisms(lookFrom,lookTo,list))return false;}return true;}
// would something at point be seen by this viewer?
function seenBy(point,viewer,farEntryM,height){toCandidate.copy(point).sub(viewer.position);const distance=toCandidate.length();if(distance<MIN_SPAWN_DISTANCE_M)return true;if(distance>viewer.far)return false;if(farEntryM>0&&distance>=farEntryM)return false;
  let inside=toCandidate.multiplyScalar(1/Math.max(distance,1e-6)).dot(viewer.forward)>=Math.cos(viewer.halfAngle);
  if(!inside&&viewer.kind==="local"){sphere.center.copy(point);sphere.center.z+=height*.5;inside=viewer.frustum.intersectsSphere(sphere);}
  if(!inside)return false;return!(distance<=OCCLUSION_MAX_M&&hiddenBehindBuildings(viewer.position,point,height));}
function safeSpawn(point,allViewers,farEntryM=0,height=2.2){for(const viewer of allViewers)if(seenBy(point,viewer,farEntryM,height))return false;return true;}
function roots(){const shared=globalThis.__arondightProceduralPopulation?.spawnVisibilityRoots;return Array.isArray(shared)?shared:[];}
function publish(allViewers,held,now){if(now-lastPublish<250)return;lastPublish=now;const view=viewport();if(!view)return;view.dataset.spawnVisibilityGuard="people-hold+spawn-gate-presented-camera-v4";view.dataset.spawnVisibilityViewers=String(allViewers.length);view.dataset.spawnVisibilityWithheld=String(held);view.dataset.spawnVisibilityRule=allViewers.length>1?"outside-union-of-player-views+occlusion":"outside-presented-view+occlusion";view.dataset.spawnVisibilityTelemetry="250ms";}
function frame(now=performance.now()){requestAnimationFrame(frame);const b=bridge();if(!b?.threeScene)return;const allViewers=viewers();let held=0;
  for(const root of roots()){if(!dynamicRoot(root))continue;const u=root.userData;candidatePos.copy(root.position);if(root.parent&&!root.parent.isScene)root.parent.localToWorld(candidatePos);
    let st=rootState.get(root);if(!st)rootState.set(root,st={x:candidatePos.x,y:candidatePos.y,vis:false});
    if(u.spawnHeld){if(safeSpawn(candidatePos,allViewers,u.spawnFarEntryM||0)){u.spawnHeld=false;/* its owner shows it again on its next update */}else{root.visible=false;held++;}st.vis=false;continue;}
    if(root.visible===false){st.vis=false;continue;}
    // a body that stays continuous (stood up from its ragdoll where it lay) is not an arrival
    const handoff=u.spawnHandoff;if(handoff)u.spawnHandoff=false;
    const appeared=!handoff&&(!st.vis||Math.hypot(candidatePos.x-st.x,candidatePos.y-st.y)>JUMP_M);
    if(appeared&&!safeSpawn(candidatePos,allViewers,u.spawnFarEntryM||0)){u.spawnHeld=true;root.visible=false;held++;holdLog.push({id:String(u.worldPopulationId||""),at:Math.round(now),jump:+Math.hypot(candidatePos.x-st.x,candidatePos.y-st.y).toFixed(2),wasVisible:st.vis});if(holdLog.length>64)holdLog.shift();st.vis=false;continue;}
    st.x=candidatePos.x;st.y=candidatePos.y;st.vis=true;}
  publish(allViewers,held,now);}

const spawnPoint=new THREE.Vector3();
// may something appear at (x,y,z) right now without any player (local presented camera or
// a peer's drone/avatar view) seeing it pop in? farEntryM: beyond this distance an arrival is
// allowed even in view (a few pixels at the horizon, e.g. traffic coming in from far away)
export function canSpawnAt(x,y,z=0,{farEntryM=0,heightM=2.2}={}){spawnPoint.set(Number(x)||0,Number(y)||0,Number(z)||0);return safeSpawn(spawnPoint,viewers(),farEntryM,heightM);}
export function presentedViewer(){return localViewer();}
export function installSpawnVisibilityGuard(){if(installed)return;installed=true;globalThis.__spawnVisibilityGuard={canSpawnAt,presentedViewer,holdLog,version:"spawn-gate-v4"};requestAnimationFrame(frame);}
installSpawnVisibilityGuard();
