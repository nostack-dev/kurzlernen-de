// Unambiguous keyboard + standard Xbox mappings. No collision with:
// V = foot/drone, L3 = sprint, LB = grenade, VIEW = map/camera, Y = weapon.
export const VOICE_KEY_PTT="KeyH";
export const VOICE_KEY_MUTE="KeyK";
export const VOICE_PAD_PTT=11;    // R3 / right stick click, hold
export const VOICE_PAD_MUTE=3;    // Y while R3 is held; suppress weapon swap

// Called once per frame by the game's sole pad-actions owner.
// Latch until R3 release so a mute chord never reopens the microphone.
export function nextVoicePadInput(previous={y:false,latched:false},{r3=false,y=false,allowed=false}={}){
  r3=Boolean(r3);y=Boolean(y);allowed=Boolean(allowed);
  const mute=allowed&&r3&&y&&!previous.y;
  const latched=allowed&&r3&&Boolean(previous.latched||mute);
  return {y,latched,talk:allowed&&r3&&!latched,mute,suppressWeapon:mute};
}
