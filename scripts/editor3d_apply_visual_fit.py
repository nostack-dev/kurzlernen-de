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

# First bring older builds to the v1 scale-aware camera so this patch stays
# applicable to the known-good baseline as well as the current live file.
old_fit="function fitView(v=activeView,points=null){if(!v)return;syncViewScene(v);let box;if(points?.length){box=new THREE.Box3();points.forEach(p=>box.expandByPoint(new THREE.Vector3().fromArray(p)))}else box=new THREE.Box3().setFromObject(v.content);if(box.isEmpty())box.set(new THREE.Vector3(-2,-2,0),new THREE.Vector3(2,2,4));const c=box.getCenter(new THREE.Vector3),size=Math.max(1,box.getSize(new THREE.Vector3).length()),dir=v.camera.position.clone().sub(v.controls.target);if(dir.lengthSq()<.01)dir.set(1,-1,.8);dir.normalize();v.controls.target.copy(c);v.camera.position.copy(c.clone().add(dir.multiplyScalar(size*1.25+2)));v.camera.near=.02;v.camera.far=Math.max(100,size*30);v.camera.updateProjectionMatrix();v.controls.update();dirtyRender=true}"
v1_fit="function fitView(v=activeView,points=null){if(!v)return;syncViewScene(v);let box;if(points?.length){box=new THREE.Box3();points.forEach(p=>box.expandByPoint(new THREE.Vector3().fromArray(p)))}else box=new THREE.Box3().setFromObject(v.content);if(box.isEmpty())box.set(new THREE.Vector3(-2,-2,0),new THREE.Vector3(2,2,4));const c=box.getCenter(new THREE.Vector3),dims=box.getSize(new THREE.Vector3),span=Math.max(dims.x,dims.y,dims.z,.05),dir=v.camera.position.clone().sub(v.controls.target);if(dir.lengthSq()<.01)dir.set(1,-1,.8);dir.normalize();const vfov=THREE.MathUtils.degToRad(v.camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*Math.max(.2,v.camera.aspect||1)),fitFov=Math.max(.08,Math.min(vfov,hfov)),distance=Math.max(span/(2*Math.tan(fitFov/2))*1.35,span*1.15,.08);v.controls.target.copy(c);v.camera.position.copy(c.clone().add(dir.multiplyScalar(distance)));v.camera.near=Math.max(.0005,distance/2000);v.camera.far=Math.max(20,distance+span*100);v.camera.updateProjectionMatrix();v.controls.update();dirtyRender=true}"
if old_fit in source:
    source=source.replace(old_fit,v1_fit,1)

old_ground="mk('ground',0,[0,0,-.5],'box',[24,24,1]);if(kind==='joints'){"
new_ground="if(kind!=='cradle')mk('ground',0,[0,0,-.5],'box',[24,24,1]);if(kind==='joints'){"
swap(old_ground,new_ground,'remove 24m ground from 50mm Newton cradle')

world_anchor="function worldTransform(b,p=V(),q=Q()){const bp=new THREE.Vector3().fromArray(b.position),bq=new THREE.Quaternion().fromArray(b.rotation),pp=new THREE.Vector3().fromArray(p).applyQuaternion(bq).add(bp),qq=bq.clone().multiply(new THREE.Quaternion().fromArray(q));return{position:pp.toArray(),rotation:qq.toArray()}}"
helpers="""function fixtureRadius(f){if(f.shape==='box')return .5*Math.hypot(...(f.size||[1,1,1]));if(f.shape==='sphere')return Math.max(.001,Number(f.radius)||.5);if(f.shape==='capsule')return Math.max(.001,Number(f.radius)||.5)+Math.max(0,Number(f.length)||1)*.5;if(f.shape==='hull')return Math.max(.001,...(f.vertices||[]).map(p=>vlen(p)));return .1}
function physicalSpan(s){let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],any=false;for(const b of s?.bodies||[])for(const f of b.fixtures||[]){const c=worldTransform(b,f.center||V()).position,r=fixtureRadius(f);for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],c[k]-r);hi[k]=Math.max(hi[k],c[k]+r)}any=true}return any?Math.max(.001,hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]):1}
function contentBounds(v){const box=new THREE.Box3();v.content.updateMatrixWorld(true);v.content.traverse(o=>{const m=o.userData?.mode;if(m==='fixture'||m==='image'||m==='sampler'){const b=new THREE.Box3().setFromObject(o);if(!b.isEmpty())box.union(b)}});return box}"""
if helpers not in source:
    if world_anchor not in source:
        raise SystemExit('missing visual patch anchor: helper insertion')
    source=source.replace(world_anchor,world_anchor+'\n'+helpers,1)

sync_old="function syncViewScene(v){while(v.content.children.length){const o=v.content.children.pop();disposeObject(o)}const s=v.type==='player'?v.source:v.doc.scene;if(!s)return;const selected=m=>new Set(v.doc.selection[m]||[]);const sb=selected('body'),sf=selected('fixture'),sv=selected('vertex'),sj=selected('joint'),si=selected('image'),ss=selected('sampler');"
sync_new="function syncViewScene(v){while(v.content.children.length){const o=v.content.children.pop();disposeObject(o)}const s=v.type==='player'?v.source:v.doc.scene;if(!s)return;const selected=m=>new Set(v.doc.selection[m]||[]);const sb=selected('body'),sf=selected('fixture'),sv=selected('vertex'),sj=selected('joint'),si=selected('image'),ss=selected('sampler'),span=physicalSpan(s),helper=Math.max(.003,Math.min(.07,span*.012)),selectedHelper=Math.max(helper,Math.min(.1,helper*1.5)),cursorLen=Math.max(.04,Math.min(.35,span*.08));"
swap(sync_old,sync_new,'physical helper scale')

swap("new THREE.SphereGeometry(sv.has(f.id+':'+i)?.09:.065,10,8)","new THREE.SphereGeometry(sv.has(f.id+':'+i)?selectedHelper:helper,10,8)",'vertex helper scale')
swap("new THREE.SphereGeometry(sb.has(b.id)?.12:.08,12,8)","new THREE.SphereGeometry(sb.has(b.id)?selectedHelper:helper,12,8)",'body helper scale')
swap("new THREE.SphereGeometry(sj.has(j.id)?.11:.07,10,8)","new THREE.SphereGeometry(sj.has(j.id)?selectedHelper:helper,10,8)",'joint helper scale')
swap("const axes=[[0xff6666,[.35,0,0]],[0x66ff66,[0,.35,0]],[0x6688ff,[0,0,.35]]]","const axes=[[0xff6666,[cursorLen,0,0]],[0x66ff66,[0,cursorLen,0]],[0x6688ff,[0,0,cursorLen]]]",'cursor axis scale')
swap("new THREE.TorusGeometry(.13,.012,6,24)","new THREE.TorusGeometry(cursorLen*.38,Math.max(.001,cursorLen*.035),6,24)",'cursor ring scale')

v2_fit="function fitView(v=activeView,points=null){if(!v)return;syncViewScene(v);let box;if(points?.length){box=new THREE.Box3();points.forEach(p=>box.expandByPoint(new THREE.Vector3().fromArray(p)))}else box=contentBounds(v);if(box.isEmpty()){box=new THREE.Box3();const s=v.type==='player'?v.source:v.doc.scene;for(const b of s?.bodies||[])box.expandByPoint(new THREE.Vector3().fromArray(bodyDisplay(v,b).position))}if(box.isEmpty())box.set(new THREE.Vector3(-2,-2,0),new THREE.Vector3(2,2,4));const c=box.getCenter(new THREE.Vector3),dims=box.getSize(new THREE.Vector3),span=Math.max(dims.x,dims.y,dims.z,.05),dir=v.camera.position.clone().sub(v.controls.target);if(dir.lengthSq()<.01)dir.set(1,-1,.8);dir.normalize();const vfov=THREE.MathUtils.degToRad(v.camera.fov),hfov=2*Math.atan(Math.tan(vfov/2)*Math.max(.2,v.camera.aspect||1)),fitFov=Math.max(.08,Math.min(vfov,hfov)),distance=Math.max(span/(2*Math.tan(fitFov/2))*1.35,span*1.15,.08);v.controls.target.copy(c);v.camera.position.copy(c.clone().add(dir.multiplyScalar(distance)));v.camera.near=Math.max(.0005,distance/2000);v.camera.far=Math.max(20,distance+span*100);v.camera.updateProjectionMatrix();v.controls.update();dirtyRender=true}"
swap(v1_fit,v2_fit,'physical-content camera fit')

v1_marker='Editor3D visual fit v1: scale-aware camera; cradle excludes 24m demo ground'
v2_marker='Editor3D visual fit v2: physical bounds + scale-aware helpers; cradle excludes 24m demo ground'
if v1_marker in source:
    source=source.replace(v1_marker,v2_marker,1)
elif v2_marker not in source:
    source=source.replace('<head>','<head><!-- '+v2_marker+' -->',1)

assert helpers in source
assert sync_new in source
assert v2_fit in source
assert new_ground in source
assert v2_marker in source
assert v1_marker not in source
assert "new THREE.SphereGeometry(sj.has(j.id)?.11:.07,10,8)" not in source
assert "new THREE.SphereGeometry(sb.has(b.id)?.12:.08,12,8)" not in source
payload=base64.b64encode(gzip.compress(source.encode('utf-8'),compresslevel=9,mtime=0)).decode('ascii')
fixed=raw[:m.start(1)]+payload+raw[m.end(1):]
out_path.write_text(fixed,encoding='utf-8')
print('patched Editor3D visual fit v2; source bytes',len(source.encode('utf-8')),'wrapper bytes',len(fixed.encode('utf-8')))
