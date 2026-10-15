// Collects the in-game suggestions (Nostr kind 30078, tag t=spawncity-suggestion, before the rename t=rush-suggestion) from public relays and
// writes artifacts/suggestions/{suggestions.json,README.md}: every note once, newest first, per build,
// plus the most frequent words — the aggregate across all players. Run by .github/workflows/suggestions.yml.
import {SimplePool} from "nostr-tools/pool";
import {verifyEvent} from "nostr-tools/pure";
import {mkdirSync,writeFileSync} from "node:fs";
const RELAYS=["wss://relay.damus.io","wss://nos.lol","wss://relay.primal.net","wss://relay-rpi.edufeed.org"];
const since=Math.floor(Date.now()/1000)-120*86400;
const pool=new SimplePool();
let events=[];
try{events=await Promise.race([pool.querySync(RELAYS,{kinds:[30078],"#t":["spawncity-suggestion","rush-suggestion"],since,limit:5000}),new Promise(r=>setTimeout(()=>r([]),25000))]);}catch(e){console.warn("query failed",e);}
try{pool.close(RELAYS);}catch{}
const seen=new Set(),rows=[];
for(const ev of events){if(!ev||seen.has(ev.id)||!verifyEvent(ev))continue;seen.add(ev.id);let c={};try{c=JSON.parse(ev.content||"{}");}catch{}const text=String(c.text||"").replace(/\s+/g," ").trim().slice(0,240);if((c.app!=="spawncity"&&c.app!=="rush")||text.length<3)continue;
  rows.push({at:new Date(ev.created_at*1000).toISOString(),build:String(c.build||ev.tags.find(t=>t[0]==="v")?.[1]||"?").slice(0,12),lang:String(c.lang||""),device:String(c.ua||""),text});}
rows.sort((a,b)=>b.at.localeCompare(a.at));
// duplicates from the same text (case/space-insensitive) are counted, not repeated
const groups=new Map();for(const r of rows){const k=r.text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu,"").trim();const g=groups.get(k)||{text:r.text,count:0,last:r.at,builds:new Set()};g.count++;g.builds.add(r.build);if(r.at>g.last)g.last=r.at;groups.set(k,g);}
const STOP=new Set("der die das und oder ein eine einen mit für von zu im in ist es ich du wir man nicht mehr auch auf am an als dass wenn bei bitte mal noch sehr so wie was the and a to of is it be".split(" "));
const words=new Map();for(const r of rows)for(const w of r.text.toLowerCase().match(/\p{L}{4,}/gu)||[])if(!STOP.has(w))words.set(w,(words.get(w)||0)+1);
const top=[...words].sort((a,b)=>b[1]-a[1]).slice(0,30);
mkdirSync("artifacts/suggestions",{recursive:true});
writeFileSync("artifacts/suggestions/suggestions.json",JSON.stringify({collectedAt:new Date().toISOString(),relays:RELAYS,count:rows.length,rows},null,1));
const md=[`# SpawnCity – Spieler-Vorschläge`,``,`Stand ${new Date().toISOString()} · ${rows.length} Vorschläge · ${groups.size} verschiedene`,``,`## Häufigste Begriffe`,top.map(([w,n])=>`${w} (${n})`).join(" · ")||"–",``,`## Alle (gleiche zusammengefasst, neueste zuerst)`,
  ...[...groups.values()].sort((a,b)=>b.count-a.count||b.last.localeCompare(a.last)).map(g=>`- ${g.count>1?`**${g.count}×** `:""}${g.text} _(${g.last.slice(0,10)}, ${[...g.builds].join(", ")})_`)].join("\n");
writeFileSync("artifacts/suggestions/README.md",md+"\n");
console.log(`collected ${rows.length} suggestions (${groups.size} distinct)`);
process.exit(0);
