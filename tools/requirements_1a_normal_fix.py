from pathlib import Path


def replace_once(path, old, new):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count!=1: raise SystemExit(f"{path}: expected one marker, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old,new,1))

# Three r185 produces raycast intersection.normal in mesh-local space. Convert
# with the inverse-transpose normal matrix, including non-uniform scale, and make
# sure the decal normal faces against the incoming world ray.
replace_once(
    "sim/flight_fire_fx.mjs",
    'const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),candidates=[],intersections=[],hitNormal=new THREE.Vector3(),decalForward=new THREE.Vector3(0,0,1),observedNodes=new Set();',
    'const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),candidates=[],intersections=[],hitNormal=new THREE.Vector3(),hitNormalMatrix=new THREE.Matrix3(),decalForward=new THREE.Vector3(0,0,1),observedNodes=new Set();',
)
replace_once(
    "sim/flight_fire_fx.mjs",
    'if(hasWorldNormal)hitNormal.copy(hit.worldNormal).normalize();else{if(!hit.object)return false;if(hit.normal)hitNormal.copy(hit.normal).normalize();else{if(!hit?.face?.normal)return false;hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();}}',
    'if(hasWorldNormal)hitNormal.copy(hit.worldNormal).normalize();else{const localNormal=hit.normal||hit?.face?.normal;if(!localNormal||!hit.object)return false;hitNormalMatrix.getNormalMatrix(hit.object.matrixWorld);hitNormal.copy(localNormal).applyMatrix3(hitNormalMatrix).normalize();if(hitNormal.dot(raycaster.ray.direction)>0)hitNormal.negate();}',
)

replace_once(
    "tests/architecture_invariants.mjs",
    'for(const marker of ["el.dataset.pulse","childadded","childremoved","candidatesDirty","intersections.find(item=>hitEligible(item.object))","if(hit.normal)hitNormal.copy(hit.normal)"])requireText("sim/flight_fire_fx.mjs",marker);',
    'for(const marker of ["el.dataset.pulse","childadded","childremoved","candidatesDirty","intersections.find(item=>hitEligible(item.object))","hitNormalMatrix.getNormalMatrix(hit.object.matrixWorld)","hitNormal.dot(raycaster.ray.direction)>0"])requireText("sim/flight_fire_fx.mjs",marker);',
)

# Strengthen the moving-target browser fixture: rotated + non-uniformly scaled
# object, independently derive the expected world-space raycast normal and compare
# against the gameplay impact event.
p=Path("tests/world_shot_decal_smoke.mjs"); text=p.read_text()
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'const targetRoot=new THREE.Group();targetRoot.userData.flightTarget=true;const targetMesh=new THREE.Mesh(new THREE.BoxGeometry(.6,.6,.6),new THREE.MeshBasicMaterial({color:0xffffff}));targetRoot.add(targetMesh);targetRoot.position.copy(cam.position).addScaledVector(dir,3);scene.add(targetRoot);',
    'const targetRoot=new THREE.Group();targetRoot.userData.flightTarget=true;const targetMesh=new THREE.Mesh(new THREE.BoxGeometry(.6,.6,.6),new THREE.MeshBasicMaterial({color:0xffffff}));targetMesh.rotation.set(.31,-.27,.19);targetMesh.scale.set(1.7,.65,1.25);targetRoot.add(targetMesh);targetRoot.position.copy(cam.position).addScaledVector(dir,3);scene.add(targetRoot);',
)
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'let impact=null;v.addEventListener("arondight45:impact",e=>{impact={kind:e.detail.kind,target:e.detail.target===targetRoot,object:e.detail.object===targetMesh,point:e.detail.point};},{once:true});\n    const before=Number(v.dataset.fireTargetHits||0),builds0=Number(v.dataset.fireRaycastBuilds||0),x=r.left+r.width*.5,y=r.top+r.height*.5,send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:502,pointerType:"touch",clientX:x,clientY:y,button:0}));',
    'const probe=new THREE.Raycaster();probe.setFromCamera(new THREE.Vector2(0,0),cam);const probeHit=probe.intersectObject(targetMesh,false)[0],expectedNormal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();if(!probeHit)throw new Error("rotated target fixture was not raycastable");normalMatrix.getNormalMatrix(targetMesh.matrixWorld);expectedNormal.copy(probeHit.normal||probeHit.face.normal).applyMatrix3(normalMatrix).normalize();if(expectedNormal.dot(probe.ray.direction)>0)expectedNormal.negate();\n    let impact=null;v.addEventListener("arondight45:impact",e=>{impact={kind:e.detail.kind,target:e.detail.target===targetRoot,object:e.detail.object===targetMesh,point:e.detail.point,normal:e.detail.normal};},{once:true});\n    const before=Number(v.dataset.fireTargetHits||0),builds0=Number(v.dataset.fireRaycastBuilds||0),x=r.left+r.width*.5,y=r.top+r.height*.5,send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:502,pointerType:"touch",clientX:x,clientY:y,button:0}));',
)
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'const result={before,after:Number(v.dataset.fireTargetHits||0),builds:Number(v.dataset.fireRaycastBuilds||0)-builds0,impact,attached:Boolean(decal),delta:decal?{x:p1.x-p0.x,y:p1.y-p0.y,z:p1.z-p0.z}:null};',
    'const normalError=impact?.normal?Math.hypot(impact.normal.x-expectedNormal.x,impact.normal.y-expectedNormal.y,impact.normal.z-expectedNormal.z):Infinity;const result={before,after:Number(v.dataset.fireTargetHits||0),builds:Number(v.dataset.fireRaycastBuilds||0)-builds0,impact,normalError,attached:Boolean(decal),delta:decal?{x:p1.x-p0.x,y:p1.y-p0.y,z:p1.z-p0.z}:null};',
)
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'if(targetVisual.after!==targetVisual.before+1||targetVisual.builds!==1||targetVisual.impact?.kind!=="target"||!targetVisual.impact.target||!targetVisual.impact.object||!targetVisual.attached||!near(targetVisual.delta?.x,1,.015)||!near(targetVisual.delta?.y,0,.015)||!near(targetVisual.delta?.z,0,.015))',
    'if(targetVisual.after!==targetVisual.before+1||targetVisual.builds!==1||targetVisual.impact?.kind!=="target"||!targetVisual.impact.target||!targetVisual.impact.object||targetVisual.normalError>1e-5||!targetVisual.attached||!near(targetVisual.delta?.x,1,.015)||!near(targetVisual.delta?.y,0,.015)||!near(targetVisual.delta?.z,0,.015))',
)

# Dependency order matters: render_fix authors the base MapLibre invariant;
# context_fix extends it; surface_fix then replaces the base-cap contract;
# attach_fix finally hardens object-local decal placement. All temporary drivers
# delete themselves so the validated release tree stays product-only.
context_script=Path("tools/requirements_1a_context_fix.py")
exec(compile(context_script.read_text(),str(context_script),"exec"),{})
context_script.unlink()
surface_script=Path("tools/requirements_1a_surface_fix.py")
exec(compile(surface_script.read_text(),str(surface_script),"exec"),{})
surface_script.unlink()
attach_script=Path("tools/requirements_1a_attach_fix.py")
exec(compile(attach_script.read_text(),str(attach_script),"exec"),{})
attach_script.unlink()

print('object-normal, context-recovery, rendered-surface and scale-safe attachment hardening applied')
