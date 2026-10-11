// Navigation view of an existing multiplayer pose. Pure math: no new gameplay state.
const EARTH=6378137;
const finite=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
function fromGeo(g,lon,lat){
  if(!finite(g,2)||!Number.isFinite(lon)||!Number.isFinite(lat))return null;
  if(Math.abs(g[0])>180||Math.abs(g[1])>90)return null;
  return [(g[0]-lon)*Math.PI/180*EARTH*Math.max(.01,Math.cos(lat*Math.PI/180)),(g[1]-lat)*Math.PI/180*EARTH,0];
}
function fromCanonical(p,offset){
  if(!finite(p,3))return null;
  return [p[0]-(offset?.[0]||0),p[1]-(offset?.[1]||0),p[2]];
}
// Rotated forward axis -> heading clockwise from north in radians.
export function headingFromQuaternion(q,axis="y"){
  if(!finite(q,4))return 0;
  const [x,y,z,w]=q,n=Math.hypot(x,y,z,w);
  if(n<.00001)return 0;
  const a=x/n,b=y/n,c=z/n,d=w/n;
  const east=axis==="minus-x"?-(1-2*(b*b+c*c)):2*(a*b-c*d);
  const north=axis==="minus-x"?-(2*(a*b+c*d)):1-2*(a*a+c*c);
  return Math.atan2(east,north);
}
export function navPoseFromPacket(pose,{originLon,originLat,offset=[0,0]}={}){
  if(!pose||typeof pose!=="object")return null;
  const mode=["drone","foot","car","jet"].includes(pose.pm)?pose.pm:"drone";
  const geo=mode==="jet"?pose.jg:mode==="car"?pose.cg:mode==="foot"?(pose.ag||pose.g):pose.g;
  const canonical=mode==="jet"?(pose.jv||pose.av):mode==="car"?(pose.cv||pose.av):mode==="foot"?(pose.av||pose.p):pose.p;
  const point=fromGeo(geo,originLon,originLat)||fromCanonical(canonical,offset);
  if(!point)return null;
  let headingRad=0;
  if(mode==="foot")headingRad=Number.isFinite(pose.ay)?pose.ay:0;
  else if(mode==="car")headingRad=Number.isFinite(pose.cy)?-pose.cy:0;
  else headingRad=headingFromQuaternion(mode==="jet"?pose.jq:pose.q,mode==="drone"?"minus-x":"y");
  return {mode,p:point,headingRad};
}
