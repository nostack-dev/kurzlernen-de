const POSITION_RATE_HZ=55;
const ORIENTATION_RATE_HZ=45;
const TELEPORT_DISTANCE_M=.35;
const TARGET_TELEPORT_DISTANCE_M=2.5;

function targetVector(THREE,args){
  if(args.length===1&&args[0]?.isVector3)return args[0].clone();
  return new THREE.Vector3(Number(args[0])||0,Number(args[1])||0,Number(args[2])||0);
}

export function installFpvOpticalCameraStabilizer({THREE,camera,viewport}={}){
  if(!THREE||!camera||!viewport)throw Error("FPV optical stabilizer requires THREE, camera and viewport");
  if(camera.userData?.arondightFpvOpticalStabilizer)return camera.userData.arondightFpvOpticalStabilizer;

  const originalLookAt=camera.lookAt.bind(camera),smoothedPosition=new THREE.Vector3(),smoothedTarget=new THREE.Vector3(),smoothedUp=new THREE.Vector3(),rawPosition=new THREE.Vector3(),rawUp=new THREE.Vector3(),rawTarget=new THREE.Vector3();
  let initialized=false,lastMs=performance.now();

  const reset=()=>{initialized=false;lastMs=performance.now();viewport.dataset.fpvOpticalStabilized="0";viewport.dataset.fpvOpticalLagM="0.0000";};
  camera.lookAt=function(...args){
    const fpv=viewport.dataset.cameraMode==="fpv";
    if(!fpv){reset();return originalLookAt(...args);}

    const now=performance.now(),dt=Math.max(0,Math.min(.1,(now-lastMs)/1000));lastMs=now;
    rawPosition.copy(camera.position);rawUp.copy(camera.up);rawTarget.copy(targetVector(THREE,args));
    const teleport=!initialized||smoothedPosition.distanceToSquared(rawPosition)>TELEPORT_DISTANCE_M*TELEPORT_DISTANCE_M||smoothedTarget.distanceToSquared(rawTarget)>TARGET_TELEPORT_DISTANCE_M*TARGET_TELEPORT_DISTANCE_M;
    if(teleport){smoothedPosition.copy(rawPosition);smoothedTarget.copy(rawTarget);smoothedUp.copy(rawUp).normalize();initialized=true;}
    else{
      const positionAlpha=1-Math.exp(-POSITION_RATE_HZ*dt),orientationAlpha=1-Math.exp(-ORIENTATION_RATE_HZ*dt);
      smoothedPosition.lerp(rawPosition,positionAlpha);smoothedTarget.lerp(rawTarget,orientationAlpha);smoothedUp.lerp(rawUp,orientationAlpha).normalize();
    }
    camera.position.copy(smoothedPosition);camera.up.copy(smoothedUp);
    viewport.dataset.fpvOpticalStabilized="1";viewport.dataset.fpvOpticalLagM=smoothedPosition.distanceTo(rawPosition).toFixed(4);
    viewport.dataset.fpvOpticalRateHz=`${POSITION_RATE_HZ}/${ORIENTATION_RATE_HZ}`;
    return originalLookAt(smoothedTarget);
  };

  const api={reset,dispose(){camera.lookAt=originalLookAt;delete camera.userData.arondightFpvOpticalStabilizer;delete viewport.dataset.fpvOpticalStabilized;delete viewport.dataset.fpvOpticalLagM;delete viewport.dataset.fpvOpticalRateHz;}};
  camera.userData.arondightFpvOpticalStabilizer=api;
  return api;
}
