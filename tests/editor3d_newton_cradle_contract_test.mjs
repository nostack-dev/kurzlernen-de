import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const raw=fs.readFileSync(new URL('../editor3d.html',import.meta.url),'utf8');
const packed=raw.match(/EDITOR3D_GZIP_BASE64='([^']+)'/);
const html=packed?gunzipSync(Buffer.from(packed[1],'base64')).toString('utf8'):raw;
for(const [name,re] of [
  ['cradle marker',/Editor3D Newton cradle example v1/],
  ['examples entry',/Newton cradle \/ pendulum/],
  ['toolbar button',/Newton cradle example/],
  ['cradle scene route',/loadDemo\('cradle'\)/],
  ['earth gravity',/s\.world\.gravity=\[0,0,-9\.80665\]/],
  ['five balls',/count=5/],
  ['two-string constraint',/wireLen=Math\.sqrt\(drop\*drop\+wire\*wire\)/],
  ['lossless restitution',/f\.restitution=1/],
  ['no damping',/ball\.linearDamping=0;ball\.angularDamping=0/],
  ['no sleep',/ball\.allowSleep=false/],
  ['continuous collision',/ball\.bullet=true/],
  ['mobile re-pull hint',/switch Orbit to Grab/],
]) assert.match(html,re,`Editor3D Newton cradle contract missing: ${name}`);
console.log('PASS editor3d Newton cradle contract');
