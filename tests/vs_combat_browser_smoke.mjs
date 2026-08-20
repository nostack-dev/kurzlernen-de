try{
  await import("./vs_combat_legacy_browser_smoke.mjs");
}catch(error){
  throw new Error(`duplicate hit changed health twice / legacy kill-presentation browser gate failed: ${error?.message||error}`);
}
await import("./vs_multiplayer_browser_smoke.mjs");
