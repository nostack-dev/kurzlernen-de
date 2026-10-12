// Persistent destruction state is keyed both by the local footprint geometry and
// by the stable OSM feature id. Different tile fragments / map rebases can have
// different geometry keys for the SAME real building.
export const WORLD_DESTRUCTION_VERSION="persistent-building-damage-v2";
const damage=new Map(),featureDamage=new Map();let revision=0;const listeners=new Set();

export function destructionRevision(){return revision;}
export function featureIdOf(key){const raw=String(key||"").split(":")[0];return raw&&raw!=="geometry"?raw:"";}

// Destruction is monotone until a world reset. A later lower roof always wins;
// at an equal height a fully leveled building must never become solid again.
function mergeDamage(map,key,{top,leveled=false}){
  const height=Number(top);if(!key||!Number.isFinite(height))return false;
  const previous=map.get(key),next={top:Math.min(height,previous?.top??height),leveled:Boolean(leveled||previous?.leveled)};
  if(previous&&previous.top===next.top&&previous.leveled===next.leveled)return false;
  map.set(key,next);return true;
}
export function buildingDamage(key){
  const exact=damage.get(String(key)),shared=featureDamage.get(featureIdOf(key));
  if(!exact)return shared||null;if(!shared)return exact;
  return{top:Math.min(exact.top,shared.top),leveled:exact.leveled||shared.leveled};
}
export function setFeatureDamage(featureId,next){return mergeDamage(featureDamage,String(featureId||""),next);}
export function damageByFeature(){
  const out=new Map();
  for(const[key,d]of damage){const id=featureIdOf(key);if(id)mergeDamage(out,id,d);}
  for(const[id,d]of featureDamage)mergeDamage(out,id,d);
  return out;
}
export function damagedBuildingKeys(){return[...damage.keys()];}
export function setBuildingDamage(key,next){
  const k=String(key||"");if(!k)return false;
  // Persist locally and under the real-world feature id. A new geometry key
  // must inherit the damage when MapLibre clips or re-loads a building.
  const changed=mergeDamage(damage,k,next),id=featureIdOf(k);
  const featureChanged=id?mergeDamage(featureDamage,id,next):false;
  return changed||featureChanged;
}
export function commitDestruction(){revision++;for(const fn of listeners){try{fn(revision);}catch{}}return revision;}
export function onDestruction(fn){listeners.add(fn);return()=>listeners.delete(fn);}
export function clearDestruction(){damage.clear();featureDamage.clear();return commitDestruction();}

// Completely leveled buildings must have NO active Box3D building shapes:
// omitting their prisms makes incremental synchronization destroy old bodies.
// Partially damaged buildings get fresh hulls at their lowered roofs.
export function applyDamageToPrisms(prisms){
  if(!damage.size&&!featureDamage.size)return prisms;
  const out=[];
  for(const prism of prisms){const d=buildingDamage(prism?.buildingKey||"");if(d?.leveled)continue;
    if(!d){out.push(prism);continue;}
    const base=Number(prism.base)||0,top=Math.min(Number(prism.top)||0,d.top);
    if(top-base<.1)continue;
    out.push({...prism,top,damaged:true,leveled:false});
  }
  return out;
}
export function damagedFeatureIds(){
  const ids=new Set();
  for(const[key]of damage){const id=featureIdOf(key);if(id)ids.add(id);}
  for(const[id]of featureDamage)if(id)ids.add(id);
  return[...ids].map(raw=>{const n=Number(raw);return Number.isFinite(n)&&String(n)===raw?n:raw;});
}
