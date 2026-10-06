// Shared, persistent building damage. Keyed by the collision footprint key
// (`<featureId>:<geometry>`), so damage survives prism re-syncs when the
// player moves and is applied identically to collision (Box3D), rendering
// (three.js solids) and the MapLibre extrusion layer (damaged features are
// filtered out there because three.js now draws their remains).

export const WORLD_DESTRUCTION_VERSION="persistent-building-damage-v1";
const damage=new Map();let revision=0;const listeners=new Set();

export function destructionRevision(){return revision;}
export function buildingDamage(key){return damage.get(String(key))||null;}
export function damagedBuildingKeys(){return[...damage.keys()];}
// top: new absolute roof height in metres (rubble stump when leveled).
export function setBuildingDamage(key,{top,leveled=false}){
  const k=String(key),previous=damage.get(k);if(previous&&previous.top<=top)return false;
  damage.set(k,{top:Number(top),leveled:Boolean(leveled||previous?.leveled)});return true;
}
export function commitDestruction(){revision++;for(const fn of listeners){try{fn(revision);}catch{}}return revision;}
export function onDestruction(fn){listeners.add(fn);return()=>listeners.delete(fn);}
export function clearDestruction(){damage.clear();return commitDestruction();}

// Apply damage to collision prisms. Prisms of one building share a key.
export function applyDamageToPrisms(prisms){
  if(!damage.size)return prisms;
  return prisms.map(prism=>{const d=damage.get(String(prism?.buildingKey||""));if(!d)return prism;const base=Number(prism.base)||0,top=Math.max(base+.3,Math.min(Number(prism.top)||0,d.top));return{...prism,top,damaged:true,leveled:d.leveled};});
}
// Feature ids (prefix of the footprint key) of damaged buildings, for the
// MapLibre extrusion filter.
export function damagedFeatureIds(){
  const ids=[];for(const key of damage.keys()){const raw=key.split(":")[0];if(!raw||raw==="geometry")continue;const n=Number(raw);ids.push(Number.isFinite(n)&&String(n)===raw?n:raw);}return ids;
}
