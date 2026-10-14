// sim/auto_flight_start.mjs is inlined RAW into drone_simulator.html by the deploy (not bundled):
// any import in it would resolve against the page URL and break the start menu in production.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync("sim/auto_flight_start.mjs","utf8");
assert.ok(!/^\s*import\s/m.test(src),"auto_flight_start.mjs must not use static imports (it is inlined raw into the page)");
assert.ok(!/\bimport\(\s*["']\.\//.test(src),"auto_flight_start.mjs must not dynamically import relative modules");
console.log("inline start script has no imports");
