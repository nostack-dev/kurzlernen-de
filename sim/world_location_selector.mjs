const STORAGE_KEY="arondight45WorldLocationV1";
const GPS_CHOICE=Object.freeze({kind:"gps",id:"gps",label:"DEVICE GPS"});

export const WORLD_LOCATION_PRESETS=Object.freeze([
  Object.freeze({id:"new-york",label:"New York",latitude:40.7128,longitude:-74.0060}),
  Object.freeze({id:"berlin",label:"Berlin",latitude:52.5200,longitude:13.4050}),
  Object.freeze({id:"zurich",label:"Zürich",latitude:47.3769,longitude:8.5417}),
  Object.freeze({id:"london",label:"London",latitude:51.5074,longitude:-0.1278}),
  Object.freeze({id:"paris",label:"Paris",latitude:48.8566,longitude:2.3522}),
  Object.freeze({id:"tokyo",label:"Tokyo",latitude:35.6762,longitude:139.6503}),
  Object.freeze({id:"los-angeles",label:"Los Angeles",latitude:34.0522,longitude:-118.2437}),
  Object.freeze({id:"singapore",label:"Singapore",latitude:1.3521,longitude:103.8198}),
  Object.freeze({id:"dubai",label:"Dubai",latitude:25.2048,longitude:55.2708}),
  Object.freeze({id:"sydney",label:"Sydney",latitude:-33.8688,longitude:151.2093}),
  Object.freeze({id:"rio",label:"Rio de Janeiro",latitude:-22.9068,longitude:-43.1729})
]);

const byId=new Map(WORLD_LOCATION_PRESETS.map(item=>[item.id,item]));
let installed=false;

function finiteCoord(value,min,max){const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;}
function readChoice(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return GPS_CHOICE;
    const value=JSON.parse(raw);if(value?.kind==="gps")return GPS_CHOICE;
    const preset=byId.get(String(value?.id||""));if(preset)return{kind:"manual",...preset};
    const latitude=finiteCoord(value?.latitude,-90,90),longitude=finiteCoord(value?.longitude,-180,180);
    if(latitude!==null&&longitude!==null)return{kind:"manual",id:"custom",label:String(value?.label||"Custom coordinates"),latitude,longitude};
  }catch{}
  return GPS_CHOICE;
}
function writeChoice(choice){
  const value=choice?.kind==="manual"?{kind:"manual",id:choice.id||"custom",label:choice.label||"Custom coordinates",latitude:Number(choice.latitude),longitude:Number(choice.longitude)}:{kind:"gps",id:"gps",label:"DEVICE GPS"};
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(value));}catch{}
  return value;
}
function manualFix(choice){return{manualWorldLocation:true,locationLabel:choice.label,coords:{latitude:choice.latitude,longitude:choice.longitude,altitude:0,accuracy:0}};}
function currentBridge(){return globalThis.__arondightRealWorld||null;}
function noteText(choice){return choice.kind==="manual"?`Permanent: ${choice.label} · ${choice.latitude.toFixed(5)}, ${choice.longitude.toFixed(5)}`:"Permanent: device GPS";}
function annotate(choice){
  const bridge=currentBridge(),viewport=document.getElementById("viewport");if(!viewport)return;
  if(choice?.kind==="manual"){
    viewport.dataset.worldLocationSource="manual";viewport.dataset.worldLocationName=choice.label;viewport.dataset.worldLocationPersistent="1";
  }else if(bridge?.active){viewport.dataset.worldLocationSource="gps";viewport.dataset.worldLocationName="DEVICE GPS";viewport.dataset.worldLocationPersistent="1";}
}
function syncUi(){
  const choice=readChoice();
  for(const root of document.querySelectorAll("[data-world-location-selector]")){
    const select=root.querySelector("[data-world-location-select]"),custom=root.querySelector("[data-world-location-custom]"),lat=root.querySelector("[data-world-location-lat]"),lon=root.querySelector("[data-world-location-lon]"),note=root.querySelector("[data-world-location-note]");
    if(select){const known=choice.kind==="gps"?"gps":byId.has(choice.id)?choice.id:"custom";select.value=known;if(custom)custom.hidden=known!=="custom";}
    if(choice.kind==="manual"&&choice.id==="custom"){if(lat&&document.activeElement!==lat)lat.value=String(choice.latitude);if(lon&&document.activeElement!==lon)lon.value=String(choice.longitude);}
    if(note)note.textContent=noteText(choice);
  }
}
function choiceFromRoot(root){
  const id=root.querySelector("[data-world-location-select]")?.value||"gps";
  if(id==="gps")return GPS_CHOICE;
  const preset=byId.get(id);if(preset)return{kind:"manual",...preset};
  const latitude=finiteCoord(root.querySelector("[data-world-location-lat]")?.value,-90,90),longitude=finiteCoord(root.querySelector("[data-world-location-lon]")?.value,-180,180);
  if(latitude===null||longitude===null)throw Error("Latitude/longitude invalid");
  return{kind:"manual",id:"custom",label:"Custom coordinates",latitude,longitude};
}
async function applyChoice(choice){
  const saved=writeChoice(choice);syncUi();const bridge=currentBridge();if(!bridge)return;
  if(!bridge.threeRenderer){bridge.status?.(`${noteText(saved)} · saved; opens with REAL WORLD`,"good");return;}
  if(bridge.active)bridge.deactivate();
  await bridge.activate(saved.kind==="manual"?manualFix(saved):undefined);annotate(saved);
  if(saved.kind==="manual")bridge.status?.(`REAL WORLD LIVE · MANUAL ${saved.label} · ${saved.latitude.toFixed(6)}, ${saved.longitude.toFixed(6)}`,"good");
}
function selectorMarkup(compact=false){
  const options=[`<option value="gps">DEVICE GPS · LIVE</option>`,...WORLD_LOCATION_PRESETS.map(item=>`<option value="${item.id}">${item.label}</option>`),`<option value="custom">CUSTOM LAT / LON</option>`].join("");
  return `<div data-world-location-selector class="world-location-selector${compact?" compact":""}">
    ${compact?"":"<h4>WORLD LOCATION</h4>"}
    <label>${compact?"GEO POSITION":"PERMANENT GEO POSITION"}<select data-world-location-select>${options}</select></label>
    <div data-world-location-custom class="world-location-custom" hidden><input data-world-location-lat inputmode="decimal" type="number" step="0.000001" min="-90" max="90" placeholder="Latitude"><input data-world-location-lon inputmode="decimal" type="number" step="0.000001" min="-180" max="180" placeholder="Longitude"></div>
    <button type="button" data-world-location-apply class="primary">APPLY LOCATION</button>
    <div data-world-location-note class="help phone-settings-note"></div>
  </div>`;
}
function wireSelector(root){
  if(root.dataset.worldLocationWired==="1")return;root.dataset.worldLocationWired="1";
  const select=root.querySelector("[data-world-location-select]"),custom=root.querySelector("[data-world-location-custom]");
  select?.addEventListener("change",()=>{if(custom)custom.hidden=select.value!=="custom";});
  root.querySelector("[data-world-location-apply]")?.addEventListener("click",()=>{let choice;try{choice=choiceFromRoot(root);}catch(error){currentBridge()?.status?.(`WORLD location · ${error.message}`,"bad");return;}applyChoice(choice).catch(error=>currentBridge()?.fail?.(error));});
}
function mountIntoWorldCard(){
  const config=document.getElementById("realWorldConfig");if(!config||config.querySelector("[data-world-location-selector]"))return false;
  const host=document.createElement("div");host.innerHTML=selectorMarkup(true);const root=host.firstElementChild;const help=config.querySelector(".help");config.insertBefore(root,help||null);wireSelector(root);
  const use=document.getElementById("useMyLocation");if(use&&!use.dataset.worldLocationOverride){use.dataset.worldLocationOverride="1";use.textContent="USE DEVICE GPS LOCATION";use.addEventListener("click",event=>{event.preventDefault();event.stopImmediatePropagation();applyChoice(GPS_CHOICE).catch(error=>currentBridge()?.fail?.(error));},true);}
  const realOption=document.querySelector('#worldMode option[value="real"]');if(realOption)realOption.textContent="REAL WORLD · SELECTED GEO POSITION";
  syncUi();return true;
}
function mountIntoPhoneSettings(){
  const dialog=document.querySelector(".phone-settings-dialog");if(!dialog||dialog.querySelector("[data-world-location-settings]"))return false;
  const section=document.createElement("section");section.dataset.worldLocationSettings="1";section.innerHTML=selectorMarkup(false);const actions=dialog.querySelector(".phone-settings-actions");dialog.insertBefore(section,actions||null);const root=section.querySelector("[data-world-location-selector]");wireSelector(root);syncUi();return true;
}
function patchBridge(){
  const bridge=currentBridge();if(!bridge||bridge.__worldLocationSelectorPatched)return false;
  const originalActivate=bridge.activate.bind(bridge);bridge.__worldLocationSelectorPatched=true;bridge.__worldLocationOriginalActivate=originalActivate;
  bridge.activate=async locationFix=>{
    let fix=locationFix,choice=null;const persisted=readChoice(),explicitShared=Boolean(locationFix?.vsSharedOrigin);
    if(!explicitShared&&persisted.kind==="manual"&&!locationFix?.manualWorldLocation){choice=persisted;fix=manualFix(persisted);}
    else if(!fix?.coords){choice=persisted;if(choice.kind==="manual")fix=manualFix(choice);}
    else if(fix.manualWorldLocation)choice={kind:"manual",id:"custom",label:fix.locationLabel||"Custom coordinates",latitude:Number(fix.coords.latitude),longitude:Number(fix.coords.longitude)};
    const result=await originalActivate(fix);
    if(!explicitShared){const selected=choice||readChoice();annotate(selected);if(selected.kind==="manual")bridge.status?.(`REAL WORLD LIVE · MANUAL ${selected.label} · ${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}`,"good");}
    return result;
  };
  return true;
}
function installStyles(){if(document.querySelector("style[data-world-location-selector]"))return;const style=document.createElement("style");style.dataset.worldLocationSelector="1";style.textContent=`
    .world-location-selector{display:grid;gap:8px;margin-top:10px}.world-location-selector h4{margin:0;font-size:12px;letter-spacing:.08em}.world-location-selector label{display:grid;gap:5px}.world-location-selector select,.world-location-selector input{width:100%;box-sizing:border-box;border:1px solid #ffffff33;border-radius:8px;background:#0a1725;color:#eef8ff;padding:8px 9px;font:750 12px system-ui,-apple-system,sans-serif}.world-location-selector button{min-height:36px}.world-location-custom{display:grid;grid-template-columns:1fr 1fr;gap:6px}.world-location-custom[hidden]{display:none!important}.world-location-selector .help{margin:0}.world-location-selector.compact{padding-top:8px;border-top:1px solid #ffffff1c}
  `;document.head.appendChild(style);}
export function installWorldLocationSelector(){
  if(installed)return;installed=true;installStyles();patchBridge();mountIntoWorldCard();mountIntoPhoneSettings();
  const observer=new MutationObserver(()=>{patchBridge();mountIntoWorldCard();mountIntoPhoneSettings();});observer.observe(document.documentElement,{childList:true,subtree:true});
}

installWorldLocationSelector();
