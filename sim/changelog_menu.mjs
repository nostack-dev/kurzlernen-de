// Title screen: NEU / CHANGELOG under WORLD. The most important points of every update, newest
// first. New updates go on top of CHANGELOG (keep each point to one line a player understands).
// Mouse, touch, keyboard (Esc closes) and the pad (pad_actions.mjs: up/down scroll, B closes).
export const CHANGELOG_MENU_VERSION="title-changelog-v1";
export const CHANGELOG=Object.freeze([
  {date:"2026-10-10",title:"Nukes per Schalter, LIVE GPS, Kühe, Boxen",items:[
    "Hauptmenü → WORLD: DRONE NUKE und LAUNCHER NUKE (Standard aus). Im Multiplayer gelten die Schalter des Hosts.",
    "Raketenwerfer feuert ohne Nuke normale Raketen – mit LAUNCHER NUKE die Atombombe.",
    "Changelog im Hauptmenü.",
    "Drohnen-LENKRAKETE: Ziel markieren (Mensch, Tier, Vogel, Auto, Drohne), nochmal drücken – Marschflugkörper mit Triebwerkssound, Reiseflug und Sturzflug.",
    "Autoradio wie in GTA – mit den echten Lokalsendern der Region (am Bodensee die Bodensee-Sender). 📻 / N / B / Steuerkreuz.",
    "Die Laufgruppe: ab und zu joggt eine Gruppe im Gleichschritt mit eigenem Schlachtruf durch die Straßen – mit Streak fürs Überfahren.",
    "Messer als eigene Waffe (Taste 7, im Waffenwechsel nach den Fäusten).",
    "Gangster: wenige Passanten tragen ein Messer, ganz selten eine Pistole – und kommen auf dich zu, statt wegzurennen.",
    "RESET räumt alles auf: Laternen, Kühe, Autos, Passanten, Kisten, Granaten in der Luft.",
    "Explosionsspuren dezenter; Ruß und Löcher verschwinden mit der eingestürzten Wand.",
    "Raketen im Flug und Leuchtspur werfen echtes Licht; Hauswände verwittern (Flecken, Regenspuren), Asphalt hat Struktur.",
    "Auto-Innenansicht: die Frontscheibe ist das Bild – schmale Säulen, flaches Armaturenbrett, Motorhaube in Wagenfarbe, Lenkrad unten.",
    "LIVE GPS (Taste L): die Welt folgt deiner echten Position – Joggen, Rad, Auto. Im Multiplayer sehen die anderen dich laufen, Rad fahren (mit Fahrrad) oder im Auto.",
    "Kühe auf den echten Weiden: physisch, treffbar, mit Muhen und Schmerzlaut.",
    "Passanten haben Temperament: meist ängstlich, manche rennen weg, wenige schlagen zurück; sie schreien, fluchen und beruhigen sich wieder.",
    "Panik nur in der Nähe von Schüssen – nicht mehr die ganze Stadt.",
    "Boxen: zwei unabhängige Fäuste, Kombos, Wusch- und Treffergeräusche; Tiere reagieren auf Schläge.",
    "Handgranaten (T / LB): Stift ziehen, kochen, werfen.",
    "Eine Granate anschießen zündet sie sofort; Werfergranaten explodieren an Gebäuden, Menschen, Laternen und Tieren, auf dem Boden springen sie.",
    "Echtes Licht von Laternen, Scheinwerfern, Mündungsfeuer, Explosionen und Jetpack.",
    "Jetpack mit Zündung, Schubdröhnen und 3D-Sound anderer Spieler.",
    "Die schwarze Katze faucht und kreischt beim Angriff.",
    "Mobile: kleinere Sticks in den Ecken, nur ein Waffenknopf, JUMP links davon, Scope darüber; Touch-Schüsse gehen exakt auf den Finger.",
  ]},
  {date:"2026-10-09",title:"Fäuste, Autos, Multiplayer-Körper",items:[
    "Fäuste für dich – und für Passanten, die genug haben.",
    "Jedes Auto, in das du steigst, fährt; Cockpit-Ansicht (C).",
    "Drohne feuert Raketensalven; Werferraketen explodieren beim Aufprall.",
    "Tag und Nacht sind im Multiplayer für alle gleich; Esc fragt „zurück ins Hauptmenü?“.",
    "Multiplayer: Trefferzonen, Ragdolls mit Todeskamera, Jetpack repliziert, Mitspieler überfahren, Gravity Gun auf alles.",
    "Klassische Glock, saubere Luftschlag-Zielwahl, Reset-Abstimmung per Desktop und Pad.",
  ]},
  {date:"2026-10-08",title:"Laternen, Zombie-Nächte, Polizei, Performance",items:[
    "Straßenlaternen an jeder echten Straße mit Lichtkegeln bei Nacht.",
    "Zombie-Nächte, Schwingtüren mit Barrikaden.",
    "Reset: allein = ganzes Level zurück; mit anderen = Abstimmung (ein Nein bricht ab).",
    "GTA-Polizei am Boden: Streifenwagen jagen dich, Beamte steigen aus und schießen.",
    "Kampfjets mit Luftschlag; ferne Passanten als Impostor.",
    "Autos mit echter Federung; geparkte Autos bleiben stehen und sind repliziert.",
    "Glasfenster von innen, Einschussrisse in Scheiben, stabile Schatten.",
    "3D-Kreuzblick-Modus in den Einstellungen.",
    "Performance: Boden in 64 Chunks, Straßennetz viel leichter, nur sichtbare Menschen werden gezeichnet.",
  ]},
  {date:"2026-10-06",title:"OPPENHEIMER",items:[
    "Neuer Name OPPENHEIMER; als App auf den Home-Bildschirm installierbar, immer der neueste Stand.",
    "Klassische Pilzwolke; jede Explosion kann Gebäude zerstören.",
    "Drohne regeneriert nach Zerstörung; Panik in der Fallout-Zone.",
    "Nahtloser Übergang Menü → Spiel, Menü-Flyover, Sound-Schalter.",
    "Performance: eine 3D-Ansicht statt zwei, weniger Speichermüll in Verkehr und Physik.",
  ]},
  {date:"2026-10-02",title:"Nuke und Mobile-Multiplayer",items:[
    "Drohnen-Nuke mit Druckwelle, Kamerabeben und Pilzwolke.",
    "Drohnen-Waffenwahl auf dem Desktop; STOP- und EMP-Knopf, Reset auf Mobile.",
    "Mobile-Multiplayer findet Mitspieler zuverlässig.",
  ]},
  {date:"2026-08-24",title:"Zu Fuß in der Ego-Perspektive",items:[
    "Aussteigen und zu Fuß: Dual-Stick-Steuerung, Pistole und MP, Touch-Feuer.",
    "Xbox-Controller: klassischer Flug- und Zielmodus.",
    "Belebte Stadt: Passanten, Verkehr und Tiere.",
    "Audio-Einstellungen; realistische FPV-Kamera.",
  ]},
  {date:"2026-08-17",title:"Die echte Welt",items:[
    "Echte Luftbilder und Gebäude mit Kollision auf der WORLD-Karte.",
    "Immer Querformat, Minimap von oben, Xbox-Steuerung.",
  ]},
  {date:"2026-08-12",title:"Multiplayer VS",items:[
    "Mitspieler in der Nähe und im WLAN finden sich automatisch; verschlüsselte Verbindung.",
    "Kampf-HUD, Explosionen und Respawn.",
  ]},
  {date:"2026-08-10",title:"Hardware-treuer Drohnensimulator",items:[
    "Flugregler wie auf dem echten ESP32 (1 kHz), GAME-Modus bis 90 km/h.",
    "Stick-Invertierungen, Schüsse exakt auf den Touchpunkt, Einschusslöcher.",
  ]},
]);
const CSS=`
#gameMenuChangelog{margin-top:4px;min-width:min(64vw,300px);padding:9px 24px;font:800 clamp(12px,1.6vw,14px) "Inter",system-ui,sans-serif;letter-spacing:.24em;color:#d8dde2;background:#ffffff0c;border:1px solid #ffffff30;border-radius:10px;cursor:pointer}
#gameMenuChangelog:hover,#gameMenuChangelog:focus-visible{background:#ffffff20;outline:none}
#changelogPanel{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:#0b0d10e8;backdrop-filter:blur(4px)}
#changelogPanel[hidden]{display:none}
#changelogPanel .cl-card{width:min(94vw,560px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;padding:16px 16px 12px;border:1px solid #ffffff2e;border-radius:14px;background:#12161ce6;text-align:left}
#changelogPanel h2{margin:0 0 10px;font:900 italic 22px/1 "Inter",system-ui,sans-serif;letter-spacing:.06em;color:#ffb02e}
#changelogPanel .cl-list{overflow:auto;flex:1;padding-right:4px;overscroll-behavior:contain}
#changelogPanel section{margin:0 0 12px}
#changelogPanel h3{margin:0 0 5px;font:850 13px/1.2 system-ui,sans-serif;letter-spacing:.06em;color:#eef0f2}
#changelogPanel h3 span{color:#ff9a3a;margin-right:8px;font-variant-numeric:tabular-nums}
#changelogPanel section:first-child h3::after{content:"NEU";margin-left:8px;padding:1px 6px;border-radius:5px;background:#ff8a1f;color:#16120c;font-size:10px;letter-spacing:.14em;vertical-align:1px}
#changelogPanel ul{margin:0;padding-left:18px}
#changelogPanel li{margin:2px 0;font:500 12.5px/1.38 system-ui,sans-serif;color:#c3ccd4}
#changelogPanel .cl-done{display:block;width:100%;margin-top:10px;padding:12px;border:0;border-radius:10px;background:linear-gradient(180deg,#ffb02e,#ff7a1a);color:#16120c;font:850 15px/1 system-ui,sans-serif;letter-spacing:.24em;cursor:pointer}
#changelogPanel .cl-done:focus-visible,body.pad-input #changelogPanel :focus{outline:3px solid #ffd76a;outline-offset:2px}`;
const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=d=>{const[y,m,dd]=d.split("-");return`${dd}.${m}.${y}`;};
let panel=null;
function open(){if(!panel)return;panel.hidden=false;panel.querySelector(".cl-list").scrollTop=0;panel.querySelector(".cl-done")?.focus({preventScroll:true});}
function close(){if(!panel)return;panel.hidden=true;document.getElementById("gameMenuChangelog")?.focus({preventScroll:true});}
function scroll(dy){panel?.querySelector(".cl-list")?.scrollBy({top:dy,behavior:"smooth"});}
function mount(){
  const menu=document.getElementById("gameMenu"),anchor=document.getElementById("gameMenuWorld")||document.getElementById("gameMenuStart");if(!menu||!anchor)return false;
  if(document.getElementById("gameMenuChangelog"))return true;
  const st=document.createElement("style");st.dataset.changelogMenu=CHANGELOG_MENU_VERSION;st.textContent=CSS;document.head.appendChild(st);
  const btn=document.createElement("button");btn.id="gameMenuChangelog";btn.type="button";btn.textContent="CHANGELOG";anchor.after(btn);
  panel=document.createElement("div");panel.id="changelogPanel";panel.hidden=true;panel.setAttribute("role","dialog");panel.setAttribute("aria-label","Changelog");
  panel.innerHTML=`<div class="cl-card"><h2>CHANGELOG</h2><div class="cl-list" tabindex="-1">${CHANGELOG.map(u=>`<section><h3><span>${fmt(u.date)}</span>${esc(u.title)}</h3><ul>${u.items.map(i=>`<li>${esc(i)}</li>`).join("")}</ul></section>`).join("")}</div><button type="button" class="cl-done">OK</button></div>`;
  menu.appendChild(panel);
  btn.addEventListener("click",e=>{e.preventDefault();open();});
  panel.addEventListener("click",e=>{if(e.target.closest?.(".cl-done")||e.target===panel)close();});
  panel.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();}else if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();scroll(e.key==="ArrowDown"?120:-120);}});
  globalThis.__arondightChangelogMenu={open,close,scroll,get isOpen(){return!panel.hidden;},entries:CHANGELOG};
  return true;
}
function wait(){if(!mount())setTimeout(wait,200);}
if(typeof document!=="undefined"){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wait,{once:true});else wait();}
