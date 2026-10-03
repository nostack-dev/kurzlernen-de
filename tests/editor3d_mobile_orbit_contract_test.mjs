import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const raw=fs.readFileSync(new URL('../editor3d.html',import.meta.url),'utf8');
const packed=raw.match(/EDITOR3D_GZIP_BASE64='([^']+)'/);
const html=packed?gunzipSync(Buffer.from(packed[1],'base64')).toString('utf8'):raw;
for(const [name,re] of [
  ['earth gravity default',/const\s+defaults\s*=\s*\{\s*gravity\s*:\s*\[0,0,-9\.80665\]/],
  ['mobile orbit marker',/Editor3D mobile orbit toggle v1/],
  ['mobile orbit button',/e3d-mobile-orbit-toggle/],
  ['orbit default',/v\.mobileOrbitMode=true/],
  ['orbit owns input',/e\.stopImmediatePropagation\(\)/],
  ['native controls disabled on mobile',/if\(v\.controls\)v\.controls\.enabled=false/],
  ['selection label',/v\.type==='player'\?'Grab':'Select'/],
  ['one finger orbit',/orbit\(v,p\.x-ox,p\.y-oy\)/],
  ['two finger pan',/pan\(v,now\.cx-lastPair\.cx,now\.cy-lastPair\.cy\)/],
  ['pinch zoom',/zoom\(v,lastPair\.d\/now\.d\)/],
]) assert.match(html,re,`Editor3D mobile orbit contract missing: ${name}`);
console.log('PASS editor3d mobile orbit contract');
