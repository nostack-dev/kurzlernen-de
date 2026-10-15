// Tunable, testable GUIDED combat contract. No browser dependencies.
// Oct 15: fires on every press (5 s cooldown, shown on the button) but hits softer (34 in 4 m).
export const GUIDED_BALANCE=Object.freeze({speedMps:34,turnG:2.2,blastRadiusM:4,damage:34,cooldownMs:5000,dodgeSpeedMps:5.8,dodgeHoldSec:.35});
export function updatePedestrianDodge(state,{previous,current,dt,pedestrian}={}){
  const elapsed=Number(dt),distance=previous&&current?Math.hypot(current.x-previous.x,current.y-previous.y):0;
  const valid=pedestrian&&Number.isFinite(elapsed)&&elapsed>0&&elapsed<=.1&&Number.isFinite(distance);
  const sprint=valid&&distance/elapsed>=GUIDED_BALANCE.dodgeSpeedMps;
  const seconds=sprint?(Number(state?.seconds)||0)+elapsed:0;
  return {seconds,lost:Boolean(state?.lost)||seconds>=GUIDED_BALANCE.dodgeHoldSec};
}
