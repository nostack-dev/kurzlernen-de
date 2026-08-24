import assert from "node:assert/strict";
import {DRONE_CAMERA_MODES,PlayerCameraModePolicy,WALK_CAMERA_MODE,normalizeDroneCameraMode} from "../sim/player_camera_mode_policy.mjs";

assert.deepEqual(DRONE_CAMERA_MODES,["follow","third","fpv"]);
assert.equal(normalizeDroneCameraMode("invalid"),"follow");

const policy=new PlayerCameraModePolicy({dronePreference:"fpv",playerMode:"drone"});
assert.deepEqual(policy.snapshot(),{playerMode:"drone",dronePreference:"fpv",effectiveMode:"fpv"});

policy.setPlayerMode("foot");
assert.equal(WALK_CAMERA_MODE,"walk");
assert.deepEqual(policy.snapshot(),{playerMode:"foot",dronePreference:"fpv",effectiveMode:"walk"});

policy.setDronePreference("third");
assert.deepEqual(policy.snapshot(),{playerMode:"foot",dronePreference:"third",effectiveMode:"walk"});

policy.setPlayerMode("drone");
assert.deepEqual(policy.snapshot(),{playerMode:"drone",dronePreference:"third",effectiveMode:"third"});

policy.cycleDronePreference();
assert.deepEqual(policy.snapshot(),{playerMode:"drone",dronePreference:"fpv",effectiveMode:"fpv"});

console.log("Player camera mode policy tests passed: WALK is a first-class eye-origin camera while drone preference remains independent.");
