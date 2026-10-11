import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const bootstrap=readFileSync('sim/real_world_bootstrap.mjs','utf8');
const layout=readFileSync('sim/walk_ui_layout_hotfix.mjs','utf8');
const map=readFileSync('sim/world_map_full.mjs','utf8');
assert.match(bootstrap,/hud\.addEventListener\("pointerup",release/);
const gesture=bootstrap.slice(bootstrap.indexOf('const release=event=>'),bootstrap.indexOf('hud.addEventListener("pointerup",release'));
assert.match(gesture,/this\.lastMinimapTapMs<360/);
assert.match(gesture,/__arondightWorldMap\?\.open\?\.\(\)/);
assert.doesNotMatch(gesture,/playerMode|currentMode|onFoot|jetMode|carMode/,'double tap must not be restricted to a vehicle');
assert.match(map,/function openMap\(\)/);
assert.match(layout,/#worldLookHud:not\(\.expanded\)\{width:108px!important;height:108px!important/);
assert.match(layout,/#worldLookHud:not\(\.expanded\)\{width:100px!important;height:100px!important/);
assert.match(layout,/#worldLookHud\.expanded\{width:min\(72vw,560px\)!important;height:min\(68dvh,430px\)!important/);
for(const mode of ['foot','first-person','car','jet','drone']){
  // All modes share the same listener; no mode-specific handler or exclusions.
  assert.ok(gesture.includes('lastMinimapTapMs'),mode+' shares double-tap');
}
console.log('Minimap double-tap common handler and expanded-foot CSS contract: passed');
