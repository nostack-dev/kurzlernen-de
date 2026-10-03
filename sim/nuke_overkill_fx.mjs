import * as THREE from "three";

const effects=[];
let installed=false;
const tmpCam=new THREE.Vector3(),tmpDir=new THREE.Vector3();
const NUKE_BLOCKED_SELECTOR="#soloTopbar,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#wantedEmpButton,#droneWeaponToggle,#mobileGameplayDock,dialog,button,input,select,textarea,a,label";

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function isDrone(){return walk()?.mode!=="foot"&&!drive()?.active;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function easeOut(t){t=clamp(t,0,1);return 1-Math.pow(1-t,3);}
function smooth(t){t=clamp(t,0,1);return t*t*(3-2*t);}
function tag(node,role){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;node.userData.nukeOverkillPart=true;node.userData.nukeOverkillRole=role;node.renderOrder=800;return node;}
function basic(color,opacity=1,additive=false){return new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,depthTest:false,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,side:THREE.DoubleSide});}
function sphere(group,r,color,opacity,additive,role,segments=18){const mesh=tag(new THREE.Mesh(new THREE.SphereGeometry(r,segments,Math.max(10,Math.floor(segments*.62))),basic(color,opacity,additive)),role);group.add(mesh);return mesh;}
function makeShock(group,role,color,opacity=.9){const ring=tag(new THREE.Mesh(new THREE.RingGeometry(.985,1.015,128),basic(color,opacity,true)),role);ring.position.z=.36;group.add(ring);return ring;}

function suppressLegacyImpact(){const scene=bridge()?.threeScene;if(!scene)return;let hidden=0;scene.traverse?.(node=>{if(node?.userData?.nukeRole!=="impact-root"||node.userData?.nukeOverkillPart)return;node.visible=false;hidden++;});const view=viewport();if(view){view.dataset.nukeLegacyVisual=`suppressed-${hidden}`;view.dataset.nukeVisibleRenderer="overkill-only-v1";}}
function makeOverlay(id,z,background){const view=viewport();if(!view)return null;let el=document.getElementById(id);if(el)return el;el=document.createElement("i");el.id=id;el.setAttribute("aria-hidden","true");el.style.cssText=`position:absolute;inset:-8%;z-index:${z};pointer-events:none;opacity:0;${background}`;view.appendChild(el);return el;}
function ensureOverlay(){return makeOverlay("nukeOverkillOverlay",88,"background:radial-gradient(circle at 50% 66%,#fff 0 6%,#fffbd7 12%,rgba(255,206,95,.96) 22%,rgba(255,127,25,.72) 38%,rgba(183,48,8,.36) 58%,transparent 82%);");}
function ensureVignette(){return makeOverlay("nukeOverkillVignette",87,"background:radial-gradient(circle at 50% 58%,transparent 32%,rgba(255,94,11,.12) 54%,rgba(77,17,6,.42) 78%,rgba(3,0,0,.78) 100%);");}
function ensureShockScreen(){const view=viewport();if(!view)return null;let el=document.getElementById("nukeOverkillShockScreen");if(el)return el;el=document.createElement("i");el.id="nukeOverkillShockScreen";el.setAttribute("aria-hidden","true");el.style.cssText="position:absolute;left:50%;top:70%;width:13vmin;aspect-ratio:1;border:5px solid rgba(255,253,231,.96);border-radius:50%;z-index:90;pointer-events:none;opacity:0;transform:translate(-50%,-50%) scale(.12);box-shadow:0 0 32px 12px rgba(255,190,80,.82),inset 0 0 25px rgba(255,255,255,.8)";view.appendChild(el);return el;}
function puff(parent,{left,top,size,light="#8a817b",mid="#5b514d",dark="#302b29",glow="rgba(255,94,20,.12)"}){const el=document.createElement("i");el.style.cssText=`position:absolute;left:${left}%;top:${top}%;width:${size}%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%);background:radial-gradient(circle at 39% 32%,${light} 0 13%,${mid} 36%,#463e3a 58%,${dark} 79%,#211e1d 100%);box-shadow:inset -8px -10px 15px rgba(0,0,0,.2),0 0 18px ${glow};`;parent.appendChild(el);return el;}
function ensureScreenCloud(){const view=viewport();if(!view)return null;let root=document.getElementById("nukeCinematicScreenCloud");if(root)return root;
  root=document.createElement("div");root.id="nukeCinematicScreenCloud";root.setAttribute("aria-hidden","true");root.style.cssText="position:absolute;left:50%;top:51%;width:min(74vmin,310px);height:min(82vmin,330px);z-index:91;pointer-events:none;opacity:0;transform:translate(-50%,-50%) scale(.54);transform-origin:50% 78%;filter:drop-shadow(0 0 24px rgba(255,100,20,.4)) drop-shadow(0 16px 24px rgba(0,0,0,.48))";

  const cap=document.createElement("div");cap.dataset.part="cap-back";cap.style.cssText="position:absolute;left:4%;top:0;width:92%;height:42%;overflow:visible";
  [
    [9,63,28,"#776c66","#4e4743"],[20,43,35,"#8c7d74","#594f4a"],[34,25,39,"#9a887d","#62564f"],[50,18,43,"#a08b7e","#67584f"],[66,24,40,"#958176","#5e524c"],[80,43,35,"#81736c","#554c48"],[92,62,28,"#706762","#4a4440"],[38,60,36,"#846e63","#574a44"],[61,60,37,"#8a7165","#584a43"]
  ].forEach(([left,top,size,light,mid])=>puff(cap,{left,top,size,light,mid,glow:"rgba(255,104,24,.15)"}));
  const capHot=document.createElement("i");capHot.dataset.part="cap-hot";capHot.style.cssText="position:absolute;left:19%;top:30%;width:62%;height:13%;border-radius:50%;background:radial-gradient(ellipse,#fffbd5 0 5%,#ffd87b 12%,#ff9a2a 27%,rgba(236,81,15,.72) 45%,rgba(126,45,26,.3) 63%,transparent 78%);filter:blur(2px);box-shadow:0 0 36px 10px rgba(255,116,22,.45)";

  const stem=document.createElement("div");stem.dataset.part="stem";stem.style.cssText="position:absolute;left:35%;top:31%;width:30%;height:55%;overflow:visible";
  const innerGlow=document.createElement("i");innerGlow.style.cssText="position:absolute;left:43%;top:2%;width:14%;height:91%;border-radius:50%;background:linear-gradient(180deg,rgba(255,151,45,.5),rgba(255,96,20,.38) 42%,rgba(255,188,76,.22) 72%,transparent);filter:blur(8px)";stem.appendChild(innerGlow);
  [
    [49,8,63],[42,20,70],[57,31,66],[45,43,73],[56,55,68],[43,67,75],[54,79,70],[48,91,66]
  ].forEach(([left,top,size],i)=>puff(stem,{left,top,size,light:i<2?"#7c6e67":"#6e625d",mid:i<3?"#514843":"#49423f",dark:"#2a2725",glow:i<3?"rgba(255,103,22,.18)":"rgba(255,82,16,.1)"}));

  const fireball=document.createElement("i");fireball.dataset.part="fireball";fireball.style.cssText="position:absolute;left:37%;top:59%;width:26%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,#fff 0 9%,#fffde0 13%,#ffe27b 21%,#ffad35 33%,#ff6a12 49%,rgba(220,52,8,.72) 64%,transparent 82%);box-shadow:0 0 40px 20px rgba(255,131,30,.66),0 0 76px 28px rgba(255,75,8,.25);mix-blend-mode:screen";
  const skirt=document.createElement("i");skirt.dataset.part="skirt";skirt.style.cssText="position:absolute;left:23%;top:82%;width:54%;height:14%;border-radius:50%;background:radial-gradient(ellipse,#fff0ad 0 3%,#ffb24a 10%,#d9652c 25%,#75615a 48%,rgba(52,45,42,.64) 68%,transparent 80%);box-shadow:0 0 28px rgba(255,108,22,.34)";
  root.append(cap,stem,skirt,fireball,capHot);view.appendChild(root);return root;
}
function screenBlast(){const flash=ensureOverlay(),vignette=ensureVignette(),shock=ensureShockScreen(),cloud=ensureScreenCloud();
  flash?.getAnimations?.().forEach(a=>a.cancel());flash?.animate([{opacity:0,filter:"brightness(1)"},{opacity:1,filter:"brightness(6.5)",offset:.018},{opacity:1,filter:"brightness(3.4)",offset:.12},{opacity:.88,filter:"brightness(1.85)",offset:.32},{opacity:.64,filter:"brightness(1.35)",offset:.62},{opacity:.46,filter:"brightness(1.15)",offset:.84},{opacity:.28,filter:"brightness(1.05)",offset:.95},{opacity:0}],{duration:7600,easing:"cubic-bezier(.08,.7,.14,1)"});
  vignette?.getAnimations?.().forEach(a=>a.cancel());vignette?.animate([{opacity:0},{opacity:.7,offset:.14},{opacity:.58,offset:.5},{opacity:.22,offset:.82},{opacity:0}],{duration:8200,easing:"ease-out"});
  shock?.getAnimations?.().forEach(a=>a.cancel());shock?.animate([{opacity:0,transform:"translate(-50%,-50%) scale(.08)"},{opacity:1,transform:"translate(-50%,-50%) scale(.35)",offset:.04},{opacity:.9,transform:"translate(-50%,-50%) scale(1.5)",offset:.24},{opacity:.5,transform:"translate(-50%,-50%) scale(4.6)",offset:.58},{opacity:0,transform:"translate(-50%,-50%) scale(9)"}],{duration:5000,easing:"cubic-bezier(.1,.72,.15,1)"});
  cloud?.getAnimations?.().forEach(a=>a.cancel());cloud?.animate([{opacity:0,transform:"translate(-50%,-41%) scale(.34)",filter:"brightness(2.2) saturate(1.35)"},{opacity:.5,transform:"translate(-50%,-45%) scale(.57)",offset:.08},{opacity:.97,transform:"translate(-50%,-49%) scale(.8)",filter:"brightness(1.4) saturate(1.28)",offset:.19},{opacity:1,transform:"translate(-50%,-50%) scale(.93)",filter:"brightness(1.08) saturate(1.12)",offset:.38},{opacity:1,transform:"translate(-50%,-51%) scale(1.0)",offset:.68},{opacity:.74,transform:"translate(-50%,-53%) scale(1.07)",offset:.9},{opacity:0,transform:"translate(-50%,-55%) scale(1.12)"}],{duration:10500,easing:"cubic-bezier(.12,.7,.18,1)"});
}

function presentationAnchor(position){const camera=bridge()?.threeCamera;if(!camera)return new THREE.Vector3(position.x,position.y,0);camera.updateMatrixWorld?.(true);camera.getWorldPosition(tmpCam);tmpDir.set(position.x-tmpCam.x,position.y-tmpCam.y,0);if(tmpDir.lengthSq()<.0001){camera.getWorldDirection(tmpDir);tmpDir.z=0;}if(tmpDir.lengthSq()<.0001)tmpDir.set(0,-1,0);tmpDir.normalize();const distance=clamp(Math.hypot(position.x-tmpCam.x,position.y-tmpCam.y),125,160),anchor=tmpCam.clone().addScaledVector(tmpDir,distance);anchor.z=0;return anchor;}
function spawn(position){suppressLegacyImpact();const scene=bridge()?.threeScene;if(!scene)return;const group=tag(new THREE.Group(),"root"),anchor=presentationAnchor(position);group.position.copy(anchor);scene.add(group);
  const white=sphere(group,6,0xffffff,1,true,"white-core",26),yellow=sphere(group,9,0xffef9a,.92,true,"yellow-core",24),orange=sphere(group,13,0xff7412,.72,true,"orange-fireball",22),red=sphere(group,17,0xe83b08,.32,true,"red-fireball",20);for(const m of[white,yellow,orange,red])m.position.z=7;
  const shock1=makeShock(group,"shock-ring-1",0xffffff,.92),shock2=makeShock(group,"shock-ring-2",0xffcf7e,.72),shock3=makeShock(group,"shock-ring-3",0xff7625,.48);
  const dust=tag(new THREE.Mesh(new THREE.RingGeometry(.75,1.22,128),basic(0xaa7041,.34,false)),"dust-ring");dust.position.z=.1;group.add(dust);
  const sparks=[];for(let i=0;i<14;i++){const a=i/14*Math.PI*2,p=sphere(group,.8+(i%3)*.25,i%2?0xffa331:0xffe59a,.22,true,`spark-${i}`,12);p.position.set(Math.cos(a)*(4+(i%4)*1.8),Math.sin(a)*(4+(i%5)*1.5),4+(i%3)*2.2);sparks.push(p);}
  const hotColumn=sphere(group,2.4,0xff6b16,.18,true,"hot-column",14);hotColumn.position.z=13;hotColumn.scale.set(.65,.65,2.4);
  const hotCrown=sphere(group,3.2,0xff6b18,.16,true,"hot-crown",14);hotCrown.position.z=22;hotCrown.scale.set(1.8,1.8,.65);
  const light=new THREE.PointLight(0xffca78,1350,650,1);light.position.z=18;group.add(light);
  effects.push({scene,group,born:performance.now(),white,yellow,orange,red,shock1,shock2,shock3,dust,sparks,hotColumn,hotCrown,light});
  const view=viewport();if(view){view.dataset.nukeOverkill="screen-dominating-nuclear-v3";view.dataset.nukeOverkillParts=String(4+4+sparks.length+2);view.dataset.nukeOverkillMushroomM="92";view.dataset.nukeOverkillFireballM="110";view.dataset.nukeOverkillAnchor=`${anchor.x.toFixed(2)},${anchor.y.toFixed(2)},${anchor.z.toFixed(2)}`;view.dataset.nukeOverkillComposition="grounded-wide-screen-cloud-v3";view.dataset.nukeScreenCloud="mushroom-fireball-overlay-v1";view.dataset.nukeCloudShape="irregular-filled-cap-v3";}
  screenBlast();
}
function update(item,now){const age=now-item.born,fireT=easeOut(age/1700),shockT=clamp(age/4300,0,1),cloudT=smooth((age-330)/4700),fade=1-clamp((age-5900)/4500,0,1);
  item.white.scale.setScalar(.35+fireT*4);item.yellow.scale.setScalar(.4+fireT*3.5);item.orange.scale.setScalar(.45+fireT*2.8);item.red.scale.setScalar(.5+fireT*2.2);
  item.white.material.opacity=Math.max(0,1-age/1450);item.yellow.material.opacity=Math.max(0,.88-age/2700);item.orange.material.opacity=Math.max(0,.68-age/4400);item.red.material.opacity=Math.max(0,.3-age/5600);
  const r1=28+shockT*490,r2=18+clamp((age-200)/4300,0,1)*440,r3=10+clamp((age-430)/4400,0,1)*380;item.shock1.scale.setScalar(r1);item.shock2.scale.setScalar(r2);item.shock3.scale.setScalar(r3);item.dust.scale.setScalar(15+shockT*290);item.shock1.material.opacity=.88*fade;item.shock2.material.opacity=.6*fade;item.shock3.material.opacity=.38*fade;item.dust.material.opacity=.28*fade;
  for(const spark of item.sparks){spark.material.opacity=Math.max(0,.24-age/7000);spark.scale.multiplyScalar(1.0014);}item.hotColumn.material.opacity=Math.max(0,.18-age/5600);item.hotCrown.material.opacity=Math.max(0,.16-age/6100);item.light.intensity=Math.max(0,1350*(1-age/5800));
  const view=viewport(),screenCloud=document.getElementById("nukeCinematicScreenCloud");if(view){view.dataset.nukeOverkillPhase=age<900?"whiteout":age<2800?"fireball":age<6200?"shockwave+mushroom":"mushroom";view.dataset.nukeOverkillShockM=r1.toFixed(0);view.dataset.nukeOverkillCloud=cloudT.toFixed(3);view.dataset.nukeScreenCloudOpacity=screenCloud?Number(getComputedStyle(screenCloud).opacity).toFixed(3):"0";}
  return age<26000;
}
function routeNukePointer(event){if(event.type!=="pointerdown"||event.button!==0||!isDrone())return;const api=globalThis.__arondightDroneWeapons;if(String(api?.displayMode||"")!=="nuke")return;const target=event.target instanceof Element?event.target:null;if(target?.closest?.(NUKE_BLOCKED_SELECTOR))return;event.preventDefault();event.stopImmediatePropagation();const fired=Boolean(api?.fireNuke?.({clientX:event.clientX,clientY:event.clientY,source:event.pointerType||"pointer"})),view=viewport();if(view){view.dataset.nukeInputRoute="window-capture-fireNuke-v1";view.dataset.nukeInputRouteFired=fired?"1":"0";view.dataset.nukeLegacyMissileBypass="blocked-v1";}}
function frame(now){for(let i=effects.length-1;i>=0;i--){const item=effects[i];if(update(item,now))continue;item.scene?.remove(item.group);item.group.traverse?.(node=>{node.geometry?.dispose?.();const mats=Array.isArray(node.material)?node.material:[node.material];mats.filter(Boolean).forEach(m=>m.dispose?.());});effects.splice(i,1);}requestAnimationFrame(frame);}
function install(){if(installed)return;installed=true;window.addEventListener("pointerdown",routeNukePointer,{capture:true,passive:false});window.addEventListener("arondight:nuke-impact",event=>{const p=event?.detail?.position;if(!Array.isArray(p)||p.length<3)return;spawn(new THREE.Vector3(Number(p[0])||0,Number(p[1])||0,Number(p[2])||0));});requestAnimationFrame(frame);}
install();