export const PLAYER_MAX_HP=100;
export const DRONE_MAX_HP=100;
export const DRONE_REPLACEMENT_COOLDOWN_MS=8000;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

export function healthAfterDamage(hp,damage,maxHp=PLAYER_MAX_HP){
  const maximum=Math.max(1,Number(maxHp)||PLAYER_MAX_HP);
  return Math.max(0,Math.min(maximum,Number(hp)||0)-Math.max(0,Number(damage)||0));
}

export function droneReplacementRemainingMs({destroyed=false,readyAt=-Infinity,now=0}={}){
  return destroyed?Math.max(0,(Number(readyAt)||0)-(Number(now)||0)):0;
}

export function radialStickAxes(dx,dy,radius){
  const x=Number(dx)||0,y=Number(dy)||0,r=Math.max(1,Number(radius)||1),length=Math.hypot(x,y);
  if(length<=1e-9)return{x:0,y:0,magnitude:0};
  const magnitude=Math.min(1,length/r),inverse=1/length;
  return{x:clamp(x*inverse*magnitude,-1,1),y:clamp(y*inverse*magnitude,-1,1),magnitude};
}

export function firstPersonDeathFall(elapsedMs,{durationMs=900,standingEyeM=1.68,floorEyeM=.24,side=1}={}){
  const t=clamp((Number(elapsedMs)||0)/Math.max(1,Number(durationMs)||900),0,1),settled=1-Math.pow(1-t,3),lean=clamp(Number(side)||1,-1,1)||1;
  return Object.freeze({progress:t,settled,eyeHeightM:standingEyeM+(floorEyeM-standingEyeM)*settled,rollRad:lean*1.48*settled,pitchOffsetRad:-.16*settled});
}
