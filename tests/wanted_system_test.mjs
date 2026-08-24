import assert from "node:assert/strict";
import {WANTED_EMP_COOLDOWN_MS,WANTED_EMP_RANGE_M,WANTED_HEAT_THRESHOLDS,WANTED_POLICE_MAX_FIRE_RANGE_M,wantedCrimeSeverity,wantedDetectionRadiusM,wantedEmpImpulseNs,wantedEscapeDurationMs,wantedLineBlockedByPrisms,wantedPoliceAltitudeOffsetM,wantedPoliceArrivalDelayMs,wantedPoliceCount,wantedPoliceDamage,wantedPoliceEngageDelayMs,wantedPoliceFireRangeM,wantedPoliceHitChance,wantedPoliceShotIntervalMs,wantedPoliceSpawnRadiusM,wantedPoliceWaveBreakMs,wantedSearchState,wantedStarsForHeat} from "../sim/wanted_system_logic.mjs";

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
assert.ok(wantedEscapeDurationMs(1)<=7000&&wantedEscapeDurationMs(5)<=10500);
assert.deepEqual([1,2,3,4,5].map(wantedPoliceDamage),[4,4,5,5,6]);
assert.ok(wantedPoliceSpawnRadiusM(0)>=58&&wantedPoliceSpawnRadiusM(2)>wantedPoliceSpawnRadiusM(0));
assert.ok(wantedPoliceArrivalDelayMs(1)>=3500&&wantedPoliceArrivalDelayMs(1)<=4000&&wantedPoliceArrivalDelayMs(5)>=3000&&wantedPoliceArrivalDelayMs(5)<wantedPoliceArrivalDelayMs(1));
assert.ok(wantedPoliceEngageDelayMs(1)>=3000&&wantedPoliceEngageDelayMs(5)>=2500);
assert.ok(wantedPoliceWaveBreakMs(1)>wantedPoliceWaveBreakMs(5)&&wantedPoliceWaveBreakMs(5)>=4000);
assert.equal(WANTED_POLICE_MAX_FIRE_RANGE_M,35);
assert.ok(wantedPoliceFireRangeM(1)>=28&&wantedPoliceFireRangeM(1)<wantedPoliceFireRangeM(5)&&wantedPoliceFireRangeM(5)<=WANTED_POLICE_MAX_FIRE_RANGE_M);
assert.ok(wantedPoliceShotIntervalMs(1)>wantedPoliceShotIntervalMs(5)&&wantedPoliceShotIntervalMs(5)>=1800);
const stationaryChance=wantedPoliceHitChance({stars:2,distanceM:18,playerSpeedMps:0}),movingChance=wantedPoliceHitChance({stars:2,distanceM:18,playerSpeedMps:7.2}),farChance=wantedPoliceHitChance({stars:2,distanceM:34,playerSpeedMps:0});
assert.ok(stationaryChance<.68&&stationaryChance>.3&&movingChance<stationaryChance&&farChance<stationaryChance&&movingChance>=.2);
assert.equal(WANTED_EMP_RANGE_M,30);
assert.equal(WANTED_EMP_COOLDOWN_MS,18000);
assert.ok(wantedEmpImpulseNs(0)>wantedEmpImpulseNs(15)&&wantedEmpImpulseNs(15)>wantedEmpImpulseNs(30)&&wantedEmpImpulseNs(30)>0);
assert.equal(wantedEmpImpulseNs(30.01),0);
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

console.log("Wanted-system logic passed: dispatch delay, hard fire range, 30 m EMP, staggered altitude, wave breaks, imperfect movement-aware accuracy and escape are deterministic.");