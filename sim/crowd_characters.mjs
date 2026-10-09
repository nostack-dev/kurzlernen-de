import * as THREE from "three";
import {buildCharacter,animateCharacter,saveRigState,loadRigState} from "./character_model.mjs";

// Instanced renderer for crowds (pedestrians, passers-by, zombies): every
// person is the same articulated character as the players — hips, knees,
// shoulders, elbows, head — posed by the same animation code, but drawn with
// one InstancedMesh per body part for the whole crowd (≈20 draw calls for
// any number of people). Each person keeps its own joint state; a single
// template rig is posed per person and its part matrices are copied into the
// instances. Colours are per person (shirt, trousers, skin, hair, shoes).

export const CROWD_CHARACTERS_VERSION="instanced-articulated-crowd-v2-packed";
// three bands: < NEAR_M full figure, NEAR_M..FAR_M the same jointed figure with
// coarser capsules/spheres (~40 % of the triangles, same animation), > FAR_M one block
const ZERO=new THREE.Matrix4().makeScale(0,0,0),col=new THREE.Color(),FAR_M=95,NEAR_M=18,MID_DETAIL=.5;

export function createCrowd(scene,{capacity=64,outfit="civilian",name="CROWD"}={}){
  const tpl=buildCharacter({outfit});tpl.root.updateMatrixWorld(true);
  const parts=[];tpl.root.traverse(n=>{if(n.isMesh)parts.push(n);});
  const group=new THREE.Group();group.name=`${name}_CHARACTERS`;group.userData.flightFireIgnore=true;group.userData.crowdInstanced=true;
  const base=parts.map(p=>p.material.color.getHex());
  const tplMid=buildCharacter({outfit,detail:MID_DETAIL}),partsMid=[];tplMid.root.traverse(n=>{if(n.isMesh)partsMid.push(n);});
  const makeMeshes=(src,suffix)=>src.map((p,idx)=>{const m=new THREE.InstancedMesh(p.geometry,new THREE.MeshStandardMaterial({color:0xffffff,roughness:p.material.roughness??.8,metalness:p.material.metalness??0}),capacity);
    m.name=`${name}_${p.userData.cat}${suffix}`;m.userData.cat=p.userData.cat;m.userData.flightFireIgnore=true;m.castShadow=true;m.receiveShadow=false;m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.raycast=()=>{};
    for(let i=0;i<capacity;i++){m.setMatrixAt(i,ZERO);m.setColorAt(i,col.set(p.material.color));}m.instanceColor.setUsage(THREE.DynamicDrawUsage);m.count=0;group.add(m);return m;});
  const meshes=makeMeshes(parts,""),meshesMid=partsMid.length===parts.length?makeMeshes(partsMid,"_MID"):null;
  // Far people (beyond FAR_M from the camera) are drawn as one simple body
  // block each (one draw call for all) — they keep walking exactly as before
  // (positions still come from their own simulation every frame), only the
  // joint animation and the 24-part body are skipped where they are a few pixels.
  const farGeo=new THREE.BoxGeometry(.42,.26,1.72);farGeo.translate(0,0,.86);
  const far=new THREE.InstancedMesh(farGeo,new THREE.MeshStandardMaterial({color:0xffffff,roughness:.85}),capacity);far.name=`${name}_FAR`;far.userData.flightFireIgnore=true;far.castShadow=true;far.frustumCulled=false;far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);far.raycast=()=>{};
  for(let i=0;i<capacity;i++){far.setMatrixAt(i,ZERO);far.setColorAt(i,col.set(0x777777));}far.instanceColor.setUsage(THREE.DynamicDrawUsage);far.count=0;group.add(far);
  const farOwner=new Int32Array(capacity).fill(-1);let farCursor=0,farColorDirty=false;const fq=new THREE.Quaternion(),fp=new THREE.Vector3(),fs=new THREE.Vector3(1,1,1),fm=new THREE.Matrix4(),Z=new THREE.Vector3(0,0,1);
  scene.add(group);
  // Only people actually shown are drawn: every frame the visible ones are
  // packed into the first instances (draw count = visible people), so
  // capacity costs nothing on the GPU. Each person keeps its own joints and
  // colours; a slot gets the person's colours when the owner changes.
  const people=Array.from({length:capacity},()=>({joints:[],colors:null}));
  const slotOwner=new Int32Array(capacity).fill(-1),midOwner=new Int32Array(capacity).fill(-1);let cursor=0,midCursor=0,colorDirty=false,midColorDirty=false;
  const crowd={group,capacity,meshes,tpl,
    // colors: {shirt,vest,pants,boots,skin,gloves,helmet(hair),dark}
    setColors(i,colors){const p=people[i];if(!p)return;p.colors=colors;for(let s=0;s<capacity;s++){if(slotOwner[s]===i)slotOwner[s]=-1;if(midOwner[s]===i)midOwner[s]=-1;if(farOwner[s]===i)farOwner[s]=-1;}},
    hide(){},
    // pose & place one person this frame: x,y,z (feet on the ground), yaw,
    // state/speed/weapon like animateCharacter
    set(i,{x,y,z,yaw=0,state="walk",speed=1.3,weapon="none",dt=1/60,lean=0,punch=0}){const p=people[i];if(!p)return;
      const cam=globalThis.__arondightRealWorld?.threeCamera?.position;
      if(cam&&(x-cam.x)**2+(y-cam.y)**2+(z-cam.z)**2>FAR_M*FAR_M){if(farCursor>=capacity)return;const slot=farCursor++;fq.setFromAxisAngle(Z,yaw);fm.compose(fp.set(x,y,z),fq,fs);far.setMatrixAt(slot,fm);
        if(farOwner[slot]!==i){farOwner[slot]=i;far.setColorAt(slot,col.set(p.colors?.shirt??0x777777));farColorDirty=true;}return;}
      const mid=meshesMid&&cam&&(x-cam.x)**2+(y-cam.y)**2+(z-cam.z)**2>NEAR_M*NEAR_M,set=mid?meshesMid:meshes,owner=mid?midOwner:slotOwner;
      if((mid?midCursor:cursor)>=capacity)return;const slot=mid?midCursor++:cursor++;
      loadRigState(tpl,p.joints);animateCharacter(tpl,{state,speed,weapon,dt,punch});saveRigState(tpl,p.joints);
      tpl.root.position.set(x,y,z);tpl.root.rotation.set(lean,0,yaw);tpl.root.updateMatrixWorld(true);
      for(let k=0;k<parts.length;k++)set[k].setMatrixAt(slot,parts[k].visible&&visibleChain(parts[k])?parts[k].matrixWorld:ZERO);
      if(owner[slot]!==i){owner[slot]=i;const c=p.colors;for(let k=0;k<set.length;k++){const v=c?.[set[k].userData.cat];set[k].setColorAt(slot,col.set(v??base[k]));}if(mid)midColorDirty=true;else colorDirty=true;}},
    commit(){/* an empty instanced mesh still costs a full draw setup (program, uniforms) per part per pass: hide it */for(const m of meshes){m.count=cursor;m.visible=cursor>0;if(cursor)m.instanceMatrix.needsUpdate=true;if(colorDirty&&m.instanceColor)m.instanceColor.needsUpdate=true;}colorDirty=false;cursor=0;
      if(meshesMid){for(const m of meshesMid){m.count=midCursor;m.visible=midCursor>0;if(midCursor)m.instanceMatrix.needsUpdate=true;if(midColorDirty&&m.instanceColor)m.instanceColor.needsUpdate=true;}}midColorDirty=false;midCursor=0;far.count=farCursor;far.visible=farCursor>0;if(farCursor)far.instanceMatrix.needsUpdate=true;if(farColorDirty)far.instanceColor.needsUpdate=true;farColorDirty=false;farCursor=0;},
    dispose(){group.parent?.remove(group);for(const m of[...meshes,...(meshesMid||[])]){m.material.dispose();m.dispose?.();}},
  };
  return crowd;
}
function visibleChain(n){for(let x=n;x;x=x.parent)if(x.visible===false)return false;return true;}

// civilian palettes
const SHIRTS=[0x5a6f86,0x8a4b3e,0x4f6f4a,0xa08348,0x5e4f7a,0x7a5a3a,0x3e6d6a,0x8f8f8a,0x2f3b4a,0xa35f50];
const PANTS=[0x2c3138,0x3a3f45,0x3f3832,0x283646,0x4a4a46,0x1f2226];
const SKINS=[0xe0b08c,0xc48e6c,0xa87052,0x7b4a33,0xd2a27e,0xb88466];
const HAIR=[0x2a211b,0x1a1614,0x4a3324,0x6b5a3e,0x8a8278,0x3b2a1e];
export function civilianColors(seed){const h=Math.abs(Math.floor(seed))>>>0,shirt=SHIRTS[h%SHIRTS.length],jacket=(h>>>3)%3===0?0x2b2e33:shirt;
  return{shirt,vest:jacket,pants:PANTS[(h>>>5)%PANTS.length],boots:(h>>>7)%2?0x1e1c1a:0x5a4a3a,skin:SKINS[(h>>>9)%SKINS.length],gloves:SKINS[(h>>>9)%SKINS.length],helmet:HAIR[(h>>>11)%HAIR.length],dark:0x16181a};}
