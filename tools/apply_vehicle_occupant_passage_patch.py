from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    assert old in s, f"missing marker in {path}: {old[:120]!r}"
    assert new not in s, f"replacement already present in {path}"
    p.write_text(s.replace(old, new, 1))


rig = Path("sim/player_human_rig.mjs")
assert not rig.exists(), "shared player human rig already exists"
rig.write_text(r'''import * as THREE from "three";

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
''')

replace_once(
    "sim/player_car_mode.mjs",
    'import * as THREE from "three";\n',
    'import * as THREE from "three";\nimport {createPlayerHumanRig,hidePlayerHumanRig,setPlayerHumanVehiclePose} from "./player_human_rig.mjs";\n',
)
replace_once(
    "sim/player_car_mode.mjs",
    'let installed=false,active=false,vehicle=null,heading=0,commandSpeed=0,lastFrame=performance.now(),cameraInstalled=false,baseCameraProvider=null;',
    'let installed=false,active=false,vehicle=null,heading=0,commandSpeed=0,lastFrame=performance.now(),cameraInstalled=false,baseCameraProvider=null;\nlet localDriverRig=null;',
)
replace_once(
    "sim/player_car_mode.mjs",
    'function setDrivingUi(value){document.body.classList.toggle("player-driving",value);const modeButton=document.getElementById("playerModeButton");if(modeButton){modeButton.disabled=value;modeButton.style.opacity=value?".45":"";}const view=viewport();if(view){view.dataset.playerDriveMode=value?"vehicle":"off";view.dataset.playerControlMode=value?"vehicle":(walk()?.mode||"drone");}}',
    '''function setDrivingUi(value){document.body.classList.toggle("player-driving",value);const modeButton=document.getElementById("playerModeButton");if(modeButton){modeButton.disabled=value;modeButton.style.opacity=value?".45":"";}const view=viewport();if(view){view.dataset.playerDriveMode=value?"vehicle":"off";view.dataset.playerControlMode=value?"vehicle":(walk()?.mode||"drone");view.dataset.playerBodyState=value?"vehicle-seated":"foot";}}
function showLocalDriver(root){if(!root)return false;if(!localDriverRig)localDriverRig=createPlayerHumanRig({id:"local-player",color:0x29d6ff});const ok=setPlayerHumanVehiclePose(localDriverRig,root,{driverSide:-1});if(ok){localDriverRig.group.userData.localPlayerVehicleDriver=true;const view=viewport();if(view)view.dataset.vehicleLocalOccupant="full-human-seated-v1";}return ok;}
function hideLocalDriver(){if(localDriverRig)hidePlayerHumanRig(localDriverRig);const view=viewport();if(view)view.dataset.vehicleLocalOccupant="hidden-on-foot-v1";}''',
)
replace_once(
    "sim/player_car_mode.mjs",
    'clearFootKeys();resetPads();suppressFootGamepad(true);setDrivingUi(true);active=true;window.dispatchEvent(new CustomEvent("arondight:vehicle-mode",{detail:{active:true,id:vehicle.id,owner:DRIVE_OWNER}}));return true;',
    'clearFootKeys();resetPads();suppressFootGamepad(true);active=true;showLocalDriver(vehicle.root);setDrivingUi(true);window.dispatchEvent(new CustomEvent("arondight:vehicle-mode",{detail:{active:true,id:vehicle.id,owner:DRIVE_OWNER,occupant:"player-human"}}));return true;',
)
replace_once(
    "sim/player_car_mode.mjs",
    'if(!active)return false;const pose=vehiclePose(),id=vehicle?.id,root=vehicle?.root;if(pose?.position){',
    'if(!active)return false;const pose=vehiclePose(),id=vehicle?.id,root=vehicle?.root;hideLocalDriver();if(pose?.position){',
)
replace_once(
    "sim/player_car_mode.mjs",
    'view.dataset.vehicleDriveController="keyboard+multitouch+xbox-v4";view.dataset.vehicleDriveHeadingSource="box3d-body-yaw-v1";view.dataset.vehicleDriveSteeringPhysics="box3d-bicycle-yaw-rate-v1";view.dataset.vehicleDriveBodyYaw=bodyYaw.toFixed(4);',
    'view.dataset.vehicleDriveController="keyboard+multitouch+xbox-v4";view.dataset.vehicleDriveHeadingSource="box3d-body-yaw-v1";view.dataset.vehicleDriveSteeringPhysics="box3d-bicycle-yaw-rate-v1";view.dataset.vehicleDriveBodyYaw=bodyYaw.toFixed(4);view.dataset.vehicleDriveTraversal="free-world-box3d-collision-only-v1";',
)

replace_once(
    "sim/first_person_weapon_runtime_v3.mjs",
    'setWeaponModeVisual(gun,mode);if(!isFoot()){screenAimActive=false;releaseAimPivot("mode-inactive");document.body.classList.remove("foot-ads-active");gun.scale.setScalar(1);setAimCleanup(gun,false,mode);}',
    'setWeaponModeVisual(gun,mode);const footActive=isFoot();gun.visible=footActive;if(!footActive){screenAimActive=false;releaseAimPivot("mode-inactive");document.body.classList.remove("foot-ads-active");gun.scale.setScalar(1);setAimCleanup(gun,false,mode);}',
)
replace_once(
    "sim/first_person_weapon_runtime_v3.mjs",
    'view.dataset.walkWeaponRuntime="dedicated-pistol+mp+hip-grip-latched-aim-v13";',
    'view.dataset.walkWeaponRuntime="dedicated-pistol+mp+hip-grip-latched-aim-v14";view.dataset.walkViewmodelVehiclePolicy="hidden-while-driving-v1";',
)
replace_once(
    "sim/first_person_weapon_runtime_v3.mjs",
    'addEventListener("arondight:player-mode",()=>{if(!isFoot())screenAimActive=false;releaseAimPivot("player-mode");hasPresentationSnapshot=false;document.body.classList.remove("foot-ads-active");});',
    'addEventListener("arondight:player-mode",()=>{if(!isFoot())screenAimActive=false;releaseAimPivot("player-mode");hasPresentationSnapshot=false;document.body.classList.remove("foot-ads-active");});addEventListener("arondight:vehicle-mode",event=>{if(event?.detail?.active){const gun=bridge()?.threeScene?.getObjectByName?.("WALK_PISTOL_3D");if(gun)gun.visible=false;screenAimActive=false;releaseAimPivot("vehicle-enter");document.body.classList.remove("foot-ads-active");}});',
)

p = Path("sim/vs_player_state_replication.mjs")
s = p.read_text()
assert 'player_human_rig.mjs' not in s
s = s.replace('import * as THREE from "three";\n', 'import * as THREE from "three";\nimport {createPlayerHumanRig,setPlayerHumanFootParent,setPlayerHumanVehiclePose} from "./player_human_rig.mjs";\n', 1)
start = s.index('function bodyMaterial(')
end = s.index('function recordFor(id)')
s = s[:start] + 'function createAvatar(id){const scene=bridge()?.threeScene;if(!scene)return null;const rig=createPlayerHumanRig({id,color:colorFor(id)});rig.group.userData.vsMultiplayerHuman=true;scene.add(rig.group);return rig;}\n' + s[end:]
s = s.replace('record={id,mode:"drone",timeline:new VsPoseTimeline(),lastPoseMs:-Infinity,ph:null,dead:false,avatar:createAvatar(id)};', 'record={id,mode:"drone",vehicleId:"",timeline:new VsPoseTimeline(),lastPoseMs:-Infinity,ph:null,dead:false,avatar:createAvatar(id)};', 1)
s = s.replace('record.ph=pose.ph&&typeof pose.ph==="object"?{...pose.ph}:null;', 'record.ph=pose.ph&&typeof pose.ph==="object"?{...pose.ph}:null;record.vehicleId=String(pose.pv?.id||pose.cv?.id||record.vehicleId||"");', 1)
s = s.replace('const ph=record.ph||{},yaw=Number(ph.yaw)||0,pitch=clamp(Number(ph.pitch)||0,-1.48,1.48),speed=Math.max(0,Number(ph.speed)||0),moving=Boolean(ph.moving)||speed>.12,dead=Boolean(record.dead||ph.dead);avatar.group.position.set(...sample.p);', 'const ph=record.ph||{},yaw=Number(ph.yaw)||0,pitch=clamp(Number(ph.pitch)||0,-1.48,1.48),speed=Math.max(0,Number(ph.speed)||0),moving=Boolean(ph.moving)||speed>.12,dead=Boolean(record.dead||ph.dead);setPlayerHumanFootParent(avatar,bridge()?.threeScene);avatar.group.position.set(...sample.p);', 1)
frame_marker = 'function frame(now=performance.now()){'
idx = s.index(frame_marker)
vehicle_funcs = '''function vehicleRootForRecord(record){const cached=record.vehicleRoot;if(cached?.parent&&(String(cached.userData?.worldPopulationId||cached.userData?.worldProceduralId||"")===record.vehicleId||String(cached.userData?.remotePlayerDriven||"")===record.id))return cached;const scene=bridge()?.threeScene;if(!scene)return null;let found=null;scene.traverse(node=>{if(found||!node?.children?.length)return;const id=String(node.userData?.worldPopulationId||node.userData?.worldProceduralId||"");if(record.vehicleId&&id===record.vehicleId){found=node;return;}if(String(node.userData?.remotePlayerDriven||"")===record.id)found=node;});record.vehicleRoot=found;return found;}
function renderVehicleHuman(record,now){const avatar=record.avatar;if(!avatar)return false;const fresh=now-record.lastPoseMs<=STALE_MS,root=fresh?vehicleRootForRecord(record):null;if(!root){avatar.group.visible=false;return false;}setPlayerHumanVehiclePose(avatar,root,{driverSide:-1});avatar.group.userData.vsRemotePlayerMode="vehicle";avatar.group.userData.vsRemoteVehicleId=record.vehicleId||String(root.userData?.worldPopulationId||"");hideLegacyPeer(record.id);return true;}
'''
s = s[:idx] + vehicle_funcs + s[idx:]
old = 'else{if(record.avatar)record.avatar.group.visible=false;if(record.mode==="vehicle"){vehicles++;hideLegacyPeer(record.id);}else drones++;}'
assert old in s
s = s.replace(old, 'else if(record.mode==="vehicle"){vehicles++;renderVehicleHuman(record,now);}else{if(record.avatar)record.avatar.group.visible=false;drones++;}', 1)
s = s.replace('drone+foot+vehicle+weapon+death-v2', 'drone+foot+vehicle-seated+weapon+death-v3')
p.write_text(s)

p = Path("tests/player_multiplayer_replication_contract_test.mjs")
s = p.read_text()
s = s.replace('const replication=readFileSync("sim/vs_player_state_replication.mjs","utf8");', 'const replication=readFileSync("sim/vs_player_state_replication.mjs","utf8"),humanRig=readFileSync("sim/player_human_rig.mjs","utf8"),car=readFileSync("sim/player_car_mode.mjs","utf8"),viewmodel=readFileSync("sim/first_person_weapon_runtime_v3.mjs","utf8"),population=readFileSync("sim/world_procedural_population.mjs","utf8");', 1)
s = s.replace('])assert.ok(replication.includes(marker),`missing full player replication marker: ${marker}`);', '])assert.ok((replication+humanRig).includes(marker),`missing full player replication marker: ${marker}`);', 1)
s = s.replace("'drone+foot+vehicle+weapon+death-v2'", "'drone+foot+vehicle-seated+weapon+death-v3'", 1)
anchor = 'assert.ok(network.includes(\'cm:"vehicle"\')&&network.includes(\'remotePlayerDriven\'),"authoritative remote vehicle replication is missing");'
assert anchor in s
extra = '''assert.ok(replication.includes('renderVehicleHuman(record,now)')&&replication.includes('setPlayerHumanVehiclePose(avatar,root'),"remote player is not seated in replicated vehicle");
assert.ok(car.includes('showLocalDriver(vehicle.root)')&&car.includes('free-world-box3d-collision-only-v1'),"local player occupant/free-world vehicle contract missing");
assert.ok(viewmodel.includes('gun.visible=footActive')&&viewmodel.includes('hidden-while-driving-v1'),"first-person arms/viewmodel remain visible while driving");
assert.ok(population.includes('const externallyDriven=Boolean(record.group.userData.playerDriven||record.group.userData.remotePlayerDriven)')&&population.includes('if(!externallyDriven)'),"player-driven cars are still constrained by AI road routing");
'''
s = s.replace(anchor, extra + anchor, 1)
p.write_text(s)

p = Path("tests/world_rigid_body_physics_box3d_test.mjs")
s = p.read_text()
marker = 'physics.removeBody("car-steer");\n\nphysics.addBody({id:"car-a"'
assert marker in s
passage = '''physics.removeBody("car-steer");

physics.syncBuildings({hash:"vehicle-passage",footprintCount:2,prisms:[{buildingKey:"passage-north",base:0,top:4,points:[[-2,1.3],[18,1.3],[18,4],[-2,4]]},{buildingKey:"passage-south",base:0,top:4,points:[[-2,-4],[18,-4],[18,-1.3],[-2,-1.3]]}]});
physics.addBody({id:"car-passage",kind:"car",position:[0,0,.42],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420});
physics.setTarget("car-passage",{position:[16,0,.42],yaw:0,speedMps:7,response:4,maxAccelerationMps2:8});
for(let index=0;index<180;index++)physics.step(1/60,4,6700+index*1000/60);
const passageCar=physics.pose("car-passage");
assert.ok(passageCar.position[0]>8,`car could not physically traverse a passable building corridor: ${JSON.stringify(passageCar)}`);
assert.ok(Math.abs(passageCar.position[1])<.7,`car was pushed out of the physical passage instead of traversing it: ${JSON.stringify(passageCar)}`);
physics.removeBody("car-passage");physics.syncBuildings({hash:"clear-after-passage",footprintCount:0,prisms:[]});

physics.addBody({id:"car-a"'''
s = s.replace(marker, passage, 1)
s = s.replace('tire grip, real rigid-body steering and impulse/gravity behavior', 'tire grip, real rigid-body steering, passable-corridor traversal and impulse/gravity behavior')
p.write_text(s)

print("vehicle occupant + free-world passage patch applied")
