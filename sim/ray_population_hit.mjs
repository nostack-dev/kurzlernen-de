import * as THREE from "three";

const DEFAULT_KINDS=new Set(["person","life-person"]);
const PERSON_SOFT_RADIUS_M=.68;
const PERSON_CENTER_Z=.88;

const worldPosition=new THREE.Vector3();
const closestPoint=new THREE.Vector3();
const delta=new THREE.Vector3();

function visibleInHierarchy(node){for(let n=node;n;n=n.parent)if(n.visible===false)return false;return true;}
function populationId(node){return String(node?.userData?.worldPopulationId||node?.userData?.worldLifeId||"");}
function populationKind(node){return String(node?.userData?.worldPopulationKind||node?.userData?.worldLifeKind||"");}
function populationRoot(node,id){let root=node;while(root?.parent&&populationId(root.parent)===id)root=root.parent;return root;}
function meshFor(root){let out=null;root?.traverse?.(node=>{if(!out&&node?.isMesh)out=node;});return out||root;}

export function findRayPopulationHit(scene,ray,{maxDistance=180,kinds=DEFAULT_KINDS,radiusM=PERSON_SOFT_RADIUS_M}={}){
  if(!scene||!ray?.origin||!ray?.direction)return null;
  const allowed=kinds instanceof Set?kinds:new Set(kinds||DEFAULT_KINDS),seen=new Set();
  let best=null;
  scene.traverse?.(node=>{
    if(best?.distance<=.01)return;
    const id=populationId(node);if(!id||seen.has(id))return;
    const root=populationRoot(node,id),kind=populationKind(root)||populationKind(node);
    if(!allowed.has(kind)||!visibleInHierarchy(root)){seen.add(id);return;}
    seen.add(id);root.updateWorldMatrix?.(true,false);root.getWorldPosition?.(worldPosition);worldPosition.z+=kind==="person"||kind==="life-person"?PERSON_CENTER_Z:.55;
    delta.copy(worldPosition).sub(ray.origin);const distance=delta.dot(ray.direction);
    if(distance<.01||distance>maxDistance)return;
    closestPoint.copy(ray.origin).addScaledVector(ray.direction,distance);
    if(closestPoint.distanceToSquared(worldPosition)>radiusM*radiusM)return;
    if(!best||distance<best.distance)best={distance,point:closestPoint.clone(),object:meshFor(root),populationSoftHit:true};
  });
  return best;
}
