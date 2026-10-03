import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';

const raw=fs.readFileSync(new URL('../editor3d.html',import.meta.url),'utf8');
const packed=raw.match(/EDITOR3D_GZIP_BASE64='([^']+)'/);
const html=packed?gunzipSync(Buffer.from(packed[1],'base64')).toString('utf8'):raw;

const must=[
  ['non-preserved WebGL framebuffer',/preserveDrawingBuffer:false/],
  ['opaque WebGL canvas',/alpha:false/],
  ['mobile DPR clamp',/pointer:coarse[\s\S]*\?1\.5:2/],
  ['coalesced ResizeObserver',/ResizeObserver\(\(\)=>\{if\(v\.resizeQueued\)return;v\.resizeQueued=true;requestAnimationFrame/],
  ['stable integer canvas sizing',/Math\.round\(v\.wrap\.clientWidth\)[\s\S]*Math\.round\(v\.wrap\.clientHeight\)/],
  ['skip unchanged backing-buffer resize',/v\.resizeW===w&&v\.resizeH===h/],
  ['grid separated from ground plane',/v\.grid\.position\.z=\.006/],
  ['helper floor separated from physical ground',/v\.floor\.position\.z=-\.07/],
];
for(const [name,re] of must) assert.match(html,re,`Editor3D flicker regression: ${name}`);
assert.doesNotMatch(html,/preserveDrawingBuffer:true/,'Editor3D must not preserve the WebGL drawing buffer');
console.log(`PASS editor3d anti-flicker contract (${must.length+1} invariants)`);
