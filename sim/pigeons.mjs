// City pigeons: small flocks that walk about on the pavement and squares near you, nod and peck,
// coo ("gurr"), and all burst into the air together when something startles them — you coming
// close, a car, a shot, a bang — circle a while and land again somewhere else nearby.
// They never land in buildings or water. One instanced draw call for bodies, one for wings.
import * as THREE from "three";
import {groundHeightAt,waterAt} from "./terrain_craters.mjs";
import {worldOption} from "./world_options.mjs";
import {loadAudioSettings,AUDIO_SETTINGS_EVENT} from "./audio_settings.mjs";

export const PIGEONS_VERSION="city-pigeons-v1";
const MOBILE=globalThis.matchMedia?.("(pointer:coarse)")?.matches||/Android|iPhone|iPad|Mobile/i.test(globalThis.navigator?.userAgent||"");
const FLOCKS=MOBILE?3:5,PER_FLOCK_MIN=6,PER_FLOCK_MAX=12,CAP=FLOCKS*PER_FLOCK_MAX;
const NEAR_M=22,FAR_M=95,DESPAWN_M=150,SPOOK_PLAYER_M=4.2,SPOOK_CAR_M=8;
const bridge=()=>globalThis.__arondightRealWorld||null;
let installed=false,scene=null,bodyMesh=null,wingMesh=null,lastFrame=performance.now(),audio=loadAudioSettings(),lastCoo=0;
const SH=new THREE.Matrix4(),WR=new THREE.Matrix4(),WL=new THREE.Matrix4(),MIRROR=new THREE.Matrix4().makeScale(-1,1,1);
const flocks=[],M=new THREE.Matrix4(),Q=new THREE.Quaternion(),P=new THREE.Vector3(),S=new THREE.Vector3(1,1,1),E=new THREE.Euler(0,0,0,"ZXY");
const rand=(a,b)=>a+Math.random()*(b-a);

function focus(){const drive=globalThis.__arondightVehicleDrive,walk=globalThis.__arondightWalkMode;if(drive?.active&&drive.cameraAnchor)return drive.cameraAnchor;if(walk?.mode==="foot"&&walk.position)return walk.position;const b=bridge(),c=b?.presentedCamera?.()||b?.threeCamera;return c?.position||null;}
function blocked(x,y){if(waterAt?.(x,y))return true;const at=globalThis.__arondightBuildingAt;return Boolean(at&&(at(x,y)||at(x+.6,y)||at(x-.6,y)||at(x,y+.6)||at(x,y-.6)));}
// a free spot on the ground in a ring around (x,y)
function spotNear(x,y,rMin,rMax){for(let i=0;i<24;i++){const a=Math.random()*Math.PI*2,r=rand(rMin,rMax),px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;if(!blocked(px,py))return{x:px,y:py};}return null;}

// ---- geometry: a plump grey body with a darker head and a tail, wings as a separate mesh (only in the air)
function bodyGeometry(){const parts=[],col=(g,c)=>{const n=g.attributes.position.count,a=new Float32Array(n*3),k=new THREE.Color(c);for(let i=0;i<n;i++){a[i*3]=k.r;a[i*3+1]=k.g;a[i*3+2]=k.b;}g.setAttribute("color",new THREE.BufferAttribute(a,3));return g;};
  const body=new THREE.SphereGeometry(.11,10,7);body.scale(.85,1.35,.8);body.translate(0,0,.13);parts.push(col(body,0x8d93a0));
  const breast=new THREE.SphereGeometry(.08,8,6);breast.scale(.9,.9,.9);breast.translate(0,.07,.15);parts.push(col(breast,0x7d6f8c));
  const head=new THREE.SphereGeometry(.052,8,6);head.translate(0,.15,.24);parts.push(col(head,0x5d6575));
  const beak=new THREE.ConeGeometry(.013,.04,5);/* a cone points +y: forward already */beak.translate(0,.205,.235);parts.push(col(beak,0x3a3330));
  const tail=new THREE.BoxGeometry(.09,.13,.018);tail.translate(0,-.17,.12);parts.push(col(tail,0x4f5562));
  for(const s of[-1,1]){const leg=new THREE.CylinderGeometry(.007,.007,.07,4);leg.rotateX(Math.PI/2);/* upright (along z) */leg.translate(s*.03,.01,.035);parts.push(col(leg,0xc0605a));}
  let n=0;for(const g of parts){const q=g.index?g.toNonIndexed():g;parts[parts.indexOf(g)]=q;n+=q.attributes.position.count;}
  const pos=new Float32Array(n*3),nrm=new Float32Array(n*3),cl=new Float32Array(n*3);let o=0;for(const g of parts){g.computeVertexNormals();pos.set(g.attributes.position.array,o*3);nrm.set(g.attributes.normal.array,o*3);cl.set(g.attributes.color.array,o*3);o+=g.attributes.position.count;}
  const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(pos,3));out.setAttribute("normal",new THREE.BufferAttribute(nrm,3));out.setAttribute("color",new THREE.BufferAttribute(cl,3));out.computeBoundingSphere();return out;}
function wingGeometry(){// ONE wing (the right one, hinged at x=0); the left is the same instance mirrored
  const v=new Float32Array([0,.07,.16, .36,-.01,.16, 0,-.09,.16, .36,-.01,.16, .2,-.1,.16, 0,-.09,.16]);const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(v,3));g.computeVertexNormals();return g;}

function ensureMeshes(s){if(scene===s&&bodyMesh)return true;if(bodyMesh){bodyMesh.parent?.remove(bodyMesh);wingMesh.parent?.remove(wingMesh);}scene=s;
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,metalness:0}),wmat=new THREE.MeshStandardMaterial({color:0x7f8592,roughness:.85,side:THREE.DoubleSide});
  bodyMesh=new THREE.InstancedMesh(bodyGeometry(),mat,CAP);wingMesh=new THREE.InstancedMesh(wingGeometry(),wmat,CAP*2);
  for(const m of[bodyMesh,wingMesh]){m.name=m===bodyMesh?"WORLD_PIGEONS":"WORLD_PIGEON_WINGS";m.frustumCulled=false;m.count=0;m.castShadow=false;m.raycast=()=>{};m.userData.flightFireIgnore=true;m.userData.neonSkip=true;s.add(m);}return true;}

// ---- a flock: one shared state (ground / air), every bird with its own offset and little moves
function makeFlock(f){const at=spotNear(f.x,f.y,NEAR_M,FAR_M);if(!at)return null;const n=Math.floor(rand(PER_FLOCK_MIN,PER_FLOCK_MAX+1)),birds=[];
  for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*2.4;birds.push({ox:Math.cos(a)*r,oy:Math.sin(a)*r,yaw:Math.random()*Math.PI*2,walkUntil:0,vx:0,vy:0,peck:Math.random()*10,flapPh:Math.random()*6,lag:rand(0,.45),x:at.x+Math.cos(a)*r,y:at.y+Math.sin(a)*r,z:0});}
  return{state:"ground",x:at.x,y:at.y,birds,nextFlight:performance.now()+rand(25000,70000),t:0,air:null,cooAt:performance.now()+rand(2000,9000)};}
function spook(fl,fromX,fromY,now){if(fl.state!=="ground")return;const away=Math.atan2(fl.y-fromY,fl.x-fromX)+rand(-.6,.6),dest=spotNear(fl.x+Math.cos(away)*rand(25,55),fl.y+Math.sin(away)*rand(25,55),0,18)||spotNear(fl.x,fl.y,20,50);
  fl.state="air";fl.t=0;fl.air={cx:fl.x+Math.cos(away)*12,cy:fl.y+Math.sin(away)*12,r:rand(9,16),h:rand(9,18),dir:Math.random()<.5?1:-1,a0:Math.atan2(fl.y-(fl.y+Math.sin(away)*12),fl.x-(fl.x+Math.cos(away)*12)),dur:rand(7,13),dest:dest||{x:fl.x,y:fl.y},from:{x:fl.x,y:fl.y}};flapSound(fl.x,fl.y);}

function update(now,dt){const b=bridge(),s=b?.threeScene,f=focus();const on=Boolean(s&&f&&worldOption("birds")&&document.body.classList.contains("solo-flight"));
  if(!on){if(bodyMesh){bodyMesh.count=0;wingMesh.count=0;}return;}ensureMeshes(s);
  // keep FLOCKS flocks around you
  for(let i=flocks.length-1;i>=0;i--){const fl=flocks[i];if(Math.hypot(fl.x-f.x,fl.y-f.y)>DESPAWN_M&&fl.state==="ground")flocks.splice(i,1);}
  if(flocks.length<FLOCKS&&Math.random()<.05){const fl=makeFlock(f);if(fl)flocks.push(fl);}
  const cars=carPositions();let nb=0,nw=0;
  for(const fl of flocks){
    if(fl.state==="ground"){
      // startled: you close by (walking or running), a moving car, or now and then by itself
      const dP=Math.hypot(f.x-fl.x,f.y-fl.y);if(dP<SPOOK_PLAYER_M+2.4)spook(fl,f.x,f.y,now);else{for(const c of cars)if(Math.hypot(c.x-fl.x,c.y-fl.y)<SPOOK_CAR_M&&c.speed>2){spook(fl,c.x,c.y,now);break;}}
      if(fl.state==="ground"&&now>fl.nextFlight)spook(fl,fl.x+rand(-1,1),fl.y+rand(-1,1),now);
      if(fl.state==="ground"&&now>fl.cooAt){fl.cooAt=now+rand(3500,11000);if(dP<30)coo(fl.x,fl.y,dP);}}
    else{fl.t+=dt;const A=fl.air,k=fl.t/A.dur;
      if(k>=1){fl.state="ground";fl.x=A.dest.x;fl.y=A.dest.y;fl.nextFlight=now+rand(30000,80000);for(const bd of fl.birds){bd.ox=rand(-2.2,2.2);bd.oy=rand(-2.2,2.2);}}}
    for(const bd of fl.birds){if(nb>=CAP)break;
      if(fl.state==="ground"){
        // short walks, nodding head, pecking; never into a wall
        if(now>bd.walkUntil){if(Math.random()<.6){bd.yaw+=rand(-1.4,1.4);const sp=rand(.25,.55);bd.vx=Math.cos(bd.yaw)*sp;bd.vy=Math.sin(bd.yaw)*sp;bd.walkUntil=now+rand(500,1800);}else{bd.vx=bd.vy=0;bd.walkUntil=now+rand(700,2400);}}
        let nx=bd.ox+bd.vx*dt,ny=bd.oy+bd.vy*dt;if(Math.hypot(nx,ny)>3.6||blocked(fl.x+nx,fl.y+ny)){bd.yaw+=Math.PI*.8;bd.vx=-bd.vx;bd.vy=-bd.vy;nx=bd.ox;ny=bd.oy;}bd.ox=nx;bd.oy=ny;
        const tx=fl.x+bd.ox,ty=fl.y+bd.oy;bd.x+=(tx-bd.x)*Math.min(1,dt*6);bd.y+=(ty-bd.y)*Math.min(1,dt*6);bd.z=groundHeightAt(bd.x,bd.y);
        const moving=Math.hypot(bd.vx,bd.vy)>.05;bd.peck+=dt*(moving?9:3);const nod=moving?Math.sin(bd.peck)*.12:(Math.sin(bd.peck*.7)>.85?.55:0);
        E.set(nod,0,bd.yaw-Math.PI/2);Q.setFromEuler(E);P.set(bd.x,bd.y,bd.z);M.compose(P,Q,S);bodyMesh.setMatrixAt(nb++,M);}
      else{const A=fl.air,t=Math.max(0,fl.t-bd.lag),k=Math.min(1,t/A.dur);
        // up and away, a couple of loops, then a glide down onto the new spot
        const ang=A.a0+A.dir*t*1.15+bd.ox*.06,cx=A.cx+bd.ox*.8,cy=A.cy+bd.oy*.8,lx=cx+Math.cos(ang)*A.r,ly=cy+Math.sin(ang)*A.r;
        const land=Math.max(0,(k-.72)/.28),lift=Math.min(1,t/1.2),dx=A.dest.x+bd.ox,dy=A.dest.y+bd.oy,sx=A.from.x+bd.ox,sy=A.from.y+bd.oy;
        let x=lx,y=ly;if(t<1.2){x=sx+(lx-sx)*lift;y=sy+(ly-sy)*lift;}if(land>0){x=lx+(dx-lx)*land;y=ly+(dy-ly)*land;}
        const g=groundHeightAt(x,y),z=g+A.h*Math.min(lift,1-land)+.05;const vx=x-bd.x,vy=y-bd.y;if(Math.hypot(vx,vy)>.01)bd.yaw=Math.atan2(vy,vx);bd.x=x;bd.y=y;bd.z=z;
        E.set(-.25,Math.sin(t*2+bd.lag*9)*.25,bd.yaw-Math.PI/2);Q.setFromEuler(E);P.set(x,y,z);M.compose(P,Q,S);bodyMesh.setMatrixAt(nb++,M);
        // flap: the wing tips go up and down (a shear of z by x); the left wing is the mirrored right one
        bd.flapPh+=dt*(land>0&&land<1?9:t<1.5?24:14);const flap=Math.sin(bd.flapPh);SH.set(1,0,0,0, 0,1,0,0, .9*flap,0,1,0, 0,0,0,1);
        WR.copy(M).multiply(SH);wingMesh.setMatrixAt(nw++,WR);WL.copy(M).multiply(MIRROR).multiply(SH);wingMesh.setMatrixAt(nw++,WL);}}}
  bodyMesh.count=nb;wingMesh.count=nw;bodyMesh.instanceMatrix.needsUpdate=true;wingMesh.instanceMatrix.needsUpdate=true;
  const v=document.getElementById("viewport");if(v){v.dataset.worldPigeons=String(nb);v.dataset.worldPigeonsAir=String(nw);}}
function carPositions(){const out=[];const R=globalThis.__arondightWorldRigidBodies,recs=R?.engine?.records;if(!recs)return out;let n=0;for(const[id,rec]of recs){if(rec.kind!=="car"&&rec.kind!=="bus")continue;const p=R.pose(id);if(!p?.position)continue;const v=p.velocity||[0,0,0];out.push({x:p.position[0],y:p.position[1],speed:Math.hypot(v[0],v[1])});if(++n>40)break;}return out;}

// ---- sound: the "gurr" (a low, rolling, nasal coo) and the clatter of wings on take-off
function ctx(){const a=globalThis.__sharedAudioContext;return a&&a.state==="running"?a:null;}
function level(){if(audio.soundEnabled===false)return 0;return Math.max(0,Math.min(1,(Number(audio.ambientVolume)||46)/100));}
function coo(x,y,dist){const a=ctx(),L=level();if(!a||!L)return;const now=performance.now();if(now-lastCoo<1600)return;lastCoo=now;
  try{const t=a.currentTime,out=a.createGain(),vol=.11*L*Math.max(.15,1-dist/30);out.gain.value=vol;out.connect(a.destination);
    // "gruu-gurr-ruu": two or three rolling notes, each a sine with a fast amplitude trill and a falling pitch
    const notes=Math.random()<.5?[[0,.32,330,270],[.38,.5,300,240]]:[[0,.26,320,280],[.3,.24,345,300],[.6,.55,310,235]];
    for(const[st,d,f0,f1]of notes){const o=a.createOscillator(),o2=a.createOscillator(),g=a.createGain(),trem=a.createOscillator(),tg=a.createGain(),lp=a.createBiquadFilter();
      o.type="sine";o2.type="triangle";o.frequency.setValueAtTime(f0,t+st);o.frequency.exponentialRampToValueAtTime(f1,t+st+d);o2.frequency.setValueAtTime(f0*2.01,t+st);o2.frequency.exponentialRampToValueAtTime(f1*2.01,t+st+d);
      lp.type="lowpass";lp.frequency.value=900;trem.frequency.value=rand(22,30);tg.gain.value=.45;trem.connect(tg).connect(g.gain);
      g.gain.setValueAtTime(0,t+st);g.gain.linearRampToValueAtTime(.55,t+st+.05);g.gain.setValueAtTime(.5,t+st+d*.7);g.gain.linearRampToValueAtTime(0,t+st+d);
      const g2=a.createGain();g2.gain.value=.25;o.connect(g);o2.connect(g2).connect(g);g.connect(lp).connect(out);
      for(const n of[o,o2,trem]){n.start(t+st);n.stop(t+st+d+.02);}}
  }catch{}}
function flapSound(x,y){const a=ctx(),L=level(),f=focus();if(!a||!L||!f)return;const dist=Math.hypot(f.x-x,f.y-y);if(dist>45)return;
  try{const t=a.currentTime,len=Math.floor(a.sampleRate*.9),buf=a.createBuffer(1,len,a.sampleRate),d=buf.getChannelData(0);
    // a burst of wing claps: many short noise pulses, dense at first, thinning out
    for(let i=0;i<len;i++){const s=i/a.sampleRate,rate=26-18*s,ph=(s*rate)%1;d[i]=(Math.random()*2-1)*Math.exp(-ph*28)*Math.exp(-s*2.2);}
    const src=a.createBufferSource(),bp=a.createBiquadFilter(),g=a.createGain();src.buffer=buf;bp.type="bandpass";bp.frequency.value=1400;bp.Q.value=.7;g.gain.value=.35*L*Math.max(.12,1-dist/45);src.connect(bp).connect(g).connect(a.destination);src.start(t);}catch{}}

// shots and bangs nearby startle every flock in earshot
function startleAt(x,y,r){for(const fl of flocks)if(fl.state==="ground"&&Math.hypot(fl.x-x,fl.y-y)<r)spook(fl,x,y,performance.now());}
function frame(now=performance.now()){requestAnimationFrame(frame);const dt=Math.min(.1,Math.max(0,(now-lastFrame)/1000));lastFrame=now;try{update(now,dt);}catch(e){console.warn("pigeons",e);}}
export function installPigeons(){if(installed||typeof window==="undefined")return;installed=true;
  addEventListener(AUDIO_SETTINGS_EVENT,()=>{audio=loadAudioSettings();});
  addEventListener("arondight:foot-tracer",e=>{const s=e.detail?.start;if(Array.isArray(s))startleAt(s[0],s[1],40);});
  addEventListener("arondight:world-explosion",e=>{const p=e.detail?.position,x=Array.isArray(p)?+p[0]:+p?.x,y=Array.isArray(p)?+p[1]:+p?.y;if(Number.isFinite(x)&&Number.isFinite(y))startleAt(x,y,90);});
  addEventListener("arondight:world-reset",()=>{flocks.length=0;});
  globalThis.__cityPigeons={version:PIGEONS_VERSION,get flocks(){return flocks.map(f=>({x:f.x,y:f.y,state:f.state,n:f.birds.length}));},spookAll(){for(const f of flocks)spook(f,f.x+1,f.y,performance.now());},coo:()=>{const f=flocks[0];if(f)coo(f.x,f.y,1);}};
  requestAnimationFrame(frame);}
installPigeons();
