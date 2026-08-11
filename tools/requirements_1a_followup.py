from pathlib import Path


def replace_once(path, old, new):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count!=1:
        raise SystemExit(f"{path}: expected one marker, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old,new,1))

# A WORLD custom-layer decal is still a decal write. Keep the total monotonic
# across rendering backends so telemetry/tests never erase player impacts.
replace_once(
    "sim/flight_fire_fx.mjs",
    'if(worldHit.mapDecal){impacted=true;emitImpact("world",worldHit,null);}else impacted=addThreeDecal(worldHit,"world",null);',
    'if(worldHit.mapDecal){impacted=true;decalWrites++;viewport.dataset.fireDecalWrites=String(decalWrites);emitImpact("world",worldHit,null);}else impacted=addThreeDecal(worldHit,"world",null);',
)

# Each pooled screen element alternates its own animation name on reuse. No
# synchronous layout flush, and the animation still restarts after >pool shots.
replace_once(
    "sim/flight_fire_fx.mjs",
    'function screenImpact(x,y){const el=screenImpacts[screenImpactCursor++%screenImpacts.length];screenImpactPulse=!screenImpactPulse;el.style.left=`${x}px`;el.style.top=`${y}px`;el.classList.toggle("pulse-a",screenImpactPulse);el.classList.toggle("pulse-b",!screenImpactPulse);}',
    'function screenImpact(x,y){const el=screenImpacts[screenImpactCursor++%screenImpacts.length],pulse=el.dataset.pulse==="a"?"b":"a";el.dataset.pulse=pulse;el.style.left=`${x}px`;el.style.top=`${y}px`;el.classList.toggle("pulse-a",pulse==="a");el.classList.toggle("pulse-b",pulse==="b");}',
)

# MapLibre 5 normally supplies WebGL2, while the CustomLayer contract permits
# WebGL1 or WebGL2. Compile the appropriate shader dialect explicitly.
p=Path("sim/real_world_bootstrap.mjs"); text=p.read_text(); start=text.find("  onAdd(map,gl){", text.find("class WorldImpactLayer")); end=text.find("\n  addImpact(point,normal){",start)
if start<0 or end<=start:
    raise SystemExit("cannot isolate WorldImpactLayer.onAdd")
new_on_add='''  onAdd(map,gl){this.map=map;this.gl=gl;const webgl2=typeof WebGL2RenderingContext!=="undefined"&&gl instanceof WebGL2RenderingContext,vertexSource=webgl2?`#version 300 es\nin vec3 a_pos;in vec2 a_uv;uniform mat4 u_matrix;out vec2 v_uv;void main(){v_uv=a_uv;gl_Position=u_matrix*vec4(a_pos,1.0);}`:`attribute vec3 a_pos;attribute vec2 a_uv;uniform mat4 u_matrix;varying vec2 v_uv;void main(){v_uv=a_uv;gl_Position=u_matrix*vec4(a_pos,1.0);}`,fragmentSource=webgl2?`#version 300 es\nprecision mediump float;in vec2 v_uv;out vec4 outColor;void main(){float r=length(v_uv-vec2(.5));if(r>.5)discard;float edge=smoothstep(.30,.50,r);float alpha=1.0-smoothstep(.47,.50,r);vec3 color=mix(vec3(.018,.016,.014),vec3(.19,.15,.11),edge);outColor=vec4(color*alpha,alpha);}`:`precision mediump float;varying vec2 v_uv;void main(){float r=length(v_uv-vec2(.5));if(r>.5)discard;float edge=smoothstep(.30,.50,r);float alpha=1.0-smoothstep(.47,.50,r);vec3 color=mix(vec3(.018,.016,.014),vec3(.19,.15,.11),edge);gl_FragColor=vec4(color*alpha,alpha);}`,vertex=this.compile(gl,gl.VERTEX_SHADER,vertexSource),fragment=this.compile(gl,gl.FRAGMENT_SHADER,fragmentSource);this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);gl.deleteShader(vertex);gl.deleteShader(fragment);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(`WORLD impact program link failed: ${gl.getProgramInfoLog(this.program)||"unknown link error"}`);this.aPos=gl.getAttribLocation(this.program,"a_pos");this.aUv=gl.getAttribLocation(this.program,"a_uv");this.uMatrix=gl.getUniformLocation(this.program,"u_matrix");this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.vertices.byteLength,gl.DYNAMIC_DRAW);}'''
p.write_text(text[:start]+new_on_add+text[end:])

# Make GL compatibility and per-element animation restart release invariants.
arch=Path("tests/architecture_invariants.mjs"); text=arch.read_text()
marker='for(const marker of ["MercatorCoordinate","class WorldImpactLayer","arondight45-impact-decals","renderingMode=\\"3d\\"","WORLD_IMPACT_POOL_SIZE=32","worldImpactLayer.addImpact","worldImpactDepth=\\"maplibre-3d\\""])requireText("sim/real_world_bootstrap.mjs",marker);\n'
if marker not in text:
    raise SystemExit("WORLD depth invariant marker missing")
text=text.replace(marker,marker+'for(const marker of ["WebGL2RenderingContext","#version 300 es","gl_FragColor"])requireText("sim/real_world_bootstrap.mjs",marker);\n',1)
fire_marker='for(const marker of ["RAYCAST_REFRESH_MS=500","function rebuildCandidates","fireRaycastBuilds","noiseSource.loop=true","hit.object?.attach","arondight45:impact","belongsToAirframe","worldHit.mapDecal"])requireText("sim/flight_fire_fx.mjs",marker);\n'
if fire_marker not in text:
    raise SystemExit("fire hardening invariant marker missing")
text=text.replace(fire_marker,fire_marker+'requireText("sim/flight_fire_fx.mjs","el.dataset.pulse");\n',1)
arch.write_text(text)

# The moving-target release gate must isolate the intended ray without weakening
# the deliberate own-airframe blocker. Existing training geometry can otherwise
# sit in front of the fixture and make the test prove the wrong thing.
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'const THREE=await import("/node_modules/three/build/three.module.js"),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b.threeScene,cam=b.threeCamera,r=v.getBoundingClientRect(),dir=new THREE.Vector3();cam.getWorldDirection(dir);\n    const targetRoot=new THREE.Group();',
    'const THREE=await import("/node_modules/three/build/three.module.js"),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b.threeScene,cam=b.threeCamera,r=v.getBoundingClientRect(),dir=new THREE.Vector3(),hidden=[];cam.getWorldDirection(dir);scene.traverse(node=>{if(node.isMesh&&node.visible&&!node.userData?.flightFireDecal){hidden.push([node,node.visible]);node.visible=false;}});\n    const targetRoot=new THREE.Group();',
)
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'scene.remove(blockerRoot);scene.remove(targetRoot);targetMesh.geometry.dispose();targetMesh.material.dispose();blockerMesh.geometry.dispose();blockerMesh.material.dispose();return result;',
    'scene.remove(blockerRoot);scene.remove(targetRoot);for(const [node,visible]of hidden)node.visible=visible;targetMesh.geometry.dispose();targetMesh.material.dispose();blockerMesh.geometry.dispose();blockerMesh.material.dispose();return result;',
)

# Visual acknowledgement must not depend on gameplay metadata. An unmarked
# moving mesh still receives a generic object decal that follows its surface.
anchor='''  if(targetVisual.after!==targetVisual.before+1||targetVisual.builds!==1||targetVisual.impact?.kind!=="target"||!targetVisual.impact.target||!targetVisual.impact.object||!targetVisual.attached||!near(targetVisual.delta?.x,1,.015)||!near(targetVisual.delta?.y,0,.015)||!near(targetVisual.delta?.z,0,.015))\n    throw new Error(`moving target/airframe impact acknowledgement failed: ${JSON.stringify(targetVisual)}`);\n\n'''
if anchor not in Path("tests/world_shot_decal_smoke.mjs").read_text():
    raise SystemExit("moving-target assertion anchor missing")
generic='''  if(targetVisual.after!==targetVisual.before+1||targetVisual.builds!==1||targetVisual.impact?.kind!=="target"||!targetVisual.impact.target||!targetVisual.impact.object||!targetVisual.attached||!near(targetVisual.delta?.x,1,.015)||!near(targetVisual.delta?.y,0,.015)||!near(targetVisual.delta?.z,0,.015))\n    throw new Error(`moving target/airframe impact acknowledgement failed: ${JSON.stringify(targetVisual)}`);\n\n  const genericVisual=await page.evaluate(async()=>{\n    const THREE=await import("/node_modules/three/build/three.module.js"),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b.threeScene,cam=b.threeCamera,r=v.getBoundingClientRect(),dir=new THREE.Vector3(),hidden=[];cam.getWorldDirection(dir);scene.traverse(node=>{if(node.isMesh&&node.visible&&!node.userData?.flightFireDecal){hidden.push([node,node.visible]);node.visible=false;}});\n    const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(.6,.6,.6),new THREE.MeshBasicMaterial({color:0xffffff}));root.add(mesh);root.position.copy(cam.position).addScaledVector(dir,3);scene.add(root);scene.updateMatrixWorld(true);\n    let impact=null;v.addEventListener("arondight45:impact",e=>{impact={kind:e.detail.kind,target:Boolean(e.detail.target),object:e.detail.object===mesh};},{once:true});\n    const before=Number(v.dataset.fireObjectHits||0),x=r.left+r.width*.5,y=r.top+r.height*.5,send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:504,pointerType:"touch",clientX:x,clientY:y,button:0}));\n    send("pointerdown");await new Promise(resolve=>setTimeout(resolve,35));send("pointerup");await new Promise(resolve=>setTimeout(resolve,20));scene.updateMatrixWorld(true);\n    const decal=mesh.children.find(node=>node.userData?.flightFireDecal&&node.userData?.flightFireKind==="object"&&!node.userData?.flightFireTarget),p0=new THREE.Vector3(),p1=new THREE.Vector3();if(decal)decal.getWorldPosition(p0);root.position.x+=.75;scene.updateMatrixWorld(true);if(decal)decal.getWorldPosition(p1);\n    const result={before,after:Number(v.dataset.fireObjectHits||0),impact,attached:Boolean(decal),delta:decal?{x:p1.x-p0.x,y:p1.y-p0.y,z:p1.z-p0.z}:null};\n    scene.remove(root);for(const [node,visible]of hidden)node.visible=visible;mesh.geometry.dispose();mesh.material.dispose();return result;\n  });\n  if(genericVisual.after!==genericVisual.before+1||genericVisual.impact?.kind!=="object"||genericVisual.impact.target||!genericVisual.impact.object||!genericVisual.attached||!near(genericVisual.delta?.x,.75,.015)||!near(genericVisual.delta?.y,0,.015)||!near(genericVisual.delta?.z,0,.015))\n    throw new Error(`unmarked moving-object impact was ignored or detached: ${JSON.stringify(genericVisual)}`);\n\n'''
p=Path("tests/world_shot_decal_smoke.mjs");p.write_text(p.read_text().replace(anchor,generic,1))

print("1a follow-up hardening applied")
