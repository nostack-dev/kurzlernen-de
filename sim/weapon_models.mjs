import * as THREE from "three";
import {buildArm,attachWeaponArms} from "./viewmodel_arms.mjs";
export {attachWeaponArms};

// Hero weapon viewmodels with skins. Silhouettes are bevelled extrusions of
// hand-drawn side profiles (cheap: a few hundred triangles each), painted
// in rarity skins with glowing details (picked up by the bloom). Coordinate
// frame of the viewmodel group: x right, y up, barrel along −z.
//   VOLT SMG          — epic purple panels on graphite, cyan energy cell
//   GOLDEN HAND CANNON — legendary gold slide, black frame, red sights,
//                        vented compensator glowing orange
//   BOOMSTICK 40 mm   — chunky drum launcher with hazard stripes
//   ROCKET LAUNCHER   — shoulder tube with a loaded warhead

export const WEAPON_MODELS_VERSION="hero-skins-v4-classic-glock";
const tag=(m,partKey)=>{m.frustumCulled=false;m.renderOrder=9998;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;if(partKey)m.userData[partKey]=true;return m;};
const std=(color,roughness=.45,metalness=.2,extra={})=>new THREE.MeshStandardMaterial({color,roughness,metalness,...extra});
const glow=color=>new THREE.MeshBasicMaterial({color,toneMapped:false});
// side profile (z forward-negative as +x of the shape, y up) → bevelled solid of width w
function profile(points,w,bevel=.008){
  const s=new THREE.Shape();points.forEach(([x,y],i)=>i?s.lineTo(x,y):s.moveTo(x,y));s.closePath();
  const g=new THREE.ExtrudeGeometry(s,{depth:Math.max(.001,w-bevel*2),bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:4});
  g.rotateY(Math.PI/2);g.translate(-(w-bevel*2)/2,0,0);g.computeVertexNormals();return g;
}
function box(w,h,d,mat,x,y,z,partKey){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);return tag(m,partKey);}
function cyl(r,len,mat,x,y,z,partKey,seg=14,r2=r){const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r2,len,seg),mat);m.rotation.x=Math.PI/2;m.position.set(x,y,z);return tag(m,partKey);}
function solid(geo,mat,x=0,y=0,z=0,partKey){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);return tag(m,partKey);}
// Named anchor points the first-person controller aligns with (grip pivot
// and the sight line).
function marker(name,x,y,z){const n=new THREE.Object3D();n.name=name;n.position.set(x,y,z);n.userData.flightFireIgnore=true;n.userData.walkWeaponPart=true;return n;}
function muzzle(name,z,y=0){const n=new THREE.Object3D();n.name=name;n.position.set(0,y,z);n.userData.flightFireIgnore=true;n.userData.walkWeaponPart=true;return n;}

// Draw-call diet: all static parts that share a material are merged into one
// mesh (a weapon goes from ~25 draw calls to ~6); anchor/muzzle nodes stay.
function mergeByMaterial(group){
  const byMat=new Map(),keep=[];
  for(const child of[...group.children]){if(!child.isMesh){keep.push(child);continue;}child.updateMatrix();let l=byMat.get(child.material);if(!l){l=[];byMat.set(child.material,l);}l.push(child);}
  const merged=[];
  for(const[mat,list]of byMat){let n=0;const parts=list.map(m=>{const g=(m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone());g.applyMatrix4(m.matrix);n+=g.attributes.position.count;return g;});
    const pos=new Float32Array(n*3),nrm=new Float32Array(n*3);let o=0;for(const g of parts){pos.set(g.attributes.position.array,o*3);nrm.set(g.attributes.normal.array,o*3);o+=g.attributes.position.count;g.dispose();}
    const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(pos,3));geo.setAttribute("normal",new THREE.BufferAttribute(nrm,3));geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,mat);Object.assign(mesh.userData,list[0].userData);mesh.renderOrder=list[0].renderOrder;mesh.frustumCulled=false;mesh.name=`${list[0].name||"WEAPON_PART"}_MERGED`;merged.push(mesh);
    for(const m of list){group.remove(m);m.geometry.dispose();}}
  group.add(...merged);return group;
}
export function buildVoltSmg(){
  const g=new THREE.Group(),K="walkSmgPart";
  const graphite=std(0x2b2f36,.5,.35),panel=std(0x7b4dff,.32,.25),gold=std(0xf2b233,.28,.85),rubber=std(0x15171b,.85,0),cell=glow(0x4fe3ff),led=glow(0xb48bff);
  // main body silhouette (receiver + handguard + grip block)
  g.add(solid(profile([[-.12,.06],[.36,.075],[.60,.06],[.62,-.02],[.38,-.06],[.18,-.06],[.12,-.04],[-.02,-.05],[-.12,-.02]],.16),graphite,0,-.01,0,K));
  // purple side panels (slightly wider, shorter)
  g.add(solid(profile([[.02,.045],[.33,.055],[.52,.045],[.53,-.01],[.34,-.045],[.04,-.04]],.172,.004),panel,0,-.01,0,K));
  // top rail + sight housing
  g.add(solid(profile([[.0,.075],[.42,.085],[.44,.105],[.40,.11],[.06,.10],[.0,.09]],.09,.004),rubber,0,0,0,K));
  // pistol grip (raked)
  g.add(solid(profile([[.10,-.04],[.20,-.04],[.17,-.25],[.08,-.26],[.065,-.2]],.105),rubber,0,0,0,K));
  // curved magazine with gold base plate
  g.add(solid(profile([[.24,-.05],[.33,-.05],[.36,-.24],[.27,-.26]],.09),graphite,0,0,0,K));
  g.add(solid(profile([[.27,-.25],[.365,-.235],[.37,-.27],[.27,-.285]],.1,.004),gold,0,0,0,K));
  // stock brace
  g.add(solid(profile([[-.12,.04],[-.04,.04],[-.04,-.02],[-.16,-.06],[-.24,-.06],[-.24,.0]],.12),rubber,0,0,0,K));
  // barrel shroud + muzzle brake with gold ring
  g.add(cyl(.026,.24,graphite,0,.02,-.72,K,16));
  g.add(cyl(.036,.07,rubber,0,.02,-.86,K,8,.032));
  g.add(cyl(.039,.014,gold,0,.02,-.825,K,16));
  // energy cell: glowing strip on both sides + LED ammo counter
  g.add(box(.176,.012,.22,cell,0,.018,-.28,K));
  g.add(box(.04,.018,.05,led,0,.112,-.14,K));
  // sights (glowing dot)
  g.add(box(.06,.03,.03,rubber,0,.13,-.1,K));g.add(box(.03,.035,.025,rubber,0,.13,-.40,K));
  g.add(tag(new THREE.Mesh(new THREE.SphereGeometry(.007,8,6),glow(0x4fe3ff)),K)).children.at(-1).position.set(0,.152,-.405);
  g.add(marker("WALK_SMG_PISTOL_GRIP",0,-.15,-.15),marker("WALK_SMG_REAR_SIGHT",0,.152,-.1),marker("WALK_SMG_FRONT_SIGHT",0,.152,-.405));
  g.add(muzzle("WALK_SMG_MUZZLE_NODE",-.9,.02));
  return mergeByMaterial(g);
}

export function buildGoldenHandCannon(){
  const g=new THREE.Group(),K="walkGlockPart";
  const slide=std(0x2b2f33,.3,.62),slideCut=std(0x15181b,.55,.3),cut=std(0x121416,.7,.18),frame=std(0x14171a,.82,.02),barrel=std(0x1c1f22,.22,.8),steel=std(0x5a5f63,.32,.7),white=std(0xe9ece9,.62,.02),tritium=glow(0x7dff6a),brass=std(0xc9a44a,.3,.85);
  // the slide (with its sights) is its own group: it cycles back on every shot
  const top=new THREE.Group();top.name="WALK_GLOCK_SLIDE";top.userData.flightFireIgnore=true;top.userData.walkWeaponPart=true;
  top.add(solid(profile([[-.025,.070],[.315,.070],[.325,.058],[.325,.008],[-.025,.008]],.074),slide,0,0,0,K));
  for(let i=0;i<5;i++)top.add(box(.076,.045,.005,slideCut,0,.040,-.012-i*.016,K));
  for(let i=0;i<3;i++)top.add(box(.076,.030,.004,slideCut,0,.045,-.262-i*.014,K)); // front serrations
  top.add(box(.052,.020,.020,slideCut,0,.087,-.015,K));for(const x of[-.017,.017]){top.add(box(.011,.011,.004,white,x,.098,-.0265,K));top.add(box(.006,.006,.005,tritium,x,.098,-.0272,K));}
  top.add(box(.018,.024,.018,slideCut,0,.090,-.304,K));top.add(box(.009,.009,.004,white,0,.103,-.3135,K));top.add(box(.005,.005,.005,tritium,0,.103,-.3142,K));
  // ejection port (dark inset on the right), extractor, slide top bevels
  top.add(box(.004,.024,.056,slideCut,.038,.054,-.13,K));top.add(box(.005,.006,.024,steel,.0385,.06,-.095,K));for(const x of[-.031,.031])top.add(box(.012,.006,.33,slideCut,x,.07,-.15,K));
  mergeByMaterial(top);g.add(top);
  g.add(box(.076,.010,.072,barrel,0,.067,-.145,K));
  g.add(cyl(.019,.275,barrel,0,.029,-.205,K,16));
  g.add(cyl(.027,.016,barrel,0,.029,-.345,K,16));
  g.add(solid(profile([[.0,.008],[.30,.008],[.30,-.030],[.13,-.040],[.105,-.078],[.035,-.078],[.020,-.035],[-.01,-.025]],.072),frame,0,0,0,K));
  g.add(box(.074,.018,.145,frame,0,-.055,-.205,K));
  g.add(solid(profile([[.005,-.035],[.078,-.040],[.055,-.245],[-.035,-.245],[-.058,-.190],[-.030,-.050]],.078),frame,0,0,0,K));
  for(let i=0;i<5;i++)g.add(box(.080,.005,.050,cut,0,-.080-i*.034,.014-i*.003,K));
  g.add(box(.086,.020,.092,cut,0,-.250,.005,K));
  g.add(box(.011,.045,.012,steel,0,-.083,-.060,K));g.add(box(.004,.03,.008,steel,0,-.07,-.052,K)); // trigger + safety blade
  g.add(box(.078,.008,.012,steel,0,-.008,-.10,K)); // takedown lever
  g.add(cyl(.007,.05,steel,0,-.012,-.33,K,10)); // recoil guide rod tip
  for(let i=0;i<3;i++)g.add(box(.076,.006,.012,cut,0,-.064,-.17-i*.03,K)); // rail slots
  g.add(box(.09,.012,.1,steel,0,-.262,.005,K)); // magazine baseplate
  g.add(marker("WALK_GLOCK_GRIP",0,-.145,.005),marker("WALK_GLOCK_REAR_SIGHT",0,.101,-.020),marker("WALK_GLOCK_FRONT_SIGHT",0,.103,-.304));
  g.add(marker("WALK_GLOCK_EJECT",.04,.075,-.13));
  g.add(muzzle("WALK_GLOCK_MUZZLE_NODE",-.362,.029));
  mergeByMaterial(g);g.scale.setScalar(1.35);g.position.set(0,-.02,-.05);return g;
}

// SNIPER: .50 anti-materiel bolt rifle — fluted heavy barrel with a muzzle brake, long scope
// (objective bell, turrets), bolt handle, folded bipod, skeleton stock. The scope's line of sight
// is the sight line for ADS: looking through it puts the reticle on the shot.
export function buildSniperRifle(){
  const g=new THREE.Group(),K="walkSniperPart";
  const dark=std(0x23272b,.55,.35),tan=std(0x8a7a5c,.7,.05),steel=std(0x3c4044,.35,.7),black=std(0x0c0d0f,.5,.4),glass=new THREE.MeshStandardMaterial({color:0x1a3a52,roughness:.05,metalness:.9}),bolt=std(0x9aa0a6,.3,.8);
  // receiver + stock (tan furniture) + grip
  g.add(solid(profile([[-.10,.050],[.42,.050],[.44,.030],[.44,-.040],[.30,-.050],[-.10,-.045]],.070),dark,0,0,0,K));
  g.add(solid(profile([[-.62,.040],[-.10,.040],[-.10,-.045],[-.25,-.060],[-.45,-.150],[-.62,-.160]],.060),tan,0,0,0,K));
  g.add(box(.064,.12,.02,black,0,-.04,.62,K)); // butt pad
  g.add(solid(profile([[-.02,-.040],[.06,-.040],[.03,-.200],[-.05,-.200],[-.06,-.150]],.058),tan,0,0,0,K));
  g.add(box(.06,.09,.11,black,0,-.09,-.20,K)); // magazine
  // fluted heavy barrel + brake
  g.add(cyl(.026,.95,steel,0,.015,-.90,K,14));
  for(let i=0;i<6;i++)g.add(box(.006,.006,.70,black,Math.cos(i*Math.PI/3)*.026,.015+Math.sin(i*Math.PI/3)*.026,-.82,K));
  g.add(cyl(.040,.13,black,0,.015,-1.42,K,10));
  for(const x of[-.041,.041])g.add(box(.004,.03,.09,steel,x,.015,-1.42,K));
  // handguard rail
  g.add(box(.068,.06,.46,dark,0,.01,-.62,K));
  // folded bipod
  for(const x of[-.022,.022])g.add(box(.012,.012,.30,black,x,-.035,-.70,K));
  // bolt handle
  g.add(cyl(.009,.07,bolt,.06,.035,-.04,K,8));g.children.at(-1).rotation.set(0,0,Math.PI/2);g.add(tag(new THREE.Mesh(new THREE.SphereGeometry(.016,10,8),bolt),K));g.children.at(-1).position.set(.10,.035,-.04);
  // scope: rings, tube, bells, turrets, lens
  for(const z of[-.08,-.36])g.add(box(.05,.055,.03,black,0,.075,z,K));
  g.add(cyl(.024,.42,black,0,.125,-.22,K,18));
  g.add(cyl(.036,.11,black,0,.125,-.49,K,18,.024));g.children.at(-1).rotation.x=-Math.PI/2;
  g.add(cyl(.032,.07,black,0,.125,.03,K,18,.024));g.children.at(-1).rotation.x=Math.PI/2;
  g.add(cyl(.016,.035,dark,0,.162,-.22,K,12));g.children.at(-1).rotation.x=0;
  g.add(cyl(.016,.035,dark,.040,.125,-.22,K,12));g.children.at(-1).rotation.set(0,0,Math.PI/2);
  const lens=tag(new THREE.Mesh(new THREE.CircleGeometry(.030,20),glass),K);lens.position.set(0,.125,.067);g.add(lens);
  g.add(marker("WALK_SNIPER_GRIP",0,-.12,.0),marker("WALK_SNIPER_REAR_SIGHT",0,.125,.06),marker("WALK_SNIPER_FRONT_SIGHT",0,.125,-.54));
  g.add(muzzle("WALK_SNIPER_MUZZLE_NODE",-1.49,.015));
  mergeByMaterial(g);g.scale.setScalar(.62);g.position.set(0,-.01,.10);return g;
}

// FISTS: two gloved fists (same tactical gloves + camo sleeves as on the guns), held low in
// a guard; each one jabs forward on a punch. Each hand is its own group (WALK_FIST_L / _R):
// the punch animation extends and turns it. Hand origin = centre of the closed fist.
export const FIST_HAND_SCALE=1.45;
function fistArm(side){
  const hand=new THREE.Group();hand.name=side<0?"WALK_FIST_L":"WALK_FIST_R";hand.position.set(side*.16,-.02,0);
  hand.userData.flightFireIgnore=true;hand.userData.walkWeaponPart=true;
  // knuckles forward and slightly inward, back of the hand up/out, forearm back and down to the corner
  const arm=buildArm(`${hand.name}_ARM`,{side,pos:[0,0,0],axis:[-side,.12,-.2],back:[side*.35,1,.15],forearm:[side*.3,-.5,.81],length:.36,scale:FIST_HAND_SCALE,grip:{rx:.012*FIST_HAND_SCALE,rz:.012*FIST_HAND_SCALE,thumb:"over",knuckle:.15,wrap:1.05}});
  arm.traverse(n=>{if(n.isMesh)n.userData.walkFistsPart=true;});hand.add(arm);hand.userData.restZ=0;return hand;
}
export function buildFists(){
  const g=new THREE.Group();
  for(const side of[-1,1])g.add(fistArm(side));
  g.add(marker("WALK_FISTS_GRIP",.16,-.02,0),marker("WALK_FISTS_REAR_SIGHT",0,.06,0),marker("WALK_FISTS_FRONT_SIGHT",0,.06,-.3),muzzle("WALK_FISTS_MUZZLE_NODE",-.08,0));
  g.position.set(-.245,.115,-.12);return g;
}

// KNIFE: a CoD-style combat knife (clip-point blade with a fuller and a bright bevel, black
// guard, ribbed rubber handle, pommel) in the right gloved hand, held low-right with the
// blade forward. WALK_KNIFE_HAND is the animated wrist group, WALK_KNIFE_BLADE the knife;
// WALK_KNIFE_TRAIL is a slash smear the runtime fades in during the strike.
export function buildKnife(){
  const g=buildFists(),left=g.getObjectByName("WALK_FIST_L");if(left)g.remove(left);
  const old=g.getObjectByName("WALK_FIST_R");if(old)g.remove(old);
  const hand=new THREE.Group();hand.name="WALK_KNIFE_HAND";hand.position.set(.16,-.02,0);hand.userData.flightFireIgnore=true;hand.userData.walkWeaponPart=true;
  const s=FIST_HAND_SCALE,K="walkKnifePart";
  // the knife in its own frame: handle centred on the origin, blade along −z, edge down (−y)
  const knife=new THREE.Group();knife.name="WALK_KNIFE_BLADE";knife.userData.flightFireIgnore=true;knife.userData.walkWeaponPart=true;
  const steel=std(0x6e757b,.3,.85),edge=std(0xd8dde2,.16,.95),dark=std(0x17191c,.5,.55),rubber=std(0x1a1c1e,.88,.02),pommel=std(0x2a2d31,.38,.75);
  const blade=new THREE.Shape();[[0,.016],[.13,.0165],[.165,.013],[.2,.0],[.17,-.01],[.12,-.0165],[0,-.016]].forEach(([x,y],i)=>i?blade.lineTo(x,y):blade.moveTo(x,y));blade.closePath();
  const bg=new THREE.ExtrudeGeometry(blade,{depth:.0022,bevelEnabled:true,bevelThickness:.0016,bevelSize:.0018,bevelSegments:1,curveSegments:2});bg.translate(0,0,-.0011);bg.rotateY(Math.PI/2);bg.computeVertexNormals();
  const bm=new THREE.Mesh(bg,steel);bm.position.set(0,.002,-.05);knife.add(tag(bm,K));
  const eg=new THREE.Shape();[[.0,-.0145],[.12,-.0152],[.168,-.0088],[.199,-.0002],[.165,-.0115],[.12,-.0185],[0,-.0182]].forEach(([x,y],i)=>i?eg.lineTo(x,y):eg.moveTo(x,y));eg.closePath();
  const egg=new THREE.ExtrudeGeometry(eg,{depth:.0052,bevelEnabled:false});egg.translate(0,0,-.0026);egg.rotateY(Math.PI/2);egg.computeVertexNormals();
  const em=new THREE.Mesh(egg,edge);em.position.set(0,.002,-.05);knife.add(tag(em,K));
  knife.add(box(.0062,.006,.1,dark,0,.006,-.105,K));                                        // fuller (blood groove)
  knife.add(box(.012,.006,.04,dark,0,.019,-.07,K));                                         // spine thumb ramp
  knife.add(box(.016,.05,.012,dark,0,.0,-.046,K));                                          // cross guard
  const hg=new THREE.CylinderGeometry(.0135,.0125,.095,10,4);{const p=hg.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i),k=1+.07*Math.cos(y*200);p.setX(i,p.getX(i)*k*.85);p.setZ(i,p.getZ(i)*k*1.12);}hg.computeVertexNormals();}
  const hm=new THREE.Mesh(hg,rubber);hm.rotation.x=Math.PI/2;hm.position.set(0,0,0);knife.add(tag(hm,K)); // ribbed handle
  knife.add(cyl(.0125,.014,pommel,0,0,.054,K,10,.0145));                                   // pommel
  knife.scale.setScalar(s*1.08);
  // the hand: grip axis along the knife handle (index side towards the blade)
  const axis=new THREE.Vector3(0,0,-1),arm=buildArm("WALK_KNIFE_ARM",{side:1,pos:[0,0,0],axis:[0,0,-1],back:[1,.35,0],forearm:[.28,-.5,.82],length:.42,scale:s,grip:{rx:.0115*s*1.08,rz:.0155*s*1.08,curls:[.95,1,1,1]}});void axis;
  arm.traverse(n=>{if(n.isMesh)n.userData.walkKnifePart=true;});
  // grip pose inside the hand: blade forward-up, edge turned out to the left
  const holder=new THREE.Group();holder.name="WALK_KNIFE_GRIP_POSE";holder.add(knife,arm);holder.rotation.set(.32,.18,-.5);hand.add(holder);
  // slash smear: a ribbon the runtime fills with the blade's recent path (tip → base),
  // additive, vertex colours fade with age (black = invisible); one tiny dynamic buffer
  const TRAIL_SAMPLES=12,trailGeo=new THREE.BufferGeometry(),tp=new Float32Array(TRAIL_SAMPLES*2*3),tc=new Float32Array(TRAIL_SAMPLES*2*3),ti=[];
  for(let i=0;i<TRAIL_SAMPLES-1;i++){const a=i*2;ti.push(a,a+1,a+2,a+1,a+3,a+2);}
  trailGeo.setAttribute("position",new THREE.BufferAttribute(tp,3).setUsage(THREE.DynamicDrawUsage));trailGeo.setAttribute("color",new THREE.BufferAttribute(tc,3).setUsage(THREE.DynamicDrawUsage));trailGeo.setIndex(ti);trailGeo.setDrawRange(0,0);
  const trailMat=new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false});
  const trail=new THREE.Mesh(trailGeo,trailMat);trail.name="WALK_KNIFE_TRAIL";trail.visible=false;tag(trail,K);trail.renderOrder=9999;trail.userData.samples=TRAIL_SAMPLES;
  knife.userData.tipLocal=new THREE.Vector3(0,.0,-.25);knife.userData.baseLocal=new THREE.Vector3(0,.004,-.1);g.add(trail);
  g.add(hand);g.position.set(-.2,.09,-.06);return g;
}

// ROCKET LAUNCHER: a shoulder tube (RPG style) with a loaded warhead poking out of the front,
// a pistol grip + fore grip under the tube, flip-up optic on the left and a flared blast cone behind.
export function buildRocketLauncher(){
  // Laser-guided launcher (Half-Life 2 RPG style): gunmetal tube, open black bore,
  // a guidance box with a red laser lens on the left side — clearly not the olive grenade launcher.
  const g=new THREE.Group(),K="walkRocketPart";
  const metal=std(0x2b3038,.42,.62),dark=std(0x121418,.72,.18),steel=std(0x8a9199,.3,.85),bore=std(0x030303,.95,0),rubber=std(0x1b1d20,.9,.02),glowR=glow(0xff1a1a),amber=glow(0xffa21a);
  g.add(cyl(.068,.96,metal,0,.03,-.35,K,18));                                   // main tube
  g.add(cyl(.084,.11,dark,0,.03,-.81,K,18,.09));                                // muzzle shroud
  g.add(cyl(.058,.012,bore,0,.03,-.867,K,16));                                  // open bore (no warhead sticking out)
  g.add(cyl(.072,.022,steel,0,.03,-.05,K,18),cyl(.072,.022,steel,0,.03,-.3,K,18),cyl(.072,.022,steel,0,.03,-.62,K,18)); // reinforcement rings
  g.add(cyl(.098,.15,dark,0,.03,.18,K,18,.07));                                 // rear venturi
  g.add(cyl(.086,.012,bore,0,.03,.258,K,16));                                   // rear bore
  g.add(box(.05,.03,.5,dark,0,.105,-.36,K));                                    // top rail
  g.add(solid(profile([[.0,-.03],[.09,-.03],[.07,-.2],[-.01,-.2]],.06),rubber,0,0,-.1,K)); // pistol grip
  g.add(solid(profile([[.0,-.03],[.07,-.03],[.06,-.15],[.0,-.15]],.055),rubber,0,0,-.44,K)); // fore grip
  g.add(box(.012,.05,.11,dark,0,-.025,-.17,K));                                 // trigger guard
  // guidance unit: box on the left with the red laser lens and a status light
  g.add(box(.06,.075,.24,metal,-.095,.06,-.46,K),box(.07,.012,.25,dark,-.095,.104,-.46,K));
  g.add(cyl(.022,.02,steel,-.095,.06,-.585,K,14),cyl(.015,.012,glowR,-.095,.06,-.597,K,14));
  g.add(box(.014,.014,.014,amber,-.128,.08,-.38,K),box(.014,.014,.014,glowR,-.128,.08,-.355,K));
  g.add(marker("WALK_RL_LASER_NODE",-.095,.06,-.61));
  g.add(marker("WALK_RL_GRIP",0,-.14,-.145),marker("WALK_RL_REAR_SIGHT",0,.135,-.1),marker("WALK_RL_FRONT_SIGHT",0,.135,-.6));
  g.add(muzzle("WALK_ROCKET_MUZZLE_NODE",-.86,.03));
  return mergeByMaterial(g);
}

export function buildBoomstick(){
  const g=new THREE.Group(),K="walkGrenadePart";
  const olive=std(0x4a5a3a,.6,.2),dark=std(0x1d2024,.7,.15),orange=std(0xff7a1a,.45,.1),yellow=std(0xffd23f,.45,.1),black=std(0x121316,.6,.1),wood=std(0x8a5a3b,.65,0),glowO=glow(0xff8a2a);
  // body + rear grip + stock
  g.add(solid(profile([[-.06,.07],[.22,.075],[.26,.03],[.24,-.05],[-.06,-.05]],.17),olive,0,0,0,K));
  g.add(solid(profile([[.06,-.05],[.15,-.05],[.13,-.25],[.04,-.26]],.1),wood,0,0,0,K));
  g.add(solid(profile([[-.06,.05],[-.06,-.05],[-.28,-.09],[-.30,.0],[-.2,.05]],.13),dark,0,0,0,K));
  // revolving drum with hazard stripes
  const drum=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.2,10),olive);drum.rotation.x=Math.PI/2;drum.position.set(0,-.005,-.36);g.add(tag(drum,K));
  for(let i=0;i<4;i++){const ring=new THREE.Mesh(new THREE.CylinderGeometry(.113,.113,.03,10),i%2?black:yellow);ring.rotation.x=Math.PI/2;ring.position.set(0,-.005,-.29-i*.045);g.add(tag(ring,K));}
  for(let i=0;i<6;i++){const a=i/6*Math.PI*2,c=new THREE.Mesh(new THREE.CylinderGeometry(.026,.026,.205,10),dark);c.rotation.x=Math.PI/2;c.position.set(Math.cos(a)*.07,-.005+Math.sin(a)*.07,-.36);g.add(tag(c,K));}
  // fat barrel, orange muzzle with glowing ring, top handle
  g.add(cyl(.058,.36,dark,0,.03,-.62,K,14));
  g.add(cyl(.068,.06,orange,0,.03,-.81,K,14));
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.06,.01,6,20),glowO);ring.position.set(0,.03,-.842);g.add(tag(ring,K));
  g.add(box(.05,.03,.26,black,0,.13,-.2,K));g.add(box(.04,.06,.03,black,0,.1,-.08,K));g.add(box(.04,.06,.03,black,0,.1,-.32,K));
  g.add(box(.02,.04,.02,glowO,0,.16,-.3,K));
  g.add(marker("WALK_GL_GRIP",0,-.15,-.095),marker("WALK_GL_REAR_SIGHT",0,.175,-.08),marker("WALK_GL_FRONT_SIGHT",0,.175,-.32));
  g.add(muzzle("WALK_GRENADE_MUZZLE_NODE",-.87,.03));
  return mergeByMaterial(g);
}
