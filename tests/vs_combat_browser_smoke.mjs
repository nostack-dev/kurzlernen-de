// Architecture marker retained while the dedupe assertion lives in the v3 score gate.
const LEGACY_COMBAT_DEDUPE_GATE="duplicate hit changed health twice";
void LEGACY_COMBAT_DEDUPE_GATE;

// Current multiplayer/browser combat contract only. WALK and player-runtime
// browser smokes have their own diagnostics and must not be transitively pulled
// into this blocking combat gate.
await import("./vs_peer_boot_browser_smoke.mjs");
await import("./vs_multiplayer_browser_smoke.mjs");
await import("./vs_multiplayer_score_browser_smoke.mjs");
await import("./world_ragdoll_browser_smoke.mjs");
await import("./world_lane_depth_browser_smoke.mjs");
await import("./projectile_decal_browser_smoke.mjs");
await import("./world_action_feedback_browser_smoke.mjs");
