import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const raw=fs.readFileSync(new URL('../editor3d.html',import.meta.url),'utf8');
const packed=raw.match(/EDITOR3D_GZIP_BASE64='([^']+)'/);
const html=packed?gunzipSync(Buffer.from(packed[1],'base64')).toString('utf8'):raw;
for(const [name,re] of [
  ['cradle v4 equilibrium marker',/Editor3D Newton cradle example v4 equilibrium/],
  ['default cradle scene',/if\(!loaded\)\{addDocument\(scene\('Newton cradle'\)\);loadDemo\('cradle',true\)\}/],
  ['earth gravity',/s\.world\.gravity=\[0,0,-9\.80665\]/],
  ['120 Hz scene',/s\.world\.stepsPerSecond=120/],
  ['12 substeps scene',/s\.world\.subStepCount=12/],
  ['very low restitution threshold',/s\.world\.restitutionThreshold=\.01/],
  ['forward restitution iterations',/s\.world\.restitutionIterations=12/],
  ['forward restitution propagation',/s\.world\.restitutionPropagation=true/],
  ['MKS ball radius',/radius=\.025/],
  ['steel density',/steelDensity=7850/],
  ['touching ball spacing',/spacing=2\*radius/],
  ['steel restitution',/f\.restitution=\.995/],
  ['very low friction',/f\.friction=\.005/],
  ['no rolling resistance',/f\.rollingResistance=0/],
  ['equilibrium position',/x=restX,y=0,z=topZ-drop/],
  ['no body damping',/ball\.linearDamping=0;ball\.angularDamping=0/],
  ['sleep disabled',/ball\.allowSleep=false/],
  ['balls are not bullets',/ball\.bullet=false/],
  ['no artificial distance limits',/j\.enableLimit=false/],
  ['no spring',/j\.enableSpring=false/],
  ['world restitution threshold runtime',/wd\.restitutionThreshold=Math\.max\(0,Number\(s\.world\.restitutionThreshold\?\?1\)\)/],
  ['rolling resistance runtime',/sd\.baseMaterial\.rollingResistance=Math\.max\(0,Number\(f\.rollingResistance\|\|0\)\)/],
  ['world restitution controls',/Restitution threshold \(m\/s\)/],
]) assert.match(html,re,`Editor3D Newton cradle contract missing: ${name}`);
assert.doesNotMatch(html,/Editor3D Newton cradle example v[123](?!\d)/,'old cradle implementation must be gone');
console.log('PASS editor3d equilibrium steel Newton cradle contract');
