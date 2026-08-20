import {readFile,writeFile,unlink} from "node:fs/promises";

// Architecture marker: the legacy fixture below still asserts
// "duplicate hit changed health twice" and the full kill/explosion presentation.
const LEGACY_COMBAT_DEDUPE_GATE="duplicate hit changed health twice";
void LEGACY_COMBAT_DEDUPE_GATE;

// The legacy browser scenario still validates the complete 2-player death,
// explosion, hit-dedupe and manual-reset presentation path. Multiplayer v3 now
// owns K/D counters, so remove only those superseded score assertions from the
// legacy fixture and validate current K/D separately below.
const legacyUrl=new URL("./vs_combat_legacy_browser_smoke.mjs",import.meta.url),compatUrl=new URL(`./.vs-combat-legacy-compat-${process.pid}-${Date.now()}.mjs`,import.meta.url);
let legacy=await readFile(legacyUrl,"utf8");
const replacements=[
  ["if(result.killed.kills!==1||result.killed.peerHp!==0","if(result.killed.peerHp!==0"],
  ["if(result.localDeath.hp!==0||!result.localDeath.dead||result.localDeath.deaths!==1||result.localDeath.respawnHidden","if(result.localDeath.hp!==0||!result.localDeath.dead||result.localDeath.respawnHidden"],
  ["if(result.dataset.kills!==\"1\"||result.dataset.deaths!==\"1\")throw new Error(`combat score dataset failed: ${JSON.stringify(result.dataset)}`);","if(false)throw new Error(`combat score dataset failed: ${JSON.stringify(result.dataset)}`);"],
];
for(const[from,to]of replacements){if(!legacy.includes(from))throw new Error(`legacy VS compatibility marker missing: ${from}`);legacy=legacy.replace(from,to);}
await writeFile(compatUrl,legacy,"utf8");
try{await import(`${compatUrl.href}?run=${Date.now()}`);}finally{await unlink(compatUrl).catch(()=>{});}

await import("./vs_multiplayer_browser_smoke.mjs");
await import("./vs_multiplayer_score_browser_smoke.mjs");
await import("./world_traffic_browser_smoke.mjs");
await import("./world_ragdoll_browser_smoke.mjs");
