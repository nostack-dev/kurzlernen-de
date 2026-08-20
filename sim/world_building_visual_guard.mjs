function isBuildingLayer(layer){const id=String(layer?.id||"").toLowerCase(),sourceLayer=String(layer?.["source-layer"]||"").toLowerCase();return layer?.type==="fill-extrusion"&&(id.includes("building")||sourceLayer.includes("building"));}

export function enforceOpaqueBuildingLayers(map){
  if(!map?.getStyle||!map?.setPaintProperty)return 0;let changed=0;
  for(const layer of map.getStyle()?.layers||[]){if(!isBuildingLayer(layer))continue;
    try{map.setPaintProperty(layer.id,"fill-extrusion-opacity",1);changed++;}catch{}
    try{
      const color=map.getPaintProperty?.(layer.id,"fill-extrusion-color");
      if(typeof color==="string"){
        const m=color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
        if(m)map.setPaintProperty(layer.id,"fill-extrusion-color",`rgb(${m[1]},${m[2]},${m[3]})`);
      }
    }catch{}
  }
  return changed;
}
