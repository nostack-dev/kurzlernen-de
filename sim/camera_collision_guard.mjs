import * as THREE from "three";
import {groundHeightAt} from "./terrain_craters.mjs";

let installed=false,wrapped=false,baseProvider=null,guardProvider=null,lastTelemetry=-Infinity,maintenanceTimer=0;
const anchor=new THREE.Vector3();
function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function resolveAnchor(){const drive=globalThis.__arondightVehicleDrive;if(drive?.active&&drive.cameraAnchor){const a=drive.cameraAnchor,x=Number(a.x)||0,y=Number(a.y)||0,g=groundHeightAt(x,y);return anchor.set(x,y,Math.max(g+.45,Number(a.z)||g+.45));}const walk=globalThis.__arondightWalkMode,p=walk?.position;if(walk?.mode==="foot"&&p){const x=Number(p.x)||0,y=Number(p.y)||0,g=groundHeightAt(x,y);return anchor.set(x,y,Math.max(g+.34,(Number(p.z)||g+1.68)-.38));}return null;}
function constrain(args,result){if(globalThis.__jetMode?.active)return result;// the jet / chute camera is free in the sky
  const b=bridge(),camera=args?.camera,a=resolveAnchor();if(!camera?.position||!a)return result;let collided=false;if(typeof b?.constrainCameraToPhysics==="function")collided=Boolean(b.constrainCameraToPhysics(a,camera));const floor=groundHeightAt(camera.position.x,camera.position.y)+.12;if(camera.position.z<floor){camera.position.z=floor;collided=true;}camera.near=Math.max(.045,Math.min(.08,Number(camera.near)||.06));camera.updateProjectionMatrix?.();camera.updateMatrixWorld?.(true);const now=performance.now();if(now-lastTelemetry>=250){lastTelemetry=now;const view=viewport();if(view){view.dataset.playerCameraCollisionGuard="box3d-ray+terrain-relative-floor-v4";view.dataset.playerCameraCollision=collided?"blocked":"clear";view.dataset.playerCameraFloorM=floor.toFixed(2);view.dataset.playerCameraCollisionTelemetry="250ms";}}return result;}
function tryWrap(){const b=bridge(),current=b?.presentationCameraProvider;if(!b||typeof b.attachPresentationCameraProvider!=="function"||!current)return false;if(current===guardProvider||current.__collisionGuard){guardProvider=current;wrapped=true;return true;}baseProvider=current;const inner=current;// each guard keeps its own inner provider: re-wrapping a provider that wrapped an older guard must not form a loop
  guardProvider={__collisionGuard:true,isActive:()=>Boolean(inner?.isActive?.()),apply:args=>constrain(args,inner?.apply?.(args))};b.attachPresentationCameraProvider(guardProvider);wrapped=true;return true;}
function maintenance(){tryWrap();clearTimeout(maintenanceTimer);maintenanceTimer=setTimeout(maintenance,500);}
export function installCameraCollisionGuard(){if(installed)return;installed=true;const view=viewport();if(view){view.dataset.playerCameraCollisionGuard="waiting-provider";view.dataset.playerCameraCollisionMaintenance="500ms-no-raf";}tryWrap();maintenanceTimer=setTimeout(maintenance,500);}
installCameraCollisionGuard();
