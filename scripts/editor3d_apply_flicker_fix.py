#!/usr/bin/env python3
import base64,gzip,re,sys
from pathlib import Path

src_path=Path(sys.argv[1])
out_path=Path(sys.argv[2])
raw=src_path.read_text()
m=re.search(r"EDITOR3D_GZIP_BASE64='([^']+)'",raw)
if not m: raise SystemExit('missing Editor3D payload')
source=gzip.decompress(base64.b64decode(m.group(1))).decode()

replacements=[
("v.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});v.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));",
 "v.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:false,alpha:false,powerPreference:'high-performance'});const mobileDpr=matchMedia('(pointer:coarse)').matches?1.5:2;v.renderer.setPixelRatio(Math.min(devicePixelRatio||1,mobileDpr));"),
("v.grid.rotation.x=Math.PI/2;v.scene3.add(v.grid);",
 "v.grid.rotation.x=Math.PI/2;v.grid.position.z=.006;v.grid.renderOrder=-1;v.scene3.add(v.grid);"),
("v.floor.position.z=-.02;v.floor.receiveShadow=true;v.scene3.add(v.floor);",
 "v.floor.position.z=-.07;v.floor.renderOrder=-2;v.floor.receiveShadow=true;v.scene3.add(v.floor);"),
("new ResizeObserver(()=>resizeView(v)).observe(v.wrap);",
 "new ResizeObserver(()=>{if(v.resizeQueued)return;v.resizeQueued=true;requestAnimationFrame(()=>{v.resizeQueued=false;resizeView(v)})}).observe(v.wrap);"),
("function resizeView(v){const r=v.wrap.getBoundingClientRect();if(!r.width||!r.height)return;v.renderer.setSize(r.width,r.height,false);v.camera.aspect=r.width/r.height;v.camera.updateProjectionMatrix()}",
 "function resizeView(v){const w=Math.max(1,Math.round(v.wrap.clientWidth)),h=Math.max(1,Math.round(v.wrap.clientHeight));if(!w||!h||v.resizeW===w&&v.resizeH===h)return;v.resizeW=w;v.resizeH=h;v.renderer.setSize(w,h,false);v.camera.aspect=w/h;v.camera.updateProjectionMatrix()}"),
("function exportView(){activeView?.renderer.domElement.toBlob?.(b=>b&&download('scene3d.png',b,'image/png'))}",
 "function exportView(){if(!activeView)return;activeView.renderer.render(activeView.scene3,activeView.camera);activeView.renderer.domElement.toBlob?.(b=>b&&download('scene3d.png',b,'image/png'))}"),
]
for old,new in replacements:
    n=source.count(old)
    if n!=1: raise SystemExit(f'expected exactly one match, got {n}: {old[:80]}')
    source=source.replace(old,new)

assert 'preserveDrawingBuffer:true' not in source
assert "v.grid.position.z=.006" in source
assert "v.floor.position.z=-.07" in source
payload=base64.b64encode(gzip.compress(source.encode(),compresslevel=9,mtime=0)).decode()
fixed=raw[:m.start(1)]+payload+raw[m.end(1):]
out_path.write_text(fixed)
print('fixed source bytes',len(source.encode()),'wrapper bytes',len(fixed.encode()))
