const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const wrap=value=>{let a=(Number(value)||0)%(Math.PI*2);if(a>Math.PI)a-=Math.PI*2;if(a<-Math.PI)a+=Math.PI*2;return a;};
let installed=false,lastApi=null,baseSetTarget=null,fixes=0,uturnCorrections=0,lastPoseFix=new Map(),cachedVehicles=[],lastVehicleScanAt=-Infinity;

function viewport(){return document.getElementById("viewport");}
function ready(){return Boolean(document.getElementById("status")?.textContent?.includes("SIM ready"));}
function bridge(){return globalThis.__arondightRealWorld||null;}
function rigid(){return globalThis.__arondightWorldRigidBodies||null;}
function vehicleId(id){return /^(?:car|bus)-/.test(String(id||""));}
function publish(){const v=viewport();if(!v)return;v.dataset.worldTrafficMotion="forward-collinear-v3";v.dataset.worldTrafficLaneContinuity="no-cross-lane-u-turn-v3";v.dataset.worldTrafficUturnCorrections=String(uturnCorrections);v.dataset.worldTrafficHeadingFixes=String(fixes);v.dataset.worldTrafficMotionCadenceMs="100";v.dataset.worldTrafficBootGuard="after-sim-ready-v1";}
function patchTargets(){
  const api=rigid();if(!api||typeof api.setTarget!=="function"||typeof api.pose!=="function")return false;if(api===lastApi&&api.setTarget?.__trafficLaneGuardV1)return true;
  baseSetTarget=api.setTarget.bind(api);
  const wrapped=function(id,target={}){
    if(vehicleId(id)&&Array.isArray(target?.position)&&Number.isFinite(target?.yaw)){
      const pose=api.pose(id);if(pose?.position&&Number.isFinite(pose.yaw)){
        const yawDiff=Math.abs(wrap(Number(target.yaw)-Number(pose.yaw)));
        if(yawDiff>2.20){
          const px=Number(pose.position[0])||0,py=Number(pose.position[1])||0,tx=Number(target.position[0])||0,ty=Number(target.position[1])||0;
          const currentYaw=Number(pose.yaw)||0,fx=Math.cos(currentYaw),fy=Math.sin(currentYaw),dx=tx-px,dy=ty-py;
          const longitudinal=dx*fx+dy*fy,lateral=-dx*fy+dy*fx;
          if(Math.abs(lateral)>.35){
            const keptLateral=clamp(lateral,-.18,.18),position=[px+fx*longitudinal-fy*keptLateral,py+fy*longitudinal+fx*keptLateral,Number(target.position[2])||0];
            target={...target,position};uturnCorrections++;publish();
          }
        }
      }
    }
    return baseSetTarget(id,target);
  };
  Object.defineProperty(wrapped,"__trafficLaneGuardV1",{value:true});api.setTarget=wrapped;lastApi=api;publish();return true;
}
function vehicleGroups(now){if(now-lastVehicleScanAt<600)return cachedVehicles;lastVehicleScanAt=now;const scene=bridge()?.threeScene,out=[];scene?.traverse?.(node=>{if(!node?.isGroup||node.visible===false||node.userData?.playerDriven)return;const kind=String(node.userData?.worldPopulationKind||""),id=String(node.userData?.worldPopulationId||node.userData?.worldProceduralId||"");if((kind==="car"||kind==="bus")&&vehicleId(id))out.push({node,id});});cachedVehicles=out;return out;}
function alignBodies(now){
  const api=rigid();if(!api?.pose||!api?.setPose)return;
  for(const{node,id}of vehicleGroups(now)){
    const pose=api.pose(id);if(!pose?.position||!Array.isArray(pose.velocity))continue;
    const vx=Number(pose.velocity[0])||0,vy=Number(pose.velocity[1])||0,speed=Math.hypot(vx,vy);if(speed<.8)continue;
    const yaw=Number(pose.yaw)||0,fx=Math.cos(yaw),fy=Math.sin(yaw),signedForward=vx*fx+vy*fy;
    const heading=signedForward>=0?yaw:wrap(yaw+Math.PI),slip=Math.abs(wrap(Math.atan2(vy,vx)-heading)),angularZ=Math.abs(Number(pose.angularVelocity?.[2])||0);
    if(slip<.08||angularZ>1.8)continue;
    const last=lastPoseFix.get(id)||-Infinity;if(now-last<220)continue;lastPoseFix.set(id,now);
    const forwardSpeed=Math.max(.2,speed),newVx=Math.cos(heading)*forwardSpeed,newVy=Math.sin(heading)*forwardSpeed;
    api.setPose(id,{position:[...pose.position],yaw:heading,velocity:[newVx,newVy,Number(pose.velocity[2])||0],angularVelocity:[0,0,Number(pose.angularVelocity?.[2])||0]});node.rotation.set(0,0,heading);fixes++;
  }
  publish();
}
function tick(){
  if(!ready()){setTimeout(tick,200);return;}
  patchTargets();alignBodies(performance.now());setTimeout(tick,100);
}
export function installWorldTrafficMotionGuardV1(){if(installed)return;installed=true;setTimeout(tick,0);}
installWorldTrafficMotionGuardV1();
