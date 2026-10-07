import * as THREE from "three";
import {buildCharacter,animateCharacter,saveRigState,loadRigState} from "./character_model.mjs";

// Instanced renderer for crowds (pedestrians, passers-by, zombies): every
// person is the same articulated character as the players — hips, knees,
// shoulders, elbows, head — posed by the same animation code, but drawn with
// one InstancedMesh per body part for the whole crowd (≈20 draw calls for
// any number of people). Each person keeps its own joint state; a single
// template rig is posed per person and its part matrices are copied into the
// instances. Colours are per person (shirt, trousers, skin, hair, shoes).

export const CROWD_CHARACTERS_VERSION="instanced-articulated-crowd-v1";
const ZERO=new THREE.Matrix4().makeScale(0,0,0),col=new THREE.Color();

export function createCrowd(scene,{capacity=64,outfit="civilian",name="CROWD"}={}){
  const tpl=buildCharacter({outfit});tpl.root.updateMatrixWorld(true);
  const parts=[];tpl.root.traverse(n=>{if(n.isMesh)parts.push(n);});
  const group=new THREE.Group();group.name=`${name}_CHARACTERS`;group.userData.flightFireIgnore=true;group.userData.crowdInstanced=true;
  const meshes=parts.map(p=>{const m=new THREE.InstancedMesh(p.geometry,new THREE.MeshStandardMaterial({color:0xffffff,roughness:p.material.roughness??.8,metalness:p.material.metalness??0}),capacity);
    m.name=`${name}_${p.userData.cat}`;m.userData.cat=p.userData.cat;m.userData.flightFireIgnore=true;m.castShadow=true;m.receiveShadow=false;m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.raycast=()=>{};
    for(let i=0;i<capacity;i++){m.setMatrixAt(i,ZERO);m.setColorAt(i,col.set(p.material.color));}m.count=capacity;group.add(m);return m;});
  scene.add(group);
  const people=Array.from({length:capacity},()=>({visible:false,joints:[],colors:null,dirty:true}));
  const crowd={group,capacity,meshes,tpl,
    // colors: {shirt,vest,pants,boots,skin,gloves,helmet(hair),dark}
    setColors(i,colors){const p=people[i];if(!p)return;p.colors=colors;for(const m of meshes){const c=colors[m.userData.cat];if(c!=null)m.setColorAt(i,col.set(c));}for(const m of meshes)if(m.instanceColor)m.instanceColor.needsUpdate=true;},
    hide(i){const p=people[i];if(!p||!p.visible)return;p.visible=false;for(const m of meshes)m.setMatrixAt(i,ZERO);p.dirty=true;},
    // pose & place one person: x,y,z (feet on the ground), yaw (facing +x of the world at yaw=0
    // is handled by the caller), state/speed/weapon like animateCharacter
    set(i,{x,y,z,yaw=0,state="walk",speed=1.3,weapon="none",dt=1/60,lean=0}){const p=people[i];if(!p)return;
      loadRigState(tpl,p.joints);animateCharacter(tpl,{state,speed,weapon,dt});saveRigState(tpl,p.joints);
      tpl.root.position.set(x,y,z);tpl.root.rotation.set(lean,0,yaw);tpl.root.updateMatrixWorld(true);
      for(let k=0;k<parts.length;k++)meshes[k].setMatrixAt(i,parts[k].visible&&visibleChain(parts[k])?parts[k].matrixWorld:ZERO);p.visible=true;p.dirty=true;},
    commit(){for(const m of meshes)m.instanceMatrix.needsUpdate=true;},
    dispose(){group.parent?.remove(group);for(const m of meshes){m.material.dispose();m.dispose?.();}},
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
