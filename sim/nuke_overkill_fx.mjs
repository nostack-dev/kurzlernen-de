import * as THREE from "three";
import {NEON,sphereGeometry,ringGeometry,disposeEffect,setData} from "./nuke_fx_shared.mjs";

const effects=[];
let installed=false;
const NUKE_BLOCKED_SELECTOR="#soloTopbar,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#wantedEmpButton,#droneWeaponToggle,#mobileGameplayDock,dialog,button,input,select,textarea,a,label";
const CINEMATIC_RENDER_ORDER=820;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function isDrone(){return walk()?.mode!=="foot"&&!drive()?.active;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function easeOut(t){t=clamp(t,0,1);return 1-Math.pow(1-t,3);}
function smooth(t){t=clamp(t,0,1);return t*t*(3-2*t);}
function tag(node,role){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;node.userData.nukeOverkillPart=true;node.userData.nukeOverkillRole=role;node.renderOrder=CINEMATIC_RENDER_ORDER;return node;}
function basic(color,opacity=1,additive=false){return new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,depthTest:false,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,side:THREE.DoubleSide,wireframe:true,toneMapped:false,fog:false});}
function sphere(group,r,color,opacity,additive,role,segments=12){const mesh=tag(new THREE.Mesh(sphereGeometry(r,segments,Math.max(6,Math.floor(segments*.62))),basic(color,opacity,additive)),role);group.add(mesh);return mesh;}
function makeShock(group,role,color,opacity=.9){const material=basic(color,opacity,true);material.wireframe=false;const ring=tag(new THREE.Mesh(ringGeometry(.985,1.015,96),material),role);ring.position.z=.24;group.add(ring);return ring;}
function makeOverlay(id,z,background){const view=viewport();if(!view)return null;let el=document.getElementById(id);if(el)return el;el=document.createElement("i");el.id=id;el.setAttribute("aria-hidden","true");el.style.cssText=`position:absolute;inset:-8%;z-index:${z};pointer-events:none;opacity:0;will-change:opacity;${background}`;view.appendChild(el);return el;}
function ensureFlash(){return makeOverlay("nukeOverkillOverlay",88,"background:radial-gradient(circle at 50% 50%,#fff 0 20%,#fffbd7 35%,rgba(255,191,76,.92) 55%,rgba(255,103,18,.52) 74%,transparent 100%);");}
function ensureVignette(){return makeOverlay("nukeOverkillVignette",87,"background:radial-gradient(circle at 50% 50%,transparent 38%,rgba(255,61,242,.10) 59%,rgba(60,10,90,.36) 82%,rgba(2,0,10,.72) 100%);");}
function cameraBlast(){const flash=ensureFlash(),vignette=ensureVignette();flash?.getAnimations?.().forEach(a=>a.cancel());flash?.animate([{opacity:0},{opacity:1,offset:.015},{opacity:1,offset:.12},{opacity:.7,offset:.29},{opacity:.24,offset:.52},{opacity:0}],{duration:2300,easing:"cubic-bezier(.06,.72,.12,1)"});vignette?.getAnimations?.().forEach(a=>a.cancel());vignette?.animate([{opacity:0},{opacity:.76,offset:.16},{opacity:.56,offset:.48},{opacity:.22,offset:.8},{opacity:0}],{duration:6000,easing:"ease-out"});}

function makeSmokePuff(group,role,r,color,z,x=0,y=0){const puff=sphere(group,r,color,0,true,role,12);puff.position.set(x,y,z);puff.material.opacity=0;return puff;}
function spawn(position){
  const scene=bridge()?.threeScene;if(!scene)return;
  const group=tag(new THREE.Group(),"world-root");group.position.copy(position);scene.add(group);

  const white=sphere(group,7.5,NEON.white,1,true,"white-core",16),yellow=sphere(group,12,NEON.yellow,.98,true,"yellow-core",16),orange=sphere(group,18,NEON.orange,.82,true,"orange-fireball",14),red=sphere(group,25,NEON.red,.48,true,"red-fireball",14);for(const m of[white,yellow,orange,red])m.position.z=9;
  const shock1=makeShock(group,"shock-ring-1",NEON.white,.98),shock2=makeShock(group,"shock-ring-2",NEON.cyan,.82),shock3=makeShock(group,"shock-ring-3",NEON.magenta,.62);
  const dust=tag(new THREE.Mesh(ringGeometry(.72,1.28,64),basic(NEON.violet,.46,true)),"dust-ring");dust.position.z=.08;group.add(dust);

  const plume=tag(new THREE.Group(),"mushroom-plume"),crown=tag(new THREE.Group(),"mushroom-crown-group");group.add(plume,crown);
  const smoke=[];
  for(let i=0;i<18;i++){
    const z=3+i*5.15,r=6.2+i*.46,x=Math.sin(i*.92)*(1.4+i*.14),y=Math.cos(i*.78)*(1.15+i*.12),p=makeSmokePuff(plume,`plume-${i}`,r,i<6?NEON.orange:NEON.violet,z,x,y);p.scale.set(1.22,1.16,1.55);smoke.push(p);
  }
  for(let i=0;i<36;i++){
    const a=i/36*Math.PI*2,ring=i%3,rad=17+ring*8+(i%6)*1.15,z=79+ring*6+(i%4)*1.6,r=9.5+(i%5)*1.25,p=makeSmokePuff(crown,`crown-${i}`,r,ring===0?NEON.magenta:ring===1?NEON.violet:NEON.purple,z,Math.cos(a)*rad,Math.sin(a)*rad);p.scale.set(1.68,1.68,.74);smoke.push(p);
  }
  const capCore=makeSmokePuff(crown,"crown-core",25,NEON.magenta,94,0,0);capCore.scale.set(2.5,2.5,.7);smoke.push(capCore);
  const lowerCap=makeSmokePuff(crown,"crown-lower",19,NEON.violet,82,0,0);lowerCap.scale.set(2.25,2.25,.6);smoke.push(lowerCap);
  const stemCore=sphere(group,8.5,NEON.violet,0,true,"plume-core",12);stemCore.position.z=43;stemCore.scale.set(1.0,1.0,5.2);
  const hotColumn=sphere(group,4.8,NEON.orange,0,true,"hot-column",12);hotColumn.position.z=42;hotColumn.scale.set(1.25,1.25,10.8);
  const hotCrown=sphere(group,14,NEON.orange,0,true,"hot-crown",12);hotCrown.position.z=88;hotCrown.scale.set(3.9,3.9,.68);

  const sparks=[];for(let i=0;i<28;i++){const a=i/28*Math.PI*2,p=sphere(group,1+(i%3)*.3,i%2?NEON.yellow:NEON.cyan,.34,true,`spark-${i}`,6);p.position.set(Math.cos(a)*(8+(i%7)*2.3),Math.sin(a)*(8+(i%6)*2.1),5+(i%5)*2.5);sparks.push(p);}
  
  plume.scale.setScalar(.05);crown.scale.setScalar(.04);stemCore.scale.multiplyScalar(.04);
  effects.push({scene,group,born:performance.now(),white,yellow,orange,red,shock1,shock2,shock3,dust,plume,crown,smoke,stemCore,hotColumn,hotCrown,sparks,sparkBase:sparks.map(p=>p.scale.x),position:position.clone()});
  const view=viewport();if(view){view.dataset.nukeOverkill="world-anchored-nuclear-v4";view.dataset.nukeOverkillParts=String(4+4+smoke.length+sparks.length+3);view.dataset.nukeOverkillStyle="neon-wireframe-unlit-v1";view.dataset.nukeOverkillMushroomM="128";view.dataset.nukeOverkillFireballM="150";view.dataset.nukeOverkillAnchor=`${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}`;view.dataset.nukeOverkillComposition="world-space-impact-locked-v4";view.dataset.nukeScreenCloud="removed-v2";view.dataset.nukeCloudShape="3d-world-mushroom-v4";view.dataset.nukeVisibleRenderer="world-space-3d-v4";view.dataset.nukeMushroomFormation="fast-dense-world-v2";view.dataset.nukeVisibilityPolicy="cinematic-depth-priority-v1";}
  document.getElementById("nukeCinematicScreenCloud")?.remove();
  document.getElementById("nukeOverkillShockScreen")?.remove();
  cameraBlast();
}
function update(item,now){
  const age=now-item.born,fireT=easeOut(age/1500),shockT=clamp(age/4700,0,1),cloudT=smooth((age-100)/2850),fade=1-clamp((age-18500)/7500,0,1);
  item.white.scale.setScalar(.45+fireT*6.0);item.yellow.scale.setScalar(.5+fireT*5.2);item.orange.scale.setScalar(.55+fireT*4.45);item.red.scale.setScalar(.6+fireT*3.65);
  item.white.material.opacity=Math.max(0,1-age/1450);item.yellow.material.opacity=Math.max(0,.98-age/3000);item.orange.material.opacity=Math.max(0,.82-age/5200);item.red.material.opacity=Math.max(0,.48-age/7600);
  const r1=22+shockT*500,r2=16+clamp((age-160)/4700,0,1)*455,r3=9+clamp((age-360)/4900,0,1)*395;item.shock1.scale.setScalar(r1);item.shock2.scale.setScalar(r2);item.shock3.scale.setScalar(r3);item.dust.scale.setScalar(14+shockT*330);item.shock1.material.opacity=.96*fade;item.shock2.material.opacity=.76*fade;item.shock3.material.opacity=.54*fade;item.dust.material.opacity=.42*fade;
  const cloudScale=.07+cloudT*1.16;item.plume.scale.set(cloudScale,cloudScale,cloudScale);item.crown.scale.set(cloudScale,cloudScale,cloudScale);item.stemCore.scale.set(cloudScale,cloudScale,cloudScale*5.2);for(const puff of item.smoke)puff.material.opacity=clamp((cloudT-.025)*1.34,0,.94)*fade;item.stemCore.material.opacity=clamp((cloudT-.05)*1.15,0,.72)*fade;
  item.hotColumn.material.opacity=clamp(cloudT*1.28,0,.62)*Math.max(0,1-age/8400);item.hotCrown.material.opacity=clamp(cloudT*1.18,0,.54)*Math.max(0,1-age/9200);
  for(let i=0;i<item.sparks.length;i++){const spark=item.sparks[i];spark.material.opacity=Math.max(0,.34-age/7800);spark.visible=spark.material.opacity>.002;spark.scale.setScalar(item.sparkBase[i]*Math.exp(age*.00009));}
  const view=viewport();setData(view,"nukeOverkillPhase",age<700?"whiteout":age<2100?"fireball":age<5800?"shockwave+mushroom":"mushroom");setData(view,"nukeOverkillShockM",r1.toFixed(0));setData(view,"nukeOverkillCloud",cloudT.toFixed(2));setData(view,"nukeScreenCloudOpacity","0");
  return age<27000;
}
function routeNukePointer(event){if(event.type!=="pointerdown"||event.button!==0||!isDrone())return;const api=globalThis.__arondightDroneWeapons;if(String(api?.displayMode||"")!=="nuke")return;const target=event.target instanceof Element?event.target:null;if(target?.closest?.(NUKE_BLOCKED_SELECTOR))return;event.preventDefault();event.stopImmediatePropagation();const fired=Boolean(api?.fireNuke?.({clientX:event.clientX,clientY:event.clientY,source:event.pointerType||"pointer"})),view=viewport();if(view){view.dataset.nukeInputRoute="window-capture-fireNuke-v1";view.dataset.nukeInputRouteFired=fired?"1":"0";view.dataset.nukeLegacyMissileBypass="blocked-v1";}}
function frame(now){for(let i=effects.length-1;i>=0;i--){const item=effects[i];if(update(item,now))continue;item.scene?.remove(item.group);disposeEffect(item.group);effects.splice(i,1);}requestAnimationFrame(frame);}
function install(){if(installed)return;installed=true;document.getElementById("nukeCinematicScreenCloud")?.remove();document.getElementById("nukeOverkillShockScreen")?.remove();window.addEventListener("pointerdown",routeNukePointer,{capture:true,passive:false});window.addEventListener("arondight:nuke-impact",event=>{const p=event?.detail?.position;if(!Array.isArray(p)||p.length<3)return;spawn(new THREE.Vector3(Number(p[0])||0,Number(p[1])||0,Number(p[2])||0));});requestAnimationFrame(frame);}
install();