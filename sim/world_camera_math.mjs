const WEB_MERCATOR_METERS_PER_PIXEL_Z0=156543.03392804097;
const DEG=Math.PI/180;

export function metersPerPixel(latitudeDeg,zoom){
  const cosLat=Math.max(.05,Math.cos(Number(latitudeDeg)*DEG));
  return WEB_MERCATOR_METERS_PER_PIXEL_Z0*cosLat/(2**Number(zoom));
}

export function fpvTargetDistanceMeters(latitudeDeg,viewportHeightPx,verticalFovDeg,maxZoom){
  const height=Math.max(1,Number(viewportHeightPx));
  const fov=Math.max(1,Math.min(179,Number(verticalFovDeg)))*DEG;
  const halfTan=Math.tan(fov/2);
  if(!Number.isFinite(halfTan)||halfTan<=0)throw new Error("invalid vertical FOV");
  return Math.max(2,metersPerPixel(latitudeDeg,maxZoom)*height/(2*halfTan));
}

export function forwardTarget(position,direction,distanceM){
  const d=Math.max(0,Number(distanceM));
  return {
    x:Number(position.x)+Number(direction.x)*d,
    y:Number(position.y)+Number(direction.y)*d,
    z:Number(position.z)+Number(direction.z)*d,
  };
}
