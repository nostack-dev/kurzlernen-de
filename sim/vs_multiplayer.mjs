import * as THREE from "three";
import {VsPoseTimeline} from "./vs_pose_sync.mjs";
import {VS_PEER_EVENT,VS_POSE_EVENT,VS_GAME_EVENT,VS_FX_EVENT} from "./lan_vs.mjs";

const VISUAL_SCALE=7;
const STALE_MS=3000;
const MAX_PLAYERS=9;
const COLOR_REFRESH_MS=420;
const TRACER_SCAN_MS=600;
const AUTHORITY_SETTLE_MS=420;
const PALETTE=[0x29d6ff,0xff6b35,0x8cf43f,0xff4fd8,0xffd83d,0x9b7bff,0x24e6a1,0xff405f,0x43a8ff,0xff9f1c,0x7ce7ff,0xd6ff4b];

const peers=new Map(),health=new Map(),confirmedHealth=new Set(),seenHits=new Set(),seenStates=new Set();
const tempPosition=new THREE.Vector3(),tempCamera=new THREE.Vector3(),tempProjected=new THREE.Vector3(),tempCameraSpace=new THREE.Vector3(),tempDir=new THREE.Vector3(),tempQuat=new THREE.Quaternion(),axisY=new THREE.Vector3(0,1,0);
const remoteTracers=[],remoteExplosions=[],localTracerMeshes=[],localImpactMeshes=[],pendingAuthorityHits=[];
const tracerWasVisible=new WeakMap(),impactWasVisible=new WeakMap();

let installed=false,lastSession=null,selfId="",authorityId="",lastAuthorityId="",primaryId="",lastPrimaryId="",shotSeq=0,kills=0,deaths=0,lastLocalDead=false,lastRender=0,lastColorRefresh=-Infinity,lastTracerScan=-Infinity,authoritySettlingUntil=0,lastManualRespawns=0,raf=0;
let style=null,tracerGeometry=null,explosionGeometry=null;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function session(){return bridge()?.vsSession||null;}
function activeSession(){return session()?.active||session()||null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function hashId(id){let h=2166136261;for(const c of String(id||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function assignments(){const ids=[selfId,...peers.keys()].filter(Boolean).sort(),used=new Set(),out=new Map();for(const id of ids){let i=hashId(id)%PALETTE.length;while(used.has(i))i=(i+1)%PALETTE.length;used.add(i);out.set(id,PALETTE[i]);}return out;}
function colorFor(id){return assignments().get(id)||PALETTE[hashId(id)%PALETTE.length];}
function cssColor(hex){return`#${Number(hex||0).toString(16).padStart(6,"0")}`;}
function localOffset(){const b=bridge(),o=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(o)&&o.length===2?[Number(o[0])||0,Number(o[1])||0]:[0,0];}
function canonicalToLocal(p){const o=localOffset(),x=Number(p?.[0])||0,y=Number(p?.[1])||0,z=Number(p?.[2])||0;return[x-o[0],y-o[1],z];}
function localToCanonical(p){const o=localOffset(),x=Number(p?.[0])||0,y=Number(p?.[1])||0,z=Number(p?.[2])||0;return[x+o[0],y+o[1],z];}
function participantIds(){return[selfId,...peers.keys()].filter(Boolean).sort();}
function localHealth(){const b=bridge();return clamp(Math.round(Number(health.get(selfId)??b?.vsLocalHealth??100)),0,100);}
function localDead(){return localHealth()<=0;}
function packetId(prefix){return`${prefix}-${Date.now().toString(36)}-${(++shotSeq).toString(36)}`;}
function registerPhysicsPeer(root){if(!root)return;root.userData.worldLifeKind="vs-drone";root.userData.worldLifeId=String(root.userData.vsPlayerId||"");globalThis.__arondightBox3dCombat?.registerTarget?.(root);}
function applyCombatScale(root){if(!root)return;if(!Array.isArray(root.userData.vsCombatBaseScale)){root.userData.vsCombatBaseScale=[Number(root.scale?.x)||1,Number(root.scale?.y)||1,Number(root.scale?.z)||1];}const s=root.userData.vsCombatBaseScale;root.scale.set(s[0]*VISUAL_SCALE,s[1]*VISUAL_SCALE,s[2]*VISUAL_SCALE);root.userData.vsCombatVisualScale=VISUAL_SCALE;root.userData.vsCombatReadability="scaled-7x+hud-marker+emissive-v2";}

function applyMaterialColor(root,color){
  root?.traverse?.(node=>{
    if(!node?.isMesh)return;
    const m=node.material;if(m?.color?.setHex)m.color.setHex(color);if(m?.emissive?.setHex){m.emissive.setHex(color);m.emissiveIntensity=Math.max(Number(m.emissiveIntensity)||0,1.6);}
  });
  root?.traverse?.(node=>{if(node?.isSprite&&node.material?.color?.setHex)node.material.color.setHex(color);});
}

function refreshColors(force=false,now=performance.now()){
  if(!force&&now-lastColorRefresh<COLOR_REFRESH_MS)return;lastColorRefresh=now;
  const map=assignments();
  for(const r of peers.values()){r.color=map.get(r.id)||r.color;applyMaterialColor(r.mesh,r.color);if(r.marker)r.marker.style.setProperty("--vs-player-color",cssColor(r.color));}
  const b=bridge(),own=b?.airframeFor?.(b.threeScene)||b?.airframe;if(own&&selfId)applyMaterialColor(own,map.get(selfId)||colorFor(selfId));
  if(b?.vsPeerMesh&&primaryId){b.vsPeerMesh.userData.vsPlayerId=primaryId;b.vsPeerMesh.userData.vsPlayerColor=map.get(primaryId)||colorFor(primaryId);applyCombatScale(b.vsPeerMesh);applyMaterialColor(b.vsPeerMesh,b.vsPeerMesh.userData.vsPlayerColor);registerPhysicsPeer(b.vsPeerMesh);}
}

function makeMarker(record){
  const view=viewport();if(!view)return null;const el=document.createElement("div");el.className="vs-player-marker";el.dataset.peerId=record.id;el.innerHTML='<i></i><strong>ENEMY</strong><small></small>';el.style.setProperty("--vs-player-color",cssColor(record.color));view.appendChild(el);return el;
}

function createPeerMesh(record){
  const b=bridge(),scene=b?.threeScene;if(!scene)return null;
  const group=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:record.color,emissive:record.color,emissiveIntensity:1.7,roughness:.24,metalness:.18});group.scale.setScalar(VISUAL_SCALE);group.userData.vsCombatBaseScale=[1,1,1];
  const body=new THREE.Mesh(new THREE.BoxGeometry(.22,.34,.07),material);body.userData.flightFireIgnore=true;group.add(body);
  for(const[x,y]of[[-.19,-.19],[.19,-.19],[-.19,.19],[.19,.19]]){const arm=new THREE.Mesh(new THREE.BoxGeometry(.025,.26,.025),material);arm.position.set(x*.5,y*.5,0);arm.rotation.z=(x*y>0?1:-1)*Math.PI/4;arm.userData.flightFireIgnore=true;group.add(arm);}
  group.userData.vsPlayerId=record.id;group.userData.vsPlayerColor=record.color;group.userData.vsMultiplayerPeer=true;group.userData.vsCombatVisualScale=VISUAL_SCALE;group.userData.vsCombatReadability="scaled-7x+hud-marker+emissive-v2";group.userData.worldLifeKind="vs-drone";group.userData.worldLifeId=record.id;group.visible=false;scene.add(group);registerPhysicsPeer(group);return group;
}

function recordFor(id){
  id=String(id||"");if(!id||id===selfId)return null;let r=peers.get(id);if(!r){r={id,timeline:new VsPoseTimeline(),mesh:null,marker:null,lastPoseMs:-Infinity,health:health.get(id)??100,dead:(health.get(id)??100)<=0,color:colorFor(id)};peers.set(id,r);if(!health.has(id))health.set(id,100);r.marker=makeMarker(r);refreshColors(true);}return r;
}

function releaseLegacyPrimary(previousId){
  const b=bridge(),r=peers.get(previousId);if(!b?.vsPeerMesh||!r||r.mesh!==b.vsPeerMesh)return;r.mesh=null;b.vsPeerMesh.visible=false;delete b.vsPeerMesh.userData.vsPlayerId;delete b.vsPeerMesh.userData.vsPlayerColor;delete b.vsPeerMesh.userData.worldLifeKind;delete b.vsPeerMesh.userData.worldLifeId;
}

function removePeer(id){
  const key=String(id||""),r=peers.get(key);if(!r)return;const b=bridge();if(r.mesh&&r.mesh!==b?.vsPeerMesh)r.mesh.parent?.remove(r.mesh);else if(r.mesh===b?.vsPeerMesh)r.mesh.visible=false;r.marker?.remove();peers.delete(key);health.delete(key);confirmedHealth.delete(key);refreshColors(true);
}

function reconcilePeers(){
  const s=session(),ids=typeof s?.getPeerIds==="function"?s.getPeerIds():activeSession()?.getPeerIds?.();if(!Array.isArray(ids)||!ids.length)return;const active=new Set(ids.map(String));for(const id of [...peers.keys()])if(!active.has(id))removePeer(id);for(const id of active)recordFor(id);
}

function posePosition(pose){
  const b=bridge();if(Array.isArray(pose?.g)&&pose.g.length===2&&Number.isFinite(b?.originLon)&&Number.isFinite(b?.originLat)){const earth=6378137,lat0=b.originLat*Math.PI/180,north=(Number(pose.g[1])-b.originLat)*Math.PI/180*earth,east=(Number(pose.g[0])-b.originLon)*Math.PI/180*earth*Math.max(.01,Math.cos(lat0));return[east,north,Number(pose.p?.[2])||0];}return canonicalToLocal(pose?.p);
}

function onPoseEvent(event){updateIdentity();const{peerId,pose}=event.detail||{};if(!peerId||!pose)return;const r=recordFor(peerId);if(!r)return;const p=posePosition(pose),packet={...pose,p};if(r.timeline.push(packet,performance.now()))r.lastPoseMs=performance.now();}

function setPrimaryCompatibility(record){
  const b=bridge();if(!b||record.id!==primaryId)return;
  if(b.vsPeerMesh&&record.mesh!==b.vsPeerMesh){if(record.mesh&&!record.mesh.userData?.vsLegacyPrimary)record.mesh.parent?.remove(record.mesh);record.mesh=b.vsPeerMesh;record.mesh.userData.vsLegacyPrimary=true;record.mesh.userData.vsPlayerId=record.id;record.mesh.userData.vsPlayerColor=record.color;applyCombatScale(record.mesh);applyMaterialColor(record.mesh,record.color);registerPhysicsPeer(record.mesh);}
  b.vsPeerHealth=record.health;b.vsPeerDead=record.dead;
}

function renderMarker(r,camera,view,now){
  const marker=r.marker;if(!marker||!r.mesh||now-r.lastPoseMs>STALE_MS){if(marker)marker.hidden=true;return;}
  const rect=view.getBoundingClientRect();if(rect.width<1||rect.height<1){marker.hidden=true;return;}
  r.mesh.getWorldPosition(tempPosition);camera.getWorldPosition(tempCamera);tempProjected.copy(tempPosition).project(camera);tempCameraSpace.copy(tempPosition).applyMatrix4(camera.matrixWorldInverse);
  const inFront=tempCameraSpace.z<0;let nx=tempProjected.x,ny=tempProjected.y;if(!inFront){nx=-nx;ny=-ny;}
  const marginX=Math.min(42,rect.width*.08),marginY=Math.min(34,rect.height*.11),halfW=Math.max(1,rect.width/2-marginX),halfH=Math.max(1,rect.height/2-marginY),sx0=nx*rect.width/2,sy0=-ny*rect.height/2,scale=Math.min(1,halfW/Math.max(1,Math.abs(sx0)),halfH/Math.max(1,Math.abs(sy0))),x=rect.width/2+sx0*scale,y=rect.height/2+sy0*scale,onScreen=inFront&&Math.abs(tempProjected.x)<.96&&Math.abs(tempProjected.y)<.90&&tempProjected.z>-1&&tempProjected.z<1;
  marker.hidden=false;marker.classList.toggle("offscreen",!onScreen);marker.classList.toggle("dead",r.dead);marker.style.transform=`translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%)`;
  const own=bridge()?.airframeFor?.(bridge()?.threeScene)||bridge()?.airframe,distance=own?.position?own.position.distanceTo(tempPosition):0,index=Math.max(1,participantIds().indexOf(r.id)+1);marker.querySelector("strong").textContent=r.dead?`P${index} DOWN`:`P${index}`;marker.querySelector("small").textContent=r.dead?"WAITING RESET":`${r.health} HP · ${distance<100?distance.toFixed(0):Math.round(distance)}m`;
}

function ensureFxPools(){
  const scene=bridge()?.threeScene;if(!scene||tracerGeometry)return;tracerGeometry=new THREE.CylinderGeometry(.018,.018,1,6);explosionGeometry=new THREE.SphereGeometry(.12,7,5);
  for(let i=0;i<40;i++){const m=new THREE.MeshBasicMaterial({color:0xffd36a,transparent:true,opacity:.9,depthWrite:false,blending:THREE.AdditiveBlending}),mesh=new THREE.Mesh(tracerGeometry,m);mesh.visible=false;mesh.renderOrder=15;mesh.userData.flightFireIgnore=true;mesh.userData.vsRemoteShot=true;scene.add(mesh);remoteTracers.push({mesh,active:false,velocity:new THREE.Vector3(),born:0,expires:0});}
  for(let i=0;i<20;i++){const m=new THREE.MeshBasicMaterial({color:0xff5d2f,transparent:true,opacity:.9,depthWrite:false,blending:THREE.AdditiveBlending}),mesh=new THREE.Mesh(explosionGeometry,m);mesh.visible=false;mesh.renderOrder=16;mesh.userData.flightFireIgnore=true;mesh.userData.vsRemoteExplosion=true;scene.add(mesh);remoteExplosions.push({mesh,born:0,expires:0});}
}

function spawnRemoteShot(packet,peerId){
  ensureFxPools();if(!remoteTracers.length)return;const item=remoteTracers.find(x=>!x.active)||remoteTracers[hashId(packet.id)%remoteTracers.length];item.active=true;item.born=performance.now();item.expires=item.born+1600;item.mesh.material.color.setHex(colorFor(packet.playerId||peerId));const p=canonicalToLocal(packet.from),d=packet.dir;item.mesh.position.set(...p);item.velocity.set(Number(d?.[0])||0,Number(d?.[1])||0,Number(d?.[2])||0).normalize().multiplyScalar(clamp(Number(packet.speed)||210,1,500));const age=clamp((Date.now()-(Number(packet.t)||Date.now()))/1000,0,1.2);item.mesh.position.addScaledVector(item.velocity,age);item.mesh.visible=true;const view=viewport();if(view)view.dataset.vsRemoteShots=String((Number(view.dataset.vsRemoteShots)||0)+1);
}

function spawnExplosion(packet,small=false){
  ensureFxPools();if(!remoteExplosions.length)return;const item=remoteExplosions.find(x=>!x.mesh.visible)||remoteExplosions[hashId(packet.id)%remoteExplosions.length],p=canonicalToLocal(packet.p);item.born=performance.now();item.expires=item.born+(small?320:780);item.mesh.position.set(...p);item.mesh.scale.setScalar(small?.35:1);item.mesh.material.opacity=.95;item.mesh.visible=true;const view=viewport();if(view)view.dataset.vsRemoteExplosions=String((Number(view.dataset.vsRemoteExplosions)||0)+1);
}

function renderFx(now,dt){
  for(const item of remoteTracers){if(!item.active)continue;if(now>=item.expires){item.active=false;item.mesh.visible=false;continue;}item.mesh.position.addScaledVector(item.velocity,dt);tempDir.copy(item.velocity).normalize();item.mesh.quaternion.setFromUnitVectors(axisY,tempDir);item.mesh.scale.set(1,2.2,1);}
  for(const item of remoteExplosions){if(!item.mesh.visible)continue;if(now>=item.expires){item.mesh.visible=false;continue;}const t=(now-item.born)/(item.expires-item.born);item.mesh.scale.multiplyScalar(1+Math.min(.13,dt*6));item.mesh.material.opacity=Math.max(0,.95*(1-t));}
}

function applyState(packet){
  if(!packet)return;const stateKey=`${packet.id}:${packet.playerId}:${packet.hp}:${packet.killed}`;if(seenStates.has(stateKey))return;seenStates.add(stateKey);while(seenStates.size>1024)seenStates.delete(seenStates.values().next().value);
  const id=String(packet.playerId||""),hp=clamp(Math.round(Number(packet.hp)||0),0,100),killed=Boolean(packet.killed);if(!id)return;health.set(id,hp);confirmedHealth.add(id);
  if(id===selfId){const b=bridge();if(b){const wasDead=Boolean(b.vsLocalDead);b.vsLocalHealth=hp;b.vsLocalDead=killed;if(killed&&!wasDead)deaths++;b.updateVsCombatHud?.(true);}return;}
  const r=recordFor(id);if(!r)return;const wasDead=r.dead;r.health=hp;r.dead=killed;if(killed&&!wasDead&&packet.by===selfId)kills++;setPrimaryCompatibility(r);
}

function sendState(playerId,hp,killed,by="",id="",options={}){
  const s=session(),packet={type:"state",playerId,hp,killed,by,id:id||packetId("state")};applyState(packet);s?.sendGame?.(packet,options);
  if(killed){const r=playerId===selfId?null:peers.get(playerId),b=bridge(),own=b?.airframeFor?.(b.threeScene)||b?.airframe,p=playerId===selfId?own?.position:r?.mesh?.position;if(p){const fx={type:"explosion",id:`boom-${packet.id}`,p:localToCanonical([p.x,p.y,p.z]),playerId};s?.sendFx?.(fx);if(playerId!==selfId&&playerId!==primaryId)spawnExplosion(fx);}}
}

function reportLocalState(target=authorityId){
  if(!selfId||!target||target===selfId)return false;const hp=localHealth();return Boolean(session()?.sendGame?.({type:"state",playerId:selfId,hp,killed:hp<=0,by:"",id:packetId("report"),report:true},{target}));
}

function sendSnapshotTo(target){
  if(authorityId!==selfId||!target||target===selfId)return;for(const playerId of participantIds()){if(!confirmedHealth.has(playerId))continue;const hp=health.get(playerId)??100;session()?.sendGame?.({type:"state",playerId,hp,killed:hp<=0,by:"",id:packetId("sync")},{target});}
}

function handleAuthorityChange(previous,next){
  if(!selfId||!next||previous===next)return;const view=viewport();if(view)view.dataset.vsAuthorityChanges=String((Number(view.dataset.vsAuthorityChanges)||0)+1);
  if(next===selfId){authoritySettlingUntil=performance.now()+AUTHORITY_SETTLE_MS;confirmedHealth.add(selfId);const hp=localHealth();sendState(selfId,hp,hp<=0,"",packetId("authority-self"));}
  else{authoritySettlingUntil=0;pendingAuthorityHits.length=0;reportLocalState(next);}
}

function updateIdentity(){
  const s=session(),a=activeSession(),nextSelf=String(s?.getSelfId?.()||a?.getSelfId?.()||selfId||""),nextAuthority=String(s?.getAuthorityId?.()||a?.getAuthorityId?.()||participantIds()[0]||""),nextPrimary=String(a?.primaryPeerId||a?.peerId||primaryId||"");
  if(nextSelf)selfId=nextSelf;if(selfId&&!health.has(selfId)){health.set(selfId,clamp(Math.round(Number(bridge()?.vsLocalHealth)||100),0,100));confirmedHealth.add(selfId);}
  if(nextPrimary!==primaryId){lastPrimaryId=primaryId;if(lastPrimaryId)releaseLegacyPrimary(lastPrimaryId);primaryId=nextPrimary;}
  authorityId=nextAuthority;if(authorityId!==lastAuthorityId){const previous=lastAuthorityId;lastAuthorityId=authorityId;handleAuthorityChange(previous,authorityId);}
  const view=viewport();if(view){view.dataset.vsSelfId=selfId;view.dataset.vsAuthorityId=authorityId;view.dataset.vsPeerCount=String(peers.size);view.dataset.vsPlayerCount=String(Math.min(MAX_PLAYERS,peers.size+1));view.dataset.vsLocalColor=cssColor(colorFor(selfId));view.dataset.vsPlayerColors=JSON.stringify(Object.fromEntries([...assignments()].map(([id,c])=>[id,cssColor(c)])));view.dataset.vsCombatVisualScale=String(VISUAL_SCALE);view.dataset.vsCombatReadability="scaled-7x+hud-marker+emissive-v2";}
}

function authorityHit(packet,allowQueue=true){
  if(authorityId!==selfId||!packet||seenHits.has(packet.id))return;
  if(allowQueue&&performance.now()<authoritySettlingUntil){if(!pendingAuthorityHits.some(item=>item.id===packet.id))pendingAuthorityHits.push({...packet});return;}
  seenHits.add(packet.id);while(seenHits.size>512)seenHits.delete(seenHits.values().next().value);
  const target=String(packet.target||""),shooter=String(packet.shooter||"");if(!participantIds().includes(target)||!participantIds().includes(shooter))return;if(!confirmedHealth.has(target))confirmedHealth.add(target);
  const old=health.get(target)??100;if(old<=0)return;const hp=Math.max(0,old-Math.round(clamp(Number(packet.damage)||25,1,100))),killed=hp===0;health.set(target,hp);sendState(target,hp,killed,shooter,packet.id);
}

function flushAuthorityHits(now){if(authorityId!==selfId||now<authoritySettlingUntil||!pendingAuthorityHits.length)return;for(const id of participantIds())if(!confirmedHealth.has(id)){health.set(id,health.get(id)??100);confirmedHealth.add(id);}const queued=pendingAuthorityHits.splice(0);for(const packet of queued)authorityHit(packet,false);}

function applyRespawn(packet){
  const id=String(packet?.playerId||"");if(!id)return;health.set(id,100);confirmedHealth.add(id);
  if(id===selfId){const b=bridge();if(b){b.vsLocalHealth=100;b.vsLocalDead=false;b.updateVsCombatHud?.(true);}return;}
  const r=recordFor(id);if(r){r.health=100;r.dead=false;setPrimaryCompatibility(r);}
}

function onGameEvent(event){
  updateIdentity();const packet=event.detail?.packet,peerId=String(event.detail?.peerId||"");if(!packet)return;
  if(packet.type==="hit-request"){if(authorityId===selfId&&peerId&&String(packet.shooter||"")===peerId)authorityHit({...packet,shooter:peerId});return;}
  if(packet.type==="state"){
    if(packet.report){if(authorityId===selfId&&peerId&&String(packet.playerId||"")===peerId){const hp=clamp(Math.round(Number(packet.hp)||0),0,100);health.set(peerId,hp);confirmedHealth.add(peerId);sendState(peerId,hp,hp<=0,"",packetId("authoritative-report"));}return;}
    if(!authorityId||peerId===authorityId)applyState(packet);return;
  }
  if(packet.type==="respawn-request"&&authorityId===selfId){const id=peerId||String(packet.playerId||"");if(id&&id===String(packet.playerId||"")&&participantIds().includes(id)&&(health.get(id)??100)<=0){const state={type:"respawn",playerId:id,hp:100};applyRespawn(state);session()?.sendGame?.(state);}return;}
  if(packet.type==="respawn"&&(!authorityId||peerId===authorityId))applyRespawn(packet);
}

function onFxEvent(event){
  const packet=event.detail?.packet,peerId=event.detail?.peerId;if(!packet||packet.objectId)return;if(packet.type==="shot")spawnRemoteShot(packet,peerId);else if(packet.type==="explosion"){if(packet.playerId===selfId||packet.playerId===primaryId)return;spawnExplosion(packet);}else if(packet.type==="impact")spawnExplosion(packet,true);
}

function onPeerEvent(event){
  const detail=event.detail||{},id=String(detail.peerId||"");if(detail.type==="join"){recordFor(id);refreshColors(true);}else if(detail.type==="leave")removePeer(id);updateIdentity();if(detail.type==="join"){if(authorityId===selfId)sendSnapshotTo(id);else reportLocalState();}else if(detail.type==="leave"&&authorityId!==selfId)reportLocalState();
}

function targetFromHit(hit){
  for(let node=hit?.object;node;node=node.parent){const id=String(node.userData?.vsPlayerId||"");if(id&&id!==selfId)return id;}
  const b=bridge();if(primaryId&&b?.vsPeerMesh){for(let node=hit?.object;node;node=node.parent)if(node===b.vsPeerMesh)return primaryId;}return"";
}

function installBridgeHooks(){
  const b=bridge();if(!b||b.__vsMultiplayerHooks)return;b.__vsMultiplayerHooks=true;const baseRegister=b.registerVsHit?.bind(b);
  b.registerVsHit=hit=>{if(b.registerWorldPopulationHit?.(hit))return true;updateIdentity();const target=targetFromHit(hit);if(!target||!session()?.sendGame)return baseRegister?.(hit)||false;const id=packetId("hit"),packet={type:"hit-request",id,shooter:selfId,target,damage:25};if(authorityId===selfId)authorityHit(packet);else if(authorityId)session()?.sendGame?.(packet,{target:authorityId});return true;};
}

function scanLocalFx(now){
  const scene=bridge()?.threeScene;if(!scene)return;
  if(now-lastTracerScan>=TRACER_SCAN_MS){lastTracerScan=now;localTracerMeshes.length=0;localImpactMeshes.length=0;scene.traverse(node=>{if(!node?.isMesh)return;if(node.userData?.flightFireTracer)localTracerMeshes.push(node);if(node.userData?.flightFireImpact)localImpactMeshes.push(node);});}
  const s=session();if(!s?.sendFx||!selfId)return;
  for(const mesh of localTracerMeshes){const visible=Boolean(mesh.visible),was=Boolean(tracerWasVisible.get(mesh));tracerWasVisible.set(mesh,visible);if(!visible||was)continue;mesh.getWorldQuaternion(tempQuat);tempDir.copy(axisY).applyQuaternion(tempQuat).normalize();mesh.getWorldPosition(tempPosition);tempPosition.addScaledVector(tempDir,1.1);s.sendFx({type:"shot",id:packetId("shot"),from:localToCanonical([tempPosition.x,tempPosition.y,tempPosition.z]),dir:[tempDir.x,tempDir.y,tempDir.z],speed:210,playerId:selfId,t:Date.now()});}
  for(const mesh of localImpactMeshes){const visible=Boolean(mesh.visible),was=Boolean(impactWasVisible.get(mesh));impactWasVisible.set(mesh,visible);if(!visible||was)continue;mesh.getWorldPosition(tempPosition);s.sendFx({type:"impact",id:packetId("impact"),p:localToCanonical([tempPosition.x,tempPosition.y,tempPosition.z]),playerId:selfId});}
}

function updateSessionHooks(){const s=session();if(s===lastSession)return;lastSession=s;installBridgeHooks();updateIdentity();reconcilePeers();refreshColors(true);lastManualRespawns=Number(viewport()?.dataset.vsManualRespawns||0);}

function syncLegacyLocalState(){
  const b=bridge(),view=viewport();if(!b||!selfId)return;const hp=localHealth(),dead=hp<=0,manual=Number(view?.dataset.vsManualRespawns||0);
  if(manual>lastManualRespawns&&dead){lastManualRespawns=manual;const req={type:"respawn-request",playerId:selfId};if(authorityId===selfId){applyRespawn({type:"respawn",playerId:selfId,hp:100});session()?.sendGame?.({type:"respawn",playerId:selfId,hp:100});}else if(authorityId)session()?.sendGame?.(req,{target:authorityId});}
  else lastManualRespawns=Math.max(lastManualRespawns,manual);
  const canonicalHp=health.get(selfId)??100;b.vsLocalHealth=canonicalHp;b.vsLocalDead=canonicalHp<=0;if(b.vsLocalDead!==lastLocalDead)lastLocalDead=b.vsLocalDead;
}

function updateHud(){
  const b=bridge(),hud=document.getElementById("vsCombatHud");if(!hud||!b?.vsConnected)return;const hp=localHealth();b.vsKills=kills;b.vsDeaths=deaths;hud.hidden=false;hud.textContent=`HP ${hp} · P ${peers.size+1} · K ${kills}`;const button=document.getElementById("lanVsButton");if(button&&peers.size)button.textContent=`MATES ${peers.size} ✓`;
}

function render(now=performance.now()){
  raf=requestAnimationFrame(render);const dt=Math.min(.05,Math.max(0,(now-lastRender)/1000||0));lastRender=now;updateSessionHooks();updateIdentity();reconcilePeers();flushAuthorityHits(now);
  const b=bridge(),camera=b?.threeCamera,view=viewport();if(!b?.threeScene||!camera||!view)return;document.body.classList.toggle("vs-multiplayer",peers.size>0);refreshColors(false,now);
  for(const r of peers.values()){if(r.id===primaryId&&b.vsPeerMesh){r.mesh=b.vsPeerMesh;setPrimaryCompatibility(r);}else if(!r.mesh)r.mesh=createPeerMesh(r);if(!r.mesh)continue;applyCombatScale(r.mesh);registerPhysicsPeer(r.mesh);const sample=r.timeline.sample(now);if(sample&&!r.dead&&now-r.lastPoseMs<=STALE_MS){r.mesh.position.set(...sample.p);r.mesh.quaternion.set(...sample.q);r.mesh.visible=true;}else if(r.dead||now-r.lastPoseMs>STALE_MS)r.mesh.visible=false;renderMarker(r,camera,view,now);}
  scanLocalFx(now);renderFx(now,dt);syncLegacyLocalState();updateHud();
}

export function installVsMultiplayer(){
  if(installed)return;installed=true;style=document.createElement("style");style.textContent=`body.vs-multiplayer #vsEnemyMarker{display:none!important}.vs-player-marker{--vs-player-color:#fff;position:absolute;z-index:14;left:0;top:0;min-width:48px;padding:3px 6px 3px 14px;border-radius:7px;background:#071522b8;color:#fff;font:800 9px/1.05 system-ui,-apple-system,sans-serif;letter-spacing:.02em;pointer-events:none;box-shadow:0 0 0 1px color-mix(in srgb,var(--vs-player-color) 52%,transparent),0 0 10px color-mix(in srgb,var(--vs-player-color) 28%,transparent)}.vs-player-marker i{position:absolute;left:5px;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:var(--vs-player-color);box-shadow:0 0 7px var(--vs-player-color)}.vs-player-marker strong{display:block;font-size:8px;color:var(--vs-player-color)}.vs-player-marker small{display:block;font-size:8px;opacity:.82}.vs-player-marker.offscreen{opacity:.72}.vs-player-marker.dead{opacity:.58}`;document.head.appendChild(style);globalThis.addEventListener(VS_PEER_EVENT,onPeerEvent);globalThis.addEventListener(VS_POSE_EVENT,onPoseEvent);globalThis.addEventListener(VS_GAME_EVENT,onGameEvent);globalThis.addEventListener(VS_FX_EVENT,onFxEvent);raf=requestAnimationFrame(render);
}