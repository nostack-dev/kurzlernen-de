// Explicit always-on / off mic toggle: R3 tap (on RELEASE), R3+Y receiver mute.
// No overlap with L3 sprint, LB grenade, Y weapon, VIEW/map, V foot/drone.
export const VOICE_KEY_PTT="KeyH";
export const VOICE_KEY_MUTE="KeyK";
export const VOICE_PAD_PTT=11;
export const VOICE_PAD_MUTE=3;
export function nextVoicePadInput(previous={r3:false,y:false,latched:false},{r3=false,y=false,allowed=false}={}){
  r3=Boolean(r3);y=Boolean(y);allowed=Boolean(allowed);
  const mute=allowed&&r3&&y&&!previous.y;
  const latched=r3&&Boolean(previous.latched||mute);
  const micToggle=allowed&&!r3&&Boolean(previous.r3)&&!previous.latched;
  return{r3,y,latched,micToggle,mute,suppressWeapon:mute};
}
