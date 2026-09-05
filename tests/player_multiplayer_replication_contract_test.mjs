import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const replication=readFileSync("sim/vs_player_state_replication.mjs","utf8"),humanRig=readFileSync("sim/player_human_rig.mjs","utf8"),car=readFileSync("sim/player_car_mode.mjs","utf8"),viewmodel=readFileSync("sim/first_person_weapon_runtime_v3.mjs","utf8"),population=readFileSync("sim/world_procedural_population.mjs","utf8");
const network=readFileSync("sim/world_network_physics_sync.mjs","utf8");
const lan=readFileSync("sim/lan_vs.mjs","utf8");
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
  'drone+stationary-human+foot+vehicle-seated+weapon+death-v4'
])assert.ok((replication+humanRig).includes(marker),`missing full player replication marker: ${marker}`);

assert.ok(replication.includes('renderVehicleHuman(record,now)')&&replication.includes('setPlayerHumanVehiclePose(avatar,root'),"remote player is not seated in replicated vehicle");
assert.ok(car.includes('showLocalDriver(vehicle.root)')&&car.includes('free-world-box3d-collision-only-v1'),"local player occupant/free-world vehicle contract missing");
assert.ok(viewmodel.includes('gun.visible=footActive')&&viewmodel.includes('hidden-while-driving-v1'),"first-person arms/viewmodel remain visible while driving");
assert.ok(population.includes('const externallyDriven=Boolean(record.group.userData.playerDriven||record.group.userData.remotePlayerDriven)')&&population.includes('if(!externallyDriven)'),"player-driven cars are still constrained by AI road routing");
assert.ok(network.includes('cm:"vehicle"')&&network.includes('remotePlayerDriven'),"authoritative remote vehicle replication is missing");
assert.ok(network.includes('function locallyOwnsVehicle(id,root=null)')&&network.includes('if(locallyOwnsVehicle(id,root))')&&network.includes('releaseRemote(peerId,"local-player-authority")'),"remote vehicle packets can still overwrite a locally driven Box3D body");
assert.ok(network.includes('vehicleLocalPhysicsAuthority="reject-remote-same-body-v1"')&&network.includes('vsRemoteVehicleRejected="local-player-authority-v1"'),"local vehicle authority rejection telemetry is missing");
assert.ok(multiplayer.includes('type:"shot"')&&multiplayer.includes('registerVsHit'),"multiplayer combat/shot replication is missing");
assert.ok(layout.includes('installVsPlayerStateReplication();'),"player-state replication is not installed after multiplayer");
assert.ok(walk.includes('globalThis.__arondightVehicleDrive?.active'),"walk controller still owns touch while driving");
assert.ok(walk.includes('#footHud,#vehicleHud,#driveModeButton'),"vehicle HUD is not excluded from walk pointer capture");

assert.ok(replication.includes('finiteArray(pose.av,3)')&&replication.includes('humanAnchorPosition(pose)'),"stationary human anchor is not consumed from replicated drone pose");
assert.ok(replication.includes('record.mode==="drone"&&now-record.anchorLastMs<=STALE_MS'),"drone control does not keep the human physical presence alive");
assert.ok(replication.includes('vsRemotePresence=droneAnchor?"stationary-human-while-drone":"active-human"'),"remote human presence telemetry is missing");
assert.ok(replication.includes('if(record.mode!=="drone")hideLegacyPeer(record.id)'),"drone mesh is hidden while stationary human presence is rendered");
assert.ok(humanRig.includes('hitbox.userData.vsCombatHitbox=true')&&replication.includes('avatar.hitbox.visible=!dead'),"stationary multiplayer human is not shootable");
const vehicleRuntime=readFileSync("sim/player_vehicle_runtime_v2.mjs","utf8");
assert.ok(vehicleRuntime.includes('av:canonical')&&vehicleRuntime.includes('vr:mode==="drone"?1:0'),"local stationary human anchor is not transmitted while drone flies");
assert.ok(vehicleRuntime.includes('__arondightVsPlayerStateReplicationV4')&&vehicleRuntime.includes('vsLegacyHumanAvatarsSuppressed'),"legacy duplicate remote human renderer is still active");
assert.ok(network.includes('if(pose.cm==="vehicle"&&pose.cv)')&&network.includes('remotePlayerDriven'),"stationary active vehicles are not continuously retained by remote physics ownership");
assert.ok(lan.includes('clonePosePacket')&&lan.includes('"av","ag","avv"')&&lan.includes('"ph","pv","cv"'),"LAN pose transport still strips rich player/drone replication fields");
assert.ok(walk.includes('viewRay(){return currentViewRay();}')&&walk.includes('walkShotPose="current-presented-camera-v1"'),"walk shooting does not expose and consume the current presented camera pose");
assert.ok(vehicleRuntime.includes('localHumanPoseContract="walk-follow+fps-hidden-v1"')&&vehicleRuntime.includes('walkShotReplicationPose="current-presented-camera-v1"')&&vehicleRuntime.includes('addEventListener("arondight:world-gunshot",onWorldGunshot)')&&vehicleRuntime.includes('addEventListener("arondight:walk-shot-ray",onWalkShotRay)'),"local walk mesh or replicated shot origin is not bound to the current walk pose");

console.log("Player multiplayer replication contract passed: drone plus stationary shootable human presence, foot/vehicle modes, full remote human rig, weapon/death state, remote vehicle replication, and local Box3D vehicle authority are wired.");
