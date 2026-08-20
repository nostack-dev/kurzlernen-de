import * as THREE from "three";

const MOBILE_RE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i;
const MOBILE=MOBILE_RE.test(globalThis.navigator?.userAgent||"");
const MAX_EXPLOSIONS=MOBILE?4:7;
const PARTS_PER_EXPLOSION=9;
const LIFE_MS=6500;
const FADE_MS=1400;
const GRAVITY=9.81;
const FLOOR_Z=.06;
const FIXED_STEP=1/60;
const MAX_STEPS=3;
const BOUNCE=.30;
const FRICTION=.76;
const pieces=[],bursts=[];
let boxGeometry=null,wheelGeometry=null,ringGeometry=null,lastNow=performance.now(),accumulator=0,raf=0;
const tmpQuat=new THREE.Quaternion(),tmpAxis=new THREE.Vector3();

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function hashText(text){let h=2166136261;for(const c of String(text||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function noise(seed,index){let x=(seed+Math.imul(index+1,0x9e3779b1))>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;return(x>>>0)/0xffffffff*2-1;}
function makePiece(material,geometry,scale){const mesh=new THREE.Mesh(geometry,material);mesh.visible=false;mesh.castShadow=true;mesh.userData.flightFireIgnore=true;mesh.userData.worldCarDebris=true;mesh.scale.set(...scale);bridge()?.threeScene?.add(mesh);return{mesh,velocity:new THREE.Vector3(),spin:new THREE.Vector3(),born:0,expires:0,active:false};}
function ensurePool(){const scene=bridge()?.threeScene;if(!scene)return false;boxGeometry??=new THREE.BoxGeometry(1,1,1);wheelGeometry??=new THREE.CylinderGeometry(.34,.34,.22,8);ringGeometry??=new THREE.RingGeometry(.7,1.05,20);while(pieces.length<MAX_EXPLOSIONS*PARTS_PER_EXPLOSION){const i=pieces.length,type=i%PARTS_PER_EXPLOSION,material=new THREE.MeshStandardMaterial({color:type<2?0x55575a:type<6?0x222326:0xb9b9b9,roughness:.62,metalness:type<6?.35:.15,transparent:false});let geometry=boxGeometry,scale=[.55,.42,.18];if(type>=2&&type<6){geometry=wheelGeometry;scale=[1,1,1];}else if(type===0)scale=[1.25,.78,.26];else if(type===1)scale=[.72,.66,.22];pieces.push(makePiece(material,geometry,scale));}while(bursts.length<MAX_EXPLOSIONS){const material=new THREE.MeshBasicMaterial({color:0xff9b45,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}),mesh=new THREE.Mesh(ringGeometry,material);mesh.visible=false;mesh.rotation.x=Math.PI/2;mesh.renderOrder=18;mesh.userData.flightFireIgnore=true;scene.add(mesh);bursts.push({mesh,born:0,expires:0,active:false});}const view=viewport();if(view){view.dataset.worldCarDebrisPool=String(pieces.length);view.dataset.worldCarExplosionPool=String(MAX_EXPLOSIONS);}return true;}
function chooseBurst(){return bursts.find(x=>!x.active)||bursts.reduce((a,b)=>a.born<=b.born?a:b);}
function choosePieces(){const free=pieces.filter(x=>!x.active);if(free.length>=PARTS_PER_EXPLOSION)return free.slice(0,PARTS_PER_EXPLOSION);return [...pieces].sort((a,b)=>a.born-b.born).slice(0,PARTS_PER_EXPLOSION);}
function floor(piece){const m=piece.mesh;if(m.position.z>=FLOOR_Z)return;m.position.z=FLOOR_Z;if(piece.velocity.z<0)piece.velocity.z=-piece.velocity.z*BOUNCE;piece.velocity.x*=FRICTION;piece.velocity.y*=FRICTION;piece.spin.multiplyScalar(.82);if(Math.abs(piece.velocity.z)<.15)piece.velocity.z=0;}
function step(dt){for(const p of pieces){if(!p.active)continue;p.velocity.z-=GRAVITY*dt;p.mesh.position.addScaledVector(p.velocity,dt);floor(p);tmpAxis.copy(p.spin);const omega=tmpAxis.length();if(omega>.0001){tmpAxis.multiplyScalar(1/omega);tmpQuat.setFromAxisAngle(tmpAxis,omega*dt);p.mesh.quaternion.premultiply(tmpQuat);}p.velocity.multiplyScalar(.997);}}
function update(now=performance.now()){raf=requestAnimationFrame(update);const frameDt=Math.min(.08,Math.max(0,(now-lastNow)/1000));lastNow=now;accumulator+=frameDt;let steps=0;while(accumulator>=FIXED_STEP&&steps<MAX_STEPS){step(FIXED_STEP);accumulator-=FIXED_STEP;steps++;}if(steps===MAX_STEPS)accumulator=Math.min(accumulator,FIXED_STEP);let activeParts=0,activeBursts=0;for(const p of pieces){if(!p.active)continue;if(now>=p.expires){p.active=false;p.mesh.visible=false;continue;}activeParts++;const remaining=p.expires-now;if(remaining<FADE_MS){p.mesh.material.transparent=true;p.mesh.material.opacity=Math.max(0,remaining/FADE_MS);p.mesh.material.depthWrite=remaining>FADE_MS*.35;}else{p.mesh.material.opacity=1;p.mesh.material.transparent=false;p.mesh.material.depthWrite=true;}}for(const b of bursts){if(!b.active)continue;if(now>=b.expires){b.active=false;b.mesh.visible=false;continue;}activeBursts++;const t=(now-b.born)/(b.expires-b.born);b.mesh.scale.setScalar(1+8*t);b.mesh.material.opacity=.9*(1-t);}const view=viewport();if(view){view.dataset.worldCarDebrisActive=String(activeParts);view.dataset.worldCarExplosions=String(activeBursts);}}
function startLoop(){if(raf)return;lastNow=performance.now();raf=requestAnimationFrame(update);}

export function spawnWorldCarExplosion({position,yaw=0,velocity=[0,0,0],color=0x777777,seed="",id=""}={}){if(!position||!ensurePool())return false;startLoop();const source=Array.isArray(position)?position:[position.x,position.y,position.z],ox=Number(source[0])||0,oy=Number(source[1])||0,oz=Math.max(FLOOR_Z,Number(source[2])||0),baseV=Array.isArray(velocity)?velocity:[0,0,0],vx0=Number(baseV[0])||0,vy0=Number(baseV[1])||0,vz0=Number(baseV[2])||0,seedNumber=hashText(seed||id||`${ox}:${oy}:${yaw}`),set=choosePieces(),c=Math.cos(yaw),s=Math.sin(yaw),now=performance.now();
  for(let i=0;i<set.length;i++){const p=set[i],side=(i%2?1:-1),forward=i<2?(i===0?0:-.3):(i<6?(i<4?.8:-.8):noise(seedNumber,i)*.6),lateral=i<2?0:side*(i<6?.72:.45),rx=forward*c-lateral*s,ry=forward*s+lateral*c,blast=4.2+Math.abs(noise(seedNumber,i*5))*6.4,angle=yaw+noise(seedNumber,i*5+1)*1.9;p.mesh.position.set(ox+rx,oy+ry,oz+(i<2?.55:.35+Math.abs(noise(seedNumber,i*5+2))*.65));p.mesh.rotation.set(noise(seedNumber,i*7)*.4,noise(seedNumber,i*7+1)*.4,yaw+noise(seedNumber,i*7+2)*.25);p.velocity.set(vx0*.35+Math.cos(angle)*blast,vy0*.35+Math.sin(angle)*blast,vz0*.2+3.2+Math.abs(noise(seedNumber,i*5+3))*6.2);p.spin.set(noise(seedNumber,i*7+3)*7,noise(seedNumber,i*7+4)*7,noise(seedNumber,i*7+5)*7);p.born=now;p.expires=now+LIFE_MS+(i<2?1000:0);p.active=true;p.mesh.visible=true;p.mesh.material.color.setHex(i<2?Number(color)||0x777777:i<6?0x242424:(Number(color)||0x777777));p.mesh.material.opacity=1;}
  const burst=chooseBurst();burst.born=now;burst.expires=now+700;burst.active=true;burst.mesh.position.set(ox,oy,FLOOR_Z+.04);burst.mesh.scale.setScalar(1);burst.mesh.material.opacity=.9;burst.mesh.visible=true;const view=viewport();if(view){view.dataset.worldCarExplosionSpawns=String((Number(view.dataset.worldCarExplosionSpawns)||0)+1);view.dataset.worldCarExplosionLastId=String(id||"");}return true;}

export function worldCarExplosionStats(){return{activePieces:pieces.filter(x=>x.active).length,activeBursts:bursts.filter(x=>x.active).length,pool:pieces.length,maxExplosions:MAX_EXPLOSIONS,partsPerExplosion:PARTS_PER_EXPLOSION};}
