import * as THREE from "three";

function material(color,roughness=.72){return new THREE.MeshStandardMaterial({color,roughness,metalness:.04});}
function box(name,size,mat,position){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);mesh.name=name;mesh.position.set(...position);mesh.castShadow=false;mesh.receiveShadow=false;mesh.userData.flightFireIgnore=false;return mesh;}

export function createPlayerHumanRig({id="player",color=0x29d6ff}={}){
  const shirt=material(color,.62),pants=material(0x26313a,.9),skin=material(0xc5906d,.86),dark=material(0x171d22,.7),group=new THREE.Group();
  group.name=`PLAYER_HUMAN_${id}`;group.userData.playerHumanRig=true;group.userData.vsHumanAvatar=true;group.userData.vsPlayerId=String(id);
  const pelvis=box("VS_HUMAN_PELVIS",[.36,.25,.24],pants,[0,0,.83]),torso=box("VS_HUMAN_TORSO",[.48,.28,.62],shirt,[0,0,1.18]),head=new THREE.Mesh(new THREE.SphereGeometry(.17,8,6),skin);head.name="VS_HUMAN_HEAD";head.position.set(0,0,1.66);group.add(pelvis,torso,head);
  const leftLeg=new THREE.Group(),rightLeg=new THREE.Group();leftLeg.name="VS_HUMAN_LEG_L";rightLeg.name="VS_HUMAN_LEG_R";leftLeg.position.set(-.12,0,.72);rightLeg.position.set(.12,0,.72);leftLeg.add(box("VS_HUMAN_SHIN_L",[.16,.18,.68],pants,[0,0,-.34]));rightLeg.add(box("VS_HUMAN_SHIN_R",[.16,.18,.68],pants,[0,0,-.34]));group.add(leftLeg,rightLeg);
  const leftArm=new THREE.Group(),rightArm=new THREE.Group();leftArm.name="VS_HUMAN_ARM_L";rightArm.name="VS_HUMAN_ARM_R";leftArm.position.set(-.31,0,1.42);rightArm.position.set(.31,0,1.42);leftArm.add(box("VS_HUMAN_FOREARM_L",[.13,.14,.58],shirt,[0,0,-.27]));rightArm.add(box("VS_HUMAN_FOREARM_R",[.13,.14,.58],shirt,[0,0,-.27]));group.add(leftArm,rightArm);
  const aimRig=new THREE.Group();aimRig.name="VS_HUMAN_AIM_RIG";aimRig.position.set(0,.10,1.31);const pistol=box("VS_HUMAN_PISTOL",[.10,.34,.12],dark,[.18,.22,0]),smg=box("VS_HUMAN_SMG",[.13,.68,.15],dark,[.12,.38,0]);pistol.userData.vsWeapon=true;smg.userData.vsWeapon=true;aimRig.add(pistol,smg);group.add(aimRig);
  const hitMat=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,depthTest:false});hitMat.colorWrite=false;const hitbox=new THREE.Mesh(new THREE.BoxGeometry(.62,.54,1.78),hitMat);hitbox.name="VS_HUMAN_HITBOX";hitbox.position.z=.89;hitbox.userData.vsCombatHitbox=true;hitbox.userData.vsPlayerId=String(id);hitbox.userData.vsPeerHitProxy=true;hitbox.userData.vsHumanHitbox=true;group.add(hitbox);group.visible=false;
  return{group,leftLeg,rightLeg,leftArm,rightArm,aimRig,pistol,smg,hitbox};
}

export function setPlayerHumanFootParent(rig,scene){if(!rig?.group||!scene)return false;if(rig.group.parent!==scene)scene.add(rig.group);rig.group.scale.setScalar(1);rig.leftLeg.rotation.set(0,0,0);rig.rightLeg.rotation.set(0,0,0);rig.leftArm.rotation.set(0,0,0);rig.rightArm.rotation.set(0,0,0);rig.aimRig.visible=true;rig.hitbox.visible=true;rig.group.userData.playerVehicleOccupant=false;return true;}
export function setPlayerHumanVehiclePose(rig,vehicleRoot,{driverSide=-1}={}){if(!rig?.group||!vehicleRoot)return false;if(rig.group.parent!==vehicleRoot)vehicleRoot.add(rig.group);rig.group.position.set(.02,.30*driverSide,.19);rig.group.rotation.set(0,0,-Math.PI/2);rig.group.scale.setScalar(.82);rig.leftLeg.rotation.set(-1.24,0,0);rig.rightLeg.rotation.set(-1.24,0,0);rig.leftArm.rotation.set(-1.12,0,.18);rig.rightArm.rotation.set(-1.12,0,-.18);rig.aimRig.visible=false;rig.pistol.visible=false;rig.smg.visible=false;rig.hitbox.visible=false;rig.group.visible=true;rig.group.userData.playerVehicleOccupant=true;return true;}
export function hidePlayerHumanRig(rig){if(!rig?.group)return false;rig.group.visible=false;rig.hitbox.visible=false;return true;}
