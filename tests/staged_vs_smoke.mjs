import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {LanVsFinder} from "../sim/lan_vs.mjs";

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const opened=[];
function harness(name,{connect=false,fail=false}={}){
  return async()=>({joinRoom(config,roomId,callbacks={}){opened.push({name,roomId,config});const room={id:`${name}-${roomId}`,onPeerJoin:null,onPeerLeave:null,makeAction(){return{onMessage:null,send:async()=>{}};},getSelfId(){return`${name}-self`;},getAuthorityId(){return`${name}-self`;},getPeers:()=>({}),ping:async()=>1,leave(){}};if(fail)queueMicrotask(()=>callbacks.onJoinError?.({peerId:"x",error:new Error(`${name} failed`)}));if(connect)queueMicrotask(()=>room.onPeerJoin?.("peer-ok"));return room;},getRelaySockets:()=>({})});
}

const source=readFileSync(new URL("../sim/lan_vs.mjs",import.meta.url),"utf8");
assert.ok(source.indexOf('{name:"DirectP2PUDP"')<source.indexOf('{name:"Nostr"'),"direct peer transport must stay first");
assert.ok(source.indexOf('{name:"Nostr"')<source.indexOf('{name:"Broker"'),"Nostr must remain the first fallback");
for(const [name,userAgent] of [["Safari","Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1"],["Chrome Android","Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36"]]){
  const finder=new LanVsFinder({userAgent});assert.equal(finder.transportStrategies[0].name,"DirectP2PUDP",`${name} must use the same primary peer path`);assert.equal(finder.transportMode,"direct-p2p-udp-mesh-first",`${name} transport mode drifted`);
}
for(const marker of ["peerIds=new Set()","sendGame(packet","sendFx(packet","VS_PEER_EVENT","VS_POSE_EVENT","VS_GAME_EVENT","VS_FX_EVENT","getAuthorityId()"])
  assert.ok(source.includes(marker),`multi-peer session contract missing: ${marker}`);

let connected="";
const finder=new LanVsFinder({stageMs:250,maxRoomsPerStage:3,transportStrategies:[{name:"DirectP2PUDP",load:harness("DirectP2PUDP",{fail:true})},{name:"Nostr",load:harness("Nostr",{connect:true})},{name:"Broker",load:harness("Broker")},{name:"MQTT",load:harness("MQTT")},{name:"Torrent",load:harness("Torrent")}],onPeer:(_peer,_room,transport)=>connected=transport});
await finder.start(["net-exact","net-secondary","net-third","tap-current","tap-previous","net-extra"]);await sleep(400);assert.equal(connected,"Nostr","fallback transport did not connect");assert.ok(opened.length<=6,`too many staged sessions: ${opened.length}`);finder.stop();

const fireSource=readFileSync(new URL("../sim/flight_fire_fx.mjs",import.meta.url),"utf8");
for(const marker of ["DECAL_POOL_SIZE=32","PROJECTILE_POOL_SIZE=64","__arondightBox3dCombat","box3d-isBullet-ccd-v1","combat-damage-vignette"])
  assert.ok(fireSource.includes(marker),`fire presentation contract missing: ${marker}`);

const physicsSource=readFileSync(new URL("../sim/box3d_combat_world.mjs",import.meta.url),"utf8");
for(const marker of ["BULLET_POOL=64","worldDef.enableContinuous=true","def.isBullet=true","b3Body_SetTargetTransform","type:\"physics-bullet\"","kind===\"vs-drone\"","VS_COMBAT_VISUAL_SCALE=7","VS_HITBOX_PADDING=1.16",".16*VS_COMBAT_VISUAL_SCALE*VS_HITBOX_PADDING",".22*VS_COMBAT_VISUAL_SCALE*VS_HITBOX_PADDING","registerTarget","registerVsHit(hit)"])
  assert.ok(physicsSource.includes(marker),`shared Box3D interaction contract missing: ${marker}`);

const vsSource=readFileSync(new URL("../sim/vs_multiplayer.mjs",import.meta.url),"utf8");
for(const marker of ["const VISUAL_SCALE=7","worldLifeKind=\"vs-drone\"","scaled-7x+hud-marker+emissive-v2","registerPhysicsPeer","applyCombatScale","vsCombatVisualScale"])
  assert.ok(vsSource.includes(marker),`7x peer readability contract missing: ${marker}`);
assert.equal(vsSource.includes("const VISUAL_SCALE=1"),false,"combat peers must not regress to hard-to-see physical scale");
assert.equal(vsSource.includes("vsPeerHitProxy"),false,"hidden Three hit proxies must not diverge from the Box3D hitbody");

const presentationSource=readFileSync(new URL("../sim/vs_combat_presentation.mjs",import.meta.url),"utf8");
for(const marker of ["RESPAWN_RADIUS_MIN_M=12","RESPAWN_RADIUS_MAX_M=30","RESET SIM TO RESPAWN NEARBY","WAITING FOR RESET","vsRespawnLocalOffset","vsManualRespawns","MOBILE_WORLD_COLLISION_SYNC_MS=1400"])
  assert.ok(presentationSource.includes(marker),`VS presentation contract missing: ${marker}`);
for(const marker of ["MAX_PLAYERS=9","PALETTE=[","hit-request","authorityHit","AUTHORITY_SETTLE_MS","confirmedHealth","MATES ${peers.size} ✓"])
  assert.ok(vsSource.includes(marker),`multiplayer state contract missing: ${marker}`);

const populationSource=readFileSync(new URL("../sim/world_population.mjs",import.meta.url),"utf8");
for(const marker of ["CAR_COUNT","PERSON_COUNT","worldPopulationId","registerWorldPopulationHit","CAR_RESPAWN_MS","PERSON_RESPAWN_MS"])
  assert.ok(populationSource.includes(marker),`WORLD population contract missing: ${marker}`);
const buildingSource=readFileSync(new URL("../sim/world_building_collision_physics.mjs",import.meta.url),"utf8");assert.equal(buildingSource.includes("skipWholeBuilding"),false,"WORLD launch must never delete its whole building collider");
const spawnGuardSource=readFileSync(new URL("../sim/world_spawn_guard.mjs",import.meta.url),"utf8");for(const marker of ["firstLoaded","buildingLaunchPointClear","queueMicrotask","soloReset","worldSpawnGuardResets"])assert.ok(spawnGuardSource.includes(marker),`WORLD spawn guard missing: ${marker}`);

await import("./multiplayer_mesh_smoke.mjs");
console.log("Staged VS smoke passed: 7x readable peer geometry, matching Box3D hitbodies, replicated physics bullets, authority migration and WORLD population retained.");