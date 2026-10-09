// Cows on the meadows. Every pasture of the real map (meadow, grassland, farmland — from the
// map's land cover, world_city_roads.mjs) big enough for a herd gets one: 2–7 cows, coat and
// count from a hash of the pasture's geo key, so every player sees the same herd.
//
// They graze and wander inside their pasture on a clock-driven path (a new spot every ~24 s,
// walked at 0.55 m/s, head down in between) — the same on every machine without sending
// anything. They moo now and then when you are near, shy away from gunfire and blasts, and they
// are physical when it counts: a round hurts (a .50 drops one), a blast or a car at speed kills
// and throws the 600 kg body as a Box3D rigid body (the car loses the momentum it hands over);
// a slow car just nudges the cow aside. Deaths are replicated.
import * as THREE from "three";
import {groundHeightAt} from "./terrain_craters.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";

export const COWS_VERSION="pasture-cows-v1";
const MAX_COWS=40,MIN_AREA_M2=1800,HERD_RADIUS_M=420,PERIOD_MS=24000,WALK_MPS=.55,COW_MASS=600,HIP_Z=.8;
const COATS=[[0xf1efe8,"holstein"],[0xf1efe8,"holstein"],[0x8a5a3c,"brown"],[0x3a2c24,"dark"],[0xcfa977,"fawn"]];
const DAMAGE={smg:14,glock:20,sniper:400,grenade:400,gun:30,"5.56":30};
let installed=false,scene=null,root=null,bodyMesh=null,headMesh=null,legMesh=null,herdsFor="",lastHerdCheck=0,lastMoo=-1e9,lastFrame=performance.now();
const cows=[],deadKeys=new Set();
const bridge=()=>globalThis.__arondightRealWorld||null;
const rigid=()=>globalThis.__arondightWorldRigidBodies||null;
const M=new THREE.Matrix4(),L=new THREE.Matrix4(),R1=new THREE.Matrix4(),Q=new THREE.Quaternion(),P=new THREE.Vector3(),S=new THREE.Vector3(1,1,1),Z=new THREE.Vector3(0,0,1),Y=new THREE.Vector3(0,1,0),ZERO=new THREE.Matrix4().makeScale(0,0,0);
function hash(s){let h=2166136261;for(const ch of String(s))h=Math.imul(h^ch.charCodeAt(0),16777619);h^=h>>>13;h=Math.imul(h,0x5bd1e995);h^=h>>>15;return(h>>>0)/4294967296;}

// ------------------------------------------------------------------ model (one draw call per part)
function coloured(g,c){const n=g.attributes.position.count,col=new Float32Array(n*3),k=new THREE.Color(c);for(let i=0;i<n;i++){col[i*3]=k.r;col[i*3+1]=k.g;col[i*3+2]=k.b;}g.setAttribute("color",new THREE.BufferAttribute(col,3));return g.index?g.toNonIndexed():g;}
function merge(list){let n=0;for(const g of list)n+=g.attributes.position.count;const pos=new Float32Array(n*3),nor=new Float32Array(n*3),col=new Float32Array(n*3);let o=0;for(const g of list){g.computeVertexNormals();pos.set(g.attributes.position.array,o*3);nor.set(g.attributes.normal.array,o*3);col.set(g.attributes.color.array,o*3);o+=g.attributes.position.count;}
  const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(pos,3));out.setAttribute("normal",new THREE.BufferAttribute(nor,3));out.setAttribute("color",new THREE.BufferAttribute(col,3));out.computeBoundingSphere();return out;}
const box=(sx,sy,sz,x,y,z,c)=>coloured(new THREE.BoxGeometry(sx,sy,sz).translate(x,y,z),c);
function bodyGeometry(){// x forward, origin between the feet; white × instance coat, spots dark
  const W=0xffffff,D=0x1a1714;return merge([box(1.62,.66,.7,0,0,1.15,W),box(.5,.67,.4,-.25,0,1.28,D).scale(1,1.002,1),box(.36,.67,.3,.42,0,1.08,D),box(.3,.4,.22,.55,.0,1.42,D),
    box(.3,.3,.16,-.35,0,.74,0xd99a9a),box(.05,.05,.6,-.83,0,1.05,W),box(.08,.1,.14,-.84,0,.72,D),box(.3,.5,.12,.72,0,1.5,W)]);}
function headGeometry(){// pivot at the neck; muzzle pink, little horns
  return merge([box(.42,.32,.34,.2,0,0,0xffffff),box(.16,.3,.2,.46,0,-.07,0xe2a7a2),box(.04,.12,.04,.08,.15,.18,0xe9e2cf),box(.04,.12,.04,.08,-.15,.18,0xe9e2cf),box(.06,.14,.08,.05,.22,.04,0xffffff),box(.06,.14,.08,.05,-.22,.04,0xffffff)]);}
function legGeometry(){return merge([box(.14,.14,HIP_Z-.1,0,0,-(HIP_Z-.1)/2,0xffffff),box(.15,.15,.1,0,0,-HIP_Z+.05,0x2a2522)]);}
function ensureMeshes(){const s=bridge()?.threeScene;if(!s)return false;if(s===scene&&root?.parent===s)return true;root?.parent?.remove(root);scene=s;root=new THREE.Group();root.name="PASTURE_COWS";root.userData.flightFireIgnore=true;
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85});bodyMesh=new THREE.InstancedMesh(bodyGeometry(),mat,MAX_COWS);headMesh=new THREE.InstancedMesh(headGeometry(),mat,MAX_COWS);legMesh=new THREE.InstancedMesh(legGeometry(),mat,MAX_COWS*4);
  for(const m of[bodyMesh,headMesh,legMesh]){m.count=0;m.frustumCulled=false;m.castShadow=true;m.receiveShadow=true;m.raycast=()=>{};m.userData.flightFireIgnore=true;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(m);}
  s.add(root);return true;}

// ------------------------------------------------------------------ pastures → herds
function areaOf(poly){let a=0;for(let i=0,j=poly.length-1;i<poly.length;j=i++)a+=(poly[j][0]+poly[i][0])*(poly[j][1]-poly[i][1]);return Math.abs(a)/2;}
function inside(poly,x,y){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1]+1e-12)+a[0])c=!c;}return c;}
function inPasture(m,x,y){if(!inside(m.outer,x,y))return false;for(const h of m.holes||[])if(h.length>2&&inside(h,x,y))return false;return true;}
function spot(m,seed){const bb=m.bb;for(let k=0;k<14;k++){const x=bb[0]+(bb[2]-bb[0])*hash(`${seed}:x${k}`),y=bb[1]+(bb[3]-bb[1])*hash(`${seed}:y${k}`);if(inPasture(m,x,y))return[x,y];}return m.centre;}
function focus(){const f=globalThis.__arondightStreamFocus?.()||bridge()?.threeCamera?.position;return f?{x:f.x,y:f.y}:null;}
function rebuildHerds(){const list=globalThis.__worldMeadows,f=focus();if(!Array.isArray(list)||!f)return;
  const cand=[];for(const m of list){if(!m.outer||m.outer.length<3)continue;const a=areaOf(m.outer);if(a<MIN_AREA_M2)continue;let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity,cx=0,cy=0;for(const p of m.outer){bx0=Math.min(bx0,p[0]);by0=Math.min(by0,p[1]);bx1=Math.max(bx1,p[0]);by1=Math.max(by1,p[1]);cx+=p[0];cy+=p[1];}cx/=m.outer.length;cy/=m.outer.length;
    const d=Math.hypot(cx-f.x,cy-f.y);if(d>HERD_RADIUS_M+Math.sqrt(a))continue;cand.push({m:{...m,bb:[bx0,by0,bx1,by1],centre:[cx,cy],area:a},d});}
  cand.sort((a,b)=>a.d-b.d);const keep=new Map(cows.map(c=>[c.key,c]));const next=[];
  for(const{m}of cand){const n=Math.max(2,Math.min(7,Math.round(m.area/4000)+Math.floor(hash(m.key)*2)));for(let i=0;i<n&&next.length<MAX_COWS;i++){const key=`${m.key}#${i}`,old=keep.get(key);if(old){old.m=m;next.push(old);continue;}
      const coat=COATS[Math.floor(hash(`${key}:coat`)*COATS.length)];next.push({key,i,m,coat:coat[0],color:new THREE.Color(coat[0]),hp:100,dead:deadKeys.has(key),body:null,flee:null,off:[0,0],nextMoo:performance.now()+8000+hash(`${key}:moo`)*30000,phase:hash(key)*6,x:0,y:0,yaw:0,walking:false});}
    if(next.length>=MAX_COWS)break;}
  for(const c of cows)if(!next.includes(c)&&c.body){rigid()?.removeBody?.(c.body);c.body=null;}
  cows.length=0;cows.push(...next);for(const c of cows)if(c.dead&&!c.body)c.hidden=true;
  const v=document.getElementById("viewport");if(v){v.dataset.cows=String(cows.length);v.dataset.cowsVersion=COWS_VERSION;}}

// the clock-driven grazing walk (identical on every machine)
function pathPose(c,t){const k=Math.floor(t/PERIOD_MS),A=spot(c.m,`${c.key}:${k}`),B=spot(c.m,`${c.key}:${k+1}`),dx=B[0]-A[0],dy=B[1]-A[1],d=Math.hypot(dx,dy),walkMs=Math.min(PERIOD_MS*.75,d/WALK_MPS*1000),u=Math.min(1,(t-k*PERIOD_MS)/Math.max(1,walkMs));
  return{x:A[0]+dx*u,y:A[1]+dy*u,yaw:d>.2?Math.atan2(dy,dx):hash(`${c.key}:${k}:yaw`)*Math.PI*2,walking:u<1&&d>.2};}

// ------------------------------------------------------------------ physics & damage
function kill(c,impulse,{net=true}={}){if(c.dead)return;c.dead=true;c.hp=0;deadKeys.add(c.key);const R=rigid();moo([c.x,c.y,1.4],.8);
  if(R?.upsertBody){const id=`cow-${hash(c.key).toString(36).slice(2,10)}`;if(R.upsertBody({id,kind:"prop",position:[c.x,c.y,groundHeightAt(c.x,c.y)+1.12],yaw:c.yaw,halfExtents:[.82,.34,.38],massKg:COW_MASS,wheeled:false,friction:.7,restitution:.05,linearDamping:.05,angularDamping:.3,sleep:true})){c.body=id;R.applyImpulse?.(id,impulse,{point:[c.x,c.y,groundHeightAt(c.x,c.y)+1.45]});}}
  if(net)sendDeath(c,impulse);window.dispatchEvent(new CustomEvent("arondight:world-kill",{detail:{id:c.key,kind:"animal",species:"cow",network:false}}));}
function scare(c,x,y,ms=4500){if(c.dead)return;const dx=c.x-x,dy=c.y-y,d=Math.hypot(dx,dy)||1;c.flee={until:performance.now()+ms,vx:dx/d*2.8,vy:dy/d*2.8};}
function hurt(c,dmg,dir,src){if(c.dead)return;c.hp-=dmg;if(c.hp<=0){const k=Math.min(4,1+dmg/120);kill(c,[dir[0]*COW_MASS*k,dir[1]*COW_MASS*k,COW_MASS*1.2]);}else{scare(c,c.x-dir[0],c.y-dir[1]);moo([c.x,c.y,1.4],.6);}}
function onTracer(e){const d=e.detail||{},a=d.start,b=d.end;if(!Array.isArray(a)||!Array.isArray(b)||!cows.length)return;const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],L2=dx*dx+dy*dy+dz*dz;if(L2<.01)return;const len=Math.sqrt(L2);let best=null,bt=2;
  for(const c of cows){if(c.dead||c.hidden)continue;const cz=groundHeightAt(c.x,c.y)+1.15,t=Math.max(0,Math.min(1,((c.x-a[0])*dx+(c.y-a[1])*dy+(cz-a[2])*dz)/L2)),px=a[0]+dx*t-c.x,py=a[1]+dy*t-c.y,pz=a[2]+dz*t-cz,along=Math.abs(px*Math.cos(c.yaw)+py*Math.sin(c.yaw)),side=Math.hypot(-px*Math.sin(c.yaw)+py*Math.cos(c.yaw),pz);if(along<.95&&side<.42&&t<bt){bt=t;best=c;}}
  if(best)hurt(best,DAMAGE[String(d.weapon||"smg")]??16,[dx/len,dy/len],"shot");
  // a near miss still startles the herd
  const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;for(const c of cows)if(!c.dead&&Math.hypot(c.x-mx,c.y-my)<len/2+12)scare(c,a[0],a[1],3000);}
function onExplosion(e){const d=e.detail||{},p=d.position;if(!Array.isArray(p))return;const r=Math.max(4,Number(d.radiusM)||8);for(const c of cows){if(c.dead)continue;const dx=c.x-p[0],dy=c.y-p[1],dist=Math.hypot(dx,dy);if(dist<r*.75){const k=COW_MASS*(7*(1-dist/r)+2)/(dist||1);kill(c,[dx*k,dy*k,COW_MASS*5*(1-dist/r)+COW_MASS]);}else if(dist<r*4)scare(c,p[0],p[1]);}}
let lastCarCheck=0;
function checkCars(now){if(now-lastCarCheck<66||!cows.length)return;lastCarCheck=now;const R=rigid(),recs=R?.engine?.records;if(!recs)return;
  for(const[id,rec]of recs){if(rec.kind!=="car"&&rec.kind!=="bus")continue;const p=R.pose(id);if(!p?.position)continue;const v=p.velocity||[0,0,0],sp=Math.hypot(v[0],v[1]),hl=rec.kind==="bus"?4.05:1.88,hw=rec.kind==="bus"?1.25:.86,c0=Math.cos(p.yaw),s0=Math.sin(p.yaw);
    for(const c of cows){if(c.dead||c.hidden)continue;const dx=c.x-p.position[0],dy=c.y-p.position[1];if(dx*dx+dy*dy>40)continue;const u=dx*c0+dy*s0,w=-dx*s0+dy*c0;if(Math.abs(u)>hl+.55||Math.abs(w)>hw+.45)continue;const m=Number(rec.massKg)||1400,share=COW_MASS/(m+COW_MASS);
      if(sp>3){const lost=sp*share;R.applyImpulse?.(id,[-v[0]/sp*m*lost,-v[1]/sp*m*lost,0]);if(sp>8)kill(c,[v[0]*COW_MASS*1.1,v[1]*COW_MASS*1.1,COW_MASS*Math.min(6,sp*.35)]);else{c.off[0]+=v[0]/sp*1.2;c.off[1]+=v[1]/sp*1.2;scare(c,p.position[0],p.position[1]);moo([c.x,c.y,1.4],.9);}}
      else{const d=Math.hypot(dx,dy)||1;c.off[0]+=dx/d*.08;c.off[1]+=dy/d*.08;}}}}
// multiplayer: deaths travel, the others drop the same cow
function session(){const s=bridge()?.vsSession;return s?.sendFx?s:s?.active?.sendFx?s.active:null;}
function sendDeath(c,impulse){const s=session();if(!s)return;try{s.sendFx({type:"impact",objectId:"pasture-cow",kind:"dead",id:`cow-${Date.now().toString(36)}-${c.i}`,p:[0,0,0],cow:c.key,imp:impulse.map(v=>Math.round(v))});}catch{}}
function onFx(e){const pk=e?.detail?.packet;if(pk?.objectId!=="pasture-cow"||!pk.cow)return;deadKeys.add(String(pk.cow));const c=cows.find(k=>k.key===pk.cow);if(c&&!c.dead)kill(c,Array.isArray(pk.imp)?pk.imp:[0,0,COW_MASS],{net:false});}

// ------------------------------------------------------------------ moo (synthesized, in 3-D)
function moo(pos,k=1){const a=globalThis.__sharedAudioContext;if(!a||a.state!=="running")return;const now=performance.now();if(now-lastMoo<2500&&k<.7)return;lastMoo=now;
  try{const cam=bridge()?.presentedCamera?.()||bridge()?.threeCamera;const t=a.currentTime,pan=a.createPanner();pan.panningModel="equalpower";pan.distanceModel="inverse";pan.refDistance=5;pan.rolloffFactor=1.2;if(pan.positionX){pan.positionX.value=pos[0];pan.positionY.value=pos[1];pan.positionZ.value=pos[2];}
    if(cam&&a.listener.positionX){a.listener.positionX.value=cam.position.x;a.listener.positionY.value=cam.position.y;a.listener.positionZ.value=cam.position.z;}
    const g=a.createGain(),dur=1.1+Math.random()*.6,f0=105+Math.random()*30;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.32*k,t+.18);g.gain.setValueAtTime(.3*k,t+dur*.7);g.gain.linearRampToValueAtTime(0,t+dur);
    const f1=a.createBiquadFilter(),f2=a.createBiquadFilter();f1.type="bandpass";f1.frequency.setValueAtTime(380,t);f1.frequency.linearRampToValueAtTime(720,t+dur*.4);f1.Q.value=4;f2.type="lowpass";f2.frequency.value=1400;
    for(const det of[0,7]){const o=a.createOscillator();o.type="sawtooth";o.frequency.setValueAtTime(f0*.9,t);o.frequency.linearRampToValueAtTime(f0,t+.25);o.frequency.linearRampToValueAtTime(f0*.82,t+dur);o.detune.value=det;o.connect(f1);o.start(t);o.stop(t+dur+.05);}
    f1.connect(f2).connect(g).connect(pan).connect(a.destination);}catch{}}

// ------------------------------------------------------------------ per frame
function frame(){requestAnimationFrame(frame);const now=performance.now(),dt=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;
  if(now-lastHerdCheck>2000){lastHerdCheck=now;const f=focus(),key=f?`${Math.round(f.x/150)},${Math.round(f.y/150)}:${globalThis.__worldMeadows?.length||0}`:"";if(key&&key!==herdsFor){herdsFor=key;rebuildHerds();}}
  if(!cows.length){if(bodyMesh)bodyMesh.count=headMesh.count=legMesh.count=0;return;}if(!ensureMeshes())return;checkCars(now);
  const t=Date.now(),R=rigid(),f=focus();let n=0;
  for(const c of cows){if(c.hidden){continue;}
    if(c.dead&&c.body){const p=R?.pose?.(c.body);if(!p?.position)continue;Q.set(p.rotation[0],p.rotation[1],p.rotation[2],p.rotation[3]);M.compose(P.set(p.position[0],p.position[1],p.position[2]),Q,S).multiply(L.makeTranslation(0,0,-1.12));c.x=p.position[0];c.y=p.position[1];}
    else if(c.dead){continue;}
    else{const base=pathPose(c,t);if(c.flee&&now<c.flee.until){c.off[0]+=c.flee.vx*dt;c.off[1]+=c.flee.vy*dt;}else{c.flee=null;const k=Math.exp(-dt/14);c.off[0]*=k;c.off[1]*=k;}
      let x=base.x+c.off[0],y=base.y+c.off[1];if(!inPasture(c.m,x,y)&&inPasture(c.m,base.x,base.y)){c.off[0]*=.9;c.off[1]*=.9;x=base.x+c.off[0];y=base.y+c.off[1];}
      const running=Boolean(c.flee),moving=running||base.walking,yaw=running?Math.atan2(c.flee.vy,c.flee.vx):base.yaw;let dy=yaw-c.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));c.yaw+=dy*Math.min(1,dt*(running?6:2.2));c.x=x;c.y=y;c.walking=moving;
      c.phase+=dt*(running?7:moving?3.2:0);Q.setFromAxisAngle(Z,c.yaw);M.compose(P.set(x,y,groundHeightAt(x,y)+(running?Math.abs(Math.sin(c.phase))*.05:0)),Q,S);
      if(f&&now>c.nextMoo){c.nextMoo=now+15000+Math.random()*30000;if(Math.hypot(x-f.x,y-f.y)<35)moo([x,y,1.4],.7);}}
    bodyMesh.setMatrixAt(n,M);bodyMesh.setColorAt(n,c.color);
    const graze=!c.dead&&!c.walking,headPitch=c.dead?.2:graze?.95+.08*Math.sin(now/600+c.phase):.12;L.makeTranslation(.86,0,1.36).multiply(R1.makeRotationY(headPitch));headMesh.setMatrixAt(n,L.premultiply(M));headMesh.setColorAt(n,c.color);
    const amp=c.dead?0:c.flee?.6:c.walking?.32:0;for(let k=0;k<4;k++){const hx=k<2?.6:-.58,hy=k%2?.2:-.2,sw=amp*Math.sin(c.phase+(k===0||k===3?0:Math.PI));L.makeTranslation(hx,hy,HIP_Z).multiply(R1.makeRotationY(sw));legMesh.setMatrixAt(n*4+k,L.premultiply(M));legMesh.setColorAt(n*4+k,c.color);}
    n++;}
  bodyMesh.count=headMesh.count=n;legMesh.count=n*4;for(const m of[bodyMesh,headMesh,legMesh]){m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}}
export function installCows(){if(installed||typeof window==="undefined")return;installed=true;addEventListener("arondight:foot-tracer",onTracer);addEventListener("arondight:world-explosion",onExplosion);addEventListener(VS_FX_EVENT,onFx);addEventListener("arondight:world-meadows",()=>{herdsFor="";});
  globalThis.__arondightCows={list:()=>cows,version:COWS_VERSION,rebuild:()=>{herdsFor="";lastHerdCheck=0;}};requestAnimationFrame(frame);}
installCows();
