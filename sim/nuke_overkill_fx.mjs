import * as THREE from "three";

const effects=[];
let installed=false;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function easeOut(t){t=clamp(t,0,1);return 1-Math.pow(1-t,3);}
function smooth(t){t=clamp(t,0,1);return t*t*(3-2*t);}
function tag(node,role){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;node.userData.nukeOverkillPart=true;node.userData.nukeOverkillRole=role;return node;}
function basic(color,opacity=1,additive=false){return new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,depthTest:true,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,side:THREE.DoubleSide});}
function sphere(group,r,color,opacity,additive,role,segments=28){const m=tag(new THREE.Mesh(new THREE.SphereGeometry(r,segments,Math.max(14,Math.floor(segments*.62))),basic(color,opacity,additive)),role);group.add(m);return m;}
function smokeMat(color,opacity=.86){return new THREE.MeshStandardMaterial({color,transparent:true,opacity,roughness:1,depthWrite:false,emissive:0x120503,emissiveIntensity:.32});}
function overlay(){const view=viewport();if(!view)return null;let el=document.getElementById("nukeOverkillOverlay");if(el)return el;el=document.createElement("i");el.id="nukeOverkillOverlay";el.setAttribute("aria-hidden","true");el.style.cssText="position:absolute;inset:-8%;z-index:88;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 50%,#fff 0 18%,#fff9c9 32%,#ff8c2a 54%,#9f2108aa 76%,#050000 100%);mix-blend-mode:screen";view.appendChild(el);return el;}
function vignette(){const view=viewport();if(!view)return null;let el=document.getElementById("nukeOverkillVignette");if(el)return el;el=document.createElement("i");el.id="nukeOverkillVignette";el.setAttribute("aria-hidden","true");el.style.cssText="position:absolute;inset:-5%;z-index:87;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 50%,transparent 30%,#8a1b0066 64%,#090000e8 100%)";view.appendChild(el);return el;}
function screenBlast(){const a=overlay(),v=vignette();if(a){a.getAnimations?.().forEach(x=>x.cancel());a.animate([{opacity:0,filter:"brightness(1)"},{opacity:1,filter:"brightness(4.5)",offset:.025},{opacity:1,filter:"brightness(2.5)",offset:.18},{opacity:.88,filter:"brightness(1.55)",offset:.34},{opacity:.5,filter:"brightness(1.15)",offset:.6},{opacity:0,filter:"brightness(1)"}],{duration:3600,easing:"cubic-bezier(.08,.72,.16,1)"});}if(v){v.getAnimations?.().forEach(x=>x.cancel());v.animate([{opacity:0},{opacity:.86,offset:.15},{opacity:.62,offset:.48},{opacity:.34,offset:.72},{opacity:0}],{duration:4600,easing:"ease-out"});}}
function makeShock(group,role,color,opacity=.95){const ring=tag(new THREE.Mesh(new THREE.RingGeometry(.985,1.015,160),basic(color,opacity,true)),role);ring.position.z=.42;group.add(ring);return ring;}
function spawn(position){const b=bridge(),scene=b?.threeScene;if(!scene)return;const group=tag(new THREE.Group(),"root");group.position.copy(position);scene.add(group);
  const white=sphere(group,8,0xffffff,1,true,"white-core",36),yellow=sphere(group,13,0xfff2a1,.98,true,"yellow-core",36),orange=sphere(group,20,0xff7a12,.92,true,"orange-fireball",34),red=sphere(group,28,0xff2a05,.6,true,"red-fireball",30);
  const shock1=makeShock(group,"shock-ring-1",0xffffff,1),shock2=makeShock(group,"shock-ring-2",0xffd18a,.9),shock3=makeShock(group,"shock-ring-3",0xff7a2e,.72);
  const dust=tag(new THREE.Mesh(new THREE.RingGeometry(.72,1.28,160),basic(0xb87842,.6,false)),"dust-ring");dust.position.z=.12;group.add(dust);
  const stem=tag(new THREE.Group(),"smoke-stem"),cap=tag(new THREE.Group(),"smoke-cap");group.add(stem,cap);
  const stemPuffs=[],capPuffs=[];
  for(let i=0;i<18;i++){const puff=sphere(stem,7.5+i*.38,0x443630,0,false,`stem-${i}`,20);puff.material=smokeMat(i<5?0x5a3b30:0x3b3432,.9);puff.position.set(Math.sin(i*.8)*2.1,Math.cos(i*.63)*1.8,5+i*5.4);puff.scale.set(1.25,1.1,1.55);stemPuffs.push(puff);}
  for(let i=0;i<34;i++){const a=i/34*Math.PI*2,rad=25+(i%6)*2.2,puff=sphere(cap,10+(i%5)*1.25,0x4a3a34,0,false,`cap-${i}`,20);puff.material=smokeMat(i%4===0?0x624235:0x403735,.9);puff.position.set(Math.cos(a)*rad,Math.sin(a)*rad,100+(i%4)*3.1);puff.scale.set(2.0,2.0,.82);capPuffs.push(puff);}
  const crown=sphere(cap,24,0x453735,0,false,"crown",28);crown.material=smokeMat(0x493632,.94);crown.position.z=108;crown.scale.set(2.6,2.6,.78);
  const hotCrown=sphere(cap,15,0xff5410,0,true,"hot-crown",24);hotCrown.position.z=100;hotCrown.scale.set(2.35,2.35,.62);
  const hotColumn=tag(new THREE.Mesh(new THREE.CylinderGeometry(6,14,92,32,1,true),basic(0xff5510,.78,true)),"hot-column");hotColumn.rotation.x=Math.PI/2;hotColumn.position.z=46;group.add(hotColumn);
  const halo=tag(new THREE.Mesh(new THREE.TorusGeometry(42,2.2,18,120),basic(0xffc76c,.82,true)),"halo");halo.position.z=76;group.add(halo);
  const light=new THREE.PointLight(0xffd69a,1800,900,1.0);light.position.z=42;group.add(light);
  effects.push({group,scene,born:performance.now(),white,yellow,orange,red,shock1,shock2,shock3,dust,stemPuffs,capPuffs,crown,hotCrown,hotColumn,halo,light});
  const view=viewport();if(view){view.dataset.nukeOverkill="screen-dominating-nuclear-v1";view.dataset.nukeOverkillParts=String(4+4+stemPuffs.length+capPuffs.length+4);view.dataset.nukeOverkillMushroomM="128";view.dataset.nukeOverkillFireballM="92";}
  screenBlast();
}
function update(item,now){const age=now-item.born,fireT=easeOut(age/2200),fade=1-clamp((age-5200)/4200,0,1),shockT=clamp(age/4200,0,1),cloudT=smooth((age-500)/5200),late=clamp((age-2500)/9000,0,1);
  item.white.scale.setScalar(.35+fireT*5.8);item.yellow.scale.setScalar(.4+fireT*5.2);item.orange.scale.setScalar(.45+fireT*4.2);item.red.scale.setScalar(.5+fireT*3.6);
  item.white.material.opacity=Math.max(0,(1-age/1500)*.98);item.yellow.material.opacity=Math.max(0,(1-age/2600)*.9);item.orange.material.opacity=Math.max(0,(1-age/4200)*.8);item.red.material.opacity=Math.max(0,(1-age/5600)*.5);
  const r1=30+shockT*470,r2=20+clamp((age-220)/4200,0,1)*420,r3=10+clamp((age-480)/4300,0,1)*360;item.shock1.scale.setScalar(r1);item.shock2.scale.setScalar(r2);item.shock3.scale.setScalar(r3);item.dust.scale.setScalar(18+shockT*280);item.shock1.material.opacity=.98*fade;item.shock2.material.opacity=.76*fade;item.shock3.material.opacity=.55*fade;item.dust.material.opacity=.46*fade;
  const cloudOpacity=clamp(cloudT*1.3,0,.96)*(1-late*.45);for(let i=0;i<item.stemPuffs.length;i++){const p=item.stemPuffs[i],rise=cloudT*(1+i*.035);p.material.opacity=cloudOpacity*(.72+i*.012);p.position.z=5+i*5.4+rise*(8+i*.55);p.scale.multiplyScalar(1.0008);}for(let i=0;i<item.capPuffs.length;i++){const p=item.capPuffs[i];p.material.opacity=cloudOpacity*.86;p.position.z=100+(i%4)*3.1+cloudT*18;p.scale.multiplyScalar(1.0012);}
  item.crown.material.opacity=cloudOpacity*.9;item.crown.position.z=108+cloudT*20;item.crown.scale.set(2.6+cloudT*.9,2.6+cloudT*.9,.78+cloudT*.16);item.hotCrown.material.opacity=Math.max(0,.72-age/6200);item.hotColumn.material.opacity=Math.max(0,.7-age/7000);item.halo.material.opacity=Math.max(0,.75-age/5200);item.halo.scale.setScalar(1+cloudT*1.45);item.light.intensity=Math.max(0,1800*(1-age/6200));
  const view=viewport();if(view){view.dataset.nukeOverkillPhase=age<900?"whiteout":age<2600?"fireball":age<5600?"shockwave+mushroom":"mushroom";view.dataset.nukeOverkillShockM=r1.toFixed(0);view.dataset.nukeOverkillCloud=(cloudT).toFixed(3);}
  return age<28000;
}
function frame(now){for(let i=effects.length-1;i>=0;i--){const item=effects[i];if(update(item,now))continue;item.scene?.remove(item.group);item.group.traverse?.(n=>{n.geometry?.dispose?.();const mats=Array.isArray(n.material)?n.material:[n.material];mats.filter(Boolean).forEach(m=>m.dispose?.());});effects.splice(i,1);}requestAnimationFrame(frame);}
function install(){if(installed)return;installed=true;window.addEventListener("arondight:nuke-impact",event=>{const p=event?.detail?.position;if(!Array.isArray(p)||p.length<3)return;spawn(new THREE.Vector3(Number(p[0])||0,Number(p[1])||0,Number(p[2])||0));});requestAnimationFrame(frame);}
install();
