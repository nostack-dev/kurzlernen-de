import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';

const packaged=fs.readFileSync(new URL('../editor3d.html',import.meta.url),'utf8');
function unpackEditor3D(source){
  if(!source.includes("DecompressionStream('gzip')"))return source;
  const expr=source.match(/const payload=([\s\S]*?);const b=Uint8Array/);
  assert.ok(expr,'Editor3D compressed wrapper must expose its payload expression');
  const chunks=[...expr[1].matchAll(/'([A-Za-z0-9+/=]*)'/g)].map(m=>m[1]);
  assert.ok(chunks.length,'Editor3D compressed wrapper must contain base64 payload chunks');
  return gunzipSync(Buffer.from(chunks.join(''),'base64')).toString('utf8');
}
const html=unpackEditor3D(packaged);
const legacyBox3dImport=/box3d\.js@0\.1\.1\/dist\/box3d\.inline\.mjs/.test(html);
const packagedBox3dRuntime=packaged!==html&&/b3CreateHull\(pts\.flat\(\)\)[\s\S]*b3CreateHullShape\(bodyId,sd,hull\)/.test(html)&&/b3CreateSphereShape\(bodyId,sd/.test(html)&&/b3CreateCapsuleShape\(bodyId,sd/.test(html)&&/b3CreateMotorJoint\(v\.sim\.world,jd\)/.test(html);
assert.ok(legacyBox3dImport||packagedBox3dRuntime,'Editor3D contract missing: Box3D inline/self-contained runtime');
const jointMatch=html.match(/const jointTypes=\[([^\]]+)\]/);
assert.ok(jointMatch,'Editor3D contract missing: joint type list');
const jointTypes=[...jointMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m=>m[1]);
for(const type of ['revolute','distance','prismatic','wheel','weld','motor'])assert.ok(jointTypes.includes(type),`Editor3D UI contract missing core 3D joint kind: ${type}`);
for(const api of ['b3DefaultRevoluteJointDef','b3DefaultDistanceJointDef','b3DefaultPrismaticJointDef','b3DefaultWheelJointDef','b3DefaultWeldJointDef','b3DefaultMotorJointDef'])assert.ok(html.includes(api),`Editor3D engine contract missing core joint API: ${api}`);
const must=[
  ['Three.js renderer',/three@0\.185\.1/],
  ['3D hull rendering',/ConvexGeometry/],
  ['RUBE-style menu bar',/data-menu="File"[\s\S]*data-menu="Edit"[\s\S]*data-menu="View"[\s\S]*data-menu="Scene"[\s\S]*data-menu="Window"[\s\S]*data-menu="Tools"[\s\S]*data-menu="Help"/],
  ['items dock',/id="itemsPanel"/],
  ['context dock',/id="contextPanel"/],
  ['undo dock',/id="undoPanel"/],
  ['properties dock',/id="propertiesPanel"/],
  ['message log dock',/id="logPanel"/],
  ['document + view model',/documents=\[\],views=\[\],activeView=null/],
  ['independent player source',/const d=doc\(\),source=clone\(d\.scene\),v=createView\(d,'player'\);v\.source=source;v\.sim=buildWorld\(source\)/],
  ['player Box3D world',/v\.sim=buildWorld\((?:v\.source|source)\)/],
  ['editor modes',/body:'Body',fixture:'Fixture',vertex:'Vertex',joint:'Joint',image:'Image',sampler:'Sampler',world:'World'/],
  ['multi fixture bodies',/fixtures:\[\]/],
  ['Box3D hull fixture',/b3CreateHull\(pts\.flat\(\)\)[\s\S]*b3CreateHullShape\(bodyId,sd,hull\)/],
  ['sphere fixture',/b3CreateSphereShape\(bodyId,sd/],
  ['capsule fixture',/b3CreateCapsuleShape\(bodyId,sd/],
  ['X Y Z transform axes',/\['x','y','z'\]\.includes\(key\)/],
  ['typed transform input',/operation\.typed/],
  ['Space action menu',/openPopup\(actionMenu\(\)/],
  ['body fixture vertex joint image shortcuts',/const m=\{b:'body',f:'fixture',v:'vertex',j:'joint',i:'image'\}\[key\]/],
  ['duplicate remaps connected joints',/map\.has\(j\.bodyA\)&&map\.has\(j\.bodyB\)/],
  ['undo history',/d\.history\.push\(\{label,before,after\}\)/],
  ['clone view',/function cloneView\(\)/],
  ['tile views',/tiled=!tiled/],
  ['image alpha to 3D fixtures',/function traceImageToBoxes\(\)/],
  ['editable e3d format',/format:'editor3d',version:2/],
  ['kinematic mouse body',/md\.type=b3\.b3BodyType\.b3_kinematicBody/],
  ['motor joint definition',/b3\.b3DefaultMotorJointDef\(\)/],
  ['motor joint creation',/b3\.b3CreateMotorJoint\(v\.sim\.world,jd\)/],
  ['local grab point',/b3\.b3Body_GetLocalPoint\(\[0,0,0\],bodyId,h\.point\.toArray\(\)\)/],
  ['official mouse spring hertz',/jd\.linearHertz=7\.5/],
  ['critical damping',/jd\.linearDampingRatio=1/],
  ['mass-scaled spring force',/const mass=Math\.max\(\.001,b3\.b3Body_GetMass\(bodyId\)\),g=vlen\(v\.source\.world\.gravity\);jd\.maxSpringForce=100\*mass\*Math\.max\(g,1\)/],
  ['target-transform dragging',/b3\.b3Body_SetTargetTransform\(g\.mouseBody/],
  ['joint cleanup',/b3\.b3DestroyJoint\(g\.joint,true\)/],
  ['mouse-body cleanup',/b3\.b3DestroyBody\(g\.mouseBody\)/],
  ['selection suppression',/user-select:none/],
  ['iOS callout suppression',/-webkit-touch-callout:none/],
  ['canvas touch ownership',/touch-action:none/],
  ['selectstart prevention',/addEventListener\('selectstart',e=>e\.preventDefault\(\)\)/],
  ['pointer cancel cleanup',/addEventListener\('pointercancel',end\)/],
  ['lost pointer capture cleanup',/addEventListener\('lostpointercapture',end\)/],
];
for(const [name,re] of must)assert.match(html,re,`Editor3D contract missing: ${name}`);
assert.doesNotMatch(html,/user-select:text/,'Canvas/editor must never enable browser text selection');
assert.doesNotMatch(html,/(?:src|from)=["'][^"']*(?:planck|box2d)|import\s+[^;]*(?:planck|box2d)/i,'Editor3D must not import a 2D physics runtime');
console.log(`PASS editor3d parity contract (${must.length+12} invariants${packaged===html?'':' · unpacked self-contained payload'})`);
