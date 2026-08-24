import * as THREE from "three";

let installed=false,wrapped=false,baseProvider=null;
const anchor=new THREE.Vector3();
function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function resolveAnchor(){const drive=globalThis.__arondightVehicleDrive;if(drive?.active&&drive.cameraAnchor){const a=drive.cameraAnchor;return anchor.set(Number(a.x)||0,Number(a.y)||0,Math.max(.45,Number(a.z)||0));}const walk=globalThis.__arondightWalkMode,p=walk?.position;if(walk?.mode==="foot"&&p)return anchor.set(Number(p.x)||0,Number(p.y)||0,Math.max(.34,(Number(p.z)||1.68)-.38));return null;}
function constrain(args,result){const b=bridge(),camera=args?.camera,a=resolveAnchor();if(!camera?.position||!a)return result;let collided=false;if(typeof b?.constrainCameraToPhysics==="function")collided=Boolean(b.constrainCameraToPhysics(a,camera));const floor=.12;if(camera.position.z<floor){camera.position.z=floor;collided=true;}camera.near=Math.max(.045,Math.min(.08,Number(camera.near)||.06));camera.updateProjectionMatrix?.();camera.updateMatrixWorld?.(true);const view=viewport();if(view){view.dataset.playerCameraCollisionGuard="box3d-ray+floor-clamp-v2";view.dataset.playerCameraCollision=collided?"blocked":"clear";view.dataset.playerCameraFloorM=floor.toFixed(2);}return result;}
function tryWrap(){if(wrapped)return true;const b=bridge(),current=b?.presentationCameraProvider;if(!b||typeof b.attachPresentationCameraProvider!=="function"||!current||current.__collisionGuard)return false;baseProvider=current;const provider={__collisionGuard:true,isActive:()=>Boolean(baseProvider?.isActive?.()),apply:args=>constrain(args,baseProvider?.apply?.(args))};b.attachPresentationCameraProvider(provider);wrapped=true;return true;}
function frame(){tryWrap();requestAnimationFrame(frame);}
export function installCameraCollisionGuard(){if(installed)return;installed=true;const view=viewport();if(view)view.dataset.playerCameraCollisionGuard="waiting-provider";requestAnimationFrame(frame);}
installCameraCollisionGuard();
