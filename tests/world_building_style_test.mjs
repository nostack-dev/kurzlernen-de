import assert from 'node:assert/strict';
import {buildingAppearanceProfile} from '../sim/world_building_style.mjs';
const brick=buildingAppearanceProfile({key:'a',base:0,top:12,properties:{'building:material':'brick','building:levels':4}});assert.equal(brick.material,'brick');assert.equal(brick.levels,4);
const office=buildingAppearanceProfile({key:'office-42',base:0,top:30,properties:{building:'office'}});assert.ok(['glass','concrete'].includes(office.material));assert.ok(office.windowRows>=2);
const repeat=buildingAppearanceProfile({key:'office-42',base:0,top:30,properties:{building:'office'}});assert.deepEqual(repeat,office);
console.log(`WORLD building style passed: ${brick.material}, ${office.material}.`);
