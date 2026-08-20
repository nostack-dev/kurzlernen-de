import * as THREE from "three";

const CHECK_MS=110;
let installed=false,raf=0,lastCheck=-Infinity;
const raycaster=new THREE.Raycaster(),cameraPos=new THREE.Vector3(),targetPos=new THREE.Vector3(),direction=new THREE.Vector3(),hits=[];

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return globalThis.document?.getElementById?.("viewport")||null;}
function resetMarkers(){for(const marker of globalThis.document?.querySelectorAll?.(".vs-player-marker")||[]){marker.style.visibility="";delete marker.dataset.worldOccluded;}}
function peerRoot(scene,id){let result=null;scene?.traverse?.(node=>{if(result||String(node?.userData?.vsPlayerId||"")!==id)return;if(node.userData?.vsMultiplayerPeer||node.userData?.vsLegacyPrimary)result=node;});return result;}

function check(now){
  if(now-lastCheck<CHECK_MS)return;lastCheck=now;const b=bridge(),scene=b?.threeScene,camera=b?.threeCamera,view=viewport();if(!b?.active||!scene||!camera||!view){resetMarkers();return;}
  const occluder=scene.getObjectByName?.("WORLD_BUILDING_DEPTH_OCCLUDER");if(!occluder?.visible){resetMarkers();return;}camera.getWorldPosition(cameraPos);let hidden=0,visible=0;
  for(const marker of view.querySelectorAll?.(".vs-player-marker")||[]){const id=String(marker.dataset.peerId||""),root=peerRoot(scene,id);if(!root){marker.style.visibility="";delete marker.dataset.worldOccluded;continue;}root.getWorldPosition(targetPos);direction.copy(targetPos).sub(cameraPos);const distance=direction.length();if(distance<.4){marker.style.visibility="";delete marker.dataset.worldOccluded;continue;}direction.multiplyScalar(1/distance);raycaster.set(cameraPos,direction);raycaster.near=.05;raycaster.far=Math.max(.05,distance-.28);hits.length=0;raycaster.intersectObject(occluder,false,hits);const blocked=hits.length>0;marker.style.visibility=blocked?"hidden":"";marker.dataset.worldOccluded=blocked?"1":"0";if(blocked)hidden++;else visible++;}
  view.dataset.worldOccludedEnemyMarkers=String(hidden);view.dataset.worldVisibleEnemyMarkers=String(visible);
}
function frame(now=performance.now()){raf=requestAnimationFrame(frame);check(now);}
export function installWorldHudOcclusion(){if(installed)return;installed=true;raf=requestAnimationFrame(frame);}
export function worldHudOcclusionState(){return{installed,raf,lastCheck};}
