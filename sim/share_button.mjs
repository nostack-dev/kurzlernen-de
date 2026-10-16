// TEILEN on the title screen (under CHANGELOG): the system share sheet where there is one
// (phones: WhatsApp, X, Instagram, …), otherwise the link is copied; and an X/Twitter post as
// the last resort. The shared link is the page's canonical address, so the preview card
// (og: / twitter: tags) shows up wherever it is pasted.
export const SHARE_BUTTON_VERSION="title-share-v1";
const TEXT="SpawnCity – spiel in deiner echten Stadt: Drohne, zu Fuß, Auto, Bus und Jet, mit Freunden. Kostenlos im Browser.";
function shareUrl(){const c=document.querySelector('link[rel="canonical"]')?.href;if(c)return c;const u=new URL(location.href);u.search="";u.hash="";return u.href;}
function toast(msg){const m=document.getElementById("gameMenu");if(!m)return;let t=document.getElementById("gameMenuShareToast");if(!t){t=document.createElement("div");t.id="gameMenuShareToast";m.appendChild(t);}t.textContent=msg;t.dataset.on="1";clearTimeout(toast.timer);toast.timer=setTimeout(()=>{t.dataset.on="0";},2200);}
async function share(){const url=shareUrl();
  try{if(navigator.share){await navigator.share({title:"SpawnCity",text:TEXT,url});return;}}catch(e){if(e?.name==="AbortError")return;}
  try{await navigator.clipboard.writeText(`${TEXT} ${url}`);toast("LINK KOPIERT");return;}catch{}
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(TEXT)}&url=${encodeURIComponent(url)}`,"_blank","noopener");}
const CSS=`#gameMenuShare{margin-top:4px;min-width:min(64vw,300px);padding:9px 24px;font:800 clamp(12px,1.6vw,14px) "Inter",system-ui,sans-serif;letter-spacing:.24em;color:#d8dde2;background:#ffffff0c;border:1px solid #ffffff30;border-radius:10px;cursor:pointer}
#gameMenuShare:hover,#gameMenuShare:focus-visible{background:#ffffff20;outline:none}
#gameMenuShareToast{position:absolute;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);padding:8px 14px;border-radius:9px;background:#12161ce6;border:1px solid #ffb02e88;color:#ffd27a;font:800 12px/1 "Inter",system-ui,sans-serif;letter-spacing:.2em;opacity:0;transition:opacity .2s;pointer-events:none;z-index:6}
#gameMenuShareToast[data-on="1"]{opacity:1}`;
function mount(){const anchor=document.getElementById("gameMenuChangelog");if(!anchor)return false;if(document.getElementById("gameMenuShare"))return true;
  const st=document.createElement("style");st.dataset.shareButton=SHARE_BUTTON_VERSION;st.textContent=CSS;document.head.appendChild(st);
  const b=document.createElement("button");b.id="gameMenuShare";b.type="button";b.textContent="TEILEN";b.addEventListener("click",e=>{e.preventDefault();share();});anchor.after(b);
  globalThis.__spawnCityShare={share,url:shareUrl,version:SHARE_BUTTON_VERSION};return true;}
function wait(){if(!mount())setTimeout(wait,250);}
if(typeof document!=="undefined"){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wait,{once:true});else wait();}
