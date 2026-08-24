import assert from "node:assert/strict";
import {DRONE_MAX_HP,DRONE_REPLACEMENT_COOLDOWN_MS,PLAYER_MAX_HP,droneReplacementRemainingMs,firstPersonDeathFall,healthAfterDamage,radialStickAxes} from "../sim/player_vitals_logic.mjs";

assert.equal(PLAYER_MAX_HP,100);
assert.equal(DRONE_MAX_HP,100);
assert.equal(DRONE_REPLACEMENT_COOLDOWN_MS,8000);
assert.equal(healthAfterDamage(100,6),94);
assert.equal(healthAfterDamage(4,6),0);
assert.equal(healthAfterDamage(72,-5),72);
assert.equal(droneReplacementRemainingMs({destroyed:true,readyAt:9000,now:2500}),6500);
assert.equal(droneReplacementRemainingMs({destroyed:false,readyAt:9000,now:2500}),0);

const half=radialStickAxes(50,0,100),outsideCardinal=radialStickAxes(240,0,100),outsideDiagonal=radialStickAxes(240,240,100);
assert.deepEqual(half,{x:.5,y:0,magnitude:.5});
assert.ok(Math.abs(outsideCardinal.x-1)<1e-12&&outsideCardinal.y===0&&outsideCardinal.magnitude===1,"cardinal travel beyond the ring must remain at full input");
assert.ok(Math.abs(Math.hypot(outsideDiagonal.x,outsideDiagonal.y)-1)<1e-12&&outsideDiagonal.magnitude===1,"diagonal travel must project onto the same radial limit");

const start=firstPersonDeathFall(0),mid=firstPersonDeathFall(450),end=firstPersonDeathFall(900);
assert.equal(start.eyeHeightM,1.68);assert.equal(start.rollRad,0);
assert.ok(mid.eyeHeightM<1.2&&mid.rollRad>0,"death fall must visibly lower and roll the camera before settling");
assert.ok(Math.abs(end.eyeHeightM-.24)<1e-12&&Math.abs(end.rollRad-1.48)<1e-12);

console.log("Player vitals passed: pilot/drone HP are independent, replacement cooldown is deterministic, death falls, and the left stick reaches its full radial range.");
