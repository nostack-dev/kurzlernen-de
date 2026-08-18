const text=value=>String(value??'').trim().toLowerCase();
const hash=value=>{let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};

const materialPalettes=Object.freeze({
  brick:{wall:'#8b5e4d',mortar:'#cdb7a4',window:'#8fc0d8',roof:'#60473f',roughness:.86},
  stone:{wall:'#918b80',mortar:'#c9c4ba',window:'#9abed0',roof:'#605e59',roughness:.95},
  concrete:{wall:'#a7a8a3',mortar:'#d0d1cc',window:'#8eb7c9',roof:'#656a6b',roughness:.92},
  glass:{wall:'#537889',mortar:'#91aeb8',window:'#acd9ea',roof:'#485963',roughness:.34},
  metal:{wall:'#81898d',mortar:'#a9afb1',window:'#8eb2c0',roof:'#596064',roughness:.58},
  stucco:{wall:'#c2b8a4',mortar:'#e1d8c7',window:'#8ab6ca',roof:'#76594e',roughness:.9},
});

function pickMaterial(properties,key){
  const raw=text(properties?.['building:material']||properties?.material||properties?.building_material||'');
  if(raw.includes('brick'))return'brick';if(raw.includes('stone')||raw.includes('sandstone'))return'stone';if(raw.includes('glass'))return'glass';if(raw.includes('metal')||raw.includes('steel'))return'metal';if(raw.includes('concrete'))return'concrete';
  const type=text(properties?.building||properties?.class||properties?.type||'');if(type.includes('industrial')||type.includes('warehouse')||type.includes('hangar'))return'metal';if(type.includes('office')||type.includes('commercial')||type.includes('retail'))return hash(key)%3===0?'glass':'concrete';
  return['brick','stucco','stone','concrete'][hash(key)%4];
}

export function buildingAppearanceProfile(footprint={}){
  const properties=footprint.properties||{},key=footprint.key||properties.id||'',material=pickMaterial(properties,key),palette=materialPalettes[material],levels=Math.max(1,Number(properties.levels||properties['building:levels'])||Math.round(Math.max(3,(Number(footprint.top)-Number(footprint.base)||8))/3)),roofShape=text(properties['roof:shape']||properties.roof_shape||'flat')||'flat';
  const color=text(properties['building:colour']||properties['building:color']||properties.colour||properties.color),roofColor=text(properties['roof:colour']||properties['roof:color']||properties.roof_colour||properties.roof_color);
  const seed=hash(key),windowColumns=2+(seed%5),windowRows=Math.max(1,Math.min(12,levels)),windowAspect=.62+((seed>>>5)%25)/100;
  return Object.freeze({key:String(key),material,wall:color||palette.wall,mortar:palette.mortar,window:palette.window,roof:roofColor||palette.roof,roughness:palette.roughness,levels,roofShape,windowColumns,windowRows,windowAspect,seed});
}
