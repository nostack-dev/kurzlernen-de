import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const raw=fs.readFileSync(new URL('../editor3d.html',import.meta.url),'utf8');
const packed=raw.match(/EDITOR3D_GZIP_BASE64='([^']+)'/);
const html=packed?gunzipSync(Buffer.from(packed[1],'base64')).toString('utf8'):raw;
for(const [name,re] of [
  ['cradle v3 MKS marker',/Editor3D Newton cradle example v3 MKS/],
  ['default cradle scene',/if\(!loaded\)\{addDocument\(scene\('Newton cradle'\)\);loadDemo\('cradle',true\)\}/],
  ['earth gravity',/s\.world\.gravity=\[0,0,-9\.80665\]/],
  ['120 Hz scene',/s\.world\.stepsPerSecond=120/],
  ['8 substeps scene',/s\.world\.subStepCount=8/],
  ['low restitution threshold',/s\.world\.restitutionThreshold=\.05/],
  ['forward restitution iterations',/s\.world\.restitutionIterations=8/],
  ['forward restitution propagation',/s\.world\.restitutionPropagation=true/],
  ['MKS ball radius',/radius=\.025/],
  ['steel density',/steelDensity=7850/],
  ['touching ball spacing',/spacing=2\*radius/],
  ['steel restitution',/f\.restitution=\.96/],
  ['low friction',/f\.friction=\.02/],
  ['no rolling resistance',/f\.rollingResistance=0/],
  ['no body damping',/ball\.linearDamping=0;ball\.angularDamping=0/],
  ['sleep disabled',/ball\.allowSleep=false/],
  ['balls are not bullets',/ball\.bullet=false/],
  ['no artificial distance limits',/j\.enableLimit=false/],
  ['no spring',/j\.enableSpring=false/],
  ['world restitution threshold runtime',/wd\.restitutionThreshold=Math\.max\(0,Number\(s\.world\.restitutionThreshold\?\?1\)\)/],
  ['rolling resistance runtime',/sd\.baseMaterial\.rollingResistance=Math\.max\(0,Number\(f\.rollingResistance\|\|0\)\)/],
  ['world restitution controls',/Restitution threshold \(m\/s\)/],
]) assert.match(html,re,`Editor3D Newton cradle contract missing: ${name}`);
assert.doesNotMatch(html,/Editor3D Newton cradle example v[12]/,'old cradle implementation must be gone');
console.log('PASS editor3d MKS Newton cradle contract');
