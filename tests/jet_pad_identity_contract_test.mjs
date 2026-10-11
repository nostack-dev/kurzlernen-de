import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const file=readFileSync(new URL("../sim/jet_mode.mjs",import.meta.url),"utf8");
const start=file.indexOf("function relocatePadJets(now)");
const end=file.indexOf("function padFrame(now)",start);
assert.ok(start>0&&end>start,"jet pad relocation must exist");
const relocate=file.slice(start,end);
assert.match(file,/function obstacleNear\(x,y,r,ignoreId=""\)/,"self-collision exclusion argument");
assert.match(file,/A\.id!==ignoreId/,"do not count jet as its own obstacle");
assert.match(relocate,/spotOk\(A\.p\.x,A\.p\.y,A\.id\)/,"check occupied pad with the self excluded");
assert.match(relocate,/Math\.hypot\(w\.x-A\.p\.x,w\.y-A\.p\.y\)<40/,"never relocate near the entering player");
assert.match(relocate,/physics\(\)\?\.setPose\?\.\(A\.id/,"move existing physics body");
assert.doesNotMatch(relocate,/removeAirframe\(A\)|createAirframeBody\(/,"must never despawn/respawn on relocation");
console.log("jet pad identity: pass");
