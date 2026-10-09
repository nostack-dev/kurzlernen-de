import * as THREE from "three";
import {spawnWorldPersonRagdoll} from "./world_person_ragdoll.mjs";
import {createCrowd,civilianColors} from "./crowd_characters.mjs";
import {groundHeightAt} from "./terrain_craters.mjs";

const MOBILE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i.test(globalThis.navigator?.userAgent||"");
const EXTRA_COUNT=MOBILE?28:40;
const extras=[];
const tmp=new THREE.Vector3(),cameraPos=new THREE.Vector3(),cameraForward=new THREE.Vector3(),peerPos=new THREE.Vector3(),peerForward=new THREE.Vector3(),peerQuat=new THREE.Quaternion(),toCandidate=new THREE.Vector3();
let installed=false,sceneRef=null,root=null,wrappedBridge=null,lastFrame=performance.now(),cachedPeople=[],cachedViewers=[],lastPeopleScan=-Infinity,lastViewerScan=-Infinity;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function ready(){return Boolean(document.getElementById("status")?.textContent?.includes("SIM ready"));}
function effectiveVisible(node){for(let n=node;n;n=n.parent)if(n.visible===false)return false;return true;}
function material(color){return new THREE.MeshStandardMaterial({color,roughness:.82,metalness:0});}
function tag(node,id){node.userData.worldPopulationKind="person";node.userData.worldPopulationId=id;node.userData.worldProceduralId=id;node.userData.worldPopulationClone=false;node.userData.crowdSupplemental=true;}
// Drawn by the instanced articulated crowd; the group holds an invisible,
// raycastable body proxy for hits.
let proxyGeo=null,proxyMat=null,crowd=null,crowdHooked=null,crowdLast=performance.now();
function makeExtra(index){
  const id=`crowd-extra-${index}`,group=new THREE.Group();proxyGeo??=(()=>{const g=new THREE.CapsuleGeometry(.26,1.2,3,8);g.rotateX(Math.PI/2);g.translate(0,0,.86);return g;})();proxyMat??=Object.assign(new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}),{colorWrite:false,visible:false});
  const proxy=new THREE.Mesh(proxyGeo,proxyMat);proxy.name="PERSON_HIT_PROXY";proxy.userData.styleSkip=true;tag(proxy,id);proxy.userData.hitProxy=true;tag(group,id);group.visible=false;group.add(proxy);
  return{id,index,group,colors:civilianColors(index*7919+13),legL:{rotation:{}},legR:{rotation:{}},armL:{rotation:{}},armR:{rotation:{}},deadUntil:0,everVisible:false,prev:null,speed:1.3};
}
function updateCrowdExtras(){if(!crowd)return;const now=performance.now(),dt=Math.min(.1,Math.max(.001,(now-crowdLast)/1000));crowdLast=now;
  for(const e of extras){if(!e.group.visible||!root?.visible||Date.now()<e.deadUntil){crowd.hide(e.index);e.prev=null;continue;}if(!e.colored){crowd.setColors(e.index,e.colors);e.colored=true;}
    const x=e.group.position.x,y=e.group.position.y;if(e.prev){const v=Math.hypot(x-e.prev.x,y-e.prev.y)/dt;if(v<12)e.speed=e.speed*.85+v*.15;}e.prev={x,y};
    crowd.set(e.index,{x,y,z:groundHeightAt(x,y),yaw:e.group.rotation.z-Math.PI/2,state:e.speed>3.2?"run":e.speed>.25?"walk":"idle",speed:e.speed,dt});}
  crowd.commit();}
function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&root)return true;root?.parent?.remove(root);sceneRef=scene;root=new THREE.Group();root.name="WORLD_CROWD_EXTRAS";root.userData.flightFireIgnore=false;scene.add(root);crowd?.dispose?.();crowd=createCrowd(scene,{capacity:EXTRA_COUNT,name:"WORLD_CROWD_EXTRAS"});extras.splice(0);for(let i=0;i<EXTRA_COUNT;i++){const extra=makeExtra(i);extras.push(extra);root.add(extra.group);}cachedPeople=[];cachedViewers=[];lastPeopleScan=lastViewerScan=-Infinity;return true;}
function nativePeople(now){if(now-lastPeopleScan<750)return cachedPeople;lastPeopleScan=now;const out=[],scene=bridge()?.threeScene;scene?.traverse?.(node=>{if(!node?.isGroup||node.userData?.crowdSupplemental)return;const kind=String(node.userData?.worldPopulationKind||""),id=String(node.userData?.worldPopulationId||node.userData?.worldProceduralId||"");if(kind==="person"&&id&&effectiveVisible(node))out.push(node);});cachedPeople=out;return out;}
function viewers(now){if(now-lastViewerScan<500)return cachedViewers;lastViewerScan=now;const scene=bridge()?.threeScene,camera=bridge()?.threeCamera,out=[];if(camera?.getWorldPosition&&camera?.getWorldDirection){camera.updateMatrixWorld?.(true);camera.getWorldPosition(cameraPos);camera.getWorldDirection(cameraForward).normalize();out.push({position:cameraPos.clone(),forward:cameraForward.clone(),halfAngle:70*Math.PI/180,local:true});}const byId=new Map();scene?.traverse?.(node=>{if(node.visible===false)return;const id=String(node.userData?.vsPlayerId||"");if(!id)return;const u=node.userData||{},isViewer=Boolean(u.vsMultiplayerPeer||u.vsLegacyPrimary||u.vsPeer||u.vsHumanAvatar);if(!isViewer)return;node.getWorldPosition?.(peerPos);node.getWorldQuaternion?.(peerQuat);peerForward.set(0,1,0).applyQuaternion(peerQuat).normalize();if(!byId.has(id))byId.set(id,{position:peerPos.clone(),forward:peerForward.clone(),halfAngle:70*Math.PI/180,local:false});});out.push(...byId.values());cachedViewers=out;return out;}
function safeSpawn(point,allViewers){if(!allViewers.length)return true;for(const viewer of allViewers){toCandidate.copy(point).sub(viewer.position);const distance=toCandidate.length();if(distance<24)return false;if(distance>240)continue;toCandidate.multiplyScalar(1/Math.max(distance,1e-6));if(toCandidate.dot(viewer.forward)>=Math.cos(viewer.halfAngle))return false;}const local=allViewers.find(v=>v.local);if(local){toCandidate.copy(point).sub(local.position);if(toCandidate.lengthSq()<1e-6)return false;toCandidate.normalize();if(toCandidate.dot(local.forward)>=-.05)return false;}return true;}
function crowdRootForHit(hit){for(let node=hit?.object;node;node=node.parent)if(node.userData?.crowdSupplemental&&node.userData?.worldPopulationId?.startsWith("crowd-extra-"))return node.isGroup?node:node.parent;return null;}
function killExtra(rootNode){const id=String(rootNode?.userData?.worldPopulationId||""),extra=extras.find(item=>item.id===id);if(!extra||Date.now()<extra.deadUntil)return true;extra.deadUntil=Date.now()+10000;rootNode.getWorldPosition(tmp);const yaw=Number(rootNode.rotation?.z)||0;rootNode.visible=false;spawnWorldPersonRagdoll({position:[tmp.x,tmp.y,tmp.z+.05],yaw:yaw-Math.PI/2,impulse:[Math.cos(yaw)*2.3,Math.sin(yaw)*2.3,2.5],seed:id,id,colors:extra.colors});window.dispatchEvent(new CustomEvent("arondight:world-kill",{detail:{id,kind:"person",position:[tmp.x,tmp.y,tmp.z],network:true,supplemental:true}}));const v=viewport();if(v)v.dataset.worldCrowdHits=String((Number(v.dataset.worldCrowdHits)||0)+1);return true;}
function ensureHitBridge(){const b=bridge();if(!b||typeof b.registerWorldPopulationHit!=="function")return false;if(b===wrappedBridge&&b.registerWorldPopulationHit?.__crowdDensityV1)return true;const base=b.registerWorldPopulationHit.bind(b),wrapped=hit=>{const crowd=crowdRootForHit(hit);if(crowd)return killExtra(crowd);return Boolean(base(hit));};Object.defineProperty(wrapped,"__crowdDensityV1",{value:true});b.registerWorldPopulationHit=wrapped;wrappedBridge=b;return true;}
function updateExtra(extra,base,now,allViewers){if(!base||Date.now()<extra.deadUntil){extra.group.visible=false;extra.placed=false;return;}base.getWorldPosition(tmp);const yaw=Number(base.rotation?.z)||0,forwardX=Math.cos(yaw),forwardY=Math.sin(yaw),sideX=-forwardY,sideY=forwardX,sign=(extra.index%4<2?-1:1),spacing=4.2+(extra.index%7)*1.95,side=(extra.index&1?1:-1)*(.42+(extra.index%3)*.18),wobble=Math.sin(now*.0011+extra.index*.77)*.22,x=tmp.x+forwardX*spacing*sign+sideX*(side+wobble),y=tmp.y+forwardY*spacing*sign+sideY*(side+wobble),z=tmp.z;
  // Extras walk to their slot next to the base person at human speed and face
  // where they walk — when the base turns or flees, its companions don't swing
  // round it at 20+ m/s. Only a real teleport (rebind far away) snaps.
  {const dt=Math.min(.1,Math.max(0,(now-(extra.lastT??now))/1000));extra.lastT=now;const g=extra.group.position,dx=x-g.x,dy=y-g.y,d=Math.hypot(dx,dy);
   if(!extra.placed||d>30){g.set(x,y,z);extra.placed=true;extra.group.rotation.set(0,0,yaw);}
   else{const v=d>2.5?3.4:d>.6?1.6:d/Math.max(dt,1e-3),step=Math.min(d,v*dt);if(d>1e-4){g.x+=dx/d*step;g.y+=dy/d*step;}g.z=z;extra.group.rotation.set(0,0,d>.6?Math.atan2(dy,dx):yaw);}}if(!extra.everVisible){if(!safeSpawn(extra.group.position,allViewers)){extra.group.visible=false;return;}extra.everVisible=true;}extra.group.visible=true;const gait=Math.sin(now*.007+extra.index)*.34;extra.legL.rotation.y=gait;extra.legR.rotation.y=-gait;extra.armL.rotation.y=-gait*.72;extra.armR.rotation.y=gait*.72;}
function publish(nativeCount,visible){const v=viewport();if(!v)return;v.dataset.worldCrowdDensity="native+supplemental-passersby-v1";v.dataset.worldCrowdExtraCount=String(EXTRA_COUNT);v.dataset.worldCrowdNativePeople=String(nativeCount);v.dataset.worldCrowdVisibleExtras=String(visible);v.dataset.worldCrowdSpawnRule="outside-joint-player-cones-v1";v.dataset.worldCrowdBootGuard="after-sim-ready-v1";}
function tick(){
  {const b=bridge();if(b&&crowdHooked!==b&&typeof b.addPreRenderHook==="function"){b.addPreRenderHook(()=>{try{updateCrowdExtras();}catch(e){console.warn("crowd extras",e);}});crowdHooked=b;}}
  const now=performance.now();if(!ready()){lastFrame=now;setTimeout(tick,200);return;}publish(cachedPeople.length,0);if(!ensureScene()){setTimeout(tick,100);return;}ensureHitBridge();const people=nativePeople(now),allViewers=viewers(now);let visible=0;for(let i=0;i<extras.length;i++){const base=people.length?people[(i*5+3)%people.length]:null;updateExtra(extras[i],base,now,allViewers);if(extras[i].group.visible)visible++;}publish(people.length,visible);lastFrame=now;setTimeout(tick,50);
}
export function installWorldCrowdDensityV1(){if(installed)return;installed=true;setTimeout(tick,0);}
installWorldCrowdDensityV1();
