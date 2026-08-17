const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finitePoint=point=>Array.isArray(point)&&point.length>=2&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1]));

export const WORLD_BUILDING_COLLISION_RADIUS_M=220;
export const WORLD_BUILDING_COLLISION_MAX_FOOTPRINTS=192;
export const WORLD_BUILDING_COLLISION_MAX_VERTICES=64;
export const WORLD_BUILDING_COLLISION_MAX_CONVEX_VERTICES=24;
export const WORLD_BUILDING_COLLISION_MAX_PRISMS=512;

function signedArea(ring){let area=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++)area+=ring[j][0]*ring[i][1]-ring[i][0]*ring[j][1];return area*.5;}
function centroid(ring){
  let twiceArea=0,x=0,y=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const cross=ring[j][0]*ring[i][1]-ring[i][0]*ring[j][1];twiceArea+=cross;x+=(ring[j][0]+ring[i][0])*cross;y+=(ring[j][1]+ring[i][1])*cross;}
  if(Math.abs(twiceArea)>1e-6)return[x/(3*twiceArea),y/(3*twiceArea)];return ring.reduce((sum,point)=>[sum[0]+point[0]/ring.length,sum[1]+point[1]/ring.length],[0,0]);
}
function canonicalRotation(tokens){let best="";for(let offset=0;offset<tokens.length;offset++){const value=Array.from({length:tokens.length},(_,index)=>tokens[(index+offset)%tokens.length]).join(";");if(!best||value<best)best=value;}return best;}
function canonicalRingKey(ring){const tokens=ring.map(point=>`${Math.round(point[0]*20)},${Math.round(point[1]*20)}`),forward=canonicalRotation(tokens),reverse=canonicalRotation([...tokens].reverse());return forward<reverse?forward:reverse;}
function stableFeatureId(feature){for(const value of [feature?.id,feature?.properties?.id,feature?.properties?.osm_id,feature?.properties?.osm_way_id,feature?.properties?.["@id"]])if(["string","number","bigint"].includes(typeof value)&&String(value))return String(value);return"";}
function geometryPolygons(geometry){if(geometry?.type==="Polygon"&&Array.isArray(geometry.coordinates))return[geometry.coordinates];if(geometry?.type==="MultiPolygon"&&Array.isArray(geometry.coordinates))return geometry.coordinates;return[];}
function normalizeRing(raw,project,maxVertices){
  if(!Array.isArray(raw))return null;const ring=[];
  for(const point of raw){if(!finitePoint(point))continue;const projected=project(Number(point[0]),Number(point[1]));if(!finitePoint(projected))continue;const next=[Number(projected[0]),Number(projected[1])],previous=ring.at(-1);if(!previous||Math.hypot(next[0]-previous[0],next[1]-previous[1])>.02)ring.push(next);}
  if(ring.length>2&&Math.hypot(ring[0][0]-ring.at(-1)[0],ring[0][1]-ring.at(-1)[1])<=.02)ring.pop();if(ring.length<3)return null;
  if(ring.length>maxVertices){const reduced=[];for(let index=0;index<maxVertices;index++)reduced.push(ring[Math.floor(index*ring.length/maxVertices)]);ring.splice(0,ring.length,...reduced);}
  return Math.abs(signedArea(ring))>=.08?ring:null;
}
function hashText(text){let hash=2166136261;for(let index=0;index<text.length;index++){hash^=text.charCodeAt(index);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,"0");}
function isConvexRing(ring){let sign=0;for(let index=0;index<ring.length;index++){const a=ring[index],b=ring[(index+1)%ring.length],c=ring[(index+2)%ring.length],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(cross)<1e-7)continue;const next=Math.sign(cross);if(sign&&next!==sign)return false;sign=next;}return sign!==0;}

export function buildingFootprintsFromFeatures(features,{project=(x,y)=>[x,y],center=[0,0],radiusM=WORLD_BUILDING_COLLISION_RADIUS_M,maxFootprints=WORLD_BUILDING_COLLISION_MAX_FOOTPRINTS,maxVertices=WORLD_BUILDING_COLLISION_MAX_VERTICES}={}){
  const candidates=new Map(),cx=Number(center?.[0])||0,cy=Number(center?.[1])||0,radius=Math.max(5,Number(radiusM)||WORLD_BUILDING_COLLISION_RADIUS_M),limit=Math.max(1,Math.floor(Number(maxFootprints)||WORLD_BUILDING_COLLISION_MAX_FOOTPRINTS)),vertexLimit=Math.max(3,Math.floor(Number(maxVertices)||WORLD_BUILDING_COLLISION_MAX_VERTICES));
  for(const feature of Array.isArray(features)?features:[]){
    const properties=feature?.properties||{},top=clamp(Number(properties.render_height??properties.height??8)||8,.5,300),base=clamp(Number(properties.render_min_height??properties.min_height??0)||0,0,Math.max(0,top-.1)),featureId=stableFeatureId(feature);
    geometryPolygons(feature?.geometry).forEach((polygon,polygonIndex)=>{
      if(!Array.isArray(polygon)||!polygon.length)return;const outer=normalizeRing(polygon[0],project,vertexLimit);if(!outer)return;const holes=polygon.slice(1).map(ring=>normalizeRing(ring,project,vertexLimit)).filter(Boolean),centerPoint=centroid(outer),distance=Math.hypot(centerPoint[0]-cx,centerPoint[1]-cy);if(distance>radius)return;
      // Vector sources may return the same OSM feature from neighbouring tiles.
      // Exact repeats are deduplicated, while differently clipped fragments of
      // one OSM id remain present so a building cannot lose half its collider at
      // a tile boundary.
      const geometryKey=[canonicalRingKey(outer),...holes.map(canonicalRingKey).sort()].join("|"),key=featureId?`${featureId}:${geometryKey}`:`geometry:${geometryKey}`,area=Math.abs(signedArea(outer))-holes.reduce((sum,hole)=>sum+Math.abs(signedArea(hole)),0);if(area<=.08)return;const candidate={key,outer,holes,base,top,center:centerPoint,distance,area};const previous=candidates.get(key);if(!previous||candidate.area>previous.area)candidates.set(key,candidate);
    });
  }
  return[...candidates.values()].sort((a,b)=>(a.distance-b.distance)||(a.key<b.key?-1:a.key>b.key?1:0)).slice(0,limit);
}

export function buildingFootprintHash(footprints){
  const rows=(Array.isArray(footprints)?footprints:[]).map(footprint=>`${footprint.key}|${Number(footprint.base).toFixed(2)}|${Number(footprint.top).toFixed(2)}|${canonicalRingKey(footprint.outer)}|${(footprint.holes||[]).map(canonicalRingKey).sort().join("|")}`).sort();return rows.length?`osm-${hashText(rows.join("\n"))}`:"";
}

export function triangulateBuildingFootprints(footprints,triangulate,{maxTriangles=WORLD_BUILDING_COLLISION_MAX_PRISMS}={}){
  if(typeof triangulate!=="function")return[];const triangles=[],limit=Math.max(1,Math.floor(Number(maxTriangles)||WORLD_BUILDING_COLLISION_MAX_PRISMS));
  for(const footprint of Array.isArray(footprints)?footprints:[]){
    const outer=footprint.outer||[],holes=footprint.holes||[],vertices=[...outer,...holes.flat()],faces=triangulate(outer,holes)||[];
    for(const face of faces){if(triangles.length>=limit)return triangles;if(!Array.isArray(face)||face.length!==3)continue;const points=face.map(index=>vertices[Number(index)]);if(points.some(point=>!finitePoint(point)))continue;const area=Math.abs((points[1][0]-points[0][0])*(points[2][1]-points[0][1])-(points[2][0]-points[0][0])*(points[1][1]-points[0][1]))*.5;if(area<.01)continue;triangles.push({buildingKey:String(footprint.key||""),base:Number(footprint.base)||0,top:Number(footprint.top)||8,points:points.map(point=>[Number(point[0]),Number(point[1])])});}
  }
  return triangles;
}

export function buildingCollisionPrismsFromFootprints(footprints,triangulate,{maxPrisms=WORLD_BUILDING_COLLISION_MAX_PRISMS,maxConvexVertices=WORLD_BUILDING_COLLISION_MAX_CONVEX_VERTICES}={}){
  const prisms=[],limit=Math.max(1,Math.floor(Number(maxPrisms)||WORLD_BUILDING_COLLISION_MAX_PRISMS)),convexLimit=Math.max(3,Math.floor(Number(maxConvexVertices)||WORLD_BUILDING_COLLISION_MAX_CONVEX_VERTICES));
  for(const footprint of Array.isArray(footprints)?footprints:[]){if(prisms.length>=limit)break;const outer=footprint.outer||[],holes=footprint.holes||[];if(!holes.length&&outer.length<=convexLimit&&isConvexRing(outer)){prisms.push({buildingKey:String(footprint.key||""),base:Number(footprint.base)||0,top:Number(footprint.top)||8,points:outer.map(point=>[Number(point[0]),Number(point[1])])});continue;}const remaining=limit-prisms.length;prisms.push(...triangulateBuildingFootprints([footprint],triangulate,{maxTriangles:remaining}));}
  return prisms;
}

export function makeBuildingCollisionSnapshot(features,{triangulate,...options}={}){
  const footprints=buildingFootprintsFromFeatures(features,options),prisms=buildingCollisionPrismsFromFootprints(footprints,triangulate,options);return Object.freeze({hash:buildingFootprintHash(footprints),footprintCount:footprints.length,prismCount:prisms.length,prisms});
}
