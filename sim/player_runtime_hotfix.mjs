import * as THREE from "three";
import {VS_GAME_EVENT,VS_PEER_EVENT} from "./lan_vs.mjs";

const INDEX_REFRESH_MS=3200;
const AIM_YAW_PER_PX=.0062;
const AIM_PITCH_PER_PX=.0049;
const UI_SELECTOR="#soloTopbar,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#footHud,#worldLookHud,dialog,button,input,select,textarea,a,label";
const WORLD_DECOR_RE=/(?:WORLD_.*(?:TREE|LAMP|PROP|SIGN|DECOR|STREET)|WORLD_LIVELINESS_(?:TREES|LAMPS))/i;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

let installed=false,patchedScene=null,nativeTraverse=null,cache=emptyCache(),build=null,lastIndexStart=-Infinity,indexTimer=0;
let dragPointer=null,lastPointerX=0,lastPointerY=0,lastResetAt=-Infinity,resetSeq=0,lastAvatarCheck=-Infinity;
let patchedRegister=null,shotSeq=0,resetHumanAnchor=null,resetAnchorSawFoot=false;
const callbackKinds=new WeakMap();
const tmpPos=new THREE.Vector3(),tmpQuat=new THREE.Quaternion(),tmpEuler=new THREE.Euler();

function emptyCache(){return{peer:[],vehicles:[],population:[],decor:[],fire:[],fireSet:new Set(),localAvatar:null,generation:0};}
function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function gameplayTarget(target){return target instanceof Element&&Boolean(target.closest("#viewport"))&&!target.closest(UI_SELECTOR);}
function ancestorNames(node){let out="";for(let n=node;n;n=n.parent)out+=` ${String(n.name||"")}`;return out;}
function ownSession(){return bridge()?.vsSession||null;}
function selfId(){const s=ownSession();try{return String(s?.getSelfId?.()||s?.active?.getSelfId?.()||"");}catch{return"";}}

function classifyTraverse(callback){
  if(typeof callback!=="function")return"native";const known=callbackKinds.get(callback);if(known)return known;let source="";try{source=Function.prototype.toString.call(callback);}catch{}
  let kind="native";
  if(source.includes("vsMultiplayerPeer")&&source.includes("vsLegacyPrimary"))kind="peer";
  else if(source.includes("worldLifeKind")&&source.includes("vehicleNodes"))kind="vehicles";
  else if(source.includes("worldPopulationKind")&&source.includes("candidates.push")&&source.includes("worldPopulationClone"))kind="population";
  else if(source.includes("worldActionFeedbackFx")&&source.includes("flightFireTracer"))kind="decor";
  else if(source.includes("arondightAirframe")&&source.includes("flightFireDecal")&&source.includes("hiddenTrainingObject"))kind="fire";
  callbackKinds.set(callback,kind);return kind;
}
function pushFire(target,node){if(node&&!target.fireSet.has(node)){target.fireSet.add(node);target.fire.push(node);}}
function indexNode(node,target){
  if(!node)return;const u=node.userData||{},life=String(u.worldLifeKind||""),populationKind=String(u.worldPopulationKind||"");
  if(u.localHumanAvatar||node.name==="LOCAL_HUMAN_VR")target.localAvatar=node;
  if(String(u.vsPlayerId||"")&&!u.vsHumanAvatar&&(u.vsMultiplayerPeer||u.vsLegacyPrimary||u.vsPeer))target.peer.push(node);
  if(node.children?.length&&((life==="car"||life==="bus")||(populationKind==="car"&&!u.worldLifeId)))target.vehicles.push(node);
  if(node.isMesh&&populationKind&&!u.worldPopulationClone)target.population.push(node);
  if((node.isMesh||node.isInstancedMesh)&&!u.flightFireDecal&&!u.flightFireTracer&&!u.worldActionFeedbackFx&&(populationKind||life||WORLD_DECOR_RE.test(ancestorNames(node))))target.decor.push(node);
  if(node.isMesh&&!u.arondightAirframe&&!u.flightFireDecal&&!u.flightFireIgnore&&node.material?.visible!==false)pushFire(target,node);
}
function idleSchedule(fn){if(typeof requestIdleCallback==="function")return requestIdleCallback(fn,{timeout:48});return setTimeout(()=>fn({timeRemaining:()=>2,didTimeout:true}),0);}
function startIndex(scene,force=false){
  if(!scene||build)return;const now=performance.now();if(!force&&now-lastIndexStart<INDEX_REFRESH_MS)return;lastIndexStart=now;build={scene,queue:[scene],next:emptyCache()};pumpIndex();
}
function pumpIndex(){
  if(!build)return;idleSchedule(deadline=>{
    if(!build)return;let processed=0;while(build.queue.length&&processed<180&&(processed<32||deadline.timeRemaining()>1)){
      const node=build.queue.pop();indexNode(node,build.next);const children=node?.children||[];for(let i=children.length-1;i>=0;i--)build.queue.push(children[i]);processed++;
    }
    if(build.queue.length){pumpIndex();return;}
    build.next.generation=(cache.generation||0)+1;cache=build.next;const scene=build.scene;build=null;makeLocalAvatarShootable(scene);const v=viewport();if(v){v.dataset.playerSceneIndex=String(cache.generation);v.dataset.playerSceneFireCandidates=String(cache.fire.length);v.dataset.playerSceneTraversal="cached-incremental-v3";}
  });
}
function scheduleReindex(){clearTimeout(indexTimer);indexTimer=setTimeout(()=>{const scene=bridge()?.threeScene;if(scene&&!build)startIndex(scene,true);scheduleReindex();},INDEX_REFRESH_MS);}
function patchSceneTraversal(scene){
  if(!scene||scene===patchedScene)return;if(patchedScene&&nativeTraverse&&patchedScene.traverse?.__playerRuntimeHotfix)patchedScene.traverse=nativeTraverse;
  patchedScene=scene;nativeTraverse=scene.traverse;const base=nativeTraverse.bind(scene);
  const wrapper=function(callback){
    const kind=classifyTraverse(callback);if(kind==="native")return base(callback);const list=cache[kind]?.length?cache[kind]:(build?.next?.[kind]||[]);
    for(const node of list){if(!node||node!==scene&&!node.parent)continue;callback(node);if(kind==="decor"&&node.isMesh&&!node.userData?.flightFireIgnore&&!node.userData?.flightFireDecal)pushFire(cache,node);}
  };
  wrapper.__playerRuntimeHotfix=true;wrapper.__nativeTraverse=nativeTraverse;scene.traverse=wrapper;cache=emptyCache();build=null;startIndex(scene,true);const v=viewport();if(v)v.dataset.playerSceneTraversal="indexing-v3";
}

function localAvatarRoot(scene){return cache.localAvatar||build?.next?.localAvatar||scene?.children?.find?.(node=>node?.userData?.localHumanAvatar||node?.name==="LOCAL_HUMAN_VR")||null;}
function makeLocalAvatarShootable(scene){
  const root=localAvatarRoot(scene);if(!root)return false;cache.localAvatar=root;const sid=selfId(),stack=[root];let count=0;
  while(stack.length){const node=stack.pop();if(node?.isMesh){node.userData.flightFireIgnore=false;node.userData.worldPopulationClone=false;if(sid&&!node.userData.vsPlayerId)node.userData.vsPlayerId=sid;pushFire(cache,node);count++;}for(const child of node?.children||[])stack.push(child);}
  const v=viewport();if(v){v.dataset.selfHarm="enabled-v2";v.dataset.selfHitMeshes=String(count);}return count>0;
}
function isLocalHumanHit(hit){for(let n=hit?.object;n;n=n.parent)if(n.userData?.localHumanAvatar||n.name==="LOCAL_HUMAN_VR")return true;return false;}
function fallbackSelfDamage(b,damage=25){const v=viewport(),old=clamp(Number(b?.vsLocalHealth??v?.dataset.selfHp??100),0,100),hp=Math.max(0,old-damage);if(b){b.vsLocalHealth=hp;b.vsLocalDead=hp<=0;b.updateVsCombatHud?.(true);}if(v){v.dataset.selfHp=String(hp);v.dataset.selfHits=String((Number(v.dataset.selfHits)||0)+1);}window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{self:true,damage,hp}}));return true;}
function sendSelfHit(hit){
  const b=bridge(),s=ownSession(),sid=selfId(),v=viewport(),damage=25;if(!b)return false;
  if(sid&&typeof s?.sendGame==="function"){
    const authority=String(v?.dataset.vsAuthorityId||""),packet={type:"hit-request",id:`self-${Date.now().toString(36)}-${(++shotSeq).toString(36)}`,shooter:sid,target:sid,damage};
    if(authority===sid)window.dispatchEvent(new CustomEvent(VS_GAME_EVENT,{detail:{peerId:sid,packet}}));
    else if(authority)s.sendGame(packet,{target:authority});
    else return fallbackSelfDamage(b,damage);
    if(v)v.dataset.selfHits=String((Number(v.dataset.selfHits)||0)+1);window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{self:true,damage}}));return true;
  }
  return fallbackSelfDamage(b,damage);
}
function patchSelfHitRouting(){
  const b=bridge(),current=b?.registerVsHit;if(!b||typeof current!=="function"||current===patchedRegister)return;if(!current.__worldActionFeedbackWrapper)return;
  const base=current.bind(b),wrapper=hit=>isLocalHumanHit(hit)?sendSelfHit(hit):Boolean(base(hit));wrapper.__playerRuntimeSelfHit=true;wrapper.__worldActionFeedbackWrapper=true;wrapper.__worldActionFeedbackBase=current.__worldActionFeedbackBase||current;patchedRegister=wrapper;b.registerVsHit=wrapper;const v=viewport();if(v)v.dataset.selfHitRouting="local-authoritative-v2";
}

function applyAimDelta(dx,dy){const w=walk(),v=viewport();if(w?.mode!=="foot"||!v)return false;const yaw=Number(v.dataset.walkYaw)||0,pitch=Number(v.dataset.walkPitch)||0;w.setPose?.({yaw:yaw+Number(dx||0)*AIM_YAW_PER_PX,pitch:clamp(pitch-Number(dy||0)*AIM_PITCH_PER_PX,-1.30,1.30)});v.dataset.walkAimEvents=String((Number(v.dataset.walkAimEvents)||0)+1);return true;}
function installAim(){
  document.addEventListener("pointerdown",event=>{
    const v=viewport(),w=walk();if(w?.mode!=="foot"||!v||!gameplayTarget(event.target))return;if(event.pointerType==="mouse"&&event.button!==0)return;
    if(event.pointerType==="mouse"&&document.pointerLockElement===v){w.fire?.();return;}dragPointer=event.pointerId;lastPointerX=event.clientX;lastPointerY=event.clientY;if(event.pointerType==="mouse"&&v.requestPointerLock)try{v.requestPointerLock();}catch{}
  },{capture:true,passive:true});
  document.addEventListener("pointermove",event=>{
    if(walk()?.mode!=="foot")return;const v=viewport();if(document.pointerLockElement===v){applyAimDelta(event.movementX,event.movementY);return;}if(event.pointerId!==dragPointer)return;const dx=event.clientX-lastPointerX,dy=event.clientY-lastPointerY;lastPointerX=event.clientX;lastPointerY=event.clientY;applyAimDelta(dx,dy);
  },{capture:true,passive:true});
  const release=event=>{if(event.pointerId===dragPointer)dragPointer=null;};document.addEventListener("pointerup",release,{capture:true,passive:true});document.addEventListener("pointercancel",release,{capture:true,passive:true});document.addEventListener("contextmenu",event=>{if(walk()?.mode==="foot"&&gameplayTarget(event.target))event.preventDefault();},{capture:true});const v=viewport();if(v)v.dataset.walkAimProfile="pointerlock+drag-center-v6";
}

function resetPoseFromAirframe(){
  const b=bridge(),root=b?.threeScene?(b.airframeFor?.(b.threeScene)||b.airframe):null;if(!root)return{x:0,y:0,yaw:0,pitch:0};root.updateWorldMatrix?.(true,false);root.getWorldPosition?.(tmpPos);root.getWorldQuaternion?.(tmpQuat);tmpEuler.setFromQuaternion(tmpQuat,"XYZ");return{x:Number(tmpPos.x)||0,y:Number(tmpPos.y)||0,yaw:Number(tmpEuler.z)||0,pitch:0};
}
function syncResetHumanAnchor(scene){
  const anchor=resetHumanAnchor,w=walk();if(!anchor||!w)return;if(w.mode==="foot"){if(!resetAnchorSawFoot){w.setPose?.(anchor);resetAnchorSawFoot=true;}return;}if(resetAnchorSawFoot){resetHumanAnchor=null;resetAnchorSawFoot=false;return;}const root=localAvatarRoot(scene);if(root){root.position.set(anchor.x,anchor.y,0);root.rotation.set(0,0,anchor.yaw);}
}
function performPlayerReset(seq){
  if(seq!==resetSeq)return;const w=walk(),v=viewport();if(!w)return;const pose=resetPoseFromAirframe();if(v)v.dataset.vsManualRespawns=String((Number(v.dataset.vsManualRespawns)||0)+1);
  if(w.mode==="foot"){w.setPose?.(pose);resetHumanAnchor=null;resetAnchorSawFoot=false;if(v){v.dataset.playerReset="foot+health-v3";v.dataset.selfHp="100";}}
  else{resetHumanAnchor={...pose};resetAnchorSawFoot=false;syncResetHumanAnchor(bridge()?.threeScene);if(v){v.dataset.playerReset="human+drone+health-v3";v.dataset.selfHp="100";}}
  const b=bridge();if(b&&!selfId()){b.vsLocalHealth=100;b.vsLocalDead=false;b.updateVsCombatHud?.(true);}
}
function queuePlayerReset(){const now=performance.now();if(now-lastResetAt<90)return;lastResetAt=now;const seq=++resetSeq;requestAnimationFrame(()=>requestAnimationFrame(()=>performPlayerReset(seq)));}
function installResetHook(){document.addEventListener("click",event=>{const id=event.target instanceof Element?event.target.closest("#reset,#soloReset")?.id:"";if(id)queuePlayerReset();},{capture:true,passive:true});}

function maintenance(now=performance.now()){
  const scene=bridge()?.threeScene;if(scene){patchSceneTraversal(scene);if(now-lastAvatarCheck>250){lastAvatarCheck=now;makeLocalAvatarShootable(scene);}if(!build&&now-lastIndexStart>INDEX_REFRESH_MS)startIndex(scene,true);syncResetHumanAnchor(scene);}patchSelfHitRouting();requestAnimationFrame(maintenance);
}
function onWorldChanged(){const scene=bridge()?.threeScene;if(scene&&!build)startIndex(scene,true);}

export function installPlayerRuntimeHotfix(){
  if(installed)return;installed=true;installAim();installResetHook();addEventListener(VS_PEER_EVENT,onWorldChanged);scheduleReindex();const v=viewport();if(v){v.dataset.playerRuntimeHotfix="reset+selfhit+aim+cached-scene-v3";v.dataset.walkAimProfile="pointerlock+drag-center-v6";}requestAnimationFrame(maintenance);
}
