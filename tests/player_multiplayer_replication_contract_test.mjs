import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const replication=readFileSync("sim/vs_player_state_replication.mjs","utf8"),humanRig=readFileSync("sim/player_human_rig.mjs","utf8"),car=readFileSync("sim/player_car_mode.mjs","utf8"),viewmodel=readFileSync("sim/first_person_weapon_runtime_v3.mjs","utf8"),population=readFileSync("sim/world_procedural_population.mjs","utf8");
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
  'drone+foot+vehicle-seated+weapon+death-v3'
])assert.ok((replication+humanRig).includes(marker),`missing full player replication marker: ${marker}`);

assert.ok(replication.includes('renderVehicleHuman(record,now)')&&replication.includes('setPlayerHumanVehiclePose(avatar,root'),"remote player is not seated in replicated vehicle");
assert.ok(car.includes('showLocalDriver(vehicle.root)')&&car.includes('free-world-box3d-collision-only-v1'),"local player occupant/free-world vehicle contract missing");
assert.ok(viewmodel.includes('gun.visible=footActive')&&viewmodel.includes('hidden-while-driving-v1'),"first-person arms/viewmodel remain visible while driving");
assert.ok(population.includes('const externallyDriven=Boolean(record.group.userData.playerDriven||record.group.userData.remotePlayerDriven)')&&population.includes('if(!externallyDriven)'),"player-driven cars are still constrained by AI road routing");
assert.ok(network.includes('cm:"vehicle"')&&network.includes('remotePlayerDriven'),"authoritative remote vehicle replication is missing");
assert.ok(multiplayer.includes('type:"shot"')&&multiplayer.includes('registerVsHit'),"multiplayer combat/shot replication is missing");
assert.ok(layout.includes('installVsPlayerStateReplication();'),"player-state replication is not installed after multiplayer");
assert.ok(walk.includes('globalThis.__arondightVehicleDrive?.active'),"walk controller still owns touch while driving");
assert.ok(walk.includes('#footHud,#vehicleHud,#driveModeButton'),"vehicle HUD is not excluded from walk pointer capture");
console.log("Player multiplayer replication contract passed: drone/foot/vehicle modes, full remote human rig, weapon/death state, vehicle authority and touch ownership are wired.");
