import * as THREE from "three";

const DEFAULT_KINDS=new Set(["person","life-person"]);
const PERSON_SOFT_RADIUS_M=.68;
const PERSON_CENTER_Z=.88;

const worldPosition=new THREE.Vector3();
const closestPoint=new THREE.Vector3();
const delta=new THREE.Vector3();
const rayDirection=new THREE.Vector3();

function visibleInHierarchy(node){for(let n=node;n;n=n.parent)if(n.visible===false)return false;return true;}
function populationId(node){return String(node?.userData?.worldPopulationId||node?.userData?.worldLifeId||"");}
function populationKind(node){return String(node?.userData?.worldPopulationKind||node?.userData?.worldLifeKind||"");}
function populationRoot(node,id){let root=node;while(root?.parent&&populationId(root.parent)===id)root=root.parent;return root;}
function meshFor(root){let out=null;root?.traverse?.(node=>{if(!out&&node?.isMesh)out=node;});return out||root;}

export function findRayPopulationHit(scene,ray,{maxDistance=180,kinds=DEFAULT_KINDS,radiusM=PERSON_SOFT_RADIUS_M}={}){
  if(!scene||!ray?.origin||!ray?.direction)return null;
  const directionLength=ray.direction.length?.()||0;if(directionLength<1e-9)return null;rayDirection.copy(ray.direction).multiplyScalar(1/directionLength);
  const allowed=kinds instanceof Set?kinds:new Set(kinds||DEFAULT_KINDS),seen=new Set(),radius=Math.max(.05,Number(radiusM)||PERSON_SOFT_RADIUS_M),radiusSq=radius*radius,limit=Math.max(.01,Number(maxDistance)||180);
  let best=null;
  scene.traverse?.(node=>{
    if(best?.distance<=.01)return;
    const id=populationId(node);if(!id||seen.has(id))return;
    const root=populationRoot(node,id),kind=populationKind(root)||populationKind(node);
    if(!allowed.has(kind)||!visibleInHierarchy(root)){seen.add(id);return;}
    seen.add(id);root.updateWorldMatrix?.(true,false);root.getWorldPosition?.(worldPosition);worldPosition.z+=kind==="person"||kind==="life-person"?PERSON_CENTER_Z:.55;
    delta.copy(worldPosition).sub(ray.origin);const centerDistance=delta.dot(rayDirection);
    if(centerDistance+radius<.01||centerDistance-radius>limit)return;
    closestPoint.copy(ray.origin).addScaledVector(rayDirection,Math.max(0,centerDistance));const perpendicularSq=closestPoint.distanceToSquared(worldPosition);
    if(perpendicularSq>radiusSq)return;
    // Return the first physical entry into the soft body volume, not the center
    // projection. Using the center made a downward ground ray appear closer than
    // a pedestrian even when the bullet entered the pedestrian first.
    const halfChord=Math.sqrt(Math.max(0,radiusSq-perpendicularSq)),entry=centerDistance-halfChord,exit=centerDistance+halfChord,distance=entry>=.01?entry:exit>=.01?.01:-1;
    if(distance<.01||distance>limit)return;
    const point=ray.origin.clone().addScaledVector(rayDirection,distance);
    if(!best||distance<best.distance)best={distance,point,object:meshFor(root),populationSoftHit:true,populationVolumeEntry:true};
  });
  return best;
}
