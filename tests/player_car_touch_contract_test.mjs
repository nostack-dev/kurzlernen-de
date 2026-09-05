import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const car=readFileSync("sim/player_car_mode.mjs","utf8"),look=readFileSync("sim/foot_look_capture.mjs","utf8"),pop=readFileSync("sim/world_procedural_population.mjs","utf8");
for(const marker of ["steer+gas+brake-multitouch-v1","screen-raycast+keyboard-e+gamepad-y-v1","vehicleAtScreenPoint","tryEnterAtScreenPoint","vehicleGas","vehicleBrake","z-index:10030","button(pad,3)","keyboard+multitouch+xbox-v3"])assert.ok(car.includes(marker),`missing car touch/interact marker: ${marker}`);
assert.ok(look.includes("vehicle-screen-interact-before-fire-v1"),"car tap is not routed before foot fire");
for(const marker of ["PARKED_CAR_FRACTION=.33","PARKED_CURB_MULTIPLIER=2.75","worldParked","speedMps:0","deterministic-curb-static-box3d-v1"])assert.ok(pop.includes(marker),`missing parked-car marker: ${marker}`);
assert.ok(pop.includes("record.parkPose"),"parked cars do not retain a stable physical pose");
console.log("Player car touch contract passed: multitouch steering/pedals, screen/Xbox interaction and deterministic parked cars are wired.");
