import assert from "node:assert/strict";
import {safeMobilePeerMarkerPoint} from "../sim/mobile_peer_marker_layout.mjs";

const p=(x,y,w,h,mobile=true)=>safeMobilePeerMarkerPoint(x,y,w,h,{mobile});

// Visually observed: the 2P marker was covering ARM / STOP in the 844×390
// mobile multiplayer screenshots, even though the button-v-button test passed.
const [x,y]=p(421,353,844,390);
assert.equal(x,421);
assert.ok(y<=390-88,`mobile peer nameplate still covers ARM/STOP: y=${y}`);
const [xs,ys]=p(420,277,844,300);
assert.equal(xs,420);
assert.ok(ys<=212,`Safari 300px landscape lost its bottom touch-control band: y=${ys}`);

// Marker next to the top-left score, MULTI and STRIKE must not cover them.
const [leftX,leftY]=p(72,105,844,390);
assert.ok(leftX>=192,`peer nameplate overlaps the crowded left HUD: ${leftX},${leftY}`);
// Right edge still has RESET and GPS; no names on top of them.
const [rightX,rightY]=p(815,45,844,390);
assert.ok(rightX<=806&&rightY>=100,`peer label overlaps the reset controls: ${rightX},${rightY}`);

// Tall portrait rotated into the game's landscape coordinate system.
// Do not pinch marker into the central aiming point if it is already safe.
assert.deepEqual(p(422,195,844,390),[422,195]);
assert.deepEqual(p(422,352,844,390,false),[422,352],
  "mouse/keyboard and desktop labels must remain camera-accurate");
// Avoid NaN CSS transforms if an offscreen projection momentarily fails.
assert.deepEqual(p(NaN,0,844,390),[NaN,0]);

console.log("Mobile multiplayer nameplate safe zones passed: 844×390, 844×300, top corners, portrait logical frame, desktop unchanged.");
