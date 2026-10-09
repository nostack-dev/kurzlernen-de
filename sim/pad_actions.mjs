// One action layer for the Xbox pad (standard mapping), the same in every mode and the same
// actions as the keyboard. The mode modules keep their analog control (sticks, triggers, fire);
// every discrete action lives here, so a button means one thing everywhere and nothing fires
// twice. Where a keyboard key already does the job, the pad sends that key (marked as pad
// input), so keyboard and pad can never drift apart.
//
//   MENU        pause menu / settings (settings_controller_nav.mjs)
//   VIEW        camera (drone: FPV/chase cycle · car + jet: cockpit/chase)            key C
//   A           jump (on foot; double jump = jetpack) · drone: arm · dead: respawn ·
//               start screen: START · strike aiming: call the strike
//   B           strike aiming: cancel · car: handbrake (car module)
//   X           enter / exit car or jet, eject in the air                              key E / F
//   Y           next weapon (on foot, drone)                                            key Q
//   D-pad ←/→   previous / next weapon                                                  wheel
//   D-pad ↓     on foot ⇄ drone                                                         key V
//   D-pad ↑     air strike: aim with the crosshair, A / RT / ↑ calls it                 key 4 / J
//   B           EMP pulse (on foot, drone)                                              key G
//
// The pad also switches the game to pad play on first use (the XBOX CONTROLLER setting, which
// hides the touch sticks), and blocks gameplay input while a menu is open.
export const PAD_ACTIONS_VERSION="unified-pad-actions-v1";
const BTN={A:0,B:1,X:2,Y:3,LB:4,RB:5,LT:6,RT:7,VIEW:8,MENU:9,L3:10,R3:11,UP:12,DOWN:13,LEFT:14,RIGHT:15};
let installed=false,prev=[],autoEnabled=false;
const walk=()=>globalThis.__arondightWalkMode||null;
function padNow(){const pads=navigator.getGamepads?.()||[];for(const p of pads)if(p?.connected&&(p.mapping==="standard"||/xbox|xinput|045e/i.test(String(p.id||""))))return p;return null;}
function pressed(p,i){const b=p?.buttons?.[i];return Boolean(typeof b==="number"?b>.5:b?.pressed||Number(b?.value)>.5);}
function menuOpen(){return Boolean(document.querySelector("dialog.phone-settings-dialog[open],#flightLogbookDialog[open],#resetVoteDialog[open]"));}
function startScreen(){const m=document.getElementById("gameMenu");return Boolean(m&&!m.hidden);}
function dead(){return Boolean(globalThis.__arondightPlayerDamageModel?.dead||globalThis.__arondightRealWorld?.vsLocalDead||document.body.classList.contains("player-dead"));}
function mode(){const b=document.body;if(b.classList.contains("jet-mode"))return"jet";if(b.classList.contains("player-driving"))return"car";return walk()?.mode==="foot"?"foot":"drone";}
// gameplay modules ask this before reading the pad
globalThis.__arondightPadBlocked=()=>menuOpen()||startScreen();
export function sendKey(code,{hold=60}={}){const opts={code,key:code.replace(/^Key|^Digit/,"").toLowerCase(),bubbles:true,cancelable:true};const down=new KeyboardEvent("keydown",opts);down.__synthetic="pad";dispatchEvent(down);setTimeout(()=>{const up=new KeyboardEvent("keyup",opts);up.__synthetic="pad";dispatchEvent(up);},hold);}
function cycleWeapon(dir){const m=mode();if(m!=="foot"&&m!=="drone")return;const api=m==="foot"?globalThis.__arondightFootWeapons:globalThis.__arondightDroneWeapons;if(!api)return;
  if(m==="foot"&&typeof api.setMode==="function"){const order=["smg","glock","grenade"],i=Math.max(0,order.indexOf(String(api.mode)));api.setMode(order[(i+dir+order.length)%order.length]);}else api.toggle?.();}
function switchFootDrone(){const m=mode();if(m!=="foot"&&m!=="drone")return;walk()?.setMode?.(m==="foot"?"drone":"foot",{reason:"pad-dpad-down"});}
function camera(){const m=mode();if(m==="drone")document.getElementById("soloCamera")?.click();else if(m==="car"||m==="jet")sendKey("KeyC");}
function strike(){const j=globalThis.__fighterJets;if(!j)return;if(j.targeting)j.confirm?.();else j.target?.(true);}
function emp(){const w=globalThis.__arondightWantedSystem;if(w?.triggerEmp)w.triggerEmp();else document.getElementById("wantedEmpButton")?.click();}
function respawn(){const hud=document.getElementById("vsRespawnHud");if(hud&&!hud.hidden){hud.querySelector("button")?.click();return;}globalThis.__arondightRequestReset?.();}
function enablePadPlay(){if(autoEnabled)return;autoEnabled=true;const box=document.querySelector("[data-xbox-controller]");if(box&&!box.checked){box.click();}}
// title screen: D-pad / stick moves between START, WORLD and the world switches, A presses, B backs out
function titleNav(edge){const panel=document.getElementById("worldOptionsPanel"),inPanel=panel&&!panel.hidden,scope=inPanel?panel:document.getElementById("gameMenu");
  const items=[...(scope?.querySelectorAll("button:not([disabled])")||[])].filter(b=>b.offsetParent!==null&&(inPanel||b.id==="gameMenuStart"||b.id==="gameMenuWorld"));
  const cur=items.indexOf(document.activeElement);
  if(edge(BTN.DOWN)||edge(BTN.UP)){const n=items.length;if(!n)return;const i=cur<0?0:(cur+(edge(BTN.DOWN)?1:-1)+n)%n;items[i].focus({preventScroll:false});return;}
  if(edge(BTN.B)&&inPanel){globalThis.__arondightWorldOptionsMenu?.close?.();return;}
  if(edge(BTN.A)){if(cur>=0)items[cur].click();else if(!inPanel)document.getElementById("gameMenuStart")?.click();return;}
  if(edge(BTN.MENU)&&!inPanel)document.getElementById("gameMenuStart")?.click();}
function frame(){
  requestAnimationFrame(frame);const p=padNow();document.body.classList.toggle("pad-connected",Boolean(p));if(!p){prev.length=0;return;}
  const now=[];for(let i=0;i<17;i++)now[i]=pressed(p,i);const edge=i=>now[i]&&!prev[i];
  if(now.some(Boolean)){enablePadPlay();if(!document.body.classList.contains("pad-input"))document.body.classList.add("pad-input");}
  try{
    if(menuOpen()){focusMenu();return;}           // the settings navigator owns the pad; make sure something is focused
    if(startScreen()){titleNav(edge);return;}
    if(dead()){if(edge(BTN.A)||edge(BTN.Y))respawn();return;}
    const j=globalThis.__fighterJets;
    if(j?.targeting){if(edge(BTN.A)||edge(BTN.RT)||edge(BTN.UP))j.confirm?.();else if(edge(BTN.B))j.target?.(false);return;}
    const m=mode();
    if(edge(BTN.UP))strike();
    if(edge(BTN.DOWN))switchFootDrone();
    if(edge(BTN.VIEW))camera();
    if(edge(BTN.X))sendKey("KeyE");
    if(m==="foot"||m==="drone"){if(edge(BTN.Y)||edge(BTN.RIGHT))cycleWeapon(1);else if(edge(BTN.LEFT))cycleWeapon(-1);}
    if((m==="foot"||m==="drone")&&edge(BTN.B))emp();
  }finally{prev=now;}
}
function onKey(e){
  if(e.__synthetic||e.metaKey||e.ctrlKey||e.altKey||e.repeat)return;const t=e.target;if(t instanceof Element&&t.closest("input,textarea,select,[contenteditable]"))return;
  // F = E (interact), as in most shooters
  if(e.code==="KeyF"&&!document.querySelector("#zombieRepair:not([hidden])")){e.preventDefault();sendKey("KeyE");return;}
  // G = EMP (the police-drone pulse), like a tactical in shooters
  if(e.code==="KeyG"){if(menuOpen()||startScreen()||dead())return;e.preventDefault();emp();return;}
  if(e.code==="Digit4"){if(menuOpen()||startScreen()||dead())return;e.preventDefault();strike();}
}
// Where am I? A pad user always sees the focused control, the start button says Ⓐ.
const PAD_CSS=`
html body.pad-input dialog :is(button,input,select,summary,[tabindex]):focus{outline:3px solid #ffd76a!important;outline-offset:2px!important;box-shadow:0 0 0 6px #ffd76a33!important}
html body.pad-input dialog input[type=range]:focus{outline-offset:6px!important}
html body.pad-connected #gameMenuStart::after{content:"Ⓐ";display:inline-block;margin-left:10px;padding:0 7px;border-radius:50%;background:#3fbf5a;color:#fff;font-weight:900}
html body.pad-connected #gameMenu::after{content:"Ⓐ START  ·  ☰ MENU";position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);padding:6px 14px;border-radius:16px;background:#000a;color:#eafff7;font:800 13px/1 system-ui,sans-serif;letter-spacing:.1em;pointer-events:none;animation:padHintPulse 1.6s ease-in-out infinite}
@keyframes padHintPulse{50%{opacity:.55}}`;
function focusMenu(){const d=document.querySelector("dialog.phone-settings-dialog[open]");const a=document.activeElement;if(!d||(d.contains(a)&&!a.matches?.("[data-close-top]")))return;(d.querySelector('[data-game-action="resume"]')||d.querySelector("button"))?.focus({preventScroll:true});}
export function installPadActions(){
  if(installed||typeof window==="undefined")return;installed=true;
  addEventListener("keydown",onKey);requestAnimationFrame(frame);const st=document.createElement("style");st.dataset.padActions=PAD_ACTIONS_VERSION;st.textContent=PAD_CSS;document.head.appendChild(st);
  addEventListener("gamepadconnected",()=>enablePadPlay());
  const v=document.getElementById("viewport");if(v)v.dataset.padActions=PAD_ACTIONS_VERSION;
}
installPadActions();
