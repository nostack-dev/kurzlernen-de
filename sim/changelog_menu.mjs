// Title screen: NEU / CHANGELOG under WORLD. The most important points of every update, newest
// first. New updates go on top of CHANGELOG (keep each point to one line a player understands).
// Mouse, touch, keyboard (Esc closes) and the pad (pad_actions.mjs: up/down scroll, B closes).
export const CHANGELOG_MENU_VERSION="title-changelog-v1";
export const CHANGELOG=Object.freeze([
  {date:"2026-10-12",title:"Mobile: Raketen-Abschuss und Waffenwahl stabil",items:["GUN, ROCKETS und GUIDED haben jetzt einen eindeutigen Schussweg. Ein Raketenabschuss nutzt zuverlässig die feste Bildschirmrichtung und funktioniert erst nach Waffenwahl und Freigabe."]},
  {date:"2026-10-12",title:"Handy: HUD bleibt außerhalb der Daumen und der Bildmitte",items:["Voice-Knöpfe erscheinen nur im verbundenen Multiplayer und finden am linken oder rechten Bildschirmrand einen freien Platz knapp über den Sticks. Alle Button-Ziele bleiben getrennt; der Moduswechsel hat jetzt Abstand zum linken Stick."]},
  {date:"2026-10-12",title:"Desktop: Schießen während Zielen repariert",items:["Rechte Maustaste zum Zielen gedrückt halten und gleichzeitig mit links schießen funktioniert wieder – zu Fuß und in der Drohne. Auch Fäuste behalten getrennte linke und rechte Schläge."]},
  {date:"2026-10-11",title:"HUD aufgeräumt: Regeln ins Menü, Voice oben",items:["Abstimmungen erscheinen nur noch im WORLD-Menü bzw. der Pause-Menü-Sektion; sie verdecken nicht mehr das Spiel. PTT und Stummschaltung sind runde Symbole oben, außerhalb der Bewegungssticks."]},
  {date:"2026-10-11",title:"Multiplayer: Sprachchat in der Nähe",items:["Halte 🎙 PTT oder V zum Sprechen gedrückt; Mikrofon erst nach Freigabe. Nahe Mitspieler hören dich leiser mit zunehmender Entfernung; MUTE schaltet ab."]},
  {date:"2026-10-11",title:"Multiplayer: RULES-Abstimmung",items:["Änderungen an Friendly Fire brauchen jetzt die Zustimmung aller verbundenen Spieler. Bei NEIN, Zeitablauf oder Spielerwechsel bleibt die bisherige Regel bestehen."]},
  {date:"2026-10-11",title:"Multiplayer: Friendly Fire",items:["Im WORLD-Menü kann der erste Spieler Friendly Fire einschalten oder ausschalten. Ohne Freigabe verletzen Waffen keine Mitspieler."]},
  {date:"2026-10-11",title:"GUIDED: fairer und ausweichbar",items:["Lenkraketen sind langsamer, schwächer und seltener. Lock-on erhält eine sichtbare Warnung; sprintende Fußgänger können die Zielverfolgung abschütteln."]},
  {date:"2026-10-11",title:"NUKE vollständig entfernt",items:["Atomwaffen sind aus Drohne, Raketenwerfer, Menüs und WORLD-Regeln entfernt. Normale Explosionen und Gebäudeschaden bleiben erhalten."]},
  {date:"2026-10-11",title:"Minimap: Double-Tap auch zu Fuß",items:["Die Minimap lässt sich per Doppeltipp jetzt auch zu Fuß und in der First-Person-Ansicht vollständig vergrößern; Auto, Jet und Drohne bleiben unverändert."]},
  {date:"2026-10-11",title:"Multiplayer: Host-Verbindung stabilisiert",items:["Beim Beitreten wird die Host-Reihenfolge nach Aufbau der Verbindung bestätigt; alle Spieler erkennen denselben Host."]},
  {date:"2026-10-11",title:"Multiplayer: Erster Spieler leitet die Runde",items:["Der zuerst beigetretene Spieler behält die Spielleitung – unabhängig von seiner Netzwerk-ID. Beim Verlassen übernimmt der nächste Spieler."]},
  {date:"2026-10-11",title:"Multiplayer: Spawn bei der Spielergruppe",items:["Neue Mitspieler erscheinen bei der groessten aktiven Spielergruppe statt an einer weit entfernten Startposition."]},
  {date:"2026-10-11",title:"Multiplayer: alle Spieler suchen dieselbe Lobby",items:[
    "Die automatische Spielersuche verwendet nun denselben öffentlichen Raum statt unterschiedliche GPS- oder Zeit-Räume.",
  ]},
  {date:"2026-10-11",title:"Live-Prüfung: Gelände, Update und Handy-Steuerung",items:[
    "Die Live-Prüfung testet echte Geländehöhen und prüft den Update-Hinweis nach einer neuen Versionsabfrage zuverlässig.",
    "Handy- und Desktop-Tests prüfen die sichtbaren Waffen und den gedrehten MODE-Knopf in der tatsächlichen Bediengröße.",
  ]},
  {date:"2026-10-11",title:"Terrain: Live-Prüfung der echten Karte",items:["Gelände und Moduswechsel werden zusätzlich direkt auf der veröffentlichten echten Karte geprüft, einschließlich Update-Hinweis für laufende Spiele."]},
  {date:"2026-10-11",title:"Terrain: stabile Höhen beim Nachladen",items:[
    "Unvollständige Höhendaten verbiegen den Boden nicht mehr; Straßen und Bodenkollision folgen gemeinsam der aktuellen Höhe.",
    "Beim Wechsel der Stadt werden verspätete Höhen verworfen. Auch weit entfernte Mitspieler behalten dieselbe Höhenreferenz.",
  ]},
  {date:"2026-10-11",title:"Terrain: Boden erscheint direkt beim Moduswechsel",items:[
    "Der echte Boden wird sofort geladen; Satellitenfarben folgen später, ohne Bodenlöcher oder weiße Flächen beim Umschalten.",
  ]},
  {date:"2026-10-11",title:"Multiplayer: flüssigere Auto- und Jet-Marker",items:[
    "Die Symbole anderer Autos und Jets bewegen sich auf der Karte ruhiger und springen bei einem Fahrzeugwechsel nicht quer über die Straße.",
  ]},
  {date:"2026-10-11",title:"Multiplayer: Mitspieler auch außerhalb der Karte finden",items:[
    "Pfeile am Kartenrand zeigen jetzt in die tatsächliche Richtung des Mitspielers – nicht immer nach Nordost.",
  ]},
  {date:"2026-10-11",title:"AR: Wegpfeile bleiben beim Umschauen auf der Strecke",items:[
    "Die 3D-Wegpfeile folgen jetzt jeder Kamerabewegung, während die Straßenroute sparsam berechnet wird.",
  ]},
  {date:"2026-10-11",title:"AR: sichere Routensuche und Abbiegehinweise",items:[
    "Beim Wechsel des Ziels oder Fahrmodus überschreibt keine verspätete Routenantwort die neue Strecke.",
    "Die Navigation kündigt Links- und Rechtskurven an, ohne jeden kleinen Straßenknick als Abzweigung zu behandeln.",
  ]},
  {date:"2026-10-11",title:"AR: Wegpfeile entlang der echten Straßen",items:[
    "Beim Gehen und Fahren zeigen mehrere Pfeile entlang der berechneten Strecke den Weg.",
    "Drohne und Jet bleiben bei der direkten Zielführung; die Mobile- und Desktop-Tests wurden an den neuen Bedienungsaufbau angepasst.",
  ]},
  {date:"2026-10-11",title:"Multiplayer: zwei Spieler in einem Jet",items:[
    "Ein Spieler fliegt als Pilot, ein zweiter kann als Passagier mitfliegen; die Sitzplätze werden innerhalb der Mehrspieler-Runde abgestimmt.",
    "Alle Mitspieler erscheinen auf der großen Karte; die Passagierfigur wird auch im Flug am Jet angezeigt.",
  ]},
  {date:"2026-10-11",title:"Multiplayer: Jet bleibt stehen, Mitspieler auf der Minimap",items:[
    "Geparkte Jets springen nicht mehr ständig zur Seite, wenn man einsteigen will.",
    "Alle verbundenen Spieler werden auf der Minimap mit Position und Blickrichtung angezeigt.",
  ]},
  {date:"2026-10-10",title:"Flüssiger im Jet und bei hohem Tempo",items:[
    "Häuser-Kollisionen werden beim schnellen Fliegen und Fahren nicht mehr komplett neu gebaut: unveränderte Häuser behalten ihre Physik, nur neue kommen dazu (vorher alle paar hundert Millisekunden alles, in drei Physik-Welten).",
    "Grundrisse werden nur einmal trianguliert; Bäume werden während des Jetflugs nicht ständig neu verteilt.",
    "Live-Anzeigen (Jet-HUD, Navigation) lösen keine Neu-Scans der Oberfläche mehr aus – vorher liefen mehrere DOM-Beobachter pro Bild.",
    "EXIT und MULTI überlappen am PC nicht mehr.",
  ]},
  {date:"2026-10-10",title:"Vollbild-Karte mit Zielsuche, einheitliche Bedienung, Jet-HUD",items:[
    "Vollbild-Karte wie in GTA: Minimap doppelt antippen, M oder VIEW gedrückt halten (Xbox). Ziehen, zoomen, tippen = Wegpunkt; ✕ / M / Esc / Ⓑ schließt.",
    "Ziel suchen: Adresse eintippen (z. B. „Dorfstraße 8, Kirchberg an der Jagst“) – Route über Straßen (zu Fuß über Fußwege), dezenter Richtungspfeil am Horizont und eine Zeile mit Entfernung. Ohne Ziel wird nichts angezeigt.",
    "Überall gleich: EXIT oben links (mit Nachfrage), MULTI direkt daneben. Der Modus-Knopf sitzt unten links am Daumen und zeigt, wohin er wechselt: TO DRONE, GO ON FOOT, EJECT.",
    "Jet: grünes, dezentes HUD – Stadtname mit Linie zum Stadtzentrum, Geschwindigkeit links, Höhe rechts, Flugbahnmarke. Auf Touch schießt die Kanone dorthin, wo du tippst.",
    "Jets stehen nicht mehr in Häusern: der Abstellplatz braucht freien Platz für Flügel und Heck und rückt nach, wenn Häuser nachladen.",
    "Zielfernrohr: feineres Absehen mit Vergrößerungsanzeige; Einschläge, Splitter und Blut bleiben auch auf große Entfernung sichtbar.",
    "Bäume stehen nicht mehr in Häusern oder auf der Fahrbahn.",
    "Schnellerer Start: die Umgebungsbeleuchtung braucht den schweren Himmels-Shader nicht mehr.",
  ]},
  {date:"2026-10-10",title:"Polizei rückt aus, echte Sirenen",items:[
    "Randale zu Fuß ruft die Polizei: Schüsse in der Nähe von Leuten, Faustschläge und Messerstiche bringen Sterne – Streifenwagen und Polizeidrohnen kommen.",
    "Streifenwagen lassen sich zerschießen: sie qualmen, brennen und explodieren.",
    "Echte Sirenen: Streifenwagen mit deutschem Martinshorn (Tatütata), Polizeidrohnen mit leisem elektronischem Heulton – räumlich, mit Doppler, dezent im Mix.",
  ]},
  {date:"2026-10-10",title:"Steuerung wie CoD, schlauere Fahrer und Passanten",items:[
    "Zielen wie in Call of Duty: Mobile-Daumen 1:1 ohne Totzone und schneller, PC-Maus roh ohne Beschleunigung, Xbox mit „Dynamic“-Kurve.",
    "Ein Glock-Schuss sprengt kein Auto mehr; keine Kettenexplosionen die Straße runter.",
    "Zombies und Passanten in deiner Nähe sind keine grauen Blöcke mehr.",
    "Fahrer halten Abstand, bremsen vor Kurven, hupen seltener. Gerammt oder beschossen: Panik (Rückwärtsgang, Vollgas weg), Angriff (versuchen dich zu überfahren) oder Wutbürger steigt aus – manchmal mit Messer oder Pistole.",
    "Passanten hören jeden Schuss in der Nähe, sprinten erst los, laufen nicht mehr durch Wände, prügeln sich manchmal untereinander und flüchten vor tief fliegenden Drohnen und Jets.",
    "Fäuste treffen zuverlässig (auch Hunde, Katzen, Kühe), Tiere fliegen nicht mehr übers Eis und stehen wieder auf; die schwarze Katze lebt nach ihrem Angriff weiter.",
    "Neue, rundere Fäuste.",
  ]},
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
    "Raketen im Flug und Leuchtspur werfen echtes Licht; Asphalt hat Flicken und Körnung statt einer Einheitsfarbe.",
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
