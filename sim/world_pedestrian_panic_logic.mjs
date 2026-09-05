export const PEDESTRIAN_PANIC_GUNSHOT_RADIUS_M=36;
export const PEDESTRIAN_PANIC_EXPLOSION_RADIUS_M=52;
export const PEDESTRIAN_PANIC_MIN_MS=4800;
export const PEDESTRIAN_PANIC_MAX_MS=7600;
export const PEDESTRIAN_PANIC_RECOVER_MS=1600;
export const PEDESTRIAN_PANIC_MIN_SPEED_MPS=3.4;
export const PEDESTRIAN_PANIC_MAX_SPEED_MPS=5.2;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

export function pedestrianPanicRadius(kind){return String(kind||"")==="explosion"?PEDESTRIAN_PANIC_EXPLOSION_RADIUS_M:PEDESTRIAN_PANIC_GUNSHOT_RADIUS_M;}
export function pedestrianShouldPanic({kind="gunshot",distanceM=Infinity}={}){const distance=Number(distanceM);return Number.isFinite(distance)&&distance>=0&&distance<=pedestrianPanicRadius(kind);}
export function pedestrianFleeHeading({personX=0,personY=0,dangerX=0,dangerY=0,jitterRad=0}={}){const dx=Number(personX)-Number(dangerX),dy=Number(personY)-Number(dangerY),base=Math.hypot(dx,dy)>.001?Math.atan2(dy,dx):0;return base+clamp(jitterRad,-.45,.45);}
export function pedestrianPanicDurationMs(unit=.5){return PEDESTRIAN_PANIC_MIN_MS+(PEDESTRIAN_PANIC_MAX_MS-PEDESTRIAN_PANIC_MIN_MS)*clamp(unit,0,1);}
export function pedestrianPanicSpeedMps(unit=.5){return PEDESTRIAN_PANIC_MIN_SPEED_MPS+(PEDESTRIAN_PANIC_MAX_SPEED_MPS-PEDESTRIAN_PANIC_MIN_SPEED_MPS)*clamp(unit,0,1);}
export function pedestrianRecoveryWeight(elapsedMs){const t=clamp(Number(elapsedMs)/PEDESTRIAN_PANIC_RECOVER_MS,0,1),smooth=t*t*(3-2*t);return 1-smooth;}
