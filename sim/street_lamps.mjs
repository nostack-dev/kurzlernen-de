import * as THREE from "three";
import {staticGroundHeightAt} from "./terrain_craters.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";

// Street lamps along the real streets: dark steel poles with a lamp head on
// both sides of every road (alternating, ~34 m apart). At dusk the heads
// start to glow sodium-warm and each throws a soft pool of light onto the
// street (additive ground decal — no real light, so 600 lamps cost 4 draw
// calls and no shader recompiles).
//
// Breakable: a round into the lamp head shatters it (the light goes out); a car hitting the post
// faster than a walking pace shears it off its base and it falls as a real Box3D body (the car
// loses speed doing it; slower, the post stops the car); a blast topples the posts near it and
// darkens those around. Broken lamps stay broken and are replicated in multiplayer.

export const STREET_LAMPS_VERSION="instanced-sodium-lamps-v1";
const SPACING=34,MAX=900,POLE_H=6.2;
let sceneRef=null,group=null,poles=null,heads=null,pools=null,count=0,lastNight=-1,poleGeo=null,poleMat=null;
const lamps=[],grid=new Map(),broken=new Map(),fallen=[];const GRID_M=10,FALLEN_MAX=14,POLE_R=.13,TOPPLE_MPS=3.5;
const bridge=()=>globalThis.__arondightRealWorld||null;
const poolUniforms={uNight:{value:0}};
const headMat=new THREE.MeshStandardMaterial({color:0x2a2a28,emissive:0xffb35a,emissiveIntensity:0,roughness:.4,metalness:.3});
function ensure(){
  const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&group?.parent===scene)return true;group?.parent?.remove(group);sceneRef=scene;group=new THREE.Group();group.name="STREET_LAMPS";group.userData.flightFireIgnore=true;
  const poleG=new THREE.CylinderGeometry(.07,.11,POLE_H,7);poleG.rotateX(Math.PI/2);poleG.translate(0,0,POLE_H/2);
  const armG=new THREE.BoxGeometry(1.5,.09,.09);armG.translate(.72,0,POLE_H-.1);const pg=mergeSimple([poleG,armG]);poleGeo=pg;
  const headG=new THREE.BoxGeometry(.6,.26,.14);headG.translate(1.42,0,POLE_H-.2);
  const poolG=new THREE.PlaneGeometry(1,1);
  const poolMat=new THREE.ShaderMaterial({uniforms:poolUniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-6,polygonOffsetUnits:-6,
    vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}",
    fragmentShader:"uniform float uNight;varying vec2 vUv;void main(){float r=length(vUv-.5)*2.0;float a=smoothstep(1.0,0.0,r);a*=a*uNight*.55;if(a<.003)discard;gl_FragColor=vec4(vec3(1.0,.72,.38)*a,1.0);}"});
  poleMat=new THREE.MeshStandardMaterial({color:0x2b2e31,roughness:.55,metalness:.6});poles=new THREE.InstancedMesh(pg,poleMat,MAX);heads=new THREE.InstancedMesh(headG,headMat,MAX);pools=new THREE.InstancedMesh(poolG,poolMat,MAX);
  for(const m of[poles,heads,pools]){m.count=0;m.frustumCulled=false;m.raycast=()=>{};m.userData.flightFireIgnore=true;m.userData.styleSkip=true;group.add(m);}poles.castShadow=true;pools.renderOrder=3;
  scene.add(group);return true;
}
function mergeSimple(list){const pos=[],idx=[];let o=0;for(const g of list){const p=g.attributes.position.array;for(let i=0;i<p.length;i++)pos.push(p[i]);const ix=g.index?g.index.array:[...Array(p.length/3).keys()];for(const i of ix)idx.push(i+o);o+=p.length/3;}const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));out.setIndex(idx);out.computeVertexNormals();return out;}
// roads: [{cls,w,pts:[[x,y],...]}]
export function setLampRoads(roads,cx=0,cy=0){
  if(!ensure())return;const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3(1,1,1),Z=new THREE.Vector3(0,0,1),sp=new THREE.Vector3();let n=0;const seen=new Set();
  const list=roads.filter(r=>!/path|track/.test(r.cls)).map(r=>({r,d:Math.hypot(r.pts[0][0]-cx,r.pts[0][1]-cy)})).sort((a,b)=>a.d-b.d).map(e=>e.r);
  for(const r of list){let carry=SPACING*.5,side=1;
    for(let i=0;i<r.pts.length-1&&n<MAX;i++){const a=r.pts[i],b=r.pts[i+1],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);if(l<.5)continue;const ux=dx/l,uy=dy/l,nx=-uy,ny=ux;
      for(let t=carry;t<l&&n<MAX;t+=SPACING){side=-side;const off=r.w/2+1.15,x=a[0]+ux*t+nx*off*side,y=a[1]+uy*t+ny*off*side,key=`${Math.round(x/8)},${Math.round(y/8)}`;if(seen.has(key))continue;seen.add(key);
        const z=staticGroundHeightAt(x,y),yaw=Math.atan2(-ny*side,-nx*side);q.setFromAxisAngle(Z,yaw);m4.compose(p.set(x,y,z),q,s);poles.setMatrixAt(n,m4);heads.setMatrixAt(n,m4);
        const hx=x+Math.cos(yaw)*1.42,hy=y+Math.sin(yaw)*1.42;m4.compose(p.set(hx,hy,staticGroundHeightAt(hx,hy)+.14),q.identity(),sp.set(13,13,1));pools.setMatrixAt(n,m4);
        lamps[n]={i:n,x,y,z,yaw,hx,hy,state:0,key};n++;}
      carry=((carry-l)%SPACING+SPACING)%SPACING;}}
  count=n;lamps.length=n;grid.clear();for(const l of lamps){const k=`${Math.floor(l.x/GRID_M)},${Math.floor(l.y/GRID_M)}`;let c=grid.get(k);if(!c)grid.set(k,c=[]);c.push(l);const b=broken.get(l.key);if(b)setState(l,b,{silent:true});}
  for(const m of[poles,heads,pools]){m.count=n;m.instanceMatrix.needsUpdate=true;}
  const v=document.getElementById("viewport");if(v)v.dataset.streetLamps=String(n);
}
// ------------------------------------------------------------------ breakage
const ZERO=new THREE.Matrix4().makeScale(0,0,0),tq=new THREE.Quaternion(),tp=new THREE.Vector3(),tm=new THREE.Matrix4();
const rigid=()=>globalThis.__arondightWorldRigidBodies||null;
function near(x,y,r){const out=[],g0=Math.floor((x-r)/GRID_M),g1=Math.floor((x+r)/GRID_M),h0=Math.floor((y-r)/GRID_M),h1=Math.floor((y+r)/GRID_M);for(let i=g0;i<=g1;i++)for(let j=h0;j<=h1;j++){const c=grid.get(`${i},${j}`);if(c)for(const l of c)if(Math.hypot(l.x-x,l.y-y)<=r)out.push(l);}return out;}
// state 1: head shattered (dark), 2: post down
function setState(l,state,{dir=[1,0],silent=false,net=true,speed=3}={}){if(!l||state<=l.state)return false;const was=l.state;l.state=state;broken.set(l.key,state);
  heads.setMatrixAt(l.i,ZERO);pools.setMatrixAt(l.i,ZERO);heads.instanceMatrix.needsUpdate=true;pools.instanceMatrix.needsUpdate=true;
  if(state===2){poles.setMatrixAt(l.i,ZERO);poles.instanceMatrix.needsUpdate=true;if(!silent)topple(l,dir,speed);}
  if(!silent){if(was<1)glass([l.hx,l.hy,l.z+POLE_H-.2]);if(state===2)clang([l.x,l.y,l.z+.4],1);if(net)sendBreak(l,state,dir);}
  const v=document.getElementById("viewport");if(v)v.dataset.streetLampsBroken=String(broken.size);return true;}
function topple(l,dir,speed){const R=rigid();if(!R?.upsertBody||!poleGeo)return;const id=`lamp-${l.key}`,half=POLE_H/2;
  if(!R.upsertBody({id,kind:"prop",position:[l.x,l.y,l.z+half+.03],yaw:l.yaw,halfExtents:[.11,.11,half],massKg:140,wheeled:false,friction:.6,restitution:.05,linearDamping:.05,angularDamping:.2,sleep:true}))return;
  const d=Math.hypot(dir[0],dir[1])||1,ux=dir[0]/d,uy=dir[1]/d,J=140*Math.min(6,1.2+speed*.45);R.applyImpulse?.(id,[ux*J,uy*J,0],{point:[l.x,l.y,l.z+POLE_H*.8]});
  const mesh=new THREE.Group(),pole=new THREE.Mesh(poleGeo,poleMat),head=new THREE.Mesh(new THREE.BoxGeometry(.6,.26,.14).translate(1.42,0,POLE_H-.2),new THREE.MeshStandardMaterial({color:0x2a2a28,roughness:.5}));pole.position.z=head.position.z=-half;pole.castShadow=true;mesh.add(pole,head);mesh.userData.flightFireIgnore=true;group.add(mesh);
  fallen.push({id,mesh,born:performance.now()});while(fallen.length>FALLEN_MAX){const f=fallen.shift();R.removeBody?.(f.id);f.mesh.parent?.remove(f.mesh);}}
function stepFallen(){const R=rigid();if(!R?.pose)return;for(const f of fallen){const p=R.pose(f.id);if(!p?.position)continue;f.mesh.position.set(p.position[0],p.position[1],p.position[2]);const q=p.rotation;f.mesh.quaternion.set(q[0],q[1],q[2],q[3]);}}
// cars: a post in the car's footprint either shears off (fast) or stops the car (slow)
let lastCarCheck=0;
function checkCars(now){if(now-lastCarCheck<66||!lamps.length)return;lastCarCheck=now;const R=rigid(),recs=R?.engine?.records;if(!recs)return;
  for(const[id,rec]of recs){if(rec.kind!=="car"&&rec.kind!=="bus")continue;const p=R.pose(id);if(!p?.position)continue;const hl=rec.kind==="bus"?4.05:1.88,hw=rec.kind==="bus"?1.25:.86,cand=near(p.position[0],p.position[1],hl+1);if(!cand.length)continue;
    const yaw=p.yaw,c=Math.cos(yaw),s=Math.sin(yaw),v=p.velocity||[0,0,0],sp=Math.hypot(v[0],v[1]);
    for(const l of cand){if(l.state===2)continue;const dx=l.x-p.position[0],dy=l.y-p.position[1],u=dx*c+dy*s,w=-dx*s+dy*c;if(Math.abs(u)>hl+POLE_R||Math.abs(w)>hw+POLE_R)continue;
      const m=Number(rec.massKg)||1400,dd=Math.hypot(dx,dy)||1,nx=dx/dd,ny=dy/dd,toward=v[0]*nx+v[1]*ny;
      if(sp>TOPPLE_MPS&&toward>1){setState(l,2,{dir:[v[0],v[1]],speed:sp});const loss=Math.min(sp*.22,2.4);R.applyImpulse?.(id,[-v[0]/sp*m*loss,-v[1]/sp*m*loss,0]);}
      else if(toward>0){R.applyImpulse?.(id,[-nx*m*toward*1.05,-ny*m*toward*1.05,0]);if(toward>1)clang([l.x,l.y,l.z+.5],.5);}}}}
// rounds: the head is glass and a bulb — one hit and it is out
function onTracer(e){const d=e.detail||{},a=d.start,b=d.end;if(!Array.isArray(a)||!Array.isArray(b)||!lamps.length)return;const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],L=Math.hypot(dx,dy,dz);if(L<.1)return;
  const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;let best=null,bt=Infinity;for(const l of near(mx,my,L/2+2)){if(l.state>=1)continue;const hz=l.z+POLE_H-.2,t=Math.max(0,Math.min(1,((l.hx-a[0])*dx+(l.hy-a[1])*dy+(hz-a[2])*dz)/(L*L))),px=a[0]+dx*t-l.hx,py=a[1]+dy*t-l.hy,pz=a[2]+dz*t-hz;if(Math.hypot(px,py,pz)<.38&&t<bt){bt=t;best=l;}}
  if(best)setState(best,1);}
function onExplosion(e){const d=e.detail||{},p=d.position;if(!Array.isArray(p)||!lamps.length)return;const r=Math.max(3,Number(d.radiusM)||8);for(const l of near(p[0],p[1],r)){const dist=Math.hypot(l.x-p[0],l.y-p[1]);if(dist<r*.6)setState(l,2,{dir:[l.x-p[0],l.y-p[1]],speed:9*(1-dist/r)+3,net:false});else setState(l,1,{net:false});}}
// multiplayer: who breaks a lamp says so; the others break the lamp nearest that point
function session(){const s=globalThis.__arondightRealWorld?.vsSession;return s?.sendFx?s:s?.active?.sendFx?s.active:null;}
function sendBreak(l,state,dir){const s=session(),f=globalThis.__arondightVsNetFrame;if(!s||!f)return;try{s.sendFx({type:"impact",objectId:"street-lamp",kind:state===2?"down":"dark",id:`lamp-${l.key}-${state}-${Date.now().toString(36)}`,p:[0,0,0],at:f.toNet([l.x,l.y,l.z]),dir:[+dir[0].toFixed(2),+dir[1].toFixed(2)]});}catch{}}
function onFx(e){const pk=e?.detail?.packet;if(pk?.objectId!=="street-lamp"||!pk.at)return;const p=globalThis.__arondightVsNetFrame?.fromNet?.(pk.at);if(!p)return;let best=null,bd=4;for(const l of near(p[0],p[1],4)){const d=Math.hypot(l.x-p[0],l.y-p[1]);if(d<bd){bd=d;best=l;}}if(best)setState(best,pk.kind==="down"?2:1,{dir:Array.isArray(pk.dir)?pk.dir:[1,0],net:false});}
// sounds: glass burst (head) and a hollow steel clang (post)
function sfx(pos,fn){const c=globalThis.__sharedAudioContext;if(!c||c.state!=="running")return;try{const cam=globalThis.__arondightRealWorld?.presentedCamera?.()||globalThis.__arondightRealWorld?.threeCamera,d=cam?Math.hypot(pos[0]-cam.position.x,pos[1]-cam.position.y,pos[2]-cam.position.z):10,g=c.createGain();g.gain.value=Math.max(0,1-d/90)*.5;g.connect(c.destination);fn(c,g,c.currentTime);}catch{}}
function glass(pos){sfx(pos,(c,out,t)=>{const n=c.createBuffer(1,c.sampleRate*.4,c.sampleRate),ch=n.getChannelData(0);for(let i=0;i<ch.length;i++)ch[i]=(Math.random()*2-1)*Math.pow(1-i/ch.length,3)*(Math.random()<.04?3:1);const s=c.createBufferSource(),hp=c.createBiquadFilter();hp.type="highpass";hp.frequency.value=3200;s.buffer=n;s.connect(hp).connect(out);s.start(t);});}
function clang(pos,k=1){sfx(pos,(c,out,t)=>{for(const f of[180,412,733]){const o=c.createOscillator(),g=c.createGain();o.type="triangle";o.frequency.value=f*(.97+Math.random()*.06);g.gain.setValueAtTime(.32*k,t);g.gain.exponentialRampToValueAtTime(.001,t+.9*k+.2);o.connect(g).connect(out);o.start(t);o.stop(t+1.2);}});}
function frame(){requestAnimationFrame(frame);if(!group)return;{const now=performance.now();checkCars(now);if(fallen.length)stepFallen();}const night=Number(globalThis.__dayNight?.state?.night)||0,glow=Math.min(1,Math.max(0,(night-.15)/.5));if(Math.abs(glow-lastNight)<.01)return;lastNight=glow;headMat.emissiveIntensity=glow*3.2;poolUniforms.uNight.value=glow;pools.visible=glow>.01;}
export function installStreetLamps(){if(globalThis.__streetLamps||typeof window==="undefined")return;globalThis.__streetLamps={setRoads:setLampRoads,version:STREET_LAMPS_VERSION,lamps:()=>lamps,breakAt(x,y,state=1,dir=[1,0]){const l=near(x,y,3)[0];return l?setState(l,state,{dir}):false;}};
  addEventListener("arondight:foot-tracer",onTracer);addEventListener("arondight:world-explosion",onExplosion);addEventListener(VS_FX_EVENT,onFx);requestAnimationFrame(frame);}
installStreetLamps();
