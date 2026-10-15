// SUGGESTIONS: after a while of playing a version (15 min), the main menu asks once, briefly:
// "Your idea for the next update?" — one short line (max 240 characters), sent anonymously.
// No account, no server of ours: the note goes out as a signed Nostr event (kind 30078,
// application data, tagged spawncity-suggestion + the build) to a few public relays with a throw-away
// key. A GitHub workflow collects them from the relays every day and sums them up for us.
export const SUGGESTION_BOX_VERSION="suggestion-box-nostr-v1";
const MIN_PLAY_S=15*60,SNOOZE_S=10*60,KEY="spawnCitySuggestV1",RELAYS=["wss://relay.damus.io","wss://nos.lol","wss://relay.primal.net","wss://relay-rpi.edufeed.org"];
const $=id=>document.getElementById(id);
function build(){const f=document.firstChild,m=f&&f.nodeType===8&&/BUILD_SHA:([0-9a-f]{7,40})/.exec(f.nodeValue||"");return m?m[1].slice(0,12):"dev";}
function state(){try{const s=JSON.parse(localStorage.getItem(KEY)||"{}");return s&&s.build===build()?s:{build:build(),played:0,done:false,snoozeUntil:0};}catch{return{build:build(),played:0,done:false,snoozeUntil:0};}}
function store(s){try{localStorage.setItem(KEY,JSON.stringify(s));}catch{}}
function playing(){const b=document.body,menu=$("gameMenu");return b.classList.contains("solo-flight")&&menu?.hidden!==false&&!document.hidden;}
setInterval(()=>{if(!playing())return;const s=state();if(s.done)return;s.played+=5;store(s);},5000);

async function send(text){const [{SimplePool},{finalizeEvent,generateSecretKey}]=await Promise.all([import("nostr-tools/pool"),import("nostr-tools/pure")]);
  const id=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,lang=(navigator.language||"de").slice(0,5);
  const ev=finalizeEvent({kind:30078,created_at:Math.floor(Date.now()/1000),tags:[["d",`spawncity-suggestion-${id}`],["t","spawncity-suggestion"],["v",build()],["l",lang]],content:JSON.stringify({app:"spawncity",text,build:build(),lang,ua:/Android/.test(navigator.userAgent)?"android":/iPhone|iPad/.test(navigator.userAgent)?"ios":"desktop"})},generateSecretKey());
  const pool=new SimplePool();try{const results=await Promise.allSettled(pool.publish(RELAYS,ev).map(p=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(Error("timeout")),6000))])));return results.filter(r=>r.status==="fulfilled").length;}finally{setTimeout(()=>{try{pool.close(RELAYS);}catch{}},500);}}

let card=null;
function show(){if(card?.isConnected){card.hidden=false;return;}const menu=$("gameMenu");if(!menu)return;card=document.createElement("div");card.id="suggestionCard";card.setAttribute("role","dialog");card.setAttribute("aria-label","Vorschlag für das nächste Update");
  card.innerHTML='<div class="sg-in"><b>💡 DEINE IDEE FÜR DAS NÄCHSTE UPDATE?</b><small>Kurz und knapp – was fehlt, was nervt, was wäre geil? Anonym.</small><textarea maxlength="240" rows="2" placeholder="z. B. Boote auf dem See, mehr Jets, …"></textarea><div class="sg-row"><button type="button" data-sg="send">SENDEN</button><button type="button" data-sg="later">SPÄTER</button><button type="button" data-sg="no">NEIN DANKE</button></div><small class="sg-msg" aria-live="polite"></small></div>';
  menu.appendChild(card);const ta=card.querySelector("textarea"),msg=card.querySelector(".sg-msg");ta.addEventListener("keydown",e=>e.stopPropagation());
  card.addEventListener("click",async e=>{const b=e.target.closest("[data-sg]");if(!b)return;e.preventDefault();e.stopPropagation();const s=state();
    if(b.dataset.sg==="no"){s.done=true;store(s);card.hidden=true;return;}
    if(b.dataset.sg==="later"){s.snoozeUntil=s.played+SNOOZE_S;store(s);card.hidden=true;return;}
    const text=ta.value.replace(/\s+/g," ").trim().slice(0,240);if(text.length<3){msg.textContent="Ein paar Worte bitte 🙂";ta.focus();return;}
    b.disabled=true;msg.textContent="SENDE …";try{const n=await send(text);if(n>0){s.done=true;store(s);msg.textContent="DANKE! 🙌 Kommt bei uns an.";setTimeout(()=>{card.hidden=true;},1600);}else{msg.textContent="Gerade nicht erreichbar – später nochmal?";b.disabled=false;}}catch{msg.textContent="Gerade nicht erreichbar – später nochmal?";b.disabled=false;}});
  const st=document.createElement("style");st.textContent=`#suggestionCard{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));z-index:15;width:min(92vw,340px)}#suggestionCard[hidden]{display:none}
#suggestionCard .sg-in{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:12px;border:1px solid #ffd36b66;background:#141009ee;color:#fff3d2;font:600 12px/1.3 system-ui,sans-serif;box-shadow:0 10px 30px #000a}
#suggestionCard small{opacity:.75;font-weight:500}#suggestionCard textarea{resize:none;padding:8px;border-radius:8px;border:1px solid #ffd36b55;background:#0a0805;color:#fff;font:500 14px/1.3 system-ui,sans-serif}
#suggestionCard .sg-row{display:flex;gap:6px}#suggestionCard .sg-row button{flex:1;padding:8px 4px;border-radius:8px;border:1px solid #ffffff33;background:#ffffff14;color:#fff;font:800 10px/1 system-ui,sans-serif;letter-spacing:.06em}#suggestionCard .sg-row button[data-sg=send]{background:linear-gradient(180deg,#ffd36b,#f2a515);color:#1c1300;border:0}`;document.head.appendChild(st);}
// asked in the menu only (never mid-fight): when the menu is up and the version was played long enough
setInterval(()=>{const menu=$("gameMenu");if(!menu||menu.hidden||$("startPlacePanel")&&!$("startPlacePanel").hidden)return;const s=state();if(s.done||s.played<MIN_PLAY_S||s.played<(s.snoozeUntil||0))return;show();},2000);
globalThis.__arondightSuggestions={version:SUGGESTION_BOX_VERSION,state,show,_send:send};
