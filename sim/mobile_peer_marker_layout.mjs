// The multiplayer nameplate belongs to the scene, but its DOM label must not
// cover the bottom thumb sticks / ARM / STOP / weapon keys or the top toolbar.
// Coordinates are in the *game viewport's* logical frame (portrait CSS rotation
// is already accounted for by the caller). Desktop remains unconstrained.
export const MOBILE_PEER_MARKER_LAYOUT_VERSION="mobile-peer-safe-bands-v1";

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

export function safeMobilePeerMarkerPoint(x,y,width,height,{mobile=false}={}){
  if(!mobile||![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)
    return[x,y];
  // The bottom row uses up to 168px for sticks, but the nameplate is only
  // ~45px tall and can stay higher than the 40px ARM/STOP/button row.
  // Retain the middle of the scene for sighting; don't make every label
  // sit at the bottom edge when the projected entity disappears below it.
  const bottomReserve=clamp(height*.27,88,116);
  const topReserve=Math.min(115,height*.34);
  const bottom=Math.max(topReserve,height-bottomReserve);
  let px=clamp(x,38,width-38),py=clamp(y,topReserve,bottom);
  // Top-left holds MULTI, multiplayer status, score/FLOW and STRIKE. If the
  // peer is in that corner, put its tiny nameplate immediately to the right
  // of those controls instead of on top of them.
  if(px<192&&py<160&&width>=520)px=192;
  // Top-right has RESET, GPS, sound and vehicle entry controls.
  if(px>width-152&&py<100&&width>=520)py=100;
  return[px,py];
}
