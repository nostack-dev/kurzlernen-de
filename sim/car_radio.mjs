// Car radio, GTA style — but with the real local stations of the place you play in. When you get
// into a car the radio comes on (the game music fades out under it); stations are the internet
// streams of the region around the map origin (radio-browser.info community directory, nearest
// ~40 km first, then wider, most listened first), so at Lake Constance you hear the Bodensee
// stations. Next / previous station: the 📻 button in the car HUD (tap = next, hold = off),
// N / B on the keyboard, D-pad right / left on the pad. A station name banner shows on every switch.
// Volume follows MUSIC VOLUME; the sound switch and the MUSIC switch turn it off.
import {AUDIO_SETTINGS_EVENT,loadAudioSettings} from "./audio_settings.mjs";

export const CAR_RADIO_VERSION="local-stations-v1";
const MIRRORS=["de1","de2","fi1","at1","nl1"].map(h=>`https://${h}.api.radio-browser.info`);
const RADIUS_M=[40000,120000],MAX_STATIONS=12,HEADROOM=.85;
let installed=false,settings=loadAudioSettings(),audio=null,stations=[],stationsFor="",loading=null,index=0,on=true,inCar=false,banner=null,bannerTimer=0,fadeRaf=0,padPrev={l:false,r:false};

const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
function wantedLevel(){return settings.soundEnabled&&settings.musicEnabled!==false&&inCar&&on&&!document.hidden?Math.min(1,(Number(settings.musicVolume)||0)/100)*HEADROOM:0;}
function setData(k,v){const el=viewport();if(el)el.dataset[k]=String(v);}
// ---------------------------------------------------------------- station list
function originLatLon(){const b=bridge();const lat=Number(b?.originLat),lon=Number(b?.originLon);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;}
async function fetchJson(path){let last=null;for(const m of MIRRORS){try{const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),6000);const r=await fetch(m+path,{signal:ctl.signal,headers:{Accept:"application/json"}});clearTimeout(t);if(r.ok)return await r.json();last=new Error(`HTTP ${r.status}`);}catch(e){last=e;}}throw last||new Error("no radio directory");}
function usable(s){const url=String(s?.url_resolved||s?.url||"");if(!/^https:\/\//i.test(url))return false;/* an https page cannot play http streams */const c=String(s.codec||"").toUpperCase();if(c&&!/MP3|AAC|OGG|OPUS|UNKNOWN/.test(c))return false;if(/hls|m3u8/i.test(url)&&!/MP3|AAC/.test(c))return false;return Boolean(String(s.name||"").trim());}
async function loadStations(){const o=originLatLon();if(!o)return stations;const key=`${o.lat.toFixed(1)},${o.lon.toFixed(1)}`;if(key===stationsFor&&stations.length)return stations;if(loading)return loading;
  loading=(async()=>{let list=[];for(const r of RADIUS_M){try{const got=await fetchJson(`/json/stations/search?geo_lat=${o.lat.toFixed(4)}&geo_long=${o.lon.toFixed(4)}&geo_distance=${r}&hidebroken=true&is_https=true&order=clickcount&reverse=true&limit=60`);list=Array.isArray(got)?got.filter(usable):[];}catch{list=[];}if(list.length>=4)break;}
    const seen=new Set(),out=[];for(const s of list){const name=String(s.name).replace(/\s+/g," ").trim(),k=name.toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,18);if(seen.has(k))continue;seen.add(k);out.push({name:name.slice(0,40),url:String(s.url_resolved||s.url),uuid:String(s.stationuuid||""),city:String(s.state||s.country||"")});if(out.length>=MAX_STATIONS)break;}
    stations=out;stationsFor=key;index=Math.min(index,Math.max(0,stations.length-1));loading=null;setData("carRadioStations",stations.length);return stations;})();
  return loading;}
// ---------------------------------------------------------------- playback
function ensureAudio(){if(audio)return audio;audio=new Audio();audio.preload="none";audio.setAttribute("playsinline","");audio.volume=0;audio.addEventListener("error",()=>{setData("carRadioState","error");if(inCar&&on&&stations.length>1)setTimeout(()=>{if(inCar&&on)tune(index+1,{auto:true});},600);});audio.addEventListener("playing",()=>setData("carRadioState","playing"));return audio;}
function fadeTo(level,ms=700,then=null){cancelAnimationFrame(fadeRaf);const a=audio;if(!a){then?.();return;}const from=a.volume,t0=performance.now();const step=now=>{const u=Math.min(1,(now-t0)/ms);a.volume=Math.max(0,Math.min(1,from+(level-from)*u));if(u<1)fadeRaf=requestAnimationFrame(step);else then?.();};fadeRaf=requestAnimationFrame(step);}
function duckMusic(){globalThis.__arondightRadioPlaying=wantedLevel()>0;window.dispatchEvent(new CustomEvent(AUDIO_SETTINGS_EVENT,{detail:{...loadAudioSettings(),source:"car-radio"}}));}
async function tune(i,{auto=false}={}){await loadStations();if(!stations.length){showBanner(stationsFor?"KEIN LOKALER SENDER":"RADIO · KEIN NETZ");return;}index=((i%stations.length)+stations.length)%stations.length;const s=stations[index],a=ensureAudio();
  showBanner(`📻 ${s.name}`,`${index+1}/${stations.length}${s.city?` · ${s.city}`:""}`);setData("carRadioStation",s.name);
  if(wantedLevel()<=0)return;a.volume=0;a.src=s.url;try{await a.play();fadeTo(wantedLevel(),auto?400:700);}catch{setData("carRadioState","blocked");}duckMusic();}
function stop(fade=true){if(!audio)return;const a=audio;fadeTo(0,fade?600:0,()=>{a.pause();a.removeAttribute("src");a.load();});setData("carRadioState","off");globalThis.__arondightRadioPlaying=false;duckMusic();}
function apply(){if(wantedLevel()>0){if(!audio?.src||audio.paused)tune(index);else fadeTo(wantedLevel(),300);}else if(audio&&!audio.paused)stop();duckMusic();}
// ---------------------------------------------------------------- UI
function showBanner(title,sub=""){const v=viewport();if(!v)return;if(!banner?.isConnected){banner=document.createElement("div");banner.id="carRadioBanner";banner.style.cssText="position:absolute;left:50%;top:calc(max(10px,env(safe-area-inset-top)) + 54px);transform:translateX(-50%);z-index:31;padding:8px 16px 7px;border-radius:12px;background:#0d1117d9;border:1px solid #ffffff2a;color:#fff;text-align:center;pointer-events:none;transition:opacity .35s;opacity:0;max-width:min(80vw,420px)";v.appendChild(banner);}
  banner.innerHTML=`<div style="font:900 15px/1.15 'Nunito',system-ui,sans-serif;letter-spacing:.05em;color:#ffd36a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div><div style="font:700 11px/1.3 system-ui,sans-serif;color:#b8c2cc;margin-top:2px"></div>`;banner.children[0].textContent=title;banner.children[1].textContent=sub;banner.style.opacity="1";clearTimeout(bannerTimer);bannerTimer=setTimeout(()=>{if(banner)banner.style.opacity="0";},2600);}
function ensureButton(){const row=document.getElementById("vehicleButtons");if(!row||document.getElementById("carRadioButton"))return;const b=document.createElement("button");b.id="carRadioButton";b.type="button";b.textContent="📻";b.title="Radio: tippen = nächster Sender, halten = aus";b.setAttribute("aria-label","Car radio");let holdT=0,held=false;
  b.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();held=false;holdT=setTimeout(()=>{held=true;toggleOff();},550);});b.addEventListener("pointerup",e=>{e.preventDefault();e.stopPropagation();clearTimeout(holdT);if(!held)next(1);});b.addEventListener("pointercancel",()=>clearTimeout(holdT));row.prepend(b);}
function next(dir){if(!inCar)return;if(!on){on=true;apply();return;}tune(index+dir);}
function toggleOff(){on=!on;if(on)apply();else{stop();showBanner("📻 RADIO AUS");}}
// ---------------------------------------------------------------- events
function onVehicle(e){const act=Boolean(e?.detail?.active);if(act===inCar)return;inCar=act;if(inCar){ensureButton();loadStations().then(()=>{if(inCar)apply();});}else stop();}
function onKey(e){if(!inCar||e.repeat||e.metaKey||e.ctrlKey||e.altKey)return;if(e.code==="KeyN"){e.preventDefault();next(1);}else if(e.code==="KeyB"){e.preventDefault();next(-1);}}
function padTick(){requestAnimationFrame(padTick);if(!inCar)return;const p=[...(navigator.getGamepads?.()||[])].find(Boolean);if(!p)return;const r=Boolean(p.buttons?.[15]?.pressed),l=Boolean(p.buttons?.[14]?.pressed);if(r&&!padPrev.r)next(1);if(l&&!padPrev.l)next(-1);padPrev={l,r};}
export function installCarRadio(){if(installed||typeof window==="undefined")return;installed=true;
  addEventListener("arondight:vehicle-mode",onVehicle);addEventListener("keydown",onKey);
  addEventListener(AUDIO_SETTINGS_EVENT,e=>{if(e?.detail?.source==="car-radio")return;settings=loadAudioSettings();if(inCar)apply();});
  document.addEventListener("visibilitychange",()=>{if(inCar)apply();});
  requestAnimationFrame(padTick);setData("carRadio",CAR_RADIO_VERSION);
  globalThis.__arondightCarRadio={next,toggleOff,get stations(){return stations.slice();},get station(){return stations[index]||null;},get on(){return on;},load:loadStations,version:CAR_RADIO_VERSION};}
installCarRadio();
