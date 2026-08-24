import assert from "node:assert/strict";
import {WANTED_HEAT_THRESHOLDS,wantedCrimeSeverity,wantedDetectionRadiusM,wantedEscapeDurationMs,wantedLineBlockedByPrisms,wantedPoliceAltitudeOffsetM,wantedPoliceCount,wantedPoliceDamage,wantedPoliceEngageDelayMs,wantedPoliceSpawnRadiusM,wantedSearchState,wantedStarsForHeat} from "../sim/wanted_system_logic.mjs";

assert.deepEqual(WANTED_HEAT_THRESHOLDS,[2,4,7,11,16]);
assert.deepEqual([0,1,2,3,4,6,7,10,11,15,16,99].map(wantedStarsForHeat),[0,0,1,1,2,2,3,3,4,4,5,5]);
assert.equal(wantedCrimeSeverity("person"),2);
assert.equal(wantedCrimeSeverity("car"),1);
assert.equal(wantedCrimeSeverity("bus"),2);
assert.equal(wantedCrimeSeverity("police-drone"),3);
assert.equal(wantedCrimeSeverity("bird"),0);
assert.equal(wantedPoliceCount(5),5);
assert.equal(wantedPoliceCount(9),5);
assert.ok(wantedDetectionRadiusM(5)>wantedDetectionRadiusM(1));
assert.ok(wantedEscapeDurationMs(5)>wantedEscapeDurationMs(1));
assert.deepEqual([1,2,3,4,5].map(wantedPoliceDamage),[4,4,5,5,6]);
assert.ok(wantedPoliceSpawnRadiusM(0)>=58&&wantedPoliceSpawnRadiusM(2)>wantedPoliceSpawnRadiusM(0));
assert.ok(wantedPoliceEngageDelayMs(1)>=2300&&wantedPoliceEngageDelayMs(5)>=1900);
const pursuitAltitudes=Array.from({length:5},(_,index)=>wantedPoliceAltitudeOffsetM(index,"pursuit")),searchAltitudes=Array.from({length:5},(_,index)=>wantedPoliceAltitudeOffsetM(index,"searching"));
assert.ok(Math.min(...pursuitAltitudes)>=0&&Math.max(...pursuitAltitudes)<=.7&&Math.max(...pursuitAltitudes)-Math.min(...pursuitAltitudes)<.7);
assert.equal(new Set(pursuitAltitudes).size,5);
assert.ok(Math.min(...searchAltitudes)>=.3&&Math.max(...searchAltitudes)<=1.1&&searchAltitudes.every((value,index)=>Math.abs(value-pursuitAltitudes[index]-.35)<1e-9));

const building=[{base:0,top:10,points:[[-1,-2],[1,-2],[1,2],[-1,2]]}];
assert.equal(wantedLineBlockedByPrisms({x:-5,y:0,z:2},{x:5,y:0,z:2},building),true);
assert.equal(wantedLineBlockedByPrisms({x:-5,y:0,z:12},{x:5,y:0,z:12},building),false);
assert.equal(wantedLineBlockedByPrisms({x:-5,y:4,z:2},{x:5,y:4,z:2},building),false);

const contact=wantedSearchState({stars:2,seesPlayer:true,now:5000,lastContactAt:1000});
assert.equal(contact.phase,"pursuit");
assert.equal(contact.lastContactAt,5000);
assert.equal(contact.remainingMs,wantedEscapeDurationMs(2));

const searching=wantedSearchState({stars:2,seesPlayer:false,now:9000,lastContactAt:5000});
assert.equal(searching.phase,"searching");
assert.equal(searching.escaped,false);
assert.equal(searching.remainingMs,wantedEscapeDurationMs(2)-4000);

const escaped=wantedSearchState({stars:2,seesPlayer:false,now:5000+wantedEscapeDurationMs(2),lastContactAt:5000});
assert.equal(escaped.phase,"escaped");
assert.equal(escaped.escaped,true);
assert.equal(escaped.remainingMs,0);

console.log("Wanted-system logic passed: heat thresholds, far player-level police formation, fair 4-6 HP damage, inbound grace, searching and escapable pursuit are deterministic.");
