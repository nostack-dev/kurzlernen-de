const EARTH_RADIUS_M=6378137;

export function hashRoadText(text){let h=2166136261;for(const c of String(text||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}

function lngLatToMeters(originLon,originLat,lon,lat){
  const north=(lat-originLat)*Math.PI/180*EARTH_RADIUS_M;
  const east=(lon-originLon)*Math.PI/180*EARTH_RADIUS_M*Math.max(.01,Math.cos(originLat*Math.PI/180));
  return[east,north];
}

function canonicalGeoPath(path){
  const clean=(path||[]).map(p=>[Number(p?.[0]),Number(p?.[1])]).filter(p=>p.every(Number.isFinite));
  if(clean.length<2)return[];
  const encode=points=>points.map(p=>`${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";");
  const forward=encode(clean),reverse=encode([...clean].reverse());
  return reverse<forward?[...clean].reverse():clean;
}

export function roadRouteKey(path){
  const canonical=canonicalGeoPath(path);
  return canonical.length?`r${hashRoadText(canonical.map(p=>`${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(";")).toString(36)}`:"";
}

export function buildRoadRoute(path,originLon,originLat,{lastSeen=0}={}){
  const geoPath=canonicalGeoPath(path);if(geoPath.length<2)return null;
  const points=geoPath.map(([lon,lat])=>lngLatToMeters(originLon,originLat,lon,lat)),segments=[];let length=0;
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy);if(d<1)continue;
    segments.push({a,b,dx,dy,d,start:length});length+=d;
  }
  if(length<18||!segments.length)return null;
  const first=points[0],last=points.at(-1),closed=points.length>2&&Math.hypot(last[0]-first[0],last[1]-first[1])<=3;
  return{key:roadRouteKey(geoPath),geoPath,points,segments,length,closed,lastSeen};
}

export function mergeRoadRouteRegistry(registry,paths,originLon,originLat,now,{graceMs=30000,maxRoutes=48}={}){
  const seen=new Set();
  for(const path of paths||[]){
    const fresh=buildRoadRoute(path,originLon,originLat,{lastSeen:now});if(!fresh)continue;seen.add(fresh.key);
    const existing=registry.get(fresh.key);if(existing)Object.assign(existing,fresh,{lastSeen:now});else registry.set(fresh.key,fresh);
  }
  for(const [key,route] of registry){
    if(!seen.has(key)){
      if(now-route.lastSeen>graceMs){registry.delete(key);continue;}
      const rebuilt=buildRoadRoute(route.geoPath,originLon,originLat,{lastSeen:route.lastSeen});if(rebuilt)Object.assign(route,rebuilt,{lastSeen:route.lastSeen});
    }
  }
  return[...registry.values()].sort((a,b)=>a.key.localeCompare(b.key)).slice(0,maxRoutes);
}

export function sampleRoadRoute(route,distance,laneOffset=0){
  if(!route?.segments?.length||!(route.length>0))return null;
  let reverse=false,d;
  if(route.closed){d=((distance%route.length)+route.length)%route.length;}
  else{
    const cycle=route.length*2,phase=((distance%cycle)+cycle)%cycle;reverse=phase>route.length;d=reverse?cycle-phase:phase;
  }
  let segment=route.segments.at(-1);for(const s of route.segments)if(d<=s.start+s.d){segment=s;break;}
  const t=Math.max(0,Math.min(1,(d-segment.start)/segment.d)),travel=reverse?-1:1,dx=segment.dx*travel,dy=segment.dy*travel,nx=-dy/segment.d,ny=dx/segment.d;
  return{x:segment.a[0]+segment.dx*t+nx*laneOffset,y:segment.a[1]+segment.dy*t+ny*laneOffset,yaw:Math.atan2(dy,dx),reverse};
}
