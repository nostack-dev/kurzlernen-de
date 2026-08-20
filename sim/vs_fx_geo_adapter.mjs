import {VS_FX_EVENT} from "./lan_vs.mjs";

const EARTH_RADIUS_M=6378137;
let installed=false,lastSession=null,raf=0;

function bridge(){return globalThis.__arondightRealWorld||null;}
function activeSession(){const session=bridge()?.vsSession;return session?.active||session||null;}
function metersToLngLat(originLon,originLat,east,north){const latRad=originLat*Math.PI/180;return[originLon+(east/(EARTH_RADIUS_M*Math.max(.01,Math.cos(latRad))))*180/Math.PI,originLat+(north/EARTH_RADIUS_M)*180/Math.PI];}
function lngLatToMeters(originLon,originLat,lon,lat){return[(lon-originLon)*Math.PI/180*EARTH_RADIUS_M*Math.max(.01,Math.cos(originLat*Math.PI/180)),(lat-originLat)*Math.PI/180*EARTH_RADIUS_M];}
function finitePair(value){return Array.isArray(value)&&value.length===2&&value.every(Number.isFinite);}
function finiteVec3(value){return Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);}

function encodeWorldCoordinates(packet){
  const b=bridge();if(!b?.active||!Number.isFinite(b.originLon)||!Number.isFinite(b.originLat)||!packet||typeof packet!=="object")return packet;
  const out=structuredClone(packet);
  if(finiteVec3(out.from)){out.fromG=metersToLngLat(b.originLon,b.originLat,out.from[0],out.from[1]);out.fromZ=out.from[2];}
  if(finiteVec3(out.p)){out.g=metersToLngLat(b.originLon,b.originLat,out.p[0],out.p[1]);out.pz=out.p[2];}
  return out;
}

function decodeWorldCoordinates(packet){
  const b=bridge();if(!b?.active||!Number.isFinite(b.originLon)||!Number.isFinite(b.originLat)||!packet||typeof packet!=="object")return;
  if(finitePair(packet.fromG)){const [x,y]=lngLatToMeters(b.originLon,b.originLat,packet.fromG[0],packet.fromG[1]);packet.from=[x,y,Number.isFinite(packet.fromZ)?Number(packet.fromZ):Number(packet.from?.[2])||0];}
  if(finitePair(packet.g)){const [x,y]=lngLatToMeters(b.originLon,b.originLat,packet.g[0],packet.g[1]);packet.p=[x,y,Number.isFinite(packet.pz)?Number(packet.pz):Number(packet.p?.[2])||0];}
}

function patchSession(){
  const session=activeSession();if(!session||session===lastSession||typeof session.sendFx!=="function")return;lastSession=session;if(session.__vsFxGeoAdapter)return;session.__vsFxGeoAdapter=true;const base=session.sendFx.bind(session);session.sendFx=(packet,options)=>base(encodeWorldCoordinates(packet),options);
}
function frame(){patchSession();raf=requestAnimationFrame(frame);}
function onFx(event){decodeWorldCoordinates(event?.detail?.packet);}

export function installVsFxGeoAdapter(){if(installed)return;installed=true;globalThis.addEventListener(VS_FX_EVENT,onFx);raf=requestAnimationFrame(frame);}
