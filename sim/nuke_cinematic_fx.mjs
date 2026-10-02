import * as THREE from "three";

const SOUND_SPEED_MPS=343;
const VISUAL_RADIUS_M=95;
const MAX_SHAKE_RADIUS_M=190;
const LIFE_MS=22000;
const effects=[];
let installed=false,flashOverlay=null,shake=null;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const easeOut=t=>1-(1-clamp(t,0,1))**3;
function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function mark(node){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;return node;}
function basic(color,opacity=1,{additive=false,side=THREE.DoubleSide}={}){return new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});}
function standard(color,opacity=.9,emissive=0x000000,intensity=0){return new THREE.MeshStandardMaterial({color,transparent:true,opacity,depthWrite:false,roughness:1,metalness:0,emissive,emissiveIntensity:intensity});}
function sphere(group,r,color,opacity=1,additive=false,segments=22){const m=mark(new THREE.Mesh(new THREE.SphereGeometry(r,segments,Math.max(10,Math.floor(segments*.65))),basic(color,opacity,{additive})));group.add(m);return m;}
function puff(group,r,color,position,scale=[1,1,1]){const m=mark(new THREE.Mesh(new THREE.SphereGeometry(r,18,12),standard(color,0)));m.position.copy(position);m.scale.set(...scale);group.add(m);return m;}

function ensureFlash(){const view=viewport();if(!view)return null;if(flashOverlay?.isConnected)return flashOverlay;flashOverlay=document.getElementById("nukeFlashOverlayCinematic");if(flashOverlay)return flashOverlay;const el=document.createElement("div");el.id="nukeFlashOverlayCinematic";el.setAttribute("aria-hidden","true");el.style.cssText="position:absolute;inset:-4%;z-index:120;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 50%,#fff 0%,#fff 28%,#fffbd8 52%,#ffcf70 75%,#ff8a32 100%);mix-blend-mode:screen;will-change:opacity,filter";view.appendChild(el);flashOverlay=el;return el;}
function blastFlash(){const el=ensureFlash();if(!el)return;el.getAnimations?.().forEach(a=>a.cancel());el.animate([{opacity:0,filter:"brightness(1)"},{opacity:1,filter:"brightness(2.8)",offset:.035},{opacity:1,filter:"brightness(2.2)",offset:.16},{opacity:.55,filter:"brightness(1.5)",offset:.42},{opacity:.16,filter:"brightness(1.15)",offset:.72},{opacity:0,filter:"brightness(1)"}],{duration:1550,easing:"cubic-bezier(.08,.7,.18,1)"});}

function makeCloud(group){const stem=new THREE.Group(),cap=new THREE.Group(),skirt=new THREE.Group();mark(stem);mark(cap);mark(skirt);group.add(stem,cap,skirt);
  for(let i=0;i<10;i++){const z=2.2+i*3.2,r=2.2+i*.28,offset=(i%2?1:-1)*(.3+i*.07);stem.add(puff(new THREE.Group(),1,0,new THREE.Vector3()));const p=puff(stem,r,i<4?0x5c4738:0x65574c,new THREE.Vector3(offset,Math.sin(i*2.1)*.45,z),[1.15,.95,1.35]);p.userData.cloudBand="stem";}
  for(let i=0;i<18;i++){const a=i/18*Math.PI*2,radius=7.8+(i%3)*1.3,z=34.5+(i%4)*1.2;const p=puff(cap,4.4+(i%4)*.45,i%2?0x76685d:0x66584d,new THREE.Vector3(Math.cos(a)*radius,Math.sin(a)*radius,z),[1.55,1.55,.72]);p.userData.cloudBand="cap";}
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2,radius=5.8+(i%2)*1.2,z=26.5+(i%3)*1.1;const p=puff(skirt,3.3+(i%3)*.35,0x58483d,new THREE.Vector3(Math.cos(a)*radius,Math.sin(a)*radius,z),[1.35,1.35,.82]);p.userData.cloudBand="skirt";}
  const crown=puff(cap,8.4,0x75675c,new THREE.Vector3(0,0,38.2),[1.75,1.75,.72]);crown.userData.cloudBand="crown";
  return{stem,cap,skirt};
}

function makeShock(group){const rings=[];for(let i=0;i<3;i++){const r=1.1+i*.45;const ring=mark(new THREE.Mesh(new THREE.RingGeometry(r,r+.18,96),basic(i===0?0xffffff:i===1?0xfff2cf:0xcde9ff,.9,{additive:true})));ring.position.z=.20+i*.035;group.add(ring);rings.push(ring);}const shell=mark(new THREE.Mesh(new THREE.SphereGeometry(1,36,18),basic(0xffffff,.22,{additive:true})));shell.scale.z=.12;shell.position.z=.75;group.add(shell);return{rings,shell};}
function makeGroundDust(group){const dust=new THREE.Group();mark(dust);group.add(dust);for(let i=0;i<18;i++){const a=i/18*Math.PI*2,p=puff(dust,1.2+(i%4)*.28,i%2?0x8b725d:0x6f5d4d,new THREE.Vector3(Math.cos(a)*2.2,Math.sin(a)*2.2,.55+(i%3)*.18),[1.5,.85,.55]);p.userData.dustIndex=i;}return dust;}

function cameraDistance(position){const c=bridge()?.threeCamera;if(!c)return Infinity;c.getWorldPosition?.(new THREE.Vector3());return c.getWorldPosition?c.getWorldPosition(new THREE.Vector3()).distanceTo(position):c.position.distanceTo(position);}
function beginShake(position,born){const distance=cameraDistance(position);if(!Number.isFinite(distance)||distance>MAX_SHAKE_RADIUS_M)return null;const arrivalMs=distance/SOUND_SPEED_MPS*1000;const strength=clamp(1-distance/MAX_SHAKE_RADIUS_M,.08,1);return{position:position.clone(),born,arrivalMs,strength,triggered:false,until:born+arrivalMs+1550,lastX:0,lastY:0};}
function applyShake(now,item){if(!item||now<item.born+item.arrivalMs)return;const view=viewport(),canvas=view?.querySelector("canvas");if(!canvas)return;if(!item.triggered){item.triggered=true;const v=viewport();if(v){v.dataset.nukeShockwaveArrivalMs=item.arrivalMs.toFixed(1);v.dataset.nukeCameraShake="pressure-front-v1";v.dataset.nukeCameraShakeStrength=item.strength.toFixed(3);}window.dispatchEvent(new CustomEvent("arondight:nuke-pressure-arrival",{detail:{distanceM:cameraDistance(item.position),arrivalMs:item.arrivalMs,strength:item.strength}}));}
  const t=clamp((now-(item.born+item.arrivalMs))/1550,0,1),envelope=(1-t)**1.45,pulse=.65+.35*Math.sin(t*Math.PI*9),amp=(4+30*item.strength)*envelope*pulse;const x=(Math.sin(now*.091)+Math.sin(now*.173)*.55)*amp*.52,y=(Math.sin(now*.127+.8)+Math.sin(now*.213)*.42)*amp*.34;canvas.style.translate=`${x.toFixed(2)}px ${y.toFixed(2)}px`;item.lastX=x;item.lastY=y;if(t>=1){canvas.style.translate="";}}

export function spawnNukeCinematicFx(scene,position,now=performance.now()){
  if(!scene||!position)return null;const root=mark(new THREE.Group());root.position.copy(position);scene.add(root);
  const flashCore=sphere(root,1.7,0xffffff,1,true,28),whiteHot=sphere(root,2.3,0xfffff2,1,true,28),fireball=sphere(root,3.0,0xff6a18,.98,true,30),fireShell=sphere(root,3.8,0xff2f05,.72,true,26);
  const shock=makeShock(root),cloud=makeCloud(root),dust=makeGroundDust(root);
  const groundGlow=mark(new THREE.Mesh(new THREE.CircleGeometry(14,64),basic(0xff5a14,.74,{additive:true})));groundGlow.position.z=.045;root.add(groundGlow);
  const scorch=mark(new THREE.Mesh(new THREE.CircleGeometry(18,64),basic(0x100b08,.78)));scorch.position.z=.025;root.add(scorch);
  const keyLight=new THREE.PointLight(0xffe0a2,220,220,1.05);keyLight.position.z=10;root.add(keyLight);
  const warmLight=new THREE.PointLight(0xff5a18,110,150,1.25);warmLight.position.z=4;root.add(warmLight);
  for(const g of[cloud.stem,cloud.cap,cloud.skirt,dust])for(const child of g.children)child.material.opacity=0;
  const item={root,scene,position:position.clone(),born:now,until:now+LIFE_MS,flashCore,whiteHot,fireball,fireShell,shock,cloud,dust,groundGlow,scorch,keyLight,warmLight,shake:beginShake(position,now)};effects.push(item);blastFlash();
  const v=viewport();if(v){v.dataset.nukeCinematic="flash-fireball-pressurewave-mushroom-camera-shake-v2";v.dataset.nukePressureWaveMps=String(SOUND_SPEED_MPS);v.dataset.nukeVisualRadiusM=String(VISUAL_RADIUS_M);v.dataset.nukeMushroomHeightM="46";}
  return item;
}

function update(item,now){const age=now-item.born,t=clamp(age/LIFE_MS,0,1);
  const fireT=clamp(age/1750,0,1),fireEase=easeOut(fireT),fireRadius=2.2+14.8*fireEase;item.flashCore.scale.setScalar(fireRadius/1.7);item.whiteHot.scale.setScalar((2.0+12.2*fireEase)/2.3);item.fireball.scale.setScalar((2.2+10.8*fireEase)/3);item.fireShell.scale.setScalar((2.5+12.5*fireEase)/3.8);item.flashCore.material.opacity=Math.max(0,1-fireT*1.35);item.whiteHot.material.opacity=Math.max(0,1-fireT*.95);item.fireball.material.opacity=Math.max(.06,.98*(1-fireT*.62))*(1-clamp((age-2600)/7000,0,1));item.fireShell.material.opacity=.72*(1-clamp((age-1800)/6500,0,1));item.keyLight.intensity=220*(1-fireT)**1.6;item.warmLight.intensity=110*(1-clamp(age/4800,0,1));item.groundGlow.scale.setScalar(1+1.55*fireEase);item.groundGlow.material.opacity=.74*(1-clamp(age/3600,0,1));
  const physicalRadius=Math.min(VISUAL_RADIUS_M,age/1000*SOUND_SPEED_MPS);const shockScale=Math.max(1,physicalRadius/1.25);for(let i=0;i<item.shock.rings.length;i++){const ring=item.shock.rings[i];ring.scale.setScalar(shockScale*(1+i*.012));ring.material.opacity=(.92-i*.16)*Math.max(0,1-physicalRadius/VISUAL_RADIUS_M);}item.shock.shell.scale.set(physicalRadius,physicalRadius,Math.max(.12,physicalRadius*.08));item.shock.shell.material.opacity=.18*Math.max(0,1-physicalRadius/VISUAL_RADIUS_M);
  const dustT=clamp((age-120)/2800,0,1),dustRadius=2+30*easeOut(dustT);for(let i=0;i<item.dust.children.length;i++){const p=item.dust.children[i],a=i/item.dust.children.length*Math.PI*2,r=dustRadius*(.82+(i%4)*.055);p.position.x=Math.cos(a)*r;p.position.y=Math.sin(a)*r;p.position.z=.55+3.1*Math.sin(Math.PI*dustT)*(0.45+(i%3)*.2);p.material.opacity=.62*Math.sin(Math.PI*clamp(dustT,0,1));p.scale.setScalar(.8+2.1*dustT);}
  const cloudT=clamp((age-520)/7500,0,1),rise=smooth(cloudT);item.cloud.stem.position.z=rise*4.5;item.cloud.skirt.position.z=rise*7.5;item.cloud.cap.position.z=rise*8.0;item.cloud.stem.scale.setScalar(.34+1.12*rise);item.cloud.skirt.scale.setScalar(.30+1.30*rise);item.cloud.cap.scale.setScalar(.28+1.48*rise);for(const g of[item.cloud.stem,item.cloud.skirt,item.cloud.cap])for(const p of g.children)p.material.opacity=.92*Math.min(1,cloudT*3.2)*(1-clamp((age-14500)/7500,0,1)*.65);
  item.scorch.material.opacity=.78*(1-clamp((age-17000)/5000,0,1));applyShake(now,item.shake);
  const v=viewport();if(v&&age<900){v.dataset.nukePressureWaveRadiusM=physicalRadius.toFixed(1);}
}

function frame(now=performance.now()){for(let i=effects.length-1;i>=0;i--){const item=effects[i];update(item,now);if(now>=item.until){item.scene.remove(item.root);effects.splice(i,1);}}requestAnimationFrame(frame);}
export function installNukeCinematicFx(){if(installed)return;installed=true;ensureFlash();requestAnimationFrame(frame);}
installNukeCinematicFx();
