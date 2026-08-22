import * as THREE from "three";

const PLAYER_MODE_KEY="arondight45PlayerModeV2";
const EYE_Z=1.68;
const WALK_MPS=4.4;
const SPRINT_MPS=7.0;
const LOOK_YAW_RATE=2.45;
const LOOK_PITCH_RATE=1.85;
const FIRE_INTERVAL_MS=165;
const DECAL_POOL_SIZE=16;
const MUZZLE_FLASH_MS=70;
const RECOIL_MS=125;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

let installed=false,mode="drone",lastFrame=performance.now(),lastShot=-Infinity,bridgeWrapped=false;
let decalPool=null,decalCursor=0,weaponGroup=null,weaponScene=null,muzzleFlash=null;
const state={position:new THREE.Vector3(0,0,EYE_Z),yaw:0,pitch:0,initialized:false,move:{x:0,y:0},look:{x:0,y:0},keys:new Set(),xboxY:false};
const raycaster=new THREE.Raycaster(),direction=new THREE.Vector3(),target=new THREE.Vector3(),normal=new THREE.Vector3(0,0,1),zAxis=new THREE.Vector3(0,0,1);
const weaponLocal=new THREE.Vector3(),weaponWorld=new THREE.Vector3();

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function readMode(){try{return localStorage.getItem(PLAYER_MODE_KEY)==="foot"?"foot":"drone";}catch{return"drone";}}
function saveMode(value){try{localStorage.setItem(PLAYER_MODE_KEY,value);}catch{}}
function pointInside(x,y,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j],cross=(a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/((b[1]-a[1])||1e-12)+a[0];if(cross)inside=!inside;}return inside;}
function insideBuilding(x,y){for(const prism of bridge()?.buildingCollisionSnapshot?.prisms||[]){if(Number(prism?.top)>.2&&Array.isArray(prism.points)&&prism.points.length>=3&&pointInside(x,y,prism.points))return true;}return false;}
function canWalkTo(x,y){return!insideBuilding(x,y);}
function canWalkStep(x,y){return insideBuilding(state.position.x,state.position.y)||canWalkTo(x,y);}
function gamepad(){return Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected&&(p.mapping==="standard"||/xbox|xinput|045e/i.test(String(p.id||""))))||null;}
function axis(v,d=.14){const x=clamp(v,-1,1),a=Math.abs(x);return a<=d?0:Math.sign(x)*(a-d)/(1-d);}
function button(pad,index){const b=pad?.buttons?.[index];return clamp(typeof b==="number"?b:(b?.value??(b?.pressed?1:0)),0,1);}

function installStyle(){if(document.querySelector("style[data-player-walk-mode]"))return;const style=document.createElement("style");style.dataset.playerWalkMode="v3";style.textContent=`
#playerModeButton{border-color:#78d8ff66!important;background:#0b2740e8!important;color:#e5f8ff!important}
body.on-foot-mode #playerModeButton{border-color:#ffd36b88!important;background:#402b10e8!important;color:#fff1c9!important}
#footHud{display:none;position:absolute;inset:0;z-index:8;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;color:#eef8ff}
body.on-foot-mode #footHud{display:block}
body.on-foot-mode #soloLeft,body.on-foot-mode #soloRight,body.on-foot-mode #soloClearance,body.on-foot-mode .solo-action{display:none!important;opacity:0!important;pointer-events:none!important}
body.on-foot-mode #soloState{display:none!important}
body.on-foot-mode #soloRaceHud{display:none!important}
.foot-stick{position:absolute;bottom:max(18px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));width:min(25vw,150px);aspect-ratio:1;border-radius:50%;border:1px solid #c6edff55;background:#0715227d;box-shadow:inset 0 0 34px #39bdf01c,0 6px 20px #0006;pointer-events:auto;touch-action:none}
#footMove{left:max(12px,var(--solo-safe-left,env(safe-area-inset-left)))}#footLook{right:max(12px,var(--solo-safe-right,env(safe-area-inset-right)))}
.foot-stick .ring{position:absolute;inset:0;border-radius:50%;border:1px solid #e6f8ff33}.foot-stick .knob{position:absolute;left:50%;top:50%;width:32%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:#e9f8ffcc;border:1px solid #fff;box-shadow:0 3px 12px #0008}.foot-stick span{position:absolute;left:50%;bottom:-15px;transform:translateX(-50%);font:850 9px/1 system-ui;letter-spacing:.08em;white-space:nowrap;text-shadow:0 2px 5px #000}
#footFire{position:absolute;right:calc(max(12px,var(--solo-safe-right,env(safe-area-inset-right))) + min(25vw,150px) + 14px);bottom:max(28px,calc(var(--solo-safe-bottom,env(safe-area-inset-bottom)) + 28px));width:68px;height:68px;border-radius:50%;border:1px solid #ffd17299;background:#4d2d12e8;color:#fff2cf;font:900 11px system-ui;box-shadow:0 6px 22px #0007,inset 0 0 18px #ffb13d22;pointer-events:auto;touch-action:none}
#footReadout{position:absolute;left:50%;top:max(46px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 40px));transform:translateX(-50%);padding:5px 9px;border-radius:8px;background:#071522c7;border:1px solid #ffffff22;font:850 9px/1 system-ui;letter-spacing:.08em;pointer-events:none}#footReadout b{color:#ffd36b}
#footReticle{position:absolute;left:50%;top:50%;width:8px;height:8px;transform:translate(-50%,-50%);border:1px solid #f5fbffcc;border-radius:50%;box-shadow:0 0 5px #000,0 0 7px #fff4;opacity:.85}
@media(max-height:340px){.foot-stick{width:min(22vw,128px);bottom:max(16px,var(--solo-safe-bottom,env(safe-area-inset-bottom)))}#footFire{right:calc(max(10px,var(--solo-safe-right,env(safe-area-inset-right))) + min(22vw,128px) + 10px);width:58px;height:58px;bottom:max(20px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));font-size:9px}}
`;document.head.appendChild(style);}

function mountHud(){const view=viewport();if(!view||document.getElementById("footHud"))return;const hud=document.createElement("div");hud.id="footHud";hud.innerHTML=`<div id="footReadout"><b>WALK READY</b> · no arming · left move · right look</div><div id="footReticle" aria-hidden="true"></div><div id="footMove" class="foot-stick" aria-label="Move"><div class="ring"></div><div class="knob"></div><span>MOVE</span></div><div id="footLook" class="foot-stick" aria-label="Look"><div class="ring"></div><div class="knob"></div><span>LOOK</span></div><button id="footFire" type="button">FIRE</button>`;view.appendChild(hud);
  const bindStick=(el,out)=>{let pointer=null;const knob=el.querySelector(".knob");const apply=e=>{const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,rad=Math.max(1,r.width*.38),dx=e.clientX-cx,dy=e.clientY-cy,len=Math.max(1,Math.hypot(dx,dy)),s=Math.min(1,rad/len);out.x=clamp(dx/rad,-1,1)*s;out.y=clamp(dy/rad,-1,1)*s;knob.style.left=`${50+out.x*31}%`;knob.style.top=`${50+out.y*31}%`;e.preventDefault();e.stopPropagation();};el.addEventListener("pointerdown",e=>{pointer=e.pointerId;el.setPointerCapture?.(pointer);apply(e);});el.addEventListener("pointermove",e=>{if(e.pointerId===pointer)apply(e);});const release=e=>{if(pointer===null||e.pointerId!==pointer)return;pointer=null;out.x=0;out.y=0;knob.style.left="50%";knob.style.top="50%";e.preventDefault();e.stopPropagation();};el.addEventListener("pointerup",release);el.addEventListener("pointercancel",release);};
  bindStick(hud.querySelector("#footMove"),state.move);bindStick(hud.querySelector("#footLook"),state.look);const fire=hud.querySelector("#footFire");fire.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();fireFoot();});for(const type of ["pointerup","pointercancel"])fire.addEventListener(type,e=>{e.preventDefault();e.stopPropagation();});
}
function mountModeButton(){const top=document.getElementById("soloTopbar");if(!top||document.getElementById("playerModeButton"))return;const button=document.createElement("button");button.id="playerModeButton";button.type="button";button.addEventListener("click",()=>setMode(mode==="foot"?"drone":"foot"));top.insertBefore(button,document.getElementById("soloCamera")||null);renderModeButton();}
function renderModeButton(){const b=document.getElementById("playerModeButton");if(b)b.textContent=mode==="foot"?"WALK ✓":"DRONE ✓";}

function initialize(){if(state.initialized)return;const b=bridge(),airframe=b?.threeScene?(b.airframeFor?.(b.threeScene)||b.airframe):null,p=airframe?.position;state.position.set(Number(p?.x)||0,Number(p?.y)||0,EYE_Z);state.yaw=0;state.pitch=0;state.initialized=true;}
function setMode(next,{persist=true}={}){mode=next==="foot"?"foot":"drone";if(persist)saveMode(mode);globalThis.__arondightOnFootMode=mode==="foot";document.body.classList.toggle("on-foot-mode",mode==="foot");const view=viewport();if(view){view.dataset.playerMode=mode;view.dataset.walkRequiresArm="0";}if(mode==="foot"){initialize();state.move.x=state.move.y=state.look.x=state.look.y=0;}else{state.keys.clear();state.move.x=state.move.y=state.look.x=state.look.y=0;if(weaponGroup)weaponGroup.visible=false;}renderModeButton();return mode;}

function applyFootCamera(camera){initialize();camera.position.copy(state.position);camera.up.set(0,0,1);const cp=Math.cos(state.pitch);direction.set(Math.sin(state.yaw)*cp,Math.cos(state.yaw)*cp,Math.sin(state.pitch)).normalize();target.copy(camera.position).add(direction);camera.lookAt(target);camera.updateMatrixWorld?.(true);}
function primitive(geometry,material,x,y,z,rx=0,ry=0,rz=0){const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.rotation.set(rx,ry,rz);mesh.frustumCulled=false;mesh.renderOrder=10000;mesh.userData.flightFireIgnore=true;mesh.userData.walkWeaponPart=true;return mesh;}
function ensureWeapon(scene){
  if(weaponGroup&&weaponScene===scene)return weaponGroup;
  if(weaponGroup?.parent)weaponGroup.parent.remove(weaponGroup);
  const gun=new THREE.Group();gun.name="WALK_PISTOL_3D";gun.userData.flightFireIgnore=true;gun.userData.walkWeapon3d=true;
  const metal=new THREE.MeshStandardMaterial({color:0x343b42,roughness:.34,metalness:.72,depthTest:false,depthWrite:false});
  const dark=new THREE.MeshStandardMaterial({color:0x0f1418,roughness:.66,metalness:.18,depthTest:false,depthWrite:false});
  const edge=new THREE.MeshStandardMaterial({color:0x68737d,roughness:.3,metalness:.82,depthTest:false,depthWrite:false});
  const skin=new THREE.MeshStandardMaterial({color:0xb97855,roughness:.78,metalness:0,depthTest:false,depthWrite:false});
  gun.add(primitive(new THREE.BoxGeometry(.086,.076,.34),metal,0,.01,-.16));
  gun.add(primitive(new THREE.BoxGeometry(.091,.018,.22),edge,0,.054,-.17));
  gun.add(primitive(new THREE.BoxGeometry(.074,.084,.18),dark,0,-.045,-.045,.18,0,0));
  gun.add(primitive(new THREE.BoxGeometry(.058,.19,.09),dark,0,-.15,.005,-.22,0,0));
  gun.add(primitive(new THREE.CylinderGeometry(.014,.014,.28,12),dark,0,.007,-.205,Math.PI/2,0,0));
  gun.add(primitive(new THREE.BoxGeometry(.018,.018,.018),edge,0,.064,-.31));
  gun.add(primitive(new THREE.BoxGeometry(.014,.018,.018),edge,0,.064,-.03));
  const hand=primitive(new THREE.SphereGeometry(.078,14,10),skin,.015,-.195,.055,0,0,-.08);hand.scale.set(1,.8,1.25);gun.add(hand);
  const forearm=primitive(new THREE.CylinderGeometry(.055,.071,.34,12),skin,.035,-.33,.17,.64,0,.12);gun.add(forearm);
  muzzleFlash=new THREE.Group();muzzleFlash.name="WALK_MUZZLE_FLASH";muzzleFlash.position.set(0,.008,-.36);muzzleFlash.userData.flightFireIgnore=true;
  const flashMat=new THREE.MeshBasicMaterial({color:0xffd36b,transparent:true,opacity:.95,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending});
  const flashCore=primitive(new THREE.SphereGeometry(.035,8,6),flashMat,0,0,0);const flashCone=primitive(new THREE.ConeGeometry(.05,.13,8),flashMat,0,0,-.065,Math.PI/2,0,0);muzzleFlash.add(flashCore,flashCone);muzzleFlash.visible=false;gun.add(muzzleFlash);
  gun.visible=false;scene.add(gun);weaponGroup=gun;weaponScene=scene;const view=viewport();if(view)view.dataset.walkWeapon3d="1";return gun;
}
function placeWeapon(camera,scene,now){const gun=ensureWeapon(scene);const age=now-lastShot,recoil=age>=0&&age<RECOIL_MS?Math.sin((age/RECOIL_MS)*Math.PI):0;weaponLocal.set(.27,-.23,-.48+recoil*.07);weaponWorld.copy(weaponLocal);camera.localToWorld(weaponWorld);gun.position.copy(weaponWorld);gun.quaternion.copy(camera.quaternion);gun.rotateX(-.035-recoil*.05);gun.rotateY(-.08);gun.rotateZ(-.025);gun.visible=true;if(muzzleFlash)muzzleFlash.visible=age>=0&&age<MUZZLE_FLASH_MS;}
function wrapBridge(){const b=bridge();if(!b||bridgeWrapped)return;bridgeWrapped=true;const baseRender=b.renderFrame?.bind(b);if(typeof baseRender==="function"){b.renderFrame=(renderer,scene,camera)=>{if(mode!=="foot"){if(weaponGroup)weaponGroup.visible=false;return baseRender(renderer,scene,camera);}const p=camera.position.clone(),q=camera.quaternion.clone(),u=camera.up.clone();applyFootCamera(camera);placeWeapon(camera,scene,performance.now());try{const handled=baseRender(renderer,scene,camera);if(!handled)renderer.render(scene,camera);return true;}finally{camera.position.copy(p);camera.quaternion.copy(q);camera.up.copy(u);camera.updateMatrixWorld?.(true);}};}const baseLook=b.applyLookCamera?.bind(b);if(typeof baseLook==="function")b.applyLookCamera=(scene,camera)=>mode==="foot"?camera:baseLook(scene,camera);b.__playerWalkModeBridgeV3=true;}

function ensureDecals(scene){if(decalPool)return decalPool;const g=new THREE.CircleGeometry(.035,10),m=new THREE.MeshBasicMaterial({color:0x151515,transparent:true,opacity:.9,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,side:THREE.DoubleSide});decalPool=Array.from({length:DECAL_POOL_SIZE},()=>{const mesh=new THREE.Mesh(g,m);mesh.visible=false;mesh.userData.flightFireIgnore=true;mesh.userData.flightFireDecal=true;scene.add(mesh);return mesh;});return decalPool;}
function addDecal(hit){const scene=bridge()?.threeScene;if(!scene||!hit?.point)return;const pool=ensureDecals(scene),mesh=pool[decalCursor++%pool.length],n=hit.worldNormal||normal;mesh.position.copy(hit.point).addScaledVector(n,.004);mesh.quaternion.setFromUnitVectors(zAxis,n.clone?.().normalize?.()||normal);mesh.visible=true;mesh.userData.flightFireWorld=Boolean(bridge()?.active);const view=viewport();if(view)view.dataset.walkDecals=String((Number(view.dataset.walkDecals)||0)+1);}
function fireFoot(now=performance.now()){if(mode!=="foot"||now-lastShot<FIRE_INTERVAL_MS)return false;lastShot=now;initialize();const b=bridge(),scene=b?.threeScene;if(!scene)return false;const cp=Math.cos(state.pitch);direction.set(Math.sin(state.yaw)*cp,Math.cos(state.yaw)*cp,Math.sin(state.pitch)).normalize();raycaster.set(state.position,direction);raycaster.far=180;const candidates=[];scene.traverse(obj=>{if(obj?.isMesh&&obj.visible!==false&&obj.userData?.worldPopulationKind&&!obj.userData?.worldPopulationClone)candidates.push(obj);});const hits=raycaster.intersectObjects(candidates,false);let handled=false;if(hits.length&&typeof b.registerWorldPopulationHit==="function")handled=Boolean(b.registerWorldPopulationHit(hits[0]));if(!handled&&b.active&&typeof b.addVisualShotImpact==="function"){const view=viewport(),rect=view?.getBoundingClientRect();if(rect){const hit=b.addVisualShotImpact(rect.width/2,rect.height/2,rect,{origin:state.position,direction});if(hit)addDecal(hit);}}const view=viewport();if(view)view.dataset.walkShots=String((Number(view.dataset.walkShots)||0)+1);return true;}

function update(now,dt){if(mode!=="foot")return;initialize();let forward=-state.move.y+(state.keys.has("KeyW")?1:0)-(state.keys.has("KeyS")?1:0),strafe=state.move.x+(state.keys.has("KeyD")?1:0)-(state.keys.has("KeyA")?1:0),sprint=state.keys.has("ShiftLeft")||state.keys.has("ShiftRight");state.yaw+=state.look.x*LOOK_YAW_RATE*dt;state.pitch=clamp(state.pitch-state.look.y*LOOK_PITCH_RATE*dt,-1.28,1.28);const pad=gamepad();if(pad){forward+=-axis(pad.axes?.[1]);strafe+=axis(pad.axes?.[0]);state.yaw+=axis(pad.axes?.[2])*LOOK_YAW_RATE*dt;state.pitch=clamp(state.pitch-axis(pad.axes?.[3])*LOOK_PITCH_RATE*dt,-1.28,1.28);sprint=sprint||button(pad,10)>.5;if(button(pad,7)>.5)fireFoot(now);const y=button(pad,3)>.5;if(y&&!state.xboxY){setMode("drone");state.xboxY=true;return;}state.xboxY=y;}const len=Math.max(1,Math.hypot(forward,strafe)),speed=sprint?SPRINT_MPS:WALK_MPS,step=speed*dt/len,dx=(Math.sin(state.yaw)*forward+Math.cos(state.yaw)*strafe)*step,dy=(Math.cos(state.yaw)*forward-Math.sin(state.yaw)*strafe)*step,nx=state.position.x+dx,ny=state.position.y+dy;if(canWalkStep(nx,state.position.y))state.position.x=nx;if(canWalkStep(state.position.x,ny))state.position.y=ny;state.position.z=EYE_Z;const view=viewport();if(view){view.dataset.walkPosition=`${state.position.x.toFixed(3)},${state.position.y.toFixed(3)},${state.position.z.toFixed(3)}`;view.dataset.walkYaw=state.yaw.toFixed(4);view.dataset.walkPitch=state.pitch.toFixed(4);view.dataset.walkMove=`${state.move.x.toFixed(3)},${state.move.y.toFixed(3)}`;view.dataset.walkLook=`${state.look.x.toFixed(3)},${state.look.y.toFixed(3)}`;view.dataset.walkRequiresArm="0";}}
function frame(now=performance.now()){const dt=clamp((now-lastFrame)/1000,0,.05);lastFrame=now;mountHud();mountModeButton();wrapBridge();update(now,dt);requestAnimationFrame(frame);}

function installInput(){const view=viewport();view?.addEventListener("pointerdown",e=>{if(mode!=="foot")return;if(e.target instanceof Element&&e.target.closest("#footHud,#soloTopbar,.phone-settings-dialog"))return;e.preventDefault();e.stopImmediatePropagation();},{capture:true,passive:false});addEventListener("keydown",e=>{if(mode!=="foot"||e.metaKey||e.ctrlKey||e.altKey)return;if(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight"].includes(e.code)){state.keys.add(e.code);e.preventDefault();}else if(e.code==="KeyV"){setMode("drone");e.preventDefault();}});addEventListener("keyup",e=>state.keys.delete(e.code));}

export function installPlayerWalkMode(){if(installed)return;installed=true;installStyle();installInput();mode=navigator.webdriver?"drone":readMode();globalThis.__arondightOnFootMode=mode==="foot";document.body.classList.toggle("on-foot-mode",mode==="foot");const view=viewport();if(view){view.dataset.playerMode=mode;view.dataset.walkArchitecture="camera-input-overlay-v3";view.dataset.walkRequiresArm="0";}globalThis.__arondightWalkMode={setMode,get mode(){return mode;},get position(){return state.position;},setPose({x=state.position.x,y=state.position.y,yaw=state.yaw,pitch=state.pitch}={}){state.position.set(Number(x)||0,Number(y)||0,EYE_Z);state.yaw=Number(yaw)||0;state.pitch=clamp(pitch,-1.28,1.28);state.initialized=true;},fire:fireFoot,canWalkTo};requestAnimationFrame(frame);}

installPlayerWalkMode();
