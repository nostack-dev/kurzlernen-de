import * as THREE from "three";
import {FX,sphereGeometry,ringGeometry,fxMaterial,disposeEffect,setData} from "./nuke_fx_shared.mjs";

const effects=[];
let installed=false;
const NUKE_BLOCKED_SELECTOR="#worldLookHud,#soloTopbar,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#wantedEmpButton,#droneWeaponToggle,#mobileGameplayDock,dialog,button,input,select,textarea,a,label";
const CINEMATIC_RENDER_ORDER=820;
const NUKE_SCALE=3;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function isDrone(){return walk()?.mode!=="foot"&&!drive()?.active;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function easeOut(t){t=clamp(t,0,1);return 1-Math.pow(1-t,3);}
function smooth(t){t=clamp(t,0,1);return t*t*(3-2*t);}
function tag(node,role){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;node.userData.nukeOverkillPart=true;node.userData.nukeOverkillRole=role;node.renderOrder=CINEMATIC_RENDER_ORDER;return node;}
function basic(color,opacity=1,additive=false,side=THREE.BackSide){return fxMaterial(color,{opacity,additive,depthTest:false,side});}
function sphere(group,r,color,opacity,additive,role,segments=22){const mesh=tag(new THREE.Mesh(sphereGeometry(r,segments,Math.max(10,Math.floor(segments*.62))),basic(color,opacity,additive)),role);group.add(mesh);return mesh;}
function makeShock(group,role,color,opacity=.9){const ring=tag(new THREE.Mesh(ringGeometry(.985,1.015,128),basic(color,opacity,true,THREE.DoubleSide)),role);ring.position.z=.24;group.add(ring);return ring;}
function makeOverlay(id,z,background){const view=viewport();if(!view)return null;let el=document.getElementById(id);if(el)return el;el=document.createElement("i");el.id=id;el.setAttribute("aria-hidden","true");el.style.cssText=`position:absolute;inset:-8%;z-index:${z};pointer-events:none;opacity:0;will-change:opacity;${background}`;view.appendChild(el);return el;}
function ensureFlash(){return makeOverlay("nukeOverkillOverlay",88,"background:#fff6d8;");}
// Flat neon frame instead of a soft orange vignette.
function ensureVignette(){return makeOverlay("nukeOverkillVignette",87,"inset:0;border:0;");}
function cameraBlast(){const flash=ensureFlash(),vignette=ensureVignette();flash?.getAnimations?.().forEach(a=>a.cancel());flash?.animate([{opacity:0},{opacity:1,offset:.015},{opacity:1,offset:.12},{opacity:.7,offset:.29},{opacity:.24,offset:.52},{opacity:0}],{duration:2300,easing:"cubic-bezier(.06,.72,.12,1)"});vignette?.getAnimations?.().forEach(a=>a.cancel());vignette?.animate([{opacity:0},{opacity:.76,offset:.16},{opacity:.56,offset:.48},{opacity:.22,offset:.8},{opacity:0}],{duration:6000,easing:"ease-out"});}

// Fireball, shock rings and sparks. The mushroom cloud is owned by the
// volumetric layer — this layer used to draw a second, overlapping mushroom,
// doubling the transparent overdraw that made phones stutter.
function spawn(position){
  const scene=bridge()?.threeScene;if(!scene)return;
  const group=tag(new THREE.Group(),"world-root");group.position.copy(position);scene.add(group);
  // One flat white-hot core (no stacked yellow/orange/red glow spheres).
  const white=sphere(group,7.5,0xfff6d8,1,true,"white-core");white.position.z=9*NUKE_SCALE;
  const shock1=makeShock(group,"shock-ring-1",0xffffff,.9),shock2=makeShock(group,"shock-ring-2",0xffd23f,.7),shock3=makeShock(group,"shock-ring-3",0xff8a3d,.5);
  const dust=tag(new THREE.Mesh(ringGeometry(.97,.985,96),basic(0xd8c8a8,.46,false,THREE.DoubleSide)),"dust-ring");dust.position.z=.08;group.add(dust);
  const sparks=[];for(let i=0;i<14;i++){const a=i/14*Math.PI*2,p=sphere(group,1+(i%3)*.3,i%2?0xfff6d8:0xffb347,.34,true,`spark-${i}`,8);p.position.set(Math.cos(a)*(8+(i%7)*2.3),Math.sin(a)*(8+(i%6)*2.1),5+(i%5)*2.5);sparks.push(p);}
  effects.push({scene,group,born:performance.now(),white,shock1,shock2,shock3,dust,sparks,sparkBase:sparks.map(p=>p.scale.x),position:position.clone()});
  const view=viewport();if(view){view.dataset.nukeOverkill="world-anchored-nuclear-v5";view.dataset.nukeOverkillParts=String(1+4+sparks.length);view.dataset.nukeOverkillFireballM="450";view.dataset.nukeOverkillAnchor=`${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}`;view.dataset.nukeOverkillComposition="world-space-impact-locked-v4";view.dataset.nukeScreenCloud="removed-v2";view.dataset.nukeVisibleRenderer="world-space-3d-v5";view.dataset.nukeVisibilityPolicy="cinematic-depth-priority-v1";}
  document.getElementById("nukeCinematicScreenCloud")?.remove();
  document.getElementById("nukeOverkillShockScreen")?.remove();
  cameraBlast();
}
function update(item,now){
  const age=now-item.born,fireT=easeOut(age/1500),shockT=clamp(age/4700,0,1),fade=1-clamp((age-18500)/7500,0,1);
  item.white.scale.setScalar(NUKE_SCALE*(.45+fireT*6.0));item.white.material.opacity=Math.max(0,1-age/1450);item.white.visible=item.white.material.opacity>.003;
  const r1=NUKE_SCALE*(22+shockT*500),r2=NUKE_SCALE*(16+clamp((age-160)/4700,0,1)*455),r3=NUKE_SCALE*(9+clamp((age-360)/4900,0,1)*395);item.shock1.scale.setScalar(r1);item.shock2.scale.setScalar(r2);item.shock3.scale.setScalar(r3);item.dust.scale.setScalar(NUKE_SCALE*(14+shockT*330));item.shock1.material.opacity=.96*fade;item.shock2.material.opacity=.76*fade;item.shock3.material.opacity=.54*fade;item.dust.material.opacity=.42*fade;
  for(let i=0;i<item.sparks.length;i++){const spark=item.sparks[i];spark.material.opacity=Math.max(0,.34-age/7800);spark.visible=spark.material.opacity>.002;spark.scale.setScalar(item.sparkBase[i]*Math.exp(age*.00009));}
  const view=viewport();setData(view,"nukeOverkillPhase",age<700?"whiteout":age<2100?"fireball":age<5800?"shockwave+mushroom":"mushroom");setData(view,"nukeOverkillShockM",r1.toFixed(0));
  return age<27000;
}
function routeNukePointer(event){if(event.type!=="pointerdown"||event.button!==0||!isDrone())return;const api=globalThis.__arondightDroneWeapons;if(String(api?.displayMode||"")!=="nuke")return;const target=event.target instanceof Element?event.target:null;if(target?.closest?.(NUKE_BLOCKED_SELECTOR))return;event.preventDefault();event.stopImmediatePropagation();const fired=Boolean(api?.fireNuke?.({clientX:event.clientX,clientY:event.clientY,source:event.pointerType||"pointer"})),view=viewport();if(view){view.dataset.nukeInputRoute="window-capture-fireNuke-v1";view.dataset.nukeInputRouteFired=fired?"1":"0";view.dataset.nukeLegacyMissileBypass="blocked-v1";}}
function frame(now){for(let i=effects.length-1;i>=0;i--){const item=effects[i];if(update(item,now))continue;item.scene?.remove(item.group);disposeEffect(item.group);effects.splice(i,1);}requestAnimationFrame(frame);}
function install(){if(installed)return;installed=true;window.addEventListener("arondight:world-reset",()=>{for(const e of effects.splice(0)){e.scene?.remove(e.group);disposeEffect(e.group);}});document.getElementById("nukeCinematicScreenCloud")?.remove();document.getElementById("nukeOverkillShockScreen")?.remove();window.addEventListener("pointerdown",routeNukePointer,{capture:true,passive:false});window.addEventListener("arondight:nuke-impact",event=>{const p=event?.detail?.position;if(!Array.isArray(p)||p.length<3)return;spawn(new THREE.Vector3(Number(p[0])||0,Number(p[1])||0,Number(p[2])||0));});requestAnimationFrame(frame);}
install();