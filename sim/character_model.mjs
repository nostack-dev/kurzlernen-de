import * as THREE from "three";

// One articulated character used for every human in the game: the local
// player as others (and the player himself in third person) see him, remote
// multiplayer players, and — with the zombie outfit — the undead. Real
// joints (hips/knees, shoulders/elbows, neck) so poses come from rotations,
// not from sliding boxes: walking, running, aiming a pistol / akimbo / MP,
// piloting the drone with the VR headset, sitting at the wheel of a car.
// z up, forward = +y, root at the feet (put it on the ground height).

export const CHARACTER_MODEL_VERSION="articulated-soldier-v1";
export const OUTFITS=Object.freeze({
  player:{shirt:0x4b5238,vest:0x2b3024,pants:0x3d3b33,boots:0x1a1a18,skin:0xc08a68,gloves:0x1c1e1b,helmet:0x3a4030},
  civilian:{shirt:0x5a6f86,vest:0x5a6f86,pants:0x2c3138,boots:0x24221f,skin:0xc8956f,gloves:0xc8956f,helmet:0x2a211b},
  police:{shirt:0x24314f,vest:0x15181e,pants:0x1b2230,boots:0x0f1012,skin:0xc8956f,gloves:0x15161a,helmet:0x161c2b},
  zombie:{shirt:0x5d5a4a,vest:0x3b3428,pants:0x2f2c28,boots:0x1f1b18,skin:0x8a9a78,gloves:0x8a9a78,helmet:null},
});
const geoCache=new Map();
// detail: 1 = full, <1 = fewer capsule/sphere segments (crowd mid-distance LOD)
let DETAIL=1;const seg=(n,min)=>Math.max(min,Math.round(n*DETAIL));
function geo(key,make){key+=`|d${DETAIL}`;let g=geoCache.get(key);if(!g){g=make();geoCache.set(key,g);}return g;}
const matCache=new Map();
function mat(color,rough=.8,metal=0){const k=`${color}|${rough}|${metal}`;let m=matCache.get(k);if(!m){m=new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal});matCache.set(k,m);}return m;}
function part(parent,g,m,x=0,y=0,z=0){const mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;}
function joint(parent,x,y,z,name){const j=new THREE.Group();j.name=name;j.position.set(x,y,z);parent.add(j);return j;}
// a limb segment hanging down from its joint (-z), rounded
const limb=(r,len)=>geo(`limb${r}|${len}`,()=>{const g=new THREE.CapsuleGeometry(r,Math.max(.01,len-2*r),seg(2,1),seg(7,5));g.rotateX(Math.PI/2);g.translate(0,0,-len/2);return g;});
const boxG=(w,d,h)=>geo(`box${w}|${d}|${h}`,()=>new THREE.BoxGeometry(w,d,h));

export function shirtColorFor(id){let h=2166136261;for(const c of String(id||""))h=Math.imul(h^c.charCodeAt(0),16777619);const p=[0x4b5238,0x55524a,0x3f4a52,0x5a4a3a,0x474c3e,0x3c4436];return p[(h>>>0)%p.length];}

export function buildCharacter({outfit="player",shirt=null,id="",detail=1}={}){const prevDetail=DETAIL;DETAIL=detail;try{return buildCharacterAt({outfit,shirt,id});}finally{DETAIL=prevDetail;}}
function buildCharacterAt({outfit,shirt,id}){
  const o={...OUTFITS[outfit]||OUTFITS.player};if(shirt!=null)o.shirt=shirt;
  const root=new THREE.Group();root.name=`CHARACTER_${outfit}`;root.userData.characterModel=CHARACTER_MODEL_VERSION;
  const M={shirt:mat(o.shirt,.86),vest:mat(o.vest,.8),pants:mat(o.pants,.88),boots:mat(o.boots,.7),skin:mat(o.skin,.75),gloves:mat(o.gloves,.7),helmet:o.helmet!=null?mat(o.helmet,.6,.1):null,dark:mat(0x16181a,.5,.3)};
  const pelvis=joint(root,0,0,.96,"pelvis");
  part(pelvis,boxG(.34,.2,.18),M.pants,0,0,.02);
  const spine=joint(pelvis,0,0,.1,"spine");
  part(spine,geo("torso",()=>{const g=new THREE.CapsuleGeometry(.17,.26,seg(3,1),seg(8,6));g.rotateX(Math.PI/2);g.scale(1.12,.72,1);return g;}),M.shirt,0,0,.25);
  part(spine,boxG(.38,.28,.34),M.vest,0,.004,.27);                         // plate carrier
  part(spine,boxG(.3,.07,.16),M.vest,0,.16,.22);                          // mag pouches
  const neck=joint(spine,0,0,.5,"neck");
  part(neck,limb(.055,.1),M.skin,0,0,.08);
  const head=joint(neck,0,0,.1,"head");
  part(head,geo("head",()=>{const g=new THREE.SphereGeometry(.115,seg(10,6),seg(8,4));g.scale(.92,1,1.12);return g;}),M.skin,0,.01,.1);
  if(M.helmet)part(head,geo("helmet",()=>{const g=new THREE.SphereGeometry(.13,seg(10,6),seg(5,3),0,Math.PI*2,0,Math.PI*.55);g.rotateX(Math.PI/2);return g;}),M.helmet,0,0,.13);
  const visor=part(head,boxG(.2,.09,.07),M.dark,0,.1,.11);visor.visible=false; // VR headset
  // arms
  const arms={};for(const s of[-1,1]){const sh=joint(spine,s*.225,0,.44,s<0?"shoulderL":"shoulderR");part(sh,limb(.058,.3),M.shirt);const el=joint(sh,0,0,-.3,s<0?"elbowL":"elbowR");part(el,limb(.05,.27),M.shirt);const wr=joint(el,0,0,-.27,s<0?"wristL":"wristR");part(wr,boxG(.075,.09,.11),M.gloves,0,.01,-.05);arms[s<0?"L":"R"]={sh,el,wr};}
  // legs
  const legs={};for(const s of[-1,1]){const hip=joint(pelvis,s*.1,0,-.02,s<0?"hipL":"hipR");part(hip,limb(.075,.45),M.pants);const kn=joint(hip,0,0,-.45,s<0?"kneeL":"kneeR");part(kn,limb(.062,.44),M.pants);const an=joint(kn,0,0,-.44,s<0?"ankleL":"ankleR");part(an,boxG(.1,.25,.08),M.boots,0,.06,-.03);legs[s<0?"L":"R"]={hip:hip,kn,an};}
  // weapon in the right hand (pistol or MP silhouette), shown by pose
  const gun=new THREE.Group();gun.name="CHARACTER_GUN";arms.R.wr.add(gun);gun.position.set(0,.02,-.09);gun.rotation.x=-Math.PI/2;
  part(gun,boxG(.035,.22,.05),M.dark,0,.08,.02);part(gun,boxG(.03,.05,.1),M.dark,0,.0,-.04);gun.visible=false;
  const gunL=gun.clone();arms.L.wr.add(gunL);gunL.visible=false;
  const rig={root,pelvis,spine,neck,head,visor,arms,legs,gun,gunL,phase:Math.random()*6,outfit,state:"idle"};
  // colour category of every mesh (instanced crowds recolour per person)
  const cats=new Map([[M.shirt,"shirt"],[M.vest,"vest"],[M.pants,"pants"],[M.boots,"boots"],[M.skin,"skin"],[M.gloves,"gloves"],[M.dark,"dark"]]);if(M.helmet)cats.set(M.helmet,"helmet");
  root.traverse(n=>{n.userData.characterPart=true;if(n.isMesh)n.userData.cat=cats.get(n.material)||"dark";});
  return rig;
}

const lerp=(a,b,t)=>a+(b-a)*t;
function set(j,x,y=0,z=0,k=1){j.rotation.x=lerp(j.rotation.x,x,k);j.rotation.y=lerp(j.rotation.y,y,k);j.rotation.z=lerp(j.rotation.z,z,k);}
// state: idle | walk | run | vr | drive | aim-pistol | aim-akimbo | aim-smg | zombie | dead
// speed m/s for the gait; dt for the cadence and pose blending.
export function animateCharacter(rig,{state="idle",speed=0,weapon="none",dt=1/60,punch=0}={}){
  const k=1-Math.exp(-dt*12),moving=speed>.25,run=speed>3.2;rig.phase+=dt*(moving?Math.min(12,4.2+speed*1.9):1.2);
  const p=rig.phase,swing=moving?Math.sin(p)*Math.min(.75,.3+speed*.09):0,lift=moving?Math.max(0,Math.cos(p))*.35:0,liftO=moving?Math.max(0,-Math.cos(p))*.35:0;
  const{arms,legs,pelvis,spine,head,visor}=rig;rig.state=state;
  pelvis.position.z=lerp(pelvis.position.z,state==="drive"?.52:(.96-(moving?Math.abs(Math.sin(p))*.03:0)),k);
  // legs
  if(state==="drive"){set(legs.L.hip,1.5,0,.06,k);set(legs.R.hip,1.5,0,-.06,k);set(legs.L.kn,-1.45,0,0,k);set(legs.R.kn,-1.45,0,0,k);}
  else if(state==="dead"){set(legs.L.hip,0,0,.1,k);set(legs.R.hip,0,0,-.1,k);set(legs.L.kn,0,0,0,k);set(legs.R.kn,0,0,0,k);}
  else{const shamble=state==="zombie"?.6:1;set(legs.L.hip,swing*shamble,0,0,k);set(legs.R.hip,-swing*shamble,0,0,k);set(legs.L.kn,-lift*(run?1.6:1.1),0,0,k);set(legs.R.kn,-liftO*(run?1.6:1.1),0,0,k);}
  // torso lean
  set(spine,state==="zombie"?.28:run?.18:state==="drive"?-.12:0,0,0,k);set(head,state==="zombie"?-.2:0,0,state==="zombie"?Math.sin(p*.5)*.15:0,k);
  visor.visible=state==="vr";
  // arms
  const g=state.startsWith("aim")||((state==="walk"||state==="run"||state==="idle")&&weapon!=="none");
  if(state==="vr"){set(arms.L.sh,.55,0,.15,k);set(arms.R.sh,.55,0,-.15,k);set(arms.L.el,1.15,0,0,k);set(arms.R.el,1.15,0,0,k);}
  else if(state==="drive"){set(arms.L.sh,1.0,0,.08,k);set(arms.R.sh,1.0,0,-.08,k);set(arms.L.el,.55,0,0,k);set(arms.R.el,.55,0,0,k);}
  else if(state==="zombie"){const r=Math.sin(p*.7)*.12;set(arms.L.sh,1.45+r,0,.12,k);set(arms.R.sh,1.4-r,0,-.12,k);set(arms.L.el,.15,0,0,k);set(arms.R.el,.2,0,0,k);}
  else if(state==="dead"){set(arms.L.sh,.2,0,.5,k);set(arms.R.sh,.2,0,-.5,k);set(arms.L.el,0,0,0,k);set(arms.R.el,0,0,0,k);}
  // fists up: a boxing guard, and a straight jab with the hand given by punch (+ right, - left), 0..1 extension
  else if(state==="fight"||weapon==="fists"){const r=Math.max(0,punch),l=Math.max(0,-punch),kk=Math.max(k,.55);set(arms.L.sh,1.05+.5*l,0,.28-.2*l,kk);set(arms.L.el,1.75-1.65*l,0,0,kk);set(arms.R.sh,1.05+.5*r,0,-.28+.2*r,kk);set(arms.R.el,1.75-1.65*r,0,0,kk);}
  else if(g&&weapon==="akimbo"){set(arms.L.sh,1.45,0,.12,k);set(arms.R.sh,1.45,0,-.12,k);set(arms.L.el,.08,0,0,k);set(arms.R.el,.08,0,0,k);}
  else if(g&&weapon==="smg"){set(arms.R.sh,1.1,0,-.2,k);set(arms.R.el,.3,0,0,k);set(arms.L.sh,1.25,0,.42,k);set(arms.L.el,.6,0,0,k);}
  else if(g&&weapon==="pistol"){set(arms.R.sh,1.48,0,-.05,k);set(arms.R.el,.05,0,0,k);set(arms.L.sh,1.38,0,.32,k);set(arms.L.el,.3,0,0,k);}
  else{set(arms.L.sh,-swing*.6,0,.06,k);set(arms.R.sh,swing*.6,0,-.06,k);set(arms.L.el,.25+(moving?.2:0),0,0,k);set(arms.R.el,.25+(moving?.2:0),0,0,k);}
  rig.gun.visible=weapon!=="none"&&weapon!=="fists"&&state!=="fight"&&state!=="vr"&&state!=="drive"&&state!=="dead"&&state!=="zombie";rig.gunL.visible=rig.gun.visible&&weapon==="akimbo";
}

// Joint state of a rig as a flat array (instanced crowds keep one per person
// and pose a single shared template rig with it).
export function rigJoints(rig){return[rig.spine,rig.neck,rig.head,rig.arms.L.sh,rig.arms.L.el,rig.arms.R.sh,rig.arms.R.el,rig.legs.L.hip,rig.legs.L.kn,rig.legs.R.hip,rig.legs.R.kn];}
export function saveRigState(rig,out){const j=rigJoints(rig);out.length=j.length*3+2;for(let i=0;i<j.length;i++){out[i*3]=j[i].rotation.x;out[i*3+1]=j[i].rotation.y;out[i*3+2]=j[i].rotation.z;}out[j.length*3]=rig.pelvis.position.z;out[j.length*3+1]=rig.phase;return out;}
export function loadRigState(rig,src){const j=rigJoints(rig);if(!src||src.length<j.length*3+2){for(const x of j)x.rotation.set(0,0,0);rig.pelvis.position.z=.96;return;}for(let i=0;i<j.length;i++)j[i].rotation.set(src[i*3],src[i*3+1],src[i*3+2]);rig.pelvis.position.z=src[j.length*3];rig.phase=src[j.length*3+1];}
