import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const nuke=readFileSync("sim/nuke_weapon.mjs","utf8");
const cleanup=readFileSync("sim/flight_first_cleanup.mjs","utf8");
const mobile=readFileSync("sim/mobile_gameplay_ui.mjs","utf8");

for(const marker of [
  'const BLAST_RADIUS_M=65',
  'const COOLDOWN_MS=4500',
  '"gun","missile","nuke"',
  'displayMode==="gun"?"missile":displayMode==="missile"?"nuke":"gun"',
  'api.fireNuke=fireNuke',
  'api.fireMissile=args=>displayMode==="nuke"?fireNuke(args)',
  'kind:"nuke"',
  'flash-fireball-shockwave-mushroom-v1',
  'drone-targeted-fixed-impact-v1'
]) assert.ok(nuke.includes(marker),`missing nuke contract marker: ${marker}`);

assert.ok(cleanup.includes('import "./nuke_weapon.mjs";'),"nuke runtime is not wired into flight-first cleanup");
assert.ok(mobile.includes('api?.displayMode||api?.mode'),"mobile HUD does not expose extended drone weapon mode");

console.log("Nuke weapon contract passed: third drone weapon, shared fire path, fixed impact and staged mushroom-cloud effect.");
