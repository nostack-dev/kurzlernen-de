import * as THREE from "three";

const MOBILE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i.test(globalThis.navigator?.userAgent||"");
const MAX_PUFFS=MOBILE?48:78;
const effects=new Map(),puffs=[];
const worldPosition=new THREE.Vector3(),localPosition=new THREE.Vector3();
let sceneRef=null,texture=null,raf=0,lastFrame=performance.now();

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function hashText(text){let h=2166136261;for(const c of String(text||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function unit(seed){let x=Number(seed)>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;return(x>>>0)/0xffffffff;}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}

function makeTexture(){
  if(texture)return texture;const canvas=document.createElement("canvas");canvas.width=canvas.height=64;const context=canvas.getContext("2d"),gradient=context.createRadialGradient(32,32,2,32,32,31);gradient.addColorStop(0,"rgba(255,255,255,.92)");gradient.addColorStop(.22,"rgba(230,230,226,.74)");gradient.addColorStop(.58,"rgba(108,108,104,.42)");gradient.addColorStop(1,"rgba(35,35,34,0)");context.fillStyle=gradient;context.fillRect(0,0,64,64);texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function clearPool(){for(const puff of puffs)puff.sprite.parent?.remove(puff.sprite);puffs.splice(0);effects.clear();}
function ensurePool(){
  const scene=bridge()?.threeScene;if(!scene)return false;if(scene!==sceneRef){clearPool();sceneRef=scene;}
  const map=makeTexture();while(puffs.length<MAX_PUFFS){const material=new THREE.SpriteMaterial({map,color:0x4a4d4f,transparent:true,opacity:0,depthWrite:false,depthTest:true}),sprite=new THREE.Sprite(material);sprite.visible=false;sprite.renderOrder=16;sprite.userData.flightFireIgnore=true;sprite.userData.worldCriticalSmoke=true;scene.add(sprite);puffs.push({sprite,velocity:new THREE.Vector3(),born:0,expires:0,startScale:1,endScale:2,ember:false,serial:0});}
  const view=viewport();if(view){view.dataset.worldCriticalDamageFx="dark-smoke+ember-countdown-v1";view.dataset.worldCriticalSmokePool=String(MAX_PUFFS);}return true;
}

function sourcePosition(effect){
  const object=effect.object;if(!object?.parent)return null;object.updateWorldMatrix?.(true,false);localPosition.set(...effect.offset);object.localToWorld?.(localPosition);if(!object.localToWorld)object.getWorldPosition?.(localPosition);return worldPosition.copy(localPosition);
}

function choosePuff(){return puffs.find(item=>!item.sprite.visible)||puffs.reduce((oldest,item)=>item.born<oldest.born?item:oldest,puffs[0]);}
function emit(effect,now){
  const origin=sourcePosition(effect);if(!origin)return false;const puff=choosePuff();if(!puff)return false;const progress=clamp((now-effect.startedAt)/Math.max(1,effect.expiresAt-effect.startedAt),0,1),serial=effect.serial++,seed=hashText(`${effect.seed}:${serial}`),a=unit(seed)*Math.PI*2,side=(unit(seed+17)-.5)*(.22+effect.scale*.18),ember=progress>.67&&serial%5===0;
  puff.sprite.position.copy(origin);puff.sprite.position.x+=Math.cos(a)*side;puff.sprite.position.y+=Math.sin(a)*side;puff.velocity.set(Math.cos(a)*(.07+unit(seed+31)*.19),Math.sin(a)*(.07+unit(seed+47)*.19),.46+unit(seed+61)*.40+progress*.30);puff.born=now;puff.expires=now+(ember?420:1250+unit(seed+79)*520);puff.startScale=effect.scale*(ember? .10:.38+unit(seed+97)*.19);puff.endScale=effect.scale*(ember? .035:1.32+unit(seed+113)*.42);puff.ember=ember;puff.serial=serial;puff.sprite.material.color.setHex(ember?0xff7a21:(progress>.55?0x25282a:0x4b4d4e));puff.sprite.material.blending=ember?THREE.AdditiveBlending:THREE.NormalBlending;puff.sprite.material.opacity=ember? .94:.54+progress*.18;puff.sprite.scale.setScalar(puff.startScale);puff.sprite.visible=true;return true;
}

function updatePuffs(now,dt){
  let active=0;for(const puff of puffs){if(!puff.sprite.visible)continue;if(now>=puff.expires){puff.sprite.visible=false;continue;}active++;const t=clamp((now-puff.born)/(puff.expires-puff.born),0,1);puff.sprite.position.addScaledVector(puff.velocity,dt);puff.velocity.x*=Math.exp(-.8*dt);puff.velocity.y*=Math.exp(-.8*dt);puff.sprite.scale.setScalar(puff.startScale+(puff.endScale-puff.startScale)*(1-(1-t)**2));puff.sprite.material.rotation+=dt*(puff.serial&1?-.42:.42);puff.sprite.material.opacity=(puff.ember? .94:.66)*Math.sin(Math.PI*Math.min(1,t*1.12))*(1-t*.48);}
  return active;
}

function update(now=performance.now()){
  raf=requestAnimationFrame(update);const dt=clamp((now-lastFrame)/1000,0,.05);lastFrame=now;if(!ensurePool())return;
  for(const[id,effect]of [...effects]){if(!effect.object?.parent){effects.delete(id);continue;}if(now>=effect.expiresAt){effects.delete(id);const callback=effect.onExpire;queueMicrotask(()=>callback?.());continue;}const progress=clamp((now-effect.startedAt)/Math.max(1,effect.expiresAt-effect.startedAt),0,1),interval=155-progress*72;if(now-effect.lastEmit>=interval){effect.lastEmit=now;emit(effect,now);if(progress>.76)emit(effect,now+1);}}
  const activePuffs=updatePuffs(now,dt),view=viewport();if(view){view.dataset.worldCriticalDamageActive=String(effects.size);view.dataset.worldCriticalSmokePuffs=String(activePuffs);if(effects.size){const soonest=Math.min(...[...effects.values()].map(effect=>effect.expiresAt-now));view.dataset.worldCriticalCountdownMs=String(Math.max(0,Math.round(soonest)));}}
}

function startLoop(){if(raf)return;lastFrame=performance.now();raf=requestAnimationFrame(update);}

export function startWorldCriticalDamage({id,object,kind="object",offset=[0,0,.5],scale=1,delayMs=2200,onExpire=null,seed=""}={}){
  const key=String(id||"");if(!key||!object||!ensurePool())return null;startLoop();const now=performance.now(),current=effects.get(key);if(current){current.object=object;current.onExpire=typeof onExpire==="function"?onExpire:current.onExpire;return current.expiresAt;}
  const effect={id:key,object,kind:String(kind||"object"),offset:[Number(offset?.[0])||0,Number(offset?.[1])||0,Number(offset?.[2])||0],scale:Math.max(.35,Number(scale)||1),startedAt:now,expiresAt:now+Math.max(250,Number(delayMs)||2200),lastEmit:-Infinity,serial:0,onExpire:typeof onExpire==="function"?onExpire:null,seed:String(seed||key)};effects.set(key,effect);emit(effect,now);const view=viewport();if(view){view.dataset.worldCriticalDamageStarts=String((Number(view.dataset.worldCriticalDamageStarts)||0)+1);view.dataset.worldCriticalDamageActive=String(effects.size);view.dataset.worldCriticalDamageKind=effect.kind;view.dataset.worldCriticalDamageModel="smoke-then-delayed-explosion-v1";}try{dispatchEvent(new CustomEvent("arondight:critical-damage",{detail:{id:key,kind:effect.kind,delayMs:effect.expiresAt-now}}));}catch{}return effect.expiresAt;
}

export function accelerateWorldCriticalDamage(id,expiresAt){
  const effect=effects.get(String(id||""));if(!effect)return false;const next=Number(expiresAt);if(Number.isFinite(next))effect.expiresAt=Math.min(effect.expiresAt,Math.max(performance.now()+180,next));const view=viewport();if(view)view.dataset.worldCriticalDamageAccelerations=String((Number(view.dataset.worldCriticalDamageAccelerations)||0)+1);return true;
}

export function stopWorldCriticalDamage(id){return effects.delete(String(id||""));}
export function worldCriticalDamageState(id){const effect=effects.get(String(id||""));return effect?{id:effect.id,kind:effect.kind,startedAt:effect.startedAt,expiresAt:effect.expiresAt}:null;}
