import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../editor3d.html',import.meta.url),'utf8');
const must=[
  ['Box3D inline runtime',/box3d\.js@0\.1\.1\/dist\/box3d\.inline\.mjs/],
  ['Three.js renderer',/three@0\.185\.1/],
  ['kinematic mouse body',/b3_kinematicBody/],
  ['motor joint definition',/b3DefaultMotorJointDef\(\)/],
  ['motor joint creation',/b3CreateMotorJoint\(world,jd\)/],
  ['local grab point',/b3Body_GetLocalPoint\(\[0,0,0\],phys\.body,h\.point\.toArray\(\)\)/],
  ['official mouse spring hertz',/jd\.linearHertz=7\.5/],
  ['critical damping',/jd\.linearDampingRatio=1/],
  ['mass-scaled spring force',/jd\.maxSpringForce=100\*mass\*9\.80665/],
  ['target-transform dragging',/b3Body_SetTargetTransform\(grab\.mouseBody/],
  ['joint cleanup',/b3DestroyJoint\(g\.joint,true\)/],
  ['mouse-body cleanup',/b3DestroyBody\(g\.mouseBody\)/],
  ['selection suppression',/user-select:none/],
  ['iOS callout suppression',/-webkit-touch-callout:none/],
  ['canvas touch ownership',/touch-action:none/],
  ['selectstart prevention',/addEventListener\('selectstart',e=>e\.preventDefault\(\)\)/],
  ['pointer cancel cleanup',/addEventListener\('pointercancel',endGrab\)/],
  ['lost pointer capture cleanup',/addEventListener\('lostpointercapture',endGrab\)/],
];
for(const [name,re] of must)assert.match(html,re,`Editor3D contract missing: ${name}`);
assert.doesNotMatch(html,/\.canvas\s*\{[^}]*user-select:text/s,'Canvas must never enable browser text selection');
console.log(`PASS editor3d contract (${must.length} invariants)`);
