let patched=null,tries=0;

function viewport(){return document.getElementById("viewport");}
function patch(){
  const walk=globalThis.__arondightWalkMode;
  if(!walk||typeof walk.setPose!=="function"){if(++tries<600)requestAnimationFrame(patch);return;}
  if(walk===patched||walk.__walkAimStateSyncV1)return;patched=walk;
  const base=walk.setPose.bind(walk);
  walk.setPose=pose=>{
    const result=base(pose);
    const v=viewport(),yaw=Number(pose?.yaw),pitch=Number(pose?.pitch);
    if(v){if(Number.isFinite(yaw))v.dataset.walkYaw=yaw.toFixed(4);if(Number.isFinite(pitch))v.dataset.walkPitch=pitch.toFixed(4);v.dataset.walkAimStateSync="setpose-immediate-v1";}
    return result;
  };
  walk.__walkAimStateSyncV1=true;
  const v=viewport();if(v)v.dataset.walkAimStateSync="setpose-immediate-v1";
}

patch();
