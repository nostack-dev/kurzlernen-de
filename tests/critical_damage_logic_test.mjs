import assert from "node:assert/strict";
import {accelerateCriticalDetonation,criticalDamageProfile,criticalDetonationAt,isCriticalDamage} from "../sim/critical_damage_logic.mjs";

assert.equal(isCriticalDamage("car",37,180),false);
assert.equal(isCriticalDamage("car",36,180),true);
assert.equal(isCriticalDamage("bus",64,320),true);
assert.equal(isCriticalDamage("police-drone",34,100),true);
assert.equal(isCriticalDamage("person",1,100),false);
assert.equal(criticalDetonationAt("car",1000),3450);
assert.equal(accelerateCriticalDetonation("car",3450,1200),1820);
assert.equal(accelerateCriticalDetonation("car",1500,1200),1500);
assert.ok(criticalDamageProfile("bus").delayMs>criticalDamageProfile("car").delayMs);

console.log("Critical-damage contract passed: vehicles and police drones enter a readable smoke countdown, with further damage shortening rather than skipping the warning.");
