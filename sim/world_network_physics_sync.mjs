import {VS_FX_EVENT,VS_POSE_EVENT} from "./lan_vs.mjs";

const REMOTE_LEASE_MS=360;
const REMOTE_STALE_MS=720;
const SNAP_ERROR_M=3.2;
const remoteVehicles=new Map(),vehicleRoots=new Map(),seenExplosions=new Set();
let installed=false,patchedSession=null,lastRootScan=-Infinity,txSequence=0;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function physics(){return globalThis.__arondightWorldRigidBodies||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function session(){return bridge()?.vsSession||null;}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function localOffset(){const b=bridge(),o=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(o)&&o.length===2?[Number(o[0])||0,Number(o[1])||0]:[0,0];}
function localToCanonical(p){const o=localOffset();return[(Number(p?.[0])||0)+o[0],(Number(p?.[1])||0)+o[1],Number(p?.[2])||0];}
function canonicalToLocal(p){const o=localOffset();return[(Number(p?.[0])||0)-o[0],(Number(p?.[1])||0)-o[1],Number(p?.[2])||0];}
function finiteArray(value,length){return Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);}
function selfId(){try{return String(session()?.getSelfId?.()||session()?.active?.getSelfId?.()||"");}catch{return"";}}
function refreshVehicleRoots(now=performance.now()){
  if(now-lastRootScan<520&&vehicleRoots.size)return;lastRootScan=now;vehicleRoots.clear();bridge()?.threeScene?.traverse?.(node=>{const id=String(node?.userData?.worldPopulationId||node?.userData?.worldProceduralId||"");if(!id||!node?.children?.length)return;const kind=String(node.userData?.worldPopulationKind||"");if(kind==="car"||kind==="bus")vehicleRoots.set(id,node);});
}
function rootFor(id){refreshVehicleRoots();return vehicleRoots.get(String(id||""))||null;}
function ensurePhysicsBody(id,root,position,yaw){const p=physics();if(!p||p.pose?.(id))return true;const kind=String(root?.userData?.worldPopulationKind||"car"),bus=kind==="bus";return Boolean(p.upsertBody?.({id,kind,position, yaw,halfExtents:bus?[4,1.17,1.08]:[1.78,.82,.42],massKg:bus?9200:1420}));}
function releaseRemote(peerId,reason="mode-change"){
  const record=remoteVehicles.get(String(peerId||""));if(!record)return false;const owner=`remote-player:${peerId}`,root=rootFor(record.vehicleId);physics()?.clearTarget?.(record.vehicleId,{owner});if(root&&root.userData?.remotePlayerDriven===String(peerId)){delete root.userData.remotePlayerDriven;delete root.userData.worldTrafficControlOwner;}remoteVehicles.delete(String(peerId));const v=viewport();if(v){v.dataset.vsRemoteVehicleRelease=reason;v.dataset.vsRemoteVehicles=String(remoteVehicles.size);}return true;
}
function attachCarToPose(pose){
  const d=drive(),physical=d?.physicsPose;if(!d?.active||!d.vehicleId||!physical||!finiteArray(physical.position,3)||!finiteArray(physical.rotation,4))return pose;
  const cv={id:String(d.vehicleId),p:localToCanonical(physical.position),q:[...physical.rotation],v:finiteArray(physical.velocity,3)?[...physical.velocity]:[0,0,0],w:finiteArray(physical.angularVelocity,3)?[...physical.angularVelocity]:[0,0,0],yaw:Number.isFinite(physical.yaw)?physical.yaw:Number(d.heading)||0,seq:++txSequence};
  const v=viewport();if(v){v.dataset.vehiclePhysicsReplicated="pose-channel-v1";v.dataset.vehiclePhysicsTx=String((Number(v.dataset.vehiclePhysicsTx)||0)+1);}return{...pose,cm:"vehicle",cv};
}
function patchPoseSession(){const s=session();if(!s||s===patchedSession||typeof s.setPose!=="function")return false;if(s.__worldVehiclePhysicsSync)return true;const base=s.setPose.bind(s);s.setPose=pose=>base(attachCarToPose(pose));s.__worldVehiclePhysicsSync=true;patchedSession=s;return true;}
function applyRemoteVehicle(peerId,cv){
  peerId=String(peerId||"");if(!peerId||peerId===selfId()||!cv||typeof cv.id!=="string"||!finiteArray(cv.p,3)||!finiteArray(cv.q,4)||!finiteArray(cv.v,3)||!finiteArray(cv.w,3))return false;const id=String(cv.id),position=canonicalToLocal(cv.p),root=rootFor(id);if(!root)return false;const yaw=Number.isFinite(cv.yaw)?Number(cv.yaw):Math.atan2(2*(cv.q[3]*cv.q[2]+cv.q[0]*cv.q[1]),1-2*(cv.q[1]*cv.q[1]+cv.q[2]*cv.q[2]));ensurePhysicsBody(id,root,position,yaw);const p=physics(),current=p?.pose?.(id),owner=`remote-player:${peerId}`,error=current?.position?Math.hypot(current.position[0]-position[0],current.position[1]-position[1],current.position[2]-position[2]):Infinity;
  if(!current||error>SNAP_ERROR_M)p?.setPose?.(id,{position,yaw,velocity:[...cv.v],angularVelocity:[...cv.w]});else{const speed=Math.hypot(cv.v[0],cv.v[1]),ahead=.11,predicted=[position[0]+cv.v[0]*ahead,position[1]+cv.v[1]*ahead,position[2]+cv.v[2]*ahead];p?.setTarget?.(id,{position:predicted,yaw,speedMps:speed,response:7.5,maxAccelerationMps2:18,owner,priority:90,leaseMs:REMOTE_LEASE_MS});}
  root.userData.remotePlayerDriven=peerId;root.userData.worldTrafficControlOwner=owner;remoteVehicles.set(peerId,{vehicleId:id,lastAt:performance.now(),seq:Number(cv.seq)||0});const v=viewport();if(v){v.dataset.vsRemoteVehiclePhysics="authoritative-pose+leased-force-v1";v.dataset.vsRemoteVehicles=String(remoteVehicles.size);v.dataset.vsRemoteVehicleLastErrorM=Number.isFinite(error)?error.toFixed(3):"snap";}return true;
}
function onPose(event){const peerId=String(event?.detail?.peerId||""),pose=event?.detail?.pose;if(!peerId||!pose)return;if(pose.cm==="vehicle"&&pose.cv){applyRemoteVehicle(peerId,pose.cv);return;}releaseRemote(peerId,"peer-not-driving");}
function replicateMissileExplosion(event){
  const d=event?.detail||{};if(d.replicated||String(d.kind||"")!=="missile"||!Array.isArray(d.position))return;const s=session();if(typeof s?.sendFx!=="function")return;const id=String(d.id||`missile-blast-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`);seenExplosions.add(id);s.sendFx({type:"explosion",id,p:localToCanonical(d.position),kind:"missile",radiusM:clamp(d.radiusM??8,1,30),maxDamage:clamp(d.maxDamage??100,0,200),playerId:selfId()||undefined,t:Date.now()});const v=viewport();if(v)v.dataset.explosionPhysicsTx=String((Number(v.dataset.explosionPhysicsTx)||0)+1);
}
function onFx(event){
  const packet=event?.detail?.packet,peerId=String(event?.detail?.peerId||"");if(packet?.type!=="explosion"||String(packet.kind||"")!=="missile"||!finiteArray(packet.p,3))return;const id=String(packet.id||"");if(id&&seenExplosions.has(id))return;if(id){seenExplosions.add(id);while(seenExplosions.size>256)seenExplosions.delete(seenExplosions.values().next().value);}const position=canonicalToLocal(packet.p);dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position,radiusM:clamp(packet.radiusM??8,1,30),maxDamage:clamp(packet.maxDamage??100,0,200),kind:"missile",id,replicated:true,peerId}}));const v=viewport();if(v){v.dataset.explosionPhysicsRx=String((Number(v.dataset.explosionPhysicsRx)||0)+1);v.dataset.explosionPhysicsReplication="fx-event->local-box3d-blast-v1";}
}
function frame(now=performance.now()){patchPoseSession();for(const[peerId,record]of remoteVehicles)if(now-record.lastAt>REMOTE_STALE_MS)releaseRemote(peerId,"stale");const v=viewport();if(v){v.dataset.worldNetworkPhysics="vehicle-pose+explosion-impulse-v1";v.dataset.vsRemoteVehicles=String(remoteVehicles.size);}requestAnimationFrame(frame);}
export function installWorldNetworkPhysicsSync(){if(installed)return;installed=true;addEventListener(VS_POSE_EVENT,onPose);addEventListener(VS_FX_EVENT,onFx);addEventListener("arondight:world-explosion",replicateMissileExplosion);requestAnimationFrame(frame);}
installWorldNetworkPhysicsSync();
