import {wantedLineBlockedByPrisms,wantedPointInRing} from "./wanted_system_logic.mjs";

const pedSafe=new WeakMap();
let installed=false,lastPedScan=-Infinity,pedestrians=[],recoveryRunning=false,lastFrame=performance.now();

const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
const walk=()=>globalThis.__arondightWalkMode||null;
const drive=()=>globalThis.__arondightVehicleDrive||null;
const rigid=()=>globalThis.__arondightWorldRigidBodies||null;
const wanted=()=>globalThis.__arondightWantedSystem||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));

function isDroneMode(){return walk()?.mode!=="foot"&&!drive()?.active;}
function collisionPrisms(){const snapshot=bridge()?.buildingCollisionSnapshot;return Array.isArray(snapshot)?snapshot:Array.isArray(snapshot?.prisms)?snapshot.prisms:[];}
function prismPoints(prism){return Array.isArray(prism?.points)?prism.points:Array.isArray(prism?.ring)?prism.ring:[];}
function prismBase(prism){return Number(prism?.base??prism?.baseM??0)||0;}
function prismTop(prism){return Number(prism?.top??prism?.topM??0)||0;}

function directRecover(){
  if(recoveryRunning)return;recoveryRunning=true;
  const reset=document.getElementById("soloReset"),view=viewport();
  if(view){view.dataset.droneRecovery="soft-airframe-recover-preserve-world-v5";view.dataset.droneRecoveryResult="recovering";}
  try{if(typeof reset?.onclick==="function")reset.onclick.call(reset);else reset?.dispatchEvent(new Event("click"));}catch{}
  const deadline=performance.now()+6000;
  const finish=()=>{
    const arm=document.getElementById("soloArm"),state=String(document.getElementById("soloState")?.textContent||"").toUpperCase();
    if(arm&&!arm.disabled&&!state.includes("CALIBRAT")){recoveryRunning=false;arm.click();if(view)view.dataset.droneRecoveryResult="recovered+arm-requested+world-preserved";return;}
    if(performance.now()>deadline){recoveryRunning=false;if(view)view.dataset.droneRecoveryResult="recover-timeout";return;}
    setTimeout(finish,120);
  };
  setTimeout(finish,180);
}
function interceptRecover(event){
  if(event.type!=="pointerdown"||!isDroneMode())return;
  const button=event.target instanceof Element?event.target.closest("#soloArm"):null;
  if(!button||!button.classList.contains("drone-recover-ready")||button.textContent?.includes("ARMING"))return;
  event.preventDefault();event.stopImmediatePropagation();directRecover();
}

function playerTarget(out){
  const d=drive(),w=walk(),physics=rigid();
  if(d?.active&&d.vehicleId){const pose=physics?.pose?.(d.vehicleId);if(pose?.position){out.set(Number(pose.position[0])||0,Number(pose.position[1])||0,Number(pose.position[2])||1);return out;}}
  if(w?.mode==="foot"&&w.position){out.set(Number(w.position.x)||0,Number(w.position.y)||0,Number(w.position.z)||1.68);return out;}
  const b=bridge(),scene=b?.threeScene;let airframe=null;try{airframe=b?.airframeFor?.(scene)||null;}catch{}
  if(!airframe)scene?.traverse?.(node=>{if(!airframe&&node?.userData?.arondightAirframe)airframe=node;});
  if(airframe?.getWorldPosition){airframe.getWorldPosition(out);return out;}
  const camera=b?.threeCamera;if(camera?.getWorldPosition){camera.getWorldPosition(out);return out;}
  return null;
}
const chaseTarget={x:0,y:0,z:0};
function restorePoliceChase(now){
  const system=wanted(),state=system?.state,drones=system?.drones,physics=rigid();
  if(!state||!Array.isArray(drones)||!physics?.setTarget||Number(state.stars)<=0)return 0;
  const current=playerTarget(chaseTarget);let active=0;
  for(const drone of drones){
    if(!drone||drone.retreating||drone.empDisabled||Number(drone.hp)<=0||drone.dispatchPosition||now<Number(drone.dispatchRevealAt||0)||drone.root?.visible===false)continue;
    const pursuit=state.phase==="pursuit"||drone.seesPlayer===true;
    let base=current;
    if(!pursuit){const last=drone.lastKnownPosition||drone.targetPosition;if(last&&Number.isFinite(Number(last.x)))base=last;else continue;}
    if(!base)continue;
    const i=Math.max(0,Number(drone.index)||0),angle=now*.00032+i*2.17,radius=pursuit?7.5+(i%3)*1.8:4.5+(i%2)*1.4;
    const bx=Number(base.x)||0,by=Number(base.y)||0,bz=Number(base.z)||0,x=bx+Math.cos(angle)*radius,y=by+Math.sin(angle)*radius,z=Math.max(2.2,bz+3.0+(i%3)*.65),yaw=Math.atan2(by-y,bx-x);
    physics.setTarget(`police-drone-${i}`,{position:[x,y,z],yaw,speedMps:pursuit?9.2+Math.min(3,Number(state.stars)||1)*.65:6.2,response:pursuit?3.6:2.7,maxAccelerationMps2:pursuit?8.2:5.4});
    active++;
  }
  const view=viewport();if(view){view.dataset.wantedPoliceChaseAuthority="pursuit-reacquire+search-last-known-v5";view.dataset.wantedPoliceChasing=String(active);}
  return active;
}

function scanPedestrians(now){
  if(now-lastPedScan<650)return;lastPedScan=now;pedestrians=[];
  bridge()?.threeScene?.traverse?.(node=>{
    const kind=String(node?.userData?.worldPopulationKind||node?.userData?.worldLifeKind||"").replace(/^life-/,"");if(kind!=="person")return;
    const id=String(node.userData?.worldPopulationId||node.userData?.worldLifeId||"");if(!id||pedestrians.some(p=>p.id===id))return;
    let root=node;while(root.parent&&String(root.parent.userData?.worldPopulationId||root.parent.userData?.worldLifeId||"")===id)root=root.parent;pedestrians.push({id,root});
  });
}
function pedestrianBlocked(from,to,prisms){
  if(!from||!to)return false;
  if(wantedLineBlockedByPrisms({x:from.x,y:from.y,z:.9},{x:to.x,y:to.y,z:.9},prisms))return true;
  for(const prism of prisms){const points=prismPoints(prism);if(points.length<3||prismTop(prism)<.1||prismBase(prism)>1.8)continue;if(wantedPointInRing(to.x,to.y,points))return true;}
  return false;
}
function guardPedestrianPaths(now){
  scanPedestrians(now);const prisms=collisionPrisms();if(!prisms.length)return;
  let stopped=0;
  for(const item of pedestrians){const root=item.root;if(!root?.parent||root.visible===false)continue;let safe=pedSafe.get(root);if(!safe){safe=root.position.clone();pedSafe.set(root,safe);continue;}
    if(pedestrianBlocked(safe,root.position,prisms)){root.position.copy(safe);root.rotation.z+=Math.PI*.58;stopped++;}else safe.copy(root.position);
  }
  const view=viewport();if(view){view.dataset.pedestrianBuildingPathGuard="segment+inside-prism-v5";view.dataset.pedestrianBuildingStops=String(stopped);}
}

function afterFrame(now){restorePoliceChase(now);guardPedestrianPaths(now);}
function frame(now=performance.now()){
  const dt=clamp((now-lastFrame)/1000,.001,.05);lastFrame=now;void dt;
  setTimeout(()=>afterFrame(performance.now()),0);
  const view=viewport();if(view)view.dataset.gameplayReliabilityAuthority="recover-preserve+police-chase+ped-path-v5";
  requestAnimationFrame(frame);
}
export function installGameplayReliabilityAuthorityV5(){if(installed)return;installed=true;window.addEventListener("pointerdown",interceptRecover,{capture:true,passive:false});requestAnimationFrame(frame);}
installGameplayReliabilityAuthorityV5();
