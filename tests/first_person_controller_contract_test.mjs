import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";

const controller=readFileSync("sim/first_person_controller_v5.mjs","utf8");
const bootstrap=readFileSync("sim/real_world_bootstrap.mjs","utf8");
const runtime=readFileSync("sim/gameplay_final_runtime_v2.mjs","utf8");
const v3=readFileSync("sim/first_person_weapon_runtime_v3.mjs","utf8");
const input=readFileSync("sim/flight_first_cleanup.mjs","utf8");
const chain=readFileSync("sim/immersive_soundscape.mjs","utf8");

// Touch rays must come from the camera exactly as presented, not from a
// camera rebuilt out of walk state (that ignored bob, smoothing, roll, FOV).
for(const marker of["snapshotPresentedCamera(camera)","raycaster.setFromCamera(ndc,presented)","b.addPreRenderHook(beforeRender)"])assert.ok(controller.includes(marker),`controller missing: ${marker}`);
assert.ok(bootstrap.includes("this.runPreRenderHooks(scene,camera);renderer.render(scene,camera)"),"pre-render hook must run immediately before the real-world render");
assert.ok(bootstrap.includes("if(!this.active){this.runPreRenderHooks(scene,camera);renderer.render(scene,camera)"),"pre-render hook must run before the training-world foot render");
assert.ok(runtime.includes("__arondightFirstPersonController?.screenRay?.(clientX,clientY)"),"foot shots must use the presented-camera ray");

// Weapon: grip-anchored, sight line aimed at the target, follows the drag.
for(const marker of["alignSights(gun,hands[0].aim)","WALK_VM_REAR_SIGHT","WALK_VM_FRONT_SIGHT","WALK_SMG_REAR_SIGHT","WALK_SMG_FRONT_SIGHT","gun.position.add(","\"crosshair-rest\"","\"touch-drag\""])assert.ok(controller.includes(marker),`weapon aim missing: ${marker}`);
assert.ok(input.includes('"arondight:foot-aim",{detail:{clientX:entry.x,clientY:entry.y,phase:"move"}}'),"drag must stream the touch point to the aim controller");
assert.ok(input.includes('phase:"end"'),"touch release must end drag aiming");
assert.ok(!v3.includes("alignGunToShot(gun,now);else"),"legacy v3 alignment still competes with the controller");
assert.ok(!existsSync("sim/first_person_weapon_anchor_v4.mjs")&&!chain.includes("first_person_weapon_anchor_v4"),"legacy anchor v4 still loaded");
assert.ok(chain.includes('import "./first_person_controller_v5.mjs";'),"controller not loaded");
console.log("First-person controller v5 contract passed: presented-camera rays, grip-anchored sight alignment, live drag aim.");
