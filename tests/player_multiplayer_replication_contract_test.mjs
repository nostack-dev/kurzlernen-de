import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const replication=readFileSync("sim/vs_player_state_replication.mjs","utf8");
const network=readFileSync("sim/world_network_physics_sync.mjs","utf8");
const multiplayer=readFileSync("sim/vs_multiplayer.mjs","utf8");
const layout=readFileSync("sim/solo_layout.mjs","utf8");
const walk=readFileSync("sim/player_walk_mode_v4.mjs","utf8");

for(const marker of [
  'pm:mode',
  'pm:"drone"',
  'weapon:localWeapon()',
  'dead:localDead()',
  'VS_HUMAN_TORSO',
  'VS_HUMAN_HEAD',
  'VS_HUMAN_ARM_L',
  'VS_HUMAN_ARM_R',
  'VS_HUMAN_LEG_L',
  'VS_HUMAN_LEG_R',
  'VS_HUMAN_HITBOX',
  'vsHumanHitbox=true',
  'record.mode==="vehicle"',
  'hideLegacyPeer(record.id)',
  'drone+foot+vehicle+weapon+death-v2'
])assert.ok(replication.includes(marker),`missing full player replication marker: ${marker}`);

assert.ok(network.includes('cm:"vehicle"')&&network.includes('remotePlayerDriven'),"authoritative remote vehicle replication is missing");
assert.ok(multiplayer.includes('type:"shot"')&&multiplayer.includes('registerVsHit'),"multiplayer combat/shot replication is missing");
assert.ok(layout.includes('installVsPlayerStateReplication();'),"player-state replication is not installed after multiplayer");
assert.ok(walk.includes('globalThis.__arondightVehicleDrive?.active'),"walk controller still owns touch while driving");
assert.ok(walk.includes('#footHud,#vehicleHud,#driveModeButton'),"vehicle HUD is not excluded from walk pointer capture");
console.log("Player multiplayer replication contract passed: drone/foot/vehicle modes, full remote human rig, weapon/death state, vehicle authority and touch ownership are wired.");
