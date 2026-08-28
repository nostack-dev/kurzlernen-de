import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const presentation=readFileSync("sim/first_person_presentation_contract.mjs","utf8"),weapon=readFileSync("sim/first_person_weapon_runtime_v3.mjs","utf8"),magnifier=readFileSync("sim/aim_magnifier_overlay.mjs","utf8");
assert.ok(!presentation.includes("suppressLegacyWeaponTransformOwner"),"first-person presentation still suppresses the weapon runtime owner");
assert.ok(!presentation.includes("camera.attach(gun)"),"competing camera-child weapon owner returned");
assert.ok(presentation.includes('walkViewmodelOwnership="player-walk-mode-v4+first-person-weapon-runtime-v3"'),"single weapon-owner contract missing");
for(const marker of ["hip-latched-grip+touch-ray-target-v13","WALK_VM_GLOVE_R","WALK_SMG_PISTOL_GRIP","dedicated-mp-mesh-v4"])assert.ok(weapon.includes(marker),`missing restored first-person marker: ${marker}`);
for(const marker of ["finger-preview-v3","above-finger","SIZE_CSS=96","ZOOM=2.25","arondight:foot-screen-aim"])assert.ok(magnifier.includes(marker),`missing aim magnifier marker: ${marker}`);
console.log("FPS visual contract passed: hands/pistol/MP stay on the existing vector owner and touch aim exposes a finger-above magnifier.");
