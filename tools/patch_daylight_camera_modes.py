from pathlib import Path

p = Path('sim/simulator.mjs')
s = p.read_text()

old = '''THREE.Object3D.DEFAULT_UP.set(0,0,1);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x080d16);scene.fog=new THREE.Fog(0x080d16,8,35);
const camera=new THREE.PerspectiveCamera(58,1,.01,100);camera.up.set(0,0,1);camera.position.set(3.3,-4.2,2.6);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;$("viewport").appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xbfd8ff,0x263248,1.4));const sun=new THREE.DirectionalLight(0xffffff,2.3);sun.position.set(-4,-5,8);sun.castShadow=true;scene.add(sun);
const grid=new THREE.GridHelper(20,40,0x40506b,0x202a3a);grid.rotation.x=Math.PI/2;scene.add(grid);const groundMesh=new THREE.Mesh(new THREE.BoxGeometry(20,20,.1),new THREE.MeshStandardMaterial({color:0x182231,roughness:.9}));groundMesh.position.z=-.05;groundMesh.receiveShadow=true;scene.add(groundMesh);
function resize(){const bounds=$("viewport").getBoundingClientRect();renderer.setSize(bounds.width,bounds.height,false);camera.aspect=bounds.width/Math.max(1,bounds.height);camera.updateProjectionMatrix();}addEventListener("resize",resize);resize();
'''
new = '''THREE.Object3D.DEFAULT_UP.set(0,0,1);
function daylightSky(){
  const canvas=document.createElement("canvas");canvas.width=4;canvas.height=512;
  const ctx=canvas.getContext("2d"),gradient=ctx.createLinearGradient(0,0,0,canvas.height);
  gradient.addColorStop(0,"#82c5ff");gradient.addColorStop(.58,"#d7ecfb");gradient.addColorStop(1,"#f5f4e9");
  ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
const scene=new THREE.Scene();scene.background=daylightSky();scene.fog=new THREE.Fog(0xd7e8f2,14,52);
const camera=new THREE.PerspectiveCamera(52,1,.01,120);camera.up.set(0,0,1);camera.position.set(1.65,0,.8);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;$("viewport").appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xf8fcff,0x7f946d,2.0));const sun=new THREE.DirectionalLight(0xfff7e8,2.6);sun.position.set(-4,-6,10);sun.castShadow=true;scene.add(sun);
const grid=new THREE.GridHelper(20,40,0x6b7d89,0xa7b6bd);grid.rotation.x=Math.PI/2;grid.position.z=.002;scene.add(grid);const groundMesh=new THREE.Mesh(new THREE.BoxGeometry(20,20,.1),new THREE.MeshStandardMaterial({color:0xa9b99a,roughness:.96,metalness:0}));groundMesh.position.z=-.05;groundMesh.receiveShadow=true;scene.add(groundMesh);
const cameraHud=document.createElement("div");cameraHud.id="cameraModes";cameraHud.setAttribute("aria-label","Camera mode");cameraHud.innerHTML='<button id="camFollow" type="button">FOLLOW</button><button id="camFpv" type="button">FPV</button>';
Object.assign(cameraHud.style,{position:"absolute",zIndex:"4",top:"12px",left:"50%",transform:"translateX(-50%)",display:"flex",gap:"6px",padding:"5px",borderRadius:"10px",background:"rgba(20,31,45,.72)",border:"1px solid rgba(255,255,255,.28)",backdropFilter:"blur(8px)",boxShadow:"0 5px 18px rgba(0,0,0,.18)"});
for(const button of cameraHud.querySelectorAll("button"))Object.assign(button.style,{minWidth:"76px",padding:"7px 10px",borderRadius:"7px",border:"1px solid rgba(255,255,255,.3)",background:"rgba(17,29,43,.82)",color:"#fff",font:"700 12px system-ui,-apple-system,sans-serif",letterSpacing:".04em"});
$("viewport").appendChild(cameraHud);
function resize(){const bounds=$("viewport").getBoundingClientRect();renderer.setSize(bounds.width,bounds.height,false);camera.aspect=bounds.width/Math.max(1,bounds.height);camera.updateProjectionMatrix();}addEventListener("resize",resize);resize();
'''
assert old in s, 'scene block changed; refusing fuzzy patch'
s = s.replace(old, new, 1)

old = '''let physics=new PhysicsModel(defaultParams(),{graphics:true,scene});
let mode="sim",backend=null,running=false,sequence=1,simTime=0,resetFlag=true;
'''
new = '''let physics=new PhysicsModel(defaultParams(),{graphics:true,scene});
let cameraMode=localStorage.getItem("arondight45CameraMode")==="fpv"?"fpv":"follow",cameraFollowInitialized=false;
const followHeading=new THREE.Vector3(-1,0,0);
function setCameraMode(next){
  cameraMode=next==="fpv"?"fpv":"follow";cameraFollowInitialized=false;localStorage.setItem("arondight45CameraMode",cameraMode);$("viewport").dataset.cameraMode=cameraMode;
  for(const [id,value] of [["camFollow","follow"],["camFpv","fpv"]]){
    const button=$(id),active=cameraMode===value;button.dataset.active=active?"1":"0";button.style.background=active?"#17694f":"rgba(17,29,43,.82)";button.style.borderColor=active?"#62d6aa":"rgba(255,255,255,.3)";
  }
}
function updateCamera(){
  const position=new THREE.Vector3(...physics.position()),raw=physics.rotation(),q=new THREE.Quaternion(raw[0],raw[1],raw[2],raw[3]);
  const bodyForward=new THREE.Vector3(-1,0,0).applyQuaternion(q).normalize();
  if(cameraMode==="fpv"){
    const bodyUp=new THREE.Vector3(0,0,1).applyQuaternion(q).normalize();
    camera.position.copy(position).addScaledVector(bodyForward,.095).addScaledVector(bodyUp,.045);
    camera.up.copy(bodyUp);camera.lookAt(camera.position.clone().addScaledVector(bodyForward,4));
    if(camera.fov!==84){camera.fov=84;camera.updateProjectionMatrix();}
    return;
  }
  const horizontal=bodyForward.clone();horizontal.z=0;
  if(horizontal.lengthSq()>.04){horizontal.normalize();followHeading.lerp(horizontal,.12).normalize();}
  const desired=position.clone().addScaledVector(followHeading,-1.65);desired.z+=.78;
  const look=position.clone().addScaledVector(followHeading,.38);look.z+=.10;
  camera.up.set(0,0,1);
  if(!cameraFollowInitialized){camera.position.copy(desired);cameraFollowInitialized=true;}else camera.position.lerp(desired,.075);
  camera.lookAt(look);
  if(camera.fov!==52){camera.fov=52;camera.updateProjectionMatrix();}
}
$("camFollow").onclick=()=>setCameraMode("follow");$("camFpv").onclick=()=>setCameraMode("fpv");setCameraMode(cameraMode);
let mode="sim",backend=null,running=false,sequence=1,simTime=0,resetFlag=true;
'''
assert old in s, 'physics declaration changed; refusing fuzzy patch'
s = s.replace(old, new, 1)

old = '''function render(){
  requestAnimationFrame(render);physics.render();const state=physics.state(),position=physics.position(),target=new THREE.Vector3(...position),desired=target.clone().add(new THREE.Vector3(3.3,-4.2,2.4));camera.position.lerp(desired,.025);camera.lookAt(target);
'''
new = '''function render(){
  requestAnimationFrame(render);physics.render();updateCamera();const state=physics.state();
'''
assert old in s, 'render camera block changed; refusing fuzzy patch'
s = s.replace(old, new, 1)

assert 'scene.background=daylightSky()' in s
assert 'function updateCamera()' in s
assert 'cameraMode==="fpv"' in s
assert 'addScaledVector(followHeading,-1.65)' in s
p.write_text(s)

# Strengthen browser smoke test with actual mode switching.
t = Path('tests/browser_sim_smoke.mjs')
ts = t.read_text()
old = '''  if (externalRequests.length) throw new Error(`self-contained simulator made external requests: ${externalRequests.join(", ")}`);

  // This smoke test validates the standalone local fallback path. The separate
'''
new = '''  if (externalRequests.length) throw new Error(`self-contained simulator made external requests: ${externalRequests.join(", ")}`);

  const cameraBoot = await page.evaluate(() => ({
    mode: document.querySelector("#viewport")?.dataset.cameraMode || "",
    follow: document.querySelector("#camFollow")?.dataset.active || "",
    fpv: document.querySelector("#camFpv")?.dataset.active || "",
  }));
  if (cameraBoot.mode !== "follow" || cameraBoot.follow !== "1") throw new Error(`FOLLOW camera is not default: ${JSON.stringify(cameraBoot)}`);
  await page.click("#camFpv");
  const fpvMode = await page.$eval("#viewport", element => element.dataset.cameraMode || "");
  if (fpvMode !== "fpv") throw new Error(`FPV camera switch failed: ${fpvMode}`);
  await page.click("#camFollow");
  const followMode = await page.$eval("#viewport", element => element.dataset.cameraMode || "");
  if (followMode !== "follow") throw new Error(`FOLLOW camera switch failed: ${followMode}`);

  // This smoke test validates the standalone local fallback path. The separate
'''
assert old in ts, 'browser smoke insertion point changed; refusing fuzzy patch'
ts = ts.replace(old, new, 1)
ts = ts.replace('Browser SIL E2E passed: self-contained boot, local fallback, calibration, arm, idle RPM, throttle, responsive layout.', 'Browser SIL E2E passed: daylight scene, FOLLOW/FPV cameras, self-contained boot, local fallback, calibration, arm, idle RPM, throttle, responsive layout.')
t.write_text(ts)
