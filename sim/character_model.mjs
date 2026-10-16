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
  // sportswear: short sleeves, shorts, trainers, no plate carrier (forearms and shins are skin)
  runner:{shirt:0xd8ff3a,vest:0xd8ff3a,pants:0x1c2a3a,boots:0xf4f4f0,skin:0xc8956f,gloves:0xc8956f,helmet:0x2a211b},
  zombie:{shirt:0x5d5a4a,vest:0x3b3428,pants:0x2f2c28,boots:0x1f1b18,skin:0x8a9a78,gloves:0x8a9a78,helmet:null},
});
const geoCache=new Map();
// detail: 1 = full, <1 = fewer capsule/sphere segments (crowd mid-distance LOD)
let DETAIL=1;const seg=(n,min)=>Math.max(min,Math.round(n*DETAIL));
function geo(key,make){key+=`|d${DETAIL}`;let g=geoCache.get(key);if(!g){g=make();geoCache.set(key,g);}return g;}
const matCache=new Map();
const EYE_MAT=new THREE.MeshBasicMaterial({color:0x8dff3c,toneMapped:false}),EYE_GLOW_MAT=new THREE.MeshBasicMaterial({color:0x46ff1e,transparent:true,opacity:.34,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
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
  const sport=outfit==="runner";
  if(!sport){part(spine,boxG(.38,.28,.34),M.vest,0,.004,.27);             // plate carrier
    part(spine,boxG(.3,.07,.16),M.vest,0,.16,.22);}                       // mag pouches
  const neck=joint(spine,0,0,.5,"neck");
  part(neck,limb(.055,.1),M.skin,0,0,.08);
  const head=joint(neck,0,0,.1,"head");
  part(head,geo("head",()=>{const g=new THREE.SphereGeometry(.115,seg(10,6),seg(8,4));g.scale(.92,1,1.12);return g;}),M.skin,0,.01,.1);
  if(M.helmet)part(head,geo("helmet",()=>{const g=new THREE.SphereGeometry(.13,seg(10,6),seg(5,3),0,Math.PI*2,0,Math.PI*.55);g.rotateX(Math.PI/2);return g;}),M.helmet,0,0,.13);
  const visor=part(head,boxG(.2,.09,.07),M.dark,0,.1,.11);visor.visible=false; // VR headset
  // the undead: glowing green eyes (unlit, a soft additive halo around each) — tells them from people at a glance, day or night
  if(outfit==="zombie"){M.eyes=EYE_MAT;M.eyeGlow=EYE_GLOW_MAT;for(const sx of[-1,1]){part(head,geo("zeye",()=>new THREE.SphereGeometry(.021,seg(8,5),seg(6,4))),M.eyes,sx*.042,.108,.128);const halo=part(head,geo("zeyeglow",()=>new THREE.SphereGeometry(.036,seg(12,6),seg(8,4))),M.eyeGlow,sx*.042,.112,.128);halo.castShadow=false;halo.renderOrder=2;}}
  // arms
  const arms={};for(const s of[-1,1]){const sh=joint(spine,s*.225,0,.44,s<0?"shoulderL":"shoulderR");part(sh,limb(.058,.3),M.shirt);const el=joint(sh,0,0,-.3,s<0?"elbowL":"elbowR");part(el,limb(.05,.27),sport?M.skin:M.shirt);const wr=joint(el,0,0,-.27,s<0?"wristL":"wristR");part(wr,boxG(.075,.09,.11),M.gloves,0,.01,-.05);arms[s<0?"L":"R"]={sh,el,wr};}
  // legs
  const legs={};for(const s of[-1,1]){const hip=joint(pelvis,s*.1,0,-.02,s<0?"hipL":"hipR");part(hip,limb(.075,.45),M.pants);const kn=joint(hip,0,0,-.45,s<0?"kneeL":"kneeR");part(kn,limb(sport?.056:.062,.44),sport?M.skin:M.pants);const an=joint(kn,0,0,-.44,s<0?"ankleL":"ankleR");part(an,boxG(.1,.25,.08),M.boots,0,.06,-.03);legs[s<0?"L":"R"]={hip:hip,kn,an};}
  // weapon in the right hand (pistol or MP silhouette), shown by pose
  const gun=new THREE.Group();gun.name="CHARACTER_GUN";arms.R.wr.add(gun);gun.position.set(0,.02,-.09);gun.rotation.x=-Math.PI/2;
  part(gun,boxG(.035,.22,.05),M.dark,0,.08,.02);part(gun,boxG(.03,.05,.1),M.dark,0,.0,-.04);gun.visible=false;
  const gunL=gun.clone();arms.L.wr.add(gunL);gunL.visible=false;
  // a knife in the right fist (blade pointing forward out of the fist): street gangsters, shown by weapon "knife"
  M.blade=mat(0xc9ced3,.25,.85);const knife=new THREE.Group();knife.name="CHARACTER_KNIFE";arms.R.wr.add(knife);knife.position.set(0,.0,-.07);knife.rotation.x=-Math.PI/2;
  part(knife,boxG(.024,.11,.03),M.dark,0,0,0);part(knife,boxG(.006,.17,.028),M.blade,0,.14,.003);knife.visible=false;
  const rig={root,pelvis,spine,neck,head,visor,arms,legs,gun,gunL,knife,phase:Math.random()*6,outfit,state:"idle"};
  // colour category of every mesh (instanced crowds recolour per person)
  const cats=new Map([[M.shirt,"shirt"],[M.vest,"vest"],[M.pants,"pants"],[M.boots,"boots"],[M.skin,"skin"],[M.gloves,"gloves"],[M.dark,"dark"],[M.blade,"blade"]]);if(M.helmet)cats.set(M.helmet,"helmet");if(M.eyes){cats.set(M.eyes,"eyes");cats.set(M.eyeGlow,"eyeglow");}
  root.traverse(n=>{n.userData.characterPart=true;if(n.isMesh)n.userData.cat=cats.get(n.material)||"dark";});
  return rig;
}

const lerp=(a,b,t)=>a+(b-a)*t;
function set(j,x,y=0,z=0,k=1){j.rotation.x=lerp(j.rotation.x,x,k);j.rotation.y=lerp(j.rotation.y,y,k);j.rotation.z=lerp(j.rotation.z,z,k);}
// ---- running gait (jog .. sprint): one leg cycle = two steps. Cadence and duty factor follow
// measured human running (≈170 steps/min at 3 m/s, contact ≈ 1/3 of the cycle, so both feet are
// off the ground between steps). The stance foot is planted: two-link leg IK keeps the ankle on the
// ground sweeping back at exactly the body speed (no foot skate), the heel peels off before toe-off;
// the swing leg folds (heel towards the seat), drives the knee forward and reaches out for the next
// contact. Pelvis: lowest at mid-stance, highest in the flight phase.
const TAU=Math.PI*2,THIGH=.45,SHIN=.44,ANKLE_Z=.05,TOE=.185,REACH=.885,HIP_DROP=.02;
const clampN=(v,a,b)=>Math.max(a,Math.min(b,v)),ease=t=>(1-Math.cos(Math.PI*clampN(t,0,1)))/2;
export function runCadenceSpm(speed){return clampN(150+6.5*speed,160,205);}
function legIK(dy,dz){let d=Math.hypot(dy,dz);d=clampN(d,.35,REACH);
  const flex=Math.PI-Math.acos(clampN((THIGH*THIGH+SHIN*SHIN-d*d)/(2*THIGH*SHIN),-1,1)),beta=Math.acos(clampN((THIGH*THIGH+d*d-SHIN*SHIN)/(2*THIGH*d),-1,1));
  return[Math.atan2(dy,-dz)+beta,-flex];}
const RUN_OUT={hipL:0,knL:0,anL:0,hipR:0,knR:0,anR:0,pelvisZ:.96,pelvisYaw:0,spine:0,spineYaw:0,head:0,shL:0,shR:0,elL:0,elR:0};
function runGait(p,speed){const o=RUN_OUT,w=TAU*runCadenceSpm(speed)/120,Tc=TAU/w;
  let D=clampN(.40-.025*speed,.2,.38);D=Math.min(D,.8/Math.max(.1,speed*Tc));const Lc=speed*D*Tc,yLand=Lc*.42;
  const A=clampN(.012+.006*speed,.018,.032),zLow=.905-clampN(.012*(speed-2.5),0,.05);
  const phiL=((p/TAU)%1+1)%1;
  const pelvisAt=phi=>{const st=(((phi-D/2)*2)%1+1)%1;return zLow+A*(1-Math.cos(TAU*st));};
  o.pelvisZ=pelvisAt(phiL);
  const stance=(u,pz)=>{const th=u<.55?0:-.72*((u-.55)/.45)**1.6,toeY=yLand+TOE-Lc*u,ay=toeY-TOE*Math.cos(th),az=ANKLE_Z+TOE*Math.sin(-th);const[h,k]=legIK(ay,az-(pz-HIP_DROP));return[h,k,th-(h+k)];};
  const pzTo=pelvisAt(D),pzS=pelvisAt(0),[hTo,kTo,aTo]=stance(1,pzTo),[hS,kS,aS]=stance(0,pzS),ov=.1,kAdd=clampN(.7+.18*speed,.9,1.75);
  const leg=phi=>{if(phi<D)return stance(phi/D,pelvisAt(phi));const u=(phi-D)/(1-D),e=ease(u/.82);
    const h=hTo+(hS+ov-hTo)*e-ov*ease((u-.82)/.18),k=kTo+(kS-kTo)*u-kAdd*Math.sin(Math.PI*Math.min(1,u/.86))**1.3,an=aTo+(aS-aTo)*ease(u)+.12*Math.sin(Math.PI*u);return[h,k,an];};
  const L=leg(phiL),R=leg((phiL+.5)%1);o.hipL=L[0];o.knL=L[1];o.anL=clampN(L[2],-.95,.55);o.hipR=R[0];o.knR=R[1];o.anR=clampN(R[2],-.95,.55);
  const a=Math.cos(TAU*(phiL+.04)),aA=clampN(.3+.07*speed,.42,.95);
  o.shL=.12-aA*a;o.shR=.12+aA*a;o.elL=1.42-.22*a;o.elR=1.42+.22*a;
  o.spine=-clampN(.05+.025*speed,.08,.3);o.head=-o.spine*.7;o.spineYaw=.09*a;o.pelvisYaw=-.07*a;return o;}
// state: idle | walk | run | vr | drive | aim-pistol | aim-akimbo | aim-smg | zombie | dead | air
// air: off the ground (jump, jetpack, fall) — no gait: legs hang slightly bent, one a little forward
// speed m/s for the gait; dt for the cadence and pose blending.
export function animateCharacter(rig,{state="idle",speed=0,weapon="none",dt=1/60,punch=0}={}){
  const air=state==="air";if(air)speed=0;const k=1-Math.exp(-dt*12),moving=speed>.25,run=speed>3.2||(state==="run"&&speed>1.6)||(state==="panic"&&speed>1.5);
  // "run" with a jogging speed (≥1.6 m/s) is a jog, not a fast walk; plain walkers switch to running above 3.2 m/s
  rig.phase+=dt*(run?TAU*runCadenceSpm(speed)/120:moving?Math.min(12,4.2+speed*1.9):1.2);
  rig.runW=run?Math.min(1,(rig.runW||0)+dt*4):Math.max(0,(rig.runW||0)-dt*4);const G=run?runGait(rig.phase,speed):null,kr=run?(rig.runW>=1?1:Math.max(k,rig.runW*rig.runW)):k;
  const p=rig.phase,swing=moving?Math.sin(p)*(run?Math.min(1.15,.65+speed*.075):Math.min(.75,.3+speed*.09)):0,lift=moving?Math.max(0,Math.cos(p))*(run?.75:.35):0,liftO=moving?Math.max(0,-Math.cos(p))*(run?.75:.35):0;
  const{arms,legs,pelvis,spine,head,visor}=rig;rig.state=state;
  pelvis.position.z=lerp(pelvis.position.z,state==="drive"?.52:G&&!air?G.pelvisZ:(.96-(moving?Math.abs(Math.sin(p))*.03:0)),G?kr:k);
  // pelvis twist / ankles are not part of the saved crowd joint state: set outright every call
  pelvis.rotation.z=G?G.pelvisYaw*rig.runW:0;legs.L.an.rotation.x=G?G.anL*rig.runW:0;legs.R.an.rotation.x=G?G.anR*rig.runW:0;
  // legs
  if(state==="drive"){set(legs.L.hip,1.5,0,.06,k);set(legs.R.hip,1.5,0,-.06,k);set(legs.L.kn,-1.45,0,0,k);set(legs.R.kn,-1.45,0,0,k);}
  else if(state==="dead"){set(legs.L.hip,0,0,.1,k);set(legs.R.hip,0,0,-.1,k);set(legs.L.kn,0,0,0,k);set(legs.R.kn,0,0,0,k);}
  else if(air){const sway=Math.sin(p*.9)*.05;set(legs.L.hip,.32+sway,0,.08,k);set(legs.R.hip,.08-sway,0,-.08,k);set(legs.L.kn,-.55,0,0,k);set(legs.R.kn,-.3,0,0,k);}
  else if(G){set(legs.L.hip,G.hipL,0,0,kr);set(legs.R.hip,G.hipR,0,0,kr);set(legs.L.kn,G.knL,0,0,kr);set(legs.R.kn,G.knR,0,0,kr);}
  else{const shamble=state==="zombie"?.6:1;set(legs.L.hip,swing*shamble,0,0,k);set(legs.R.hip,-swing*shamble,0,0,k);set(legs.L.kn,-lift*(run?1.6:1.1),0,0,k);set(legs.R.kn,-liftO*(run?1.6:1.1),0,0,k);}
  // torso lean
  set(spine,state==="zombie"?-.28:G?G.spine:state==="drive"?-.12:0,0,G?G.spineYaw:0,G?kr:k);set(head,state==="zombie"?.18:G?G.head:0,0,state==="zombie"?Math.sin(p*.5)*.15:0,k);
  visor.visible=state==="vr";
  // arms
  const g=state.startsWith("aim")||((state==="walk"||state==="run"||state==="idle"||air)&&weapon!=="none");
  if(state==="vr"){set(arms.L.sh,.55,0,.15,k);set(arms.R.sh,.55,0,-.15,k);set(arms.L.el,1.15,0,0,k);set(arms.R.el,1.15,0,0,k);}
  else if(state==="drive"){set(arms.L.sh,1.0,0,.08,k);set(arms.R.sh,1.0,0,-.08,k);set(arms.L.el,.55,0,0,k);set(arms.R.el,.55,0,0,k);}
  else if(state==="zombie"){const r=Math.sin(p*.7)*.12;set(arms.L.sh,1.73+r,0,.12,k);set(arms.R.sh,1.68-r,0,-.12,k);set(arms.L.el,.15,0,0,k);set(arms.R.el,.2,0,0,k);}
  else if(state==="dead"){set(arms.L.sh,.2,0,.5,k);set(arms.R.sh,.2,0,-.5,k);set(arms.L.el,0,0,0,k);set(arms.R.el,0,0,0,k);}
  // fists up: a boxing guard, and a straight jab with the hand given by punch (+ right, - left), 0..1 extension
  // knife: guard low with the blade forward; a stab drives the right arm straight out and a little down
  else if(weapon==="knife"&&(state==="fight"||state==="run"||state==="walk"||state==="idle")&&(state==="fight"||punch)){const r=Math.abs(punch),kk=Math.max(k,.55);set(arms.L.sh,.95,0,.32,kk);set(arms.L.el,1.6,0,0,kk);set(arms.R.sh,.7+.75*r,0,-.18+.1*r,kk);set(arms.R.el,1.35-1.25*r,0,0,kk);}
  else if(state==="fight"||weapon==="fists"){const r=Math.max(0,punch),l=Math.max(0,-punch),kk=Math.max(k,.55);set(arms.L.sh,1.05+.5*l,0,.28-.2*l,kk);set(arms.L.el,1.75-1.65*l,0,0,kk);set(arms.R.sh,1.05+.5*r,0,-.28+.2*r,kk);set(arms.R.el,1.75-1.65*r,0,0,kk);}
  // panic: running with both hands thrown up over the head, flailing
  else if(state==="panic"){const w=Math.sin(p*1.4)*.28;set(arms.L.sh,2.75+w,0,.4,k);set(arms.R.sh,2.75-w,0,-.4,k);set(arms.L.el,.4+w*.5,0,0,k);set(arms.R.el,.4-w*.5,0,0,k);}
  else if(g&&weapon==="akimbo"){set(arms.L.sh,1.45,0,.12,k);set(arms.R.sh,1.45,0,-.12,k);set(arms.L.el,.08,0,0,k);set(arms.R.el,.08,0,0,k);}
  else if(g&&weapon==="smg"){set(arms.R.sh,1.1,0,-.2,k);set(arms.R.el,.3,0,0,k);set(arms.L.sh,1.25,0,.42,k);set(arms.L.el,.6,0,0,k);}
  else if(g&&weapon==="pistol"){set(arms.R.sh,1.48,0,-.05,k);set(arms.R.el,.05,0,0,k);set(arms.L.sh,1.38,0,.32,k);set(arms.L.el,.3,0,0,k);}
  else if(G){set(arms.L.sh,G.shL,0,-.2,kr);set(arms.R.sh,G.shR,0,.2,kr);set(arms.L.el,G.elL,0,0,kr);set(arms.R.el,G.elR,0,0,kr);}
  else{set(arms.L.sh,-swing*.6,0,.06,k);set(arms.R.sh,swing*.6,0,-.06,k);set(arms.L.el,.25+(moving?.2:0),0,0,k);set(arms.R.el,.25+(moving?.2:0),0,0,k);}
  if(rig.knife)rig.knife.visible=weapon==="knife"&&state!=="dead"&&state!=="drive"&&state!=="vr"&&state!=="zombie";
  rig.gun.visible=weapon!=="none"&&weapon!=="fists"&&weapon!=="knife"&&state!=="fight"&&state!=="vr"&&state!=="drive"&&state!=="dead"&&state!=="zombie";rig.gunL.visible=rig.gun.visible&&weapon==="akimbo";
}

// Joint state of a rig as a flat array (instanced crowds keep one per person
// and pose a single shared template rig with it).
export function rigJoints(rig){return[rig.spine,rig.neck,rig.head,rig.arms.L.sh,rig.arms.L.el,rig.arms.R.sh,rig.arms.R.el,rig.legs.L.hip,rig.legs.L.kn,rig.legs.R.hip,rig.legs.R.kn];}
export function saveRigState(rig,out){const j=rigJoints(rig);out.length=j.length*3+3;for(let i=0;i<j.length;i++){out[i*3]=j[i].rotation.x;out[i*3+1]=j[i].rotation.y;out[i*3+2]=j[i].rotation.z;}out[j.length*3]=rig.pelvis.position.z;out[j.length*3+1]=rig.phase;out[j.length*3+2]=rig.runW||0;return out;}
export function loadRigState(rig,src){const j=rigJoints(rig);if(!src||src.length<j.length*3+2){for(const x of j)x.rotation.set(0,0,0);rig.pelvis.position.z=.96;rig.phase=Math.random()*TAU;rig.runW=0;return;}for(let i=0;i<j.length;i++)j[i].rotation.set(src[i*3],src[i*3+1],src[i*3+2]);rig.pelvis.position.z=src[j.length*3];rig.phase=src[j.length*3+1];rig.runW=Number(src[j.length*3+2])||0;}
