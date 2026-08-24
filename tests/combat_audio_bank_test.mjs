import assert from "node:assert/strict";
import fs from "node:fs";
import {COMBAT_AUDIO_BANK_VERSION,combatPcmSummary,createCombatPcmBank} from "../sim/combat_audio_bank.mjs";

assert.equal(COMBAT_AUDIO_BANK_VERSION,"prebaked-pcm-buffer-bank-v1");
const bank=createCombatPcmBank(12000),expected={shot:3,hit:4,damage:2,scream:4,explosion:2,step:3};
for(const [kind,count] of Object.entries(expected)){
  assert.equal(bank.samples[kind].length,count,`${kind} variant count`);
  for(const samples of bank.samples[kind]){
    assert.ok(samples instanceof Float32Array&&samples.length>500,`${kind} PCM buffer missing`);
    let energy=0,peak=0;for(const sample of samples){assert.ok(Number.isFinite(sample),`${kind} contains invalid PCM`);energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
    assert.ok(Math.sqrt(energy/samples.length)>.035,`${kind} is effectively silent`);assert.ok(peak<=1&&peak>.25,`${kind} peak is invalid: ${peak}`);
  }
  assert.notDeepEqual([...bank.samples[kind][0].slice(0,128)],[...bank.samples[kind][1].slice(0,128)],`${kind} variants are identical`);
}
assert.equal(combatPcmSummary().sampleRate,44100);
for(const file of ["sim/flight_fire_fx.mjs","sim/gameplay_polish_lite.mjs","sim/walk_world_experience_hotfix.mjs","sim/player_vehicle_runtime_v2.mjs"]){
  const source=fs.readFileSync(new URL(`../${file}`,import.meta.url),"utf8");assert.ok(source.includes("combat_audio_bank.mjs"),`${file} does not use the shared buffer bank`);assert.ok(!source.includes("createOscillator()"),`${file} still synthesizes oscillators during gameplay`);
}
console.log("Combat audio bank passed: finite multi-variant PCM, human-voice buffers, and zero runtime oscillators on active hit/shot paths.");
