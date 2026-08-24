import assert from "node:assert/strict";
import {GAMEPLAY_COMBO_WINDOW_MS,GAMEPLAY_FUN_VERSION,GAMEPLAY_MOMENTUM_TARGET,createGameplayState,gameplayContract,gameplayMultiplier,gameplayPoliceDamageScale,reduceGameplay} from "../sim/gameplay_fun_logic.mjs";

let state=createGameplayState();
assert.equal(GAMEPLAY_FUN_VERSION,"skill-risk-bank-contracts-v1");
assert.equal(gameplayContract(state).id,"hot-escape");

let result=reduceGameplay(state,{type:"worldKill",kind:"car",stars:1,now:1000});state=result.state;
assert.equal(state.atRisk,190);assert.equal(state.combo,1);assert.equal(state.momentum,1);assert.equal(state.contractProgress,0);assert.equal(gameplayMultiplier(state,{stars:1,now:1000}),1.25);

result=reduceGameplay(state,{type:"escape",stars:2,now:2200});state=result.state;
assert.equal(state.atRisk,0);assert.equal(state.score,1430);assert.equal(state.contractComplete,true);assert.equal(state.contractsCompleted,1);assert.ok(result.effects.some(effect=>effect.type==="bank"&&effect.points===630));assert.ok(result.effects.some(effect=>effect.type==="contractComplete"&&effect.reward===800));

state=reduceGameplay(state,{type:"advanceContract",now:4600}).state;assert.equal(gameplayContract(state).id,"drone-hunter");assert.equal(state.contractComplete,false);
state=reduceGameplay(state,{type:"policeKill",stars:3,now:5000}).state;result=reduceGameplay(state,{type:"policeKill",stars:3,now:6100});state=result.state;
assert.equal(state.contractComplete,true);assert.equal(state.contractProgress,2);assert.equal(state.momentum,1);assert.ok(state.overdriveUntil>=14100);assert.ok(result.effects.some(effect=>effect.type==="overdrive"));assert.ok(gameplayMultiplier(state,{stars:3,now:6200})>3);

const comboBefore=state.combo;state=reduceGameplay(state,{type:"damage",amount:12,stars:3,now:6400}).state;assert.ok(comboBefore>=2);assert.equal(state.combo,0);assert.equal(state.runDamage,12);
const riskBeforeDrone=state.atRisk;state=reduceGameplay(state,{type:"droneDestroyed",now:7000}).state;assert.equal(state.mercy,1);assert.equal(gameplayPoliceDamageScale(state),.88);assert.ok(state.atRisk<riskBeforeDrone&&state.atRisk>=riskBeforeDrone*.75);
const riskBeforeDeath=state.atRisk,scoreBeforeDeath=state.score;result=reduceGameplay(state,{type:"playerDeath",now:7500});state=result.state;assert.equal(state.mercy,2);assert.equal(gameplayPoliceDamageScale(state),.76);assert.equal(state.atRisk,0);assert.equal(state.score,scoreBeforeDeath+Math.round(riskBeforeDeath*.5/10)*10);assert.ok(result.effects.some(effect=>effect.type==="insurance"));

state=reduceGameplay(state,{type:"escape",stars:2,now:9000}).state;assert.equal(state.mercy,1,"a successful escape should ease comeback assistance toward baseline");
state=reduceGameplay(state,{type:"cycleContract",now:9100}).state;assert.equal(gameplayContract(state).id,"emp-chain");
state=reduceGameplay(state,{type:"emp",affected:2,stars:2,now:9200}).state;assert.equal(state.contractProgress,2);assert.ok(state.atRisk>0);
state=reduceGameplay(state,{type:"tick",stars:2,now:9200+GAMEPLAY_COMBO_WINDOW_MS+1}).state;assert.equal(state.combo,0,"combo must expire on wall-clock time");
const scoreBeforeReset=state.score;state=reduceGameplay(state,{type:"reset",now:16000}).state;assert.equal(state.score,scoreBeforeReset,"SIM reset keeps already banked skill score");assert.equal(state.atRisk,0);assert.equal(state.momentum,0);assert.equal(GAMEPLAY_MOMENTUM_TARGET,4);

console.log("Gameplay fun loop passed: contracts, transparent momentum, risk/bank decisions, combos, overdrive, insurance and comeback-only difficulty are deterministic.");
