const RAD_TO_DEG=180/Math.PI;
const DEG_TO_RAD=Math.PI/180;

// Input stops a little before the display limit so recoil and view-bob still
// have room. The display margin also keeps THREE's Z-up lookAt basis defined.
export const FPS_PITCH_LIMIT_RAD=Math.PI/2-.012;
export const FPS_DISPLAY_PITCH_LIMIT_RAD=Math.PI/2-.006;

// MapLibre pitch is 90 degrees at the horizon and supports the 0..180 range.
// Deriving this from the FPS display limit keeps both renderers in lockstep.
export const FPS_WORLD_MAP_MAX_PITCH_DEG=90+FPS_DISPLAY_PITCH_LIMIT_RAD*RAD_TO_DEG;
export const FPS_WORLD_MAP_MIN_PITCH_DEG=90-FPS_DISPLAY_PITCH_LIMIT_RAD*RAD_TO_DEG;
export const FPS_HORIZONTAL_FOV_DEG=90;

export function fpsPitchRadToWorldMapPitchDeg(pitchRad){
  const pitch=Math.max(-FPS_DISPLAY_PITCH_LIMIT_RAD,Math.min(FPS_DISPLAY_PITCH_LIMIT_RAD,Number(pitchRad)||0));
  return 90+pitch*RAD_TO_DEG;
}

export function fpsVerticalFovDegForAspect(aspect){
  const safeAspect=Math.max(.5,Math.min(4,Number(aspect)||16/9));
  return 2*Math.atan(Math.tan(FPS_HORIZONTAL_FOV_DEG*DEG_TO_RAD/2)/safeAspect)*RAD_TO_DEG;
}
