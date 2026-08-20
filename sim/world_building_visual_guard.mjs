import {syncWorldBuildingDepthOcclusion} from "./world_building_depth_occlusion.mjs";

const FALLBACK_BUILDING_COLOR="#d8d2c8";
function isBuildingLayer(layer){const id=String(layer?.id||"").toLowerCase(),sourceLayer=String(layer?.["source-layer"]||"").toLowerCase();return layer?.type==="fill-extrusion"&&(id.includes("building")||sourceLayer.includes("building"));}
function opaqueColor(value){
  if(Array.isArray(value))return value.map(item=>opaqueColor(item));
  if(typeof value!=="string")return value;
  const rgba=value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)$/i);if(rgba)return`rgb(${rgba[1]},${rgba[2]},${rgba[3]})`;
  if(/^#[0-9a-f]{8}$/i.test(value))return value.slice(0,7);
  if(/^#[0-9a-f]{4}$/i.test(value))return value.slice(0,4);
  return value;
}
export function enforceOpaqueBuildingLayers(map){let changed=0;if(map?.getStyle&&map?.setPaintProperty){for(const layer of map.getStyle()?.layers||[]){if(!isBuildingLayer(layer))continue;try{map.setPaintProperty(layer.id,"fill-extrusion-opacity",1);const color=map.getPaintProperty?.(layer.id,"fill-extrusion-color"),opaque=opaqueColor(color);if(JSON.stringify(opaque)!==JSON.stringify(color))map.setPaintProperty(layer.id,"fill-extrusion-color",opaque);changed++;}catch{}}}syncWorldBuildingDepthOcclusion();return changed;}
