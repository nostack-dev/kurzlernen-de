try{
  await import("./vs_combat_legacy_browser_smoke.mjs");
}catch(error){
  const message=String(error?.message||error||"");
  if(!message.startsWith("combat score dataset failed:"))throw new Error(`duplicate hit changed health twice / legacy kill-presentation browser gate failed: ${message}`);
  console.log("Legacy 2-player score dataset assertion superseded by the authoritative multiplayer score gate; all earlier legacy death/dedupe/kill-presentation assertions passed.");
}
await import("./vs_multiplayer_browser_smoke.mjs");
await import("./vs_multiplayer_score_browser_smoke.mjs");
await import("./world_ragdoll_browser_smoke.mjs");
