import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=name=>readFileSync(new URL("../sim/"+name,import.meta.url),"utf8");
const rules=read("game_rules_sync.mjs"),voice=read("proximity_voice.mjs"),world=read("world_options_menu.mjs"),settings=read("settings_help.mjs");
assert.doesNotMatch(rules,/getElementById\("viewport"\)\?\.append\(button,panel\)/,"Never mount rule votes inside gameplay viewport");
assert.doesNotMatch(rules,/id="rulesVotePanel"|id="rulesVoteButton"/,"Remove the intrusive in-world rules panel");
assert.match(rules,/arondight:rules-vote-change/,"Rule state changes must notify menus");
assert.match(rules,/remoteBallot/,"Remote pending votes remain visible in menu state");
for(const [name,source] of [["title WORLD",world],["pause WORLD",settings]]){
  assert.match(source,/data-rule-vote-actions/,`${name}: vote controls need a menu home`);
  assert.match(source,/data-rule-vote-status/,`${name}: vote status should be accessible`);
  assert.match(source,/data-rule-vote-choice/,`${name}: approve or decline from menu`);
  assert.match(source,/arondight:rules-vote-change/,`${name}: respond to vote events`);
  assert.match(source,/remoteBallot/,`${name}: no approval buttons without an active ballot`);
}
assert.doesNotMatch(voice,/bottom:96px/,"No PTT controls over the movement stick");
assert.match(voice,/top:max\(8px/,"Voice goes into the top utility zone");
assert.match(voice,/border-radius:50%!important/,"Voice buttons must be circular");
assert.match(voice,/pointer-events:none/,"Voice container must not steal stick input");
assert.match(voice,/pointer-events:auto/,"Voice buttons remain usable");
assert.match(voice,/aria-pressed/,"Voice buttons expose press/mute state");
assert.match(voice,/toggleMic\(\)/,"Microphone toggles on a deliberate button click instead of hold/release");
assert.match(voice,/addEventListener\(\x27click\x27/,"Touch microphone switch is a click (no accidental hold)");
assert.match(voice,/body:not\(\.solo-flight\)/,"Voice hidden outside play");
console.log("HUD rules menu / voice thumb-safe controls: pass");
