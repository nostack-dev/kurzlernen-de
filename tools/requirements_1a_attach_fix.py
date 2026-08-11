from pathlib import Path


def replace_once(path, old, new):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count!=1: raise SystemExit(f"{path}: expected one marker, found {count}: {old[:160]!r}")
    p.write_text(text.replace(old,new,1))

# Avoid Object3D.attach(): Three explicitly does not support preserving world
# transforms through non-uniformly-scaled scene graphs. For object hits, author
# the pooled decal directly in the hit mesh's local coordinates. Local position
# comes from worldToLocal(hitpoint + world-normal offset); local Z is aligned to
# the exact local raycast normal, so the parent's own inverse-transpose normal
# transform makes the rendered decal normal match the rendered target surface.
replace_once(
    "sim/flight_fire_fx.mjs",
    'const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),candidates=[],intersections=[],hitNormal=new THREE.Vector3(),hitNormalMatrix=new THREE.Matrix3(),decalForward=new THREE.Vector3(0,0,1),observedNodes=new Set();',
    'const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),candidates=[],intersections=[],hitNormal=new THREE.Vector3(),hitNormalMatrix=new THREE.Matrix3(),decalForward=new THREE.Vector3(0,0,1),decalLocalNormal=new THREE.Vector3(),decalWorldPoint=new THREE.Vector3(),observedNodes=new Set();',
)

p=Path("sim/flight_fire_fx.mjs"); text=p.read_text()
start=text.find('  function addThreeDecal(')
end=text.find('\n  function aimPoint()',start)
if start<0 or end<=start: raise SystemExit('cannot isolate addThreeDecal')
new_fn='''  function addThreeDecal(hit,kind="object",targetRoot=null){
    if(!hit?.point)return false;const hasWorldNormal=hit.worldNormal&&Number.isFinite(hit.worldNormal.x)&&Number.isFinite(hit.worldNormal.y)&&Number.isFinite(hit.worldNormal.z);if(hasWorldNormal)hitNormal.copy(hit.worldNormal).normalize();else{const localNormal=hit.normal||hit?.face?.normal;if(!localNormal||!hit.object)return false;decalLocalNormal.copy(localNormal).normalize();hitNormalMatrix.getNormalMatrix(hit.object.matrixWorld);hitNormal.copy(decalLocalNormal).applyMatrix3(hitNormalMatrix).normalize();if(hitNormal.dot(raycaster.ray.direction)>0){hitNormal.negate();decalLocalNormal.negate();}}
    const mesh=decalPool[decalCursor++%decalPool.length],spin=(decalWrites*2.399963229728653)%6.283185307179586;mesh.material=hasWorldNormal?worldDecalMaterial:objectDecalMaterial;mesh.scale.setScalar(.88+(decalWrites%5)*.055);mesh.renderOrder=hasWorldNormal?18:8;mesh.userData.flightFireWorld=Boolean(hasWorldNormal);mesh.userData.flightFireKind=kind;mesh.userData.flightFireTarget=Boolean(targetRoot);
    decalWorldPoint.copy(hit.point).addScaledVector(hitNormal,.0035);if(hasWorldNormal){scene.add(mesh);mesh.position.copy(decalWorldPoint);mesh.quaternion.setFromUnitVectors(decalForward,hitNormal);mesh.rotateZ(spin);}else{hit.object.add(mesh);mesh.position.copy(decalWorldPoint);hit.object.worldToLocal(mesh.position);mesh.quaternion.setFromUnitVectors(decalForward,decalLocalNormal);mesh.rotateZ(spin);}mesh.visible=true;mesh.updateMatrixWorld(true);
    decalWrites++;viewport.dataset.fireDecalWrites=String(decalWrites);emitImpact(kind,hit,targetRoot);return true;
  }'''
p.write_text(text[:start]+new_fn+text[end:])

# Replace the old positive attach() requirement before adding the stronger local
# authoring invariant. Keeping both would make the release gate self-contradictory.
replace_once(
    "tests/architecture_invariants.mjs",
    'for(const marker of ["RAYCAST_REFRESH_MS=500","function rebuildCandidates","fireRaycastBuilds","noiseSource.loop=true","hit.object?.attach","arondight45:impact","belongsToAirframe","worldHit.mapDecal"])requireText("sim/flight_fire_fx.mjs",marker);',
    'for(const marker of ["RAYCAST_REFRESH_MS=500","function rebuildCandidates","fireRaycastBuilds","noiseSource.loop=true","hit.object.add(mesh)","arondight45:impact","belongsToAirframe","worldHit.mapDecal"])requireText("sim/flight_fire_fx.mjs",marker);',
)
replace_once(
    "tests/architecture_invariants.mjs",
    'for(const marker of ["el.dataset.pulse","childadded","childremoved","candidatesDirty","intersections.find(item=>hitEligible(item.object))","hitNormalMatrix.getNormalMatrix(hit.object.matrixWorld)","hitNormal.dot(raycaster.ray.direction)>0"])requireText("sim/flight_fire_fx.mjs",marker);',
    'for(const marker of ["el.dataset.pulse","childadded","childremoved","candidatesDirty","intersections.find(item=>hitEligible(item.object))","hitNormalMatrix.getNormalMatrix(hit.object.matrixWorld)","hit.object.worldToLocal(mesh.position)","mesh.quaternion.setFromUnitVectors(decalForward,decalLocalNormal)"])requireText("sim/flight_fire_fx.mjs",marker);\nforbidText("sim/flight_fire_fx.mjs","hit.object?.attach","object impact decals must not use Object3D.attach under non-uniform scale");',
)

# Runtime test: on the deliberately rotated + non-uniform target, prove the
# rendered decal plane itself (normal matrix of its matrixWorld) matches the exact
# independently derived world surface normal, and starts at the physical hitpoint.
p=Path("tests/world_shot_decal_smoke.mjs"); text=p.read_text()
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'const decal=targetMesh.children.find(node=>node.userData?.flightFireDecal&&node.userData?.flightFireTarget);const p0=new THREE.Vector3(),p1=new THREE.Vector3();if(decal)decal.getWorldPosition(p0);targetRoot.position.x+=1;scene.updateMatrixWorld(true);if(decal)decal.getWorldPosition(p1);\n    const normalError=impact?.normal?Math.hypot(impact.normal.x-expectedNormal.x,impact.normal.y-expectedNormal.y,impact.normal.z-expectedNormal.z):Infinity;const result={before,after:Number(v.dataset.fireTargetHits||0),builds:Number(v.dataset.fireRaycastBuilds||0)-builds0,impact,normalError,attached:Boolean(decal),delta:decal?{x:p1.x-p0.x,y:p1.y-p0.y,z:p1.z-p0.z}:null};',
    'const decal=targetMesh.children.find(node=>node.userData?.flightFireDecal&&node.userData?.flightFireTarget);const p0=new THREE.Vector3(),p1=new THREE.Vector3(),decalWorldNormal=new THREE.Vector3(0,0,1),decalNormalMatrix=new THREE.Matrix3();if(decal){decal.getWorldPosition(p0);decalNormalMatrix.getNormalMatrix(decal.matrixWorld);decalWorldNormal.applyMatrix3(decalNormalMatrix).normalize();if(decalWorldNormal.dot(expectedNormal)<0)decalWorldNormal.negate();}const expectedPoint=probeHit.point.clone().addScaledVector(expectedNormal,.0035),decalPointError=decal?p0.distanceTo(expectedPoint):Infinity,decalNormalError=decal?decalWorldNormal.distanceTo(expectedNormal):Infinity;targetRoot.position.x+=1;scene.updateMatrixWorld(true);if(decal)decal.getWorldPosition(p1);\n    const normalError=impact?.normal?Math.hypot(impact.normal.x-expectedNormal.x,impact.normal.y-expectedNormal.y,impact.normal.z-expectedNormal.z):Infinity;const result={before,after:Number(v.dataset.fireTargetHits||0),builds:Number(v.dataset.fireRaycastBuilds||0)-builds0,impact,normalError,decalPointError,decalNormalError,attached:Boolean(decal),delta:decal?{x:p1.x-p0.x,y:p1.y-p0.y,z:p1.z-p0.z}:null};',
)
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'if(targetVisual.after!==targetVisual.before+1||targetVisual.builds!==1||targetVisual.impact?.kind!=="target"||!targetVisual.impact.target||!targetVisual.impact.object||targetVisual.normalError>1e-5||!targetVisual.attached||!near(targetVisual.delta?.x,1,.015)||!near(targetVisual.delta?.y,0,.015)||!near(targetVisual.delta?.z,0,.015))',
    'if(targetVisual.after!==targetVisual.before+1||targetVisual.builds!==1||targetVisual.impact?.kind!=="target"||!targetVisual.impact.target||!targetVisual.impact.object||targetVisual.normalError>1e-5||targetVisual.decalPointError>.002||targetVisual.decalNormalError>1e-5||!targetVisual.attached||!near(targetVisual.delta?.x,1,.015)||!near(targetVisual.delta?.y,0,.015)||!near(targetVisual.delta?.z,0,.015))',
)

print('scale-safe local object decal authoring applied')
