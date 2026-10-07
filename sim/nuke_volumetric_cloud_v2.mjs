import * as THREE from "three";
import {disposeEffect,setData} from "./nuke_fx_shared.mjs";
import {fatLineMaterial,fatLineGeometry,fatLineSegments} from "./box3d_collider_debug.mjs";

// The classic mushroom, sculpted instead of a pile of cloud puffs:
//   * stem   – a lathe surface with the typical narrow neck, flaring into the
//              cap and spreading at the ground,
//   * cap    – a rolling toroidal vortex ring under a domed top,
//   * collar – the condensation (Wilson) ring that forms around the stem,
//   * base surge – a wide ring rolling outward along the ground.
// Each part is a flat dark silhouette (the game's look, same fill as the
// buildings) outlined by neon lines. Heat is never a soft gradient: the hot
// core lines inside the stem, under the cap and along the base surge glow
// white-hot and cool down to the game's neon green. Flow rings scroll up the
// stem and roll around the vortex ring so the cloud visibly churns.
// ~25 draw calls in total, no lights, no per-frame geometry rebuilds.

const CINEMATIC_RENDER_ORDER=840;
const NUKE_SCALE=3;
const HEIGHT_M=112*NUKE_SCALE;       // final top of the dome (~336 m)
const RISE_TAU_S=3.6,LIFE_S=34;
const STEM_RINGS=10,TORUS_FLOWS=7;

const clouds=[];let installed=false,unitCircle=null;

function viewport(){return document.getElementById("viewport");}
function scene(){return globalThis.__arondightRealWorld?.threeScene||null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function smooth(t){t=clamp(t,0,1);return t*t*(3-2*t);}
function tag(node,role){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;node.userData.nukeOverkillPart=true;node.userData.nukeOverkillRole=role;node.userData.nukeVolumetricPart=true;node.userData.neonSkip=true;node.renderOrder=CINEMATIC_RENDER_ORDER;return node;}

// Stem profile (radius, height) as fractions of HEIGHT_M.
const STEM_PROFILE=[[.30,0],[.22,.025],[.15,.07],[.095,.16],[.072,.30],[.066,.46],[.07,.60],[.085,.70],[.12,.775]];
function stemRadiusAt(h){if(h<=0)return STEM_PROFILE[0][0];for(let i=1;i<STEM_PROFILE.length;i++){const[a,ha]=STEM_PROFILE[i-1],[b,hb]=STEM_PROFILE[i];if(h<=hb)return a+(b-a)*(h-ha)/(hb-ha);}return STEM_PROFILE.at(-1)[0];}
const CAP={z:.80,R:.24,r:.105};       // vortex ring centre height, major and tube radius
const DOME={z:.84,r:.27,squash:.62};

const NEON=new THREE.Color(0x00ff9c),WHITE_HOT=new THREE.Color(0xf4fff9);
function darkMaterial(){return new THREE.MeshBasicMaterial({color:0x03160d,toneMapped:false,fog:false,side:THREE.FrontSide,transparent:true,opacity:1,depthWrite:true});}
// Hot core lines: inside the stem, under the cap, along the base surge.
function circlePositions(radius,z,seg=56){const out=[];for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,b=(i+1)/seg*Math.PI*2;out.push(Math.cos(a)*radius,Math.sin(a)*radius,z,Math.cos(b)*radius,Math.sin(b)*radius,z);}return out;}
function stemCorePositions(){const out=[],n=8;for(let k=0;k<n;k++){const a=(k+.5)/n*Math.PI*2,c=Math.cos(a),si=Math.sin(a);for(let i=0;i<STEM_PROFILE.length-1;i++){const[r0,h0]=STEM_PROFILE[i],[r1,h1]=STEM_PROFILE[i+1];out.push(c*r0*.5,si*r0*.5,h0,c*r1*.5,si*r1*.5,h1);}}return out;}
function capUnderPositions(){const out=[];for(const phi of[-Math.PI/2,-Math.PI/3,-Math.PI*2/3])out.push(...circlePositions(CAP.R+CAP.r*1.07*Math.cos(phi),CAP.r*1.07*Math.sin(phi),56));return out;}
// Lathe/Torus in three are built around +Y / in the XY plane; stand the lathe on +Z.
function zUp(geometry){geometry.rotateX(Math.PI/2);return geometry;}

// Neon structure lines (the game's look: dark solid + neon edges).
function stemWirePositions(){const out=[],n=14;for(let k=0;k<n;k++){const a=k/n*Math.PI*2,c=Math.cos(a),si=Math.sin(a);for(let i=0;i<STEM_PROFILE.length-1;i++){const[r0,h0]=STEM_PROFILE[i],[r1,h1]=STEM_PROFILE[i+1];out.push(c*r0*1.04,si*r0*1.04,h0,c*r1*1.04,si*r1*1.04,h1);}}return out;}
function torusWirePositions(){const out=[],R=CAP.R,r=CAP.r*1.05,seg=56;for(const phi of[0,Math.PI/2,Math.PI,-Math.PI/2,Math.PI/4,-Math.PI/4]){const rr=R+r*Math.cos(phi),z=r*Math.sin(phi);for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,b=(i+1)/seg*Math.PI*2;out.push(Math.cos(a)*rr,Math.sin(a)*rr,z,Math.cos(b)*rr,Math.sin(b)*rr,z);}}
  for(let k=0;k<16;k++){const a=k/16*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a);for(let j=0;j<16;j++){const p0=j/16*Math.PI*2,p1=(j+1)/16*Math.PI*2,r0=R+r*Math.cos(p0),r1=R+r*Math.cos(p1);out.push(ca*r0,sa*r0,r*Math.sin(p0),ca*r1,sa*r1,r*Math.sin(p1));}}return out;}
function domeWirePositions(){const out=[],r=DOME.r*1.02,sq=DOME.squash;for(let k=0;k<16;k++){const a=k/16*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a);for(let j=0;j<8;j++){const t0=j/8*Math.PI/2,t1=(j+1)/8*Math.PI/2;out.push(ca*r*Math.cos(t0),sa*r*Math.cos(t0),r*sq*Math.sin(t0),ca*r*Math.cos(t1),sa*r*Math.cos(t1),r*sq*Math.sin(t1));}}
  for(const t of[Math.PI/8,Math.PI/4,Math.PI*3/8]){const rr=r*Math.cos(t),z=r*sq*Math.sin(t);for(let i=0;i<48;i++){const a=i/48*Math.PI*2,b=(i+1)/48*Math.PI*2;out.push(Math.cos(a)*rr,Math.sin(a)*rr,z,Math.cos(b)*rr,Math.sin(b)*rr,z);}}return out;}
// Geometry is built once and shared by every detonation (flagged so
// disposeEffect keeps it); only materials are per-cloud.
let shared=null;
function sharedGeometries(){
  if(shared)return shared;const mark=g=>{g.userData.nukeSharedGeometry=true;return g;};
  const domeGeo=new THREE.SphereGeometry(DOME.r,40,14,0,Math.PI*2,0,Math.PI/2);domeGeo.rotateX(Math.PI/2);domeGeo.scale(1,1,DOME.squash);
  shared={
    stem:mark(zUp(new THREE.LatheGeometry(STEM_PROFILE.map(([r,h])=>new THREE.Vector2(r,h)),40))),
    stemHot:mark(fatLineGeometry(stemCorePositions())),
    cap:mark(new THREE.TorusGeometry(CAP.R,CAP.r,22,56)),
    capHot:mark(fatLineGeometry(capUnderPositions())),
    dome:mark(domeGeo),
    collar:mark(fatLineGeometry([...circlePositions(.16,0,48),...circlePositions(.17,.012,48)])),
    surge:mark(new THREE.TorusGeometry(.42,.045,10,64)),
    surgeHot:mark(fatLineGeometry([...circlePositions(.465,.03,64),...circlePositions(.42,.09,64)])),
    stemWire:mark(fatLineGeometry(stemWirePositions())),
    capWire:mark(fatLineGeometry(torusWirePositions())),
    domeWire:mark(fatLineGeometry(domeWirePositions())),
  };return shared;
}
function buildParts(group){
  const parts={},G=sharedGeometries();
  parts.stem=tag(new THREE.Mesh(G.stem,darkMaterial()),"stem-silhouette");
  const hotMat=fatLineMaterial(0xf4fff9,{width:2.4,opacity:1,additive:true});parts.hotMat=hotMat;
  parts.stemHeat=tag(fatLineSegments(G.stemHot,hotMat),"hot-plume-visible-stem");delete parts.stemHeat.userData.neonEdge;
  parts.cap=tag(new THREE.Mesh(G.cap,darkMaterial()),"crown-visible-core");parts.cap.position.z=CAP.z;
  parts.capHeat=tag(fatLineSegments(G.capHot,hotMat),"hot-crown-visible-core");delete parts.capHeat.userData.neonEdge;parts.capHeat.position.z=CAP.z;
  parts.dome=tag(new THREE.Mesh(G.dome,darkMaterial()),"crown-volumetric-core");parts.dome.position.z=DOME.z;
  parts.collarMat=fatLineMaterial(0x00ff9c,{width:1.6,opacity:0,additive:true});parts.collar=tag(fatLineSegments(G.collar,parts.collarMat),"crown-collar");delete parts.collar.userData.neonEdge;parts.collar.position.z=.5;
  parts.surge=tag(new THREE.Mesh(G.surge,darkMaterial()),"base-surge");parts.surge.position.z=.03;
  parts.surgeHeat=tag(fatLineSegments(G.surgeHot,hotMat),"hot-plume-visible-surge");delete parts.surgeHeat.userData.neonEdge;parts.surgeHeat.position.z=0;
  for(const key of Object.keys(parts))if(parts[key]?.isObject3D)group.add(parts[key]);
  unitCircle??=(()=>{const pts=[],n=64;for(let i=0;i<n;i++){const a=i/n*Math.PI*2,b=(i+1)/n*Math.PI*2;pts.push(Math.cos(a),Math.sin(a),0,Math.cos(b),Math.sin(b),0);}const g=fatLineGeometry(pts);g.userData.nukeSharedGeometry=true;return g;})();
  const lineMat=fatLineMaterial(0x00ff9c,{width:2,opacity:.95,additive:true}),wireMat=fatLineMaterial(0x00ff9c,{width:1.6,opacity:.9,additive:true});
  const stemWire=tag(fatLineSegments(G.stemWire,wireMat),"plume-volumetric-wire");delete stemWire.userData.neonEdge;group.add(stemWire);
  const capWire=tag(fatLineSegments(G.capWire,wireMat),"crown-volumetric-wire");delete capWire.userData.neonEdge;parts.cap.add(capWire);
  const domeWire=tag(fatLineSegments(G.domeWire,wireMat),"crown-volumetric-dome-wire");delete domeWire.userData.neonEdge;parts.dome.add(domeWire);
  parts.wireMat=wireMat;
  parts.stemRings=[];for(let i=0;i<STEM_RINGS;i++){const ring=tag(fatLineSegments(unitCircle,lineMat),`plume-volumetric-ring-${i}`);delete ring.userData.neonEdge;group.add(ring);parts.stemRings.push(ring);}
  parts.capFlows=[];for(let i=0;i<TORUS_FLOWS;i++){const ring=tag(fatLineSegments(unitCircle,lineMat),`crown-volumetric-flow-${i}`);delete ring.userData.neonEdge;group.add(ring);parts.capFlows.push(ring);}
  parts.lineMat=lineMat;
  return parts;
}

function spawn(position){
  const world=scene();if(!world)return;
  const group=tag(new THREE.Group(),"volumetric-world-root");group.position.copy(position);world.add(group);
  const parts=buildParts(group);group.scale.setScalar(.001);
  clouds.push({group,world,parts,born:performance.now(),position:position.clone()});
  const v=viewport();if(v){v.dataset.nukeVolumetricCloud="sculpted-mushroom-v3";v.dataset.nukeVolumetricStyle="flat-silhouette+neon-hot-lines-v2";v.dataset.nukeVolumetricAnchor=`${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}`;v.dataset.nukeVolumetricParts=String(group.children.length);v.dataset.nukeVolumetricHotParts="3";v.dataset.nukeVolumetricScreenSpace="none";v.dataset.nukeVolumetricVisibility="depth-tested-v4";}
}

function update(item,now){
  const age=(now-item.born)/1000,p=item.parts;
  const rise=1-Math.exp(-age/RISE_TAU_S),spread=.55+.45*smooth(age/9)+.12*smooth((age-9)/25);
  item.group.scale.set(HEIGHT_M*spread,HEIGHT_M*spread,HEIGHT_M*Math.max(.02,rise));
  const open=smooth((age-.6)/5);p.cap.scale.set(.6+.4*open,.6+.4*open,1+.25*(1-open));p.capHeat.scale.copy(p.cap.scale);p.dome.scale.set(.75+.25*open,.75+.25*open,1);
  const fade=1-smooth((age-(LIFE_S-9))/9),heat=Math.max(0,1-age/24)*fade;
  for(const m of[p.stem,p.cap,p.dome,p.surge]){m.material.opacity=fade;m.material.depthWrite=fade>.98;}
  // Hot lines: white-hot at detonation, cooling to the neon green.
  p.hotMat.color.copy(NEON).lerp(WHITE_HOT,clamp(heat*1.25,0,1));p.hotMat.opacity=fade*(.55+.45*heat);
  p.surgeHeat.visible=age<14;
  p.collarMat.opacity=.85*smooth((age-3)/2)*(1-smooth((age-10)/5));p.collar.position.z=.46+.06*smooth(age/8);p.collar.scale.setScalar(1+.25*smooth((age-3)/8));
  const surge=1+2.2*(1-Math.exp(-age/4));p.surge.scale.set(surge,surge,1);p.surgeHeat.scale.set(surge,surge,1);
  const flow=age*.06;
  for(let i=0;i<p.stemRings.length;i++){const h=((i/p.stemRings.length+flow)%1)*.76,r=stemRadiusAt(h),ring=p.stemRings[i];ring.position.z=h;ring.scale.set(r*1.06,r*1.06,1);ring.visible=fade>.02;}
  for(let i=0;i<p.capFlows.length;i++){const phi=i/p.capFlows.length*Math.PI*2+age*.9,R=(CAP.R+CAP.r*1.05*Math.cos(phi))*(.6+.4*open),ring=p.capFlows[i];ring.position.z=CAP.z+CAP.r*1.05*Math.sin(phi)*(1+.25*(1-open));ring.scale.set(R,R,1);ring.visible=fade>.02;}
  p.lineMat.opacity=.95*fade;p.wireMat.opacity=.9*fade;
  const v=viewport();setData(v,"nukeVolumetricProgress",clamp(rise,0,1).toFixed(2));setData(v,"nukeVolumetricRiseM",(HEIGHT_M*rise).toFixed(0));setData(v,"nukeVolumetricHeat",heat.toFixed(2));
  return age<LIFE_S;
}

let prewarmed=false;
function prewarm(){const world=scene();if(prewarmed||!world)return;prewarmed=true;const group=tag(new THREE.Group(),"prewarm");group.position.set(0,0,-3000);group.scale.setScalar(.001);const parts=buildParts(group);for(const node of group.children)node.frustumCulled=false;world.add(group);// Remove without disposing materials: their compiled programs stay cached.
  const drop=()=>setTimeout(()=>{world.remove(group);void parts;},4000);window.addEventListener("arondight:game-start",drop,{once:true});setTimeout(drop,60000);}
function frame(now){prewarm();for(let i=clouds.length-1;i>=0;i--){const item=clouds[i];if(update(item,now))continue;item.world?.remove(item.group);disposeEffect(item.group);clouds.splice(i,1);}requestAnimationFrame(frame);}
function install(){if(installed)return;installed=true;window.addEventListener("arondight:world-reset",()=>{for(const c of clouds.splice(0)){c.world?.remove(c.group);disposeEffect(c.group);}});document.getElementById("nukeCinematicScreenCloud")?.remove();document.getElementById("nukeOverkillShockScreen")?.remove();window.addEventListener("arondight:nuke-impact",event=>{const p=event?.detail?.position;if(!Array.isArray(p)||p.length<3)return;requestAnimationFrame(()=>spawn(new THREE.Vector3(Number(p[0])||0,Number(p[1])||0,Number(p[2])||0)));});requestAnimationFrame(frame);}
install();
