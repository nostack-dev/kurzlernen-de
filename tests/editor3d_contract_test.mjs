import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';

const raw=fs.readFileSync(new URL('../editor3d.html', import.meta.url),'utf8');
const packed=raw.match(/EDITOR3D_GZIP_BASE64='([^']+)'/);
const html=packed?gunzipSync(Buffer.from(packed[1],'base64')).toString('utf8'):raw;
const must=[
  ['Box3D inline runtime',/box3d\.js@0\.1\.1\/dist\/box3d\.inline\.mjs/],
  ['Three.js renderer',/three@0\.185\.1/],
  ['3D convex hull rendering',/ConvexGeometry/],
  ['RUBE menu bar',/data-menu="File"[\s\S]*data-menu="Edit"[\s\S]*data-menu="View"[\s\S]*data-menu="Scene"[\s\S]*data-menu="Window"[\s\S]*data-menu="Tools"[\s\S]*data-menu="Help"/],
  ['dockable panels',/id="itemsPanel"[\s\S]*id="contextPanel"[\s\S]*id="undoPanel"[\s\S]*id="propertiesPanel"[\s\S]*id="helpPanel"[\s\S]*id="logPanel"/],
  ['documents and views',/documents=\[\],views=\[\],activeView=null/],
  ['editor modes',/body:'Body',fixture:'Fixture',vertex:'Vertex',joint:'Joint',image:'Image',sampler:'Sampler',world:'World'/],
  ['RUBE + Box3D joint vocabulary',/\['revolute','distance','prismatic','wheel','rope','weld','friction','motor','spherical','parallel','filter'\]/],
  ['compound document bodies',/fixtures:\[\]/],
  ['separate player source',/source=clone\(d\.scene\)/],
  ['Box3D player world',/v\.sim=buildWorld\(source\)/],
  ['box hull shape',/b3CreateHullShape\(bodyId,sd,hull\)/],
  ['sphere shape',/b3CreateSphereShape\(bodyId,sd/],
  ['capsule shape',/b3CreateCapsuleShape\(bodyId,sd/],
  ['native revolute joint',/b3CreateRevoluteJoint\(sim\.world,d\)/],
  ['native prismatic joint',/b3CreatePrismaticJoint\(sim\.world,d\)/],
  ['native wheel joint',/b3CreateWheelJoint\(sim\.world,d\)/],
  ['native spherical joint',/b3CreateSphericalJoint\(sim\.world,d\)/],
  ['native filter joint',/b3CreateFilterJoint\(sim\.world,d\)/],
  ['rope maps to distance limits',/j\.type==='distance'\|\|j\.type==='rope'[\s\S]*d\.maxLength/],
  ['friction maps to motor constraint',/j\.type==='motor'\|\|j\.type==='friction'[\s\S]*maxVelocityForce/],
  ['three axis operations',/\['x','y','z'\]\.includes\(key\)/],
  ['typed transforms',/applyTypedOperation/],
  ['joint limit keyboard operation',/kind==='limit'[\s\S]*lowerLimit[\s\S]*upperLimit/],
  ['space action menu',/openPopup\(actionMenu\(\)/],
  ['mode keys',/\{b:'body',f:'fixture',v:'vertex',j:'joint',i:'image'\}/],
  ['connected duplicate remaps joints',/map\.get\(j\.bodyA\)[\s\S]*map\.get\(j\.bodyB\)/],
  ['full clipboard paste',/function pasteData\(data=clipboard\)/],
  ['undo journal',/d\.history\.push\(\{label,before,after\}\)/],
  ['clone view',/function cloneView\(/],
  ['tile views',/tiled=!tiled/],
  ['box selection',/function selectInBox\(/],
  ['image alpha fixture generation',/function traceImageToBoxes\(/],
  ['sampler composition',/function composeSampler\(/],
  ['editable e3d v2',/format:'editor3d',version:2/],
  ['negative mirror support',/sx\*sy\*sz<0/],
  ['mirrored limits',/j\.lowerLimit=-old\.upperLimit;j\.upperLimit=-old\.lowerLimit/],
  ['mirrored motor direction',/j\.motorSpeed=-\(old\.motorSpeed\|\|0\)/],
  ['world sleep forwarded',/wd\.enableSleep=!!s\.world\.allowSleep/],
  ['continuous physics forwarded',/wd\.enableContinuous=!!s\.world\.continuousPhysics/],
  ['kinematic mouse body',/b3_kinematicBody/],
  ['mouse MotorJoint',/b3CreateMotorJoint\(v\.sim\.world,jd\)/],
  ['local grab point',/b3Body_GetLocalPoint\(\[0,0,0\],bodyId,h\.point\.toArray\(\)\)/],
  ['official mouse spring frequency',/jd\.linearHertz=7\.5/],
  ['critical mouse damping',/jd\.linearDampingRatio=1/],
  ['mass scaled mouse force',/jd\.maxSpringForce=100\*mass\*Math\.max\(g,1\)/],
  ['mouse target transform',/b3Body_SetTargetTransform\(g\.mouseBody/],
  ['mouse joint cleanup',/b3DestroyJoint\(g\.joint,true\)/],
  ['mouse body cleanup',/b3DestroyBody\(g\.mouseBody\)/],
  ['canvas selection disabled',/user-select:none/],
  ['iOS callout disabled',/-webkit-touch-callout:none/],
  ['canvas touch ownership',/touch-action:none/],
  ['selectstart prevention',/addEventListener\('selectstart',e=>e\.preventDefault\(\)\)/],
  ['pointer cancel cleanup',/addEventListener\('pointercancel',end\)/],
  ['lost pointer capture cleanup',/addEventListener\('lostpointercapture',end\)/],
];
for(const [name,re] of must) assert.match(html,re,`Editor3D contract missing: ${name}`);
assert.doesNotMatch(html,/(?:src|from)=[#'][^"']*(?:planck|box2d)|import\s+[^;]*(?:planck|box2d)/i,'Editor3D must not import a 2D physics runtime');
assert.doesNotMatch(html,/user-select:text/,'Canvas/editor must never enable browser text selection');
console.log(`PASS editor3d parity contract (${must.length} invariants)`);
