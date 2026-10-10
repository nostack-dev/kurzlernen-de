// World options chosen in the main menu (WORLD tab): which living things exist in the world,
// and player abilities. Stored per device. Modules read them live:
//   globalThis.__arondightWorldOptions.get("zombies")   → true / false
//   addEventListener(WORLD_OPTIONS_EVENT, e => e.detail.options)
// A switched-off kind is not hidden and kept simulating: it does not exist (no bodies, no AI,
// no draw); switching it back on brings it in out of the player's view like any arrival.
export const WORLD_OPTIONS_KEY="rushWorldOptionsV1";
export const WORLD_OPTIONS_EVENT="rush-world-options-change";
export const WORLD_OPTIONS=Object.freeze([
  {key:"people",label:"PEOPLE",help:"Pedestrians walking to their own destinations."},
  {key:"traffic",label:"TRAFFIC",help:"Cars and buses driving the streets."},
  {key:"dogs",label:"DOGS",help:"Dogs roaming the neighbourhood."},
  {key:"cats",label:"CATS",help:"Cats, including the black one."},
  {key:"birds",label:"BIRDS",help:"Flocks in the sky."},
  {key:"zombies",label:"ZOMBIES",help:"Zombie nights after dark."},
  {key:"police",label:"POLICE",help:"Police drones and officers when you are wanted."},
  {key:"military",label:"MILITARY",help:"Soldiers, tanks and helicopters at high wanted levels."},
  {key:"props",label:"LOOSE OBJECTS",help:"Crates, oil drums, cones and bins lying around — throw them with the gravity gun."},
  {key:"jetpack",label:"JETPACK",help:"Jump twice to fire a short jetpack burst over houses. Recharges."},
  {key:"droneNuke",label:"DRONE NUKE",help:"The drone carries a nuclear warhead (third weapon after gun and rockets). Multiplayer: the host's setting applies.",def:false,rule:true},
  {key:"launcherNuke",label:"LAUNCHER NUKE",help:"The rocket launcher on foot fires nukes instead of rockets. Multiplayer: the host's setting applies.",def:false,rule:true},
]);
export const DEFAULT_WORLD_OPTIONS=Object.freeze(Object.fromEntries(WORLD_OPTIONS.map(o=>[o.key,o.def??true])));
// Game rules (the nukes): in a multiplayer session the session host's switches apply to
// everybody (game_rules_sync.mjs sends them); alone, your own. worldRule() is the one to ask.
export const GAME_RULE_KEYS=Object.freeze(WORLD_OPTIONS.filter(o=>o.rule).map(o=>o.key));
let hostRules=null;
let current=load();
function load(){try{const raw=JSON.parse(localStorage.getItem(WORLD_OPTIONS_KEY)||"{}");return{...DEFAULT_WORLD_OPTIONS,...Object.fromEntries(Object.entries(raw).filter(([k,v])=>k in DEFAULT_WORLD_OPTIONS&&typeof v==="boolean"))};}catch{return{...DEFAULT_WORLD_OPTIONS};}}
export function worldOption(key){return key in current?current[key]===true:true;}
export function worldRule(key){if(hostRules&&key in hostRules)return hostRules[key]===true;return worldOption(key);}
export function setHostRules(rules){const next=rules&&typeof rules==="object"?Object.fromEntries(GAME_RULE_KEYS.filter(k=>typeof rules[k]==="boolean").map(k=>[k,rules[k]])):null;const same=JSON.stringify(next)===JSON.stringify(hostRules);hostRules=next&&Object.keys(next).length?next:null;
  if(!same&&typeof window!=="undefined")window.dispatchEvent(new CustomEvent(WORLD_OPTIONS_EVENT,{detail:{options:{...current},hostRules:hostRules?{...hostRules}:null,key:"hostRules"}}));}
export function hostRulesActive(){return Boolean(hostRules);}
export function setWorldOption(key,value){if(!(key in DEFAULT_WORLD_OPTIONS))return;current={...current,[key]:Boolean(value)};try{localStorage.setItem(WORLD_OPTIONS_KEY,JSON.stringify(current));}catch{}
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(WORLD_OPTIONS_EVENT,{detail:{options:{...current},key,value:Boolean(value)}}));}
export function worldOptions(){return{...current};}
if(typeof globalThis!=="undefined")globalThis.__arondightWorldOptions={get:worldOption,rule:worldRule,setHostRules,get hostRules(){return hostRules?{...hostRules}:null;},set:setWorldOption,all:worldOptions,list:WORLD_OPTIONS,event:WORLD_OPTIONS_EVENT};
