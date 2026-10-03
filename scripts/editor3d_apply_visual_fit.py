#!/usr/bin/env python3
import base64,gzip,re,sys
from pathlib import Path

if len(sys.argv)!=3:
    raise SystemExit('usage: editor3d_apply_visual_fit.py <input.html> <output.html>')
src_path=Path(sys.argv[1]); out_path=Path(sys.argv[2])
raw=src_path.read_text(encoding='utf-8')
m=re.search(r"EDITOR3D_GZIP_BASE64='([^']+)'",raw)
if not m:
    raise SystemExit('missing Editor3D packed payload')
source=gzip.decompress(base64.b64decode(m.group(1))).decode('utf-8')

def swap(old,new,label):
    global source
    if new in source:
        return
    if old not in source:
        raise SystemExit(f'missing visual patch anchor: {label}')
    source=source.replace(old,new,1)

old_fit="function fitView(v=activeView,points=null){if(!v)return;syncViewScene(v);let box;if(points?.length){box=new THREE.Box3();points.forEach(p=>box.expandByPoint(new THREE.Vector3().fromArray(p)))}else box=new THREE.Box3().setFromObject(v.content);if(box.isEmpty())box.set(new THREE.Vector3(-2,-2,0),new THREE.Vector3(2,2,4));const c=box.getCenter(new THREE.Vector3),size=Math.max(1,box.getSize(new THREE.Vector3).length()),dir=v.camera.position.clone().sub(v.controls.target);if(dir.lengthSq()<.01)dir.set(1,-1,.8);dir.normalize();v.controls.target.copy(c);v.camera.position.copy(c.clone().add(dir.multiplyScalar(size*1.25+2)));v.camera.near=.02;v.camera.far=Math.max(100,size*30);v.camera.updateProjectionMatrix();v.controls.update();dirtyRender=true}"
new_fit="function fitView(v=activeView,points=null){if(!v)return;syncViewScene(v);let box;if(points?.length){box=new THREE.Box3();points.forEach(p=>box.expandByPoint(new THREE.Vector3().fromArray(p)))}else box=new THREE.Box3().setFromObject(v.content);if(box.isEmpty())box.set(new THREE.Vector3(-2,-2,0),new THREE.Vector3(2,2,4));const c=box.getCenter(new THREE.Vector3),dims=box.getSize(new THREE.Vector3),span=Math.max(dims.x,dims.y,dims.z,.05),dir=v.camera.position.clone().sub(v.controls.target);if(dir.lengthSq()<.01)dir.set(1,-1,.8);dir.normalize();const vfov=THREE.MathUtils.degToRad(v.camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*Math.max(.2,v.camera.aspect||1)),fitFov=Math.max(.08,Math.min(vfov,hfov)),distance=Math.max(span/(2*Math.tan(fitFov/2))*1.35,span*1.15,.08);v.controls.target.copy(c);v.camera.position.copy(c.clone().add(dir.multiplyScalar(distance)));v.camera.near=Math.max(.0005,distance/2000);v.camera.far=Math.max(20,distance+span*100);v.camera.updateProjectionMatrix();v.controls.update();dirtyRender=true}"
swap(old_fit,new_fit,'adaptive camera fit')

old_ground="mk('ground',0,[0,0,-.5],'box',[24,24,1]);if(kind==='joints'){"
new_ground="if(kind!=='cradle')mk('ground',0,[0,0,-.5],'box',[24,24,1]);if(kind==='joints'){"
swap(old_ground,new_ground,'remove 24m ground from 50mm Newton cradle')

marker='Editor3D visual fit v1: scale-aware camera; cradle excludes 24m demo ground'
if marker not in source:
    source=source.replace('<head>','<head><!-- '+marker+' -->',1)

assert new_fit in source
assert new_ground in source
assert marker in source
payload=base64.b64encode(gzip.compress(source.encode('utf-8'),compresslevel=9,mtime=0)).decode('ascii')
fixed=raw[:m.start(1)]+payload+raw[m.end(1):]
out_path.write_text(fixed,encoding='utf-8')
print('patched Editor3D visual fit; source bytes',len(source.encode('utf-8')),'wrapper bytes',len(fixed.encode('utf-8')))
