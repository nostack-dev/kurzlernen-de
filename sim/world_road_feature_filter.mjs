const NON_DRIVABLE=/(?:rail|railway|train|tram|subway|light_rail|path|foot|pedestrian|cycle|track|steps|platform|ferry|aerialway)/i;
const DRIVABLE=/(?:motorway|trunk|primary|secondary|tertiary|minor|service|residential|living_street|street|road|unclassified)/i;

export function geometryLinePaths(geometry){const c=geometry?.coordinates||[];if(geometry?.type==="LineString")return[c];if(geometry?.type==="MultiLineString")return c;return[];}
export function isDrivableRoadFeature(feature){
  const p=feature?.properties||{},layer=feature?.layer||{},sourceLayer=String(feature?.sourceLayer||layer?.["source-layer"]||"").toLowerCase(),id=String(layer?.id||"").toLowerCase(),kind=[p.class,p.subclass,p.type,p.kind,p.highway,p.transportation,id].filter(v=>v!==undefined&&v!==null).join(" ").toLowerCase();
  if(sourceLayer&&sourceLayer!=="transportation")return false;if(NON_DRIVABLE.test(kind))return false;if(DRIVABLE.test(kind))return true;
  return sourceLayer==="transportation"&&/(?:road|street|transportation)/i.test(id)&&!NON_DRIVABLE.test(id);
}

export function collectRenderedDrivableRoadPaths(map,{maxFeatures=96}={}){
  if(!map?.getStyle||!map?.queryRenderedFeatures)return[];try{
    const layers=(map.getStyle()?.layers||[]).filter(layer=>String(layer?.["source-layer"]||"").toLowerCase()==="transportation"&&!NON_DRIVABLE.test(String(layer?.id||""))).map(layer=>layer.id);if(!layers.length)return[];
    const paths=[];for(const feature of map.queryRenderedFeatures(undefined,{layers})||[]){if(paths.length>=maxFeatures)break;if(!isDrivableRoadFeature(feature))continue;for(const path of geometryLinePaths(feature.geometry)){if(Array.isArray(path)&&path.length>=2)paths.push(path);if(paths.length>=maxFeatures)break;}}
    return paths;
  }catch{return[];}
}
