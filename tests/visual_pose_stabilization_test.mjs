import assert from "node:assert/strict";
import {StabilizedExternalAirframeVisual,EXTERNAL_AIRFRAME_VISUAL_PROFILES} from "../sim/visual_pose_stabilization.mjs";
const range=v=>Math.max(...v)-Math.min(...v),yawQuat=y=>[0,0,Math.sin(y/2),Math.cos(y/2)],quatYaw=q=>Math.atan2(2*q[3]*q[2],1-2*q[2]*q[2]);
for(const mode of ["follow","third"]){
  const filter=new StabilizedExternalAirframeVisual(),raw=[],filtered=[],dt=1/120,anchor=[0,0,2];
  for(let i=0;i<1200;i++){const t=i*dt,jitter=.018*Math.sin(2*Math.PI*14*t),p=[jitter,0,2],state=filter.update({position:p,quaternion:[0,0,0,1],cameraAnchor:anchor,mode,dt});if(i>180){raw.push(jitter);filtered.push(state.position[0]);}}
  const ratio=range(filtered)/range(raw);assert.ok(ratio<.48,`${mode} passed too much 14 Hz external-view position twitch: ${ratio}`);
}
for(const mode of ["follow","third"]){
  const profile=EXTERNAL_AIRFRAME_VISUAL_PROFILES[mode],filter=new StabilizedExternalAirframeVisual(),dt=1/120;let maxError=0;
  for(let i=0;i<900;i++){const t=i*dt,x=t<1?.5*7*t*t:3.5+7*(t-1),anchor=[x-.16*(1-Math.exp(-2*t)),0,2],state=filter.update({position:[x,0,2],quaternion:[0,0,0,1],cameraAnchor:anchor,mode,dt});maxError=Math.max(maxError,state.positionErrorM);}
  assert.ok(maxError<=profile.maxPositionErrorM+1e-6,`${mode} visible airframe diverged from authoritative pose: ${maxError}`);
}
for(const mode of ["follow","third"]){
  const filter=new StabilizedExternalAirframeVisual(),raw=[],filtered=[],dt=1/120,anchor=[0,0,2];
  for(let i=0;i<1200;i++){const t=i*dt,yaw=.035*Math.sin(2*Math.PI*12*t),state=filter.update({position:[0,0,2],quaternion:yawQuat(yaw),cameraAnchor:anchor,mode,dt});if(i>180){raw.push(yaw);filtered.push(quatYaw(state.quaternion));}}
  assert.ok(range(filtered)/range(raw)<.55,`${mode} passed too much 12 Hz attitude twitch`);
}
console.log("External airframe presentation passed: high-frequency relative twitch attenuated, physical/root pose untouched, bounded visual error.");
