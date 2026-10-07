// Shared, persistent building damage. Keyed by the collision footprint key
// (`<featureId>:<geometry>`), so damage survives prism re-syncs when the
// player moves and is applied identically to collision (Box3D), rendering
// (three.js solids) and the MapLibre extrusion layer (damaged features are
// filtered out there because three.js now draws their remains).

export const WORLD_DESTRUCTION_VERSION="persistent-building-damage-v1";
const damage=new Map(),featureDamage=new Map();let revision=0;const listeners=new Set();

export function destructionRevision(){return revision;}
// Map feature id = the part of the footprint key before ":" (OSM/OpenFreeMap
// id). It is the same on every client, while the geometry part depends on
// each client's local origin — so multiplayer sync matches on it.
export function featureIdOf(key){const raw=String(key||"").split(":")[0];return raw&&raw!=="geometry"?raw:"";}
export function buildingDamage(key){const k=String(key);return damage.get(k)||featureDamage.get(featureIdOf(k))||null;}
export function setFeatureDamage(featureId,{top,leveled=false}){const id=String(featureId||"");if(!id)return false;const previous=featureDamage.get(id);if(previous&&previous.top<=top)return false;featureDamage.set(id,{top:Number(top),leveled:Boolean(leveled||previous?.leveled)});return true;}
export function damageByFeature(){const out=new Map();for(const[key,d]of damage){const id=featureIdOf(key);if(!id)continue;const prev=out.get(id);if(!prev||d.top<prev.top)out.set(id,d);}for(const[id,d]of featureDamage){const prev=out.get(id);if(!prev||d.top<prev.top)out.set(id,d);}return out;}
export function damagedBuildingKeys(){return[...damage.keys()];}
// top: new absolute roof height in metres (rubble stump when leveled).
export function setBuildingDamage(key,{top,leveled=false}){
  const k=String(key),previous=damage.get(k);if(previous&&previous.top<=top)return false;
  damage.set(k,{top:Number(top),leveled:Boolean(leveled||previous?.leveled)});return true;
}
export function commitDestruction(){revision++;for(const fn of listeners){try{fn(revision);}catch{}}return revision;}
export function onDestruction(fn){listeners.add(fn);return()=>listeners.delete(fn);}
export function clearDestruction(){damage.clear();featureDamage.clear();return commitDestruction();}

// Apply damage to collision prisms. Prisms of one building share a key.
export function applyDamageToPrisms(prisms){
  if(!damage.size&&!featureDamage.size)return prisms;
  return prisms.map(prism=>{const d=buildingDamage(prism?.buildingKey||"");if(!d)return prism;const base=Number(prism.base)||0,top=Math.max(base+.3,Math.min(Number(prism.top)||0,d.top));return{...prism,top,damaged:true,leveled:d.leveled};});
}
// Feature ids (prefix of the footprint key) of damaged buildings, for the
// MapLibre extrusion filter.
export function damagedFeatureIds(){
  const ids=[];for(const key of[...damage.keys(),...featureDamage.keys()]){const raw=key.split(":")[0];if(!raw||raw==="geometry")continue;const n=Number(raw);ids.push(Number.isFinite(n)&&String(n)===raw?n:raw);}return ids;
}
