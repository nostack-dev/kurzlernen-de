import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const raw=fs.readFileSync(new URL('../editor3d.html',import.meta.url),'utf8');
const packed=raw.match(/EDITOR3D_GZIP_BASE64='([^']+)'/);
const html=packed?gunzipSync(Buffer.from(packed[1],'base64')).toString('utf8'):raw;
for(const [name,re] of [
  ['cradle v2 marker',/Editor3D Newton cradle example v2/],
  ['examples entry',/Newton cradle \/ pendulum/],
  ['toolbar button',/Newton cradle example/],
  ['cradle scene route',/loadDemo\('cradle'\)/],
  ['default cradle scene',/if\(!loaded\)\{addDocument\(scene\('Newton cradle'\)\);loadDemo\('cradle',true\)\}/],
  ['earth gravity',/s\.world\.gravity=\[0,0,-9\.80665\]/],
  ['five balls',/count=5/],
  ['row aligned on X',/restX=\(i-\(count-1\)\/2\)\*spacing/],
  ['wire anchors across Y',/\[restX,side\*wire,topZ\]/],
  ['no artificial distance limits',/j\.enableLimit=false/],
  ['no spring',/j\.enableSpring=false/],
  ['lossless restitution',/f\.restitution=1/],
  ['no damping',/ball\.linearDamping=0;ball\.angularDamping=0/],
  ['no sleep',/ball\.allowSleep=false/],
  ['continuous collision',/ball\.bullet=true/],
]) assert.match(html,re,`Editor3D Newton cradle contract missing: ${name}`);
assert.doesNotMatch(html,/Editor3D Newton cradle example v1/,'old cradle implementation must be gone');
console.log('PASS editor3d realistic Newton cradle contract');
