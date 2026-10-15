// START LOCATION: play in any city, not only where you are. The main menu has a "📍 START" pill under
// START: MEIN STANDORT (GPS, default) or a place you search — city, street, address — with live
// suggestions (Photon / OpenStreetMap). The choice is remembered (with the last few places) and
// used on the next START; picked while a game runs, the next START moves the world there.
export const START_LOCATION_VERSION="start-place-search-v1";
const KEY="spawnCityStartPlaceV1",RECENT_KEY="spawnCityStartPlaceRecentV1",API="https://photon.komoot.io/api/";
const $=id=>document.getElementById(id);
function load(k,f){try{return JSON.parse(localStorage.getItem(k)||"null")??f;}catch{return f;}}
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
// the chosen place lives only for this browser session: every new start of the app is at your GPS position
function loadSession(){try{return JSON.parse(sessionStorage.getItem(KEY)||"null");}catch{return null;}}
let place=loadSession();try{localStorage.removeItem(KEY);}catch{}const valid=p=>p&&Number.isFinite(+p.lat)&&Number.isFinite(+p.lon)&&Math.abs(+p.lat)<=85&&Math.abs(+p.lon)<=180;if(!valid(place))place=null;
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function labelOf(pr){const street=pr.street?`${pr.street}${pr.housenumber?" "+pr.housenumber:""}`:"",head=pr.name||street||pr.city||pr.state||"",tail=[pr.name&&street?street:"",[pr.postcode,pr.city||pr.town||pr.village].filter(Boolean).join(" "),pr.country].filter(x=>x&&x!==head);return{head,tail:tail.join(", ")};}
function setPlace(p){place=p&&valid(p)?{name:String(p.name||"").slice(0,80),sub:String(p.sub||"").slice(0,120),lat:+p.lat,lon:+p.lon}:null;try{sessionStorage.setItem(KEY,JSON.stringify(place));}catch{}
  if(place){const r=load(RECENT_KEY,[]).filter(q=>Math.abs(q.lat-place.lat)>1e-4||Math.abs(q.lon-place.lon)>1e-4);r.unshift(place);save(RECENT_KEY,r.slice(0,5));}render();}
let gpsState="";try{navigator.permissions?.query?.({name:"geolocation"}).then(st=>{const f=()=>{gpsState=st.state;render();};f();st.onchange=f;}).catch(()=>{});}catch{}
function render(){const b=$("startPlaceButton");if(!b)return;b.innerHTML=`<span>📍</span><b>${esc(place?place.name:gpsState==="denied"?"GPS BLOCKIERT – IN DEN EINSTELLUNGEN ERLAUBEN":"MEIN STANDORT (GPS)")}</b><i>ÄNDERN</i>`;b.title=place?`${place.name} · ${place.sub}`:"Start an deinem GPS-Standort";}
let panel=null,timer=0,seq=0;
function row(p,current){return`<button type="button" class="sp-item${current?" sp-on":""}" data-lat="${p?p.lat:""}" data-lon="${p?p.lon:""}" data-name="${esc(p?p.name:"")}" data-sub="${esc(p?p.sub:"")}"><b>${esc(p?p.name:"📡 MEIN STANDORT (GPS)")}</b><small>${esc(p?p.sub:"wo du gerade bist")}</small></button>`;}
function openPanel(){if(!panel){panel=document.createElement("div");panel.id="startPlacePanel";panel.setAttribute("role","dialog");panel.setAttribute("aria-label","Startort wählen");
    panel.innerHTML='<div class="sp-card"><div class="sp-head"><b>WO WILLST DU SPIELEN?</b><button type="button" class="sp-x" aria-label="Schließen">✕</button></div><input type="search" class="sp-q" placeholder="Stadt, Straße oder Adresse …" autocomplete="off" enterkeyhint="search"><div class="sp-list"></div><small class="sp-note">Suche: © OpenStreetMap (Photon)</small></div>';
    $("gameMenu")?.appendChild(panel);
    panel.addEventListener("click",e=>{const it=e.target.closest(".sp-item");if(it){const lat=it.dataset.lat;setPlace(lat?{lat,lon:it.dataset.lon,name:it.dataset.name,sub:it.dataset.sub}:null);closePanel();return;}if(e.target.closest(".sp-x")||e.target===panel)closePanel();});
    panel.querySelector(".sp-q").addEventListener("input",e=>{clearTimeout(timer);const q=e.target.value.trim();timer=setTimeout(()=>search(q),280);});
    panel.querySelector(".sp-q").addEventListener("keydown",e=>{e.stopPropagation();if(e.key==="Escape")closePanel();if(e.key==="Enter"){const first=panel.querySelector(".sp-list .sp-item[data-lat]:not([data-lat=''])");first?.click();}});}
  panel.hidden=false;listDefault();const q=panel.querySelector(".sp-q");q.value="";setTimeout(()=>{try{if(matchMedia("(pointer:fine)").matches)q.focus();}catch{}},30);}
function closePanel(){if(panel)panel.hidden=true;$("startPlaceButton")?.focus?.();}
function listDefault(){const list=panel.querySelector(".sp-list"),recent=load(RECENT_KEY,[]).filter(valid);list.innerHTML=row(null,!place)+recent.map(p=>row(p,place&&Math.abs(p.lat-place.lat)<1e-5&&Math.abs(p.lon-place.lon)<1e-5)).join("");}
async function search(q){const list=panel?.querySelector(".sp-list");if(!list)return;if(q.length<2){listDefault();return;}const my=++seq;list.innerHTML='<div class="sp-wait">SUCHE …</div>';
  try{const b=globalThis.__arondightRealWorld,bias=Number.isFinite(b?.originLat)?`&lat=${b.originLat.toFixed(3)}&lon=${b.originLon.toFixed(3)}`:"";const r=await fetch(`${API}?q=${encodeURIComponent(q)}&limit=7&lang=de${bias}`);const j=await r.json();if(my!==seq)return;
    const items=(j.features||[]).map(f=>{const[lon,lat]=f.geometry?.coordinates||[],l=labelOf(f.properties||{});return{lat,lon,name:l.head,sub:l.tail};}).filter(p=>valid(p)&&p.name);
    list.innerHTML=items.length?items.map(p=>row(p,false)).join(""):'<div class="sp-wait">NICHTS GEFUNDEN</div>';}
  catch{if(my===seq)list.innerHTML='<div class="sp-wait">SUCHE NICHT ERREICHBAR – OFFLINE?</div>';}}
function mount(){const status=$("gameMenuStatus");if(!status||$("startPlaceButton"))return Boolean(status);const b=document.createElement("button");b.id="startPlaceButton";b.type="button";status.after(b);b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();openPanel();});render();
  const st=document.createElement("style");st.textContent=`#startPlaceButton{display:flex;align-items:center;gap:8px;margin:10px auto 0;max-width:min(86vw,420px);padding:7px 12px;border-radius:18px;border:1px solid #ffffff40;background:#0b1118b8;color:#eaf4ff;font:700 12px/1.2 system-ui,sans-serif;letter-spacing:.04em;cursor:pointer}
#startPlaceButton b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:62vw}#startPlaceButton i{font-style:normal;opacity:.6;font-size:10px;margin-left:4px}
#startPlacePanel{position:absolute;inset:0;z-index:20;display:flex;align-items:flex-start;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 12px 12px;background:#05080ccc;backdrop-filter:blur(3px)}#startPlacePanel[hidden]{display:none}
#startPlacePanel .sp-card{width:min(94vw,520px);max-height:calc(100dvh - 24px);display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;border:1px solid #ffffff2e;background:#0f151d;color:#eaf4ff;font:600 13px/1.3 system-ui,sans-serif}
#startPlacePanel .sp-head{display:flex;justify-content:space-between;align-items:center;letter-spacing:.08em}#startPlacePanel .sp-x{width:34px;height:34px;border-radius:50%;border:1px solid #ffffff40;background:#ffffff12;color:#fff;font-size:14px}
#startPlacePanel .sp-q{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid #7fd3ff88;background:#081018;color:#fff;font:600 16px/1.2 system-ui,sans-serif}
#startPlacePanel .sp-list{overflow:auto;display:flex;flex-direction:column;gap:4px;min-height:60px}#startPlacePanel .sp-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:9px 10px;border-radius:9px;border:1px solid #ffffff1c;background:#ffffff0a;color:#eaf4ff;text-align:left;cursor:pointer}
#startPlacePanel .sp-item:hover,#startPlacePanel .sp-item:focus{border-color:#7fd3ff;background:#7fd3ff1a;outline:none}#startPlacePanel .sp-item.sp-on{border-color:#7ff0c5}#startPlacePanel .sp-item small{opacity:.65;font-weight:500}#startPlacePanel .sp-wait{padding:12px;opacity:.7;letter-spacing:.06em}#startPlacePanel .sp-note{opacity:.45;font-size:10px}`;document.head.appendChild(st);return true;}
// km between the running world and the chosen place (the next START moves the world when far)
function distanceKm(lat,lon){const b=globalThis.__arondightRealWorld;if(!b?.active||!Number.isFinite(b.originLat))return Infinity;const R=6371,dLat=(lat-b.originLat)*Math.PI/180,dLon=(lon-b.originLon)*Math.PI/180,a=Math.sin(dLat/2)**2+Math.cos(lat*Math.PI/180)*Math.cos(b.originLat*Math.PI/180)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(a));}
globalThis.__arondightStartPlace={version:START_LOCATION_VERSION,get:()=>place,set:setPlace,fix:()=>place?{coords:{latitude:place.lat,longitude:place.lon,altitude:0,accuracy:5},timestamp:Date.now(),chosen:true}:null,needsMove:()=>Boolean(place&&distanceKm(place.lat,place.lon)>1.5)};
const boot=()=>{if(!mount())setTimeout(boot,300);};boot();
