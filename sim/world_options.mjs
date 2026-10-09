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
  {key:"jetpack",label:"JETPACK",help:"Jump twice to fire a short jetpack burst over houses. Recharges."},
]);
export const DEFAULT_WORLD_OPTIONS=Object.freeze(Object.fromEntries(WORLD_OPTIONS.map(o=>[o.key,true])));
let current=load();
function load(){try{const raw=JSON.parse(localStorage.getItem(WORLD_OPTIONS_KEY)||"{}");return{...DEFAULT_WORLD_OPTIONS,...Object.fromEntries(Object.entries(raw).filter(([k,v])=>k in DEFAULT_WORLD_OPTIONS&&typeof v==="boolean"))};}catch{return{...DEFAULT_WORLD_OPTIONS};}}
export function worldOption(key){return current[key]!==false;}
export function setWorldOption(key,value){if(!(key in DEFAULT_WORLD_OPTIONS))return;current={...current,[key]:Boolean(value)};try{localStorage.setItem(WORLD_OPTIONS_KEY,JSON.stringify(current));}catch{}
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(WORLD_OPTIONS_EVENT,{detail:{options:{...current},key,value:Boolean(value)}}));}
export function worldOptions(){return{...current};}
if(typeof globalThis!=="undefined")globalThis.__arondightWorldOptions={get:worldOption,set:setWorldOption,all:worldOptions,list:WORLD_OPTIONS,event:WORLD_OPTIONS_EVENT};
