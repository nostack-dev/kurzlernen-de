import * as THREE from "three";

// Hero weapon viewmodels with skins. Silhouettes are bevelled extrusions of
// hand-drawn side profiles (cheap: a few hundred triangles each), painted
// in rarity skins with glowing details (picked up by the bloom). Coordinate
// frame of the viewmodel group: x right, y up, barrel along −z.
//   VOLT SMG          — epic purple panels on graphite, cyan energy cell
//   GOLDEN HAND CANNON — legendary gold slide, black frame, red sights,
//                        vented compensator glowing orange
//   BOOMSTICK 40 mm   — chunky drum launcher with hazard stripes

export const WEAPON_MODELS_VERSION="hero-skins-v1";
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
  const gold=std(0x25282b,.40,.46),goldDark=std(0x111315,.58,.28),frame=std(0x101214,.78,.04),steel=std(0x34383d,.42,.58),red=std(0xe7e9e6,.64,.04),hot=std(0x181b1e,.72,.08);
  // matte black service-pistol slide with serrations
  g.add(solid(profile([[-.02,.07],[.30,.07],[.31,.06],[.31,.005],[-.02,.005]],.068),gold,0,0,0,K));
  for(let i=0;i<6;i++)g.add(box(.07,.05,.006,goldDark,0,.04,.0-.01-i*.016,K));
  // ejection port + engraving line
  g.add(box(.07,.012,.07,frame,0,.064,-.13,K));g.add(box(.0705,.004,.24,goldDark,0,.03,-.16,K));
  // dark front slide extension and vent cuts
  g.add(solid(profile([[.30,.07],[.38,.07],[.39,.06],[.39,.005],[.30,.005]],.07),steel,0,0,0,K));
  for(let i=0;i<3;i++)g.add(box(.072,.012,.012,hot,0,.07,-.32-i*.022,K));
  // polymer frame: dust cover, trigger guard, grip with texture bands
  g.add(solid(profile([[.0,.006],[.29,.006],[.29,-.02],[.12,-.03],[.10,-.07],[.04,-.07],[.03,-.03],[.0,-.025]],.064),frame,0,0,0,K));
  g.add(solid(profile([[.0,-.02],[.06,-.02],[.035,-.21],[-.04,-.21],[-.05,-.17],[-.03,-.03]],.07),frame,0,0,0,K));
  for(let i=0;i<4;i++)g.add(box(.072,.006,.06,steel,0,-.07-i*.035,.01-i*.003,K));
  g.add(box(.08,.02,.08,goldDark,0,-.215,.0,K));
  // trigger
  g.add(box(.012,.04,.012,steel,0,-.045,-.065,K));
  // sights: glowing red night sights
  g.add(box(.05,.02,.02,frame,0,.082,.0,K));g.add(box(.012,.024,.014,red,-.017,.088,.0,K));g.add(box(.012,.024,.014,red,.017,.088,.0,K));
  g.add(box(.016,.026,.016,red,0,.084,-.29,K));
  g.add(marker("WALK_GLOCK_GRIP",0,-.12,.01),marker("WALK_GLOCK_REAR_SIGHT",0,.098,.0),marker("WALK_GLOCK_FRONT_SIGHT",0,.098,-.29));
  g.add(muzzle("WALK_GLOCK_MUZZLE_NODE",-.40,.04));
  mergeByMaterial(g);g.scale.setScalar(1.35);g.position.set(.0,-.02,-.05);
  return g;
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
