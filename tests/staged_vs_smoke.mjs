import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {LanVsFinder} from "../sim/lan_vs.mjs";
import {integrateProjectile,traceProjectileWorldSegment,createProjectileHit,PROJECTILE_GRAVITY_MPS2} from "../sim/projectile_ballistics.mjs";

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const opened=[];
function harness(name,{connect=false,fail=false}={}){
  return async()=>({
    joinRoom(config,roomId,callbacks={}){
      opened.push({name,roomId,config});
      const room={id:`${name}-${roomId}`,onPeerJoin:null,onPeerLeave:null,makeAction(){return{onMessage:null,send:async()=>{}};},getSelfId(){return`${name}-self`;},getAuthorityId(){return`${name}-self`;},getPeers:()=>({}),ping:async()=>1,leave(){}};
      if(fail)queueMicrotask(()=>callbacks.onJoinError?.({peerId:"x",error:new Error(`${name} failed`)}));
      if(connect)queueMicrotask(()=>room.onPeerJoin?.("peer-ok"));
      return room;
    },getRelaySockets:()=>({})
  });
}

const source=readFileSync(new URL("../sim/lan_vs.mjs",import.meta.url),"utf8");
assert.ok(source.indexOf('{name:"DirectP2PUDP"')<source.indexOf('{name:"Nostr"'),"direct P2P UDP must be the first transport for every browser");
assert.ok(source.indexOf('{name:"Nostr"')<source.indexOf('{name:"Broker"'),"direct Trystero Nostr must remain the first fallback");
const safariUa="Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const chromeUa="Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
for(const [name,userAgent] of [["Safari",safariUa],["Chrome Android",chromeUa]]){
  const finder=new LanVsFinder({userAgent});
  assert.equal(finder.transportStrategies[0].name,"DirectP2PUDP",`${name} must enter the same direct UDP gameplay path first`);
  assert.equal(finder.transportMode,"direct-p2p-udp-mesh-first",`${name} must advertise the multi-peer UDP mesh transport mode`);
}
for(const marker of ["peerIds=new Set()","sendGame(packet","sendFx(packet","VS_PEER_EVENT","VS_POSE_EVENT","VS_GAME_EVENT","VS_FX_EVENT","getAuthorityId()"])
  assert.ok(source.includes(marker),`multi-peer session contract missing: ${marker}`);

const udpSource=readFileSync(new URL("../sim/direct_udp_peer.mjs",import.meta.url),"utf8");
for(const marker of [
  'createDataChannel("pose",{negotiated:true,id:0,ordered:false,maxRetransmits:0})',
  'createDataChannel("control",{negotiated:true,id:1,ordered:true})',
  'packet.a==="__ready"',
  'packet.a==="__ready-ack"',
  'this.localChannelsReady||!this.remoteReady||!this.remoteAcked',
  'kind:"restart-needed"',
  'iceRestart:true',
  'POSE_BUFFER_LIMIT_BYTES',
  'pose-drop-backpressure',
  'pc.__a45HostAuthority=this.isHost',
  'pc.__a45Transport="direct-p2p-udp"'
])assert.ok(udpSource.includes(marker),`direct P2P UDP engine contract missing: ${marker}`);
const signalSource=readFileSync(new URL("../sim/nostr_data_relay.mjs",import.meta.url),"utf8");
for(const marker of ['verifyEvent(event)','kind==="probe"','kind==="probe-ack"','probe.pubkey!==packet._pubkey','this.peers=new Map()','MAX_PEERS=8','getAuthorityId()','readyPeerIds()'])assert.ok(signalSource.includes(marker),`signed multi-peer signaling contract missing: ${marker}`);
assert.equal(signalSource.includes('kind:"sealed"'),false,"Nostr signaling must never carry gameplay payloads");

let connected="";
const finder=new LanVsFinder({stageMs:250,maxRoomsPerStage:3,transportStrategies:[{name:"DirectP2PUDP",load:harness("DirectP2PUDP",{fail:true})},{name:"Nostr",load:harness("Nostr",{connect:true})},{name:"Broker",load:harness("Broker")},{name:"MQTT",load:harness("MQTT")},{name:"Torrent",load:harness("Torrent")}],onPeer:(_peer,_room,transport)=>connected=transport});
await finder.start(["net-exact","net-secondary","net-third","tap-current","tap-previous","net-extra"]);
await sleep(400);
assert.equal(connected,"Nostr","direct Trystero Nostr must take over when the primary UDP engine cannot connect");
assert.ok(opened.length<=6,`staged finder opened too many sessions before fallback connection: ${opened.length}`);
const firstStage=opened.filter(x=>x.name==="DirectP2PUDP");
assert.equal(firstStage.length,3,"mobile stage must cap simultaneous direct UDP rooms at three");
assert.deepEqual(firstStage.map(x=>x.roomId),["net-exact","net-secondary","net-third"],"stable same-network/proximity rooms must be attempted before transient gesture rooms");
for(const item of opened.filter(x=>!["Broker","DirectP2PUDP"].includes(x.name))){
  assert.equal(item.config.trickleIce,true,`${item.name} must force trickle ICE`);
  assert.equal(item.config.rtcConfig?.iceTransportPolicy,"all",`${item.name} must explicitly keep direct ICE paths enabled`);
  assert.ok(Array.isArray(item.config.rtcConfig?.iceServers)&&item.config.rtcConfig.iceServers.length>=2,`${item.name} must explicitly carry STUN config`);
}
for(const item of opened.filter(x=>["Broker","DirectP2PUDP"].includes(x.name)))assert.equal(item.config.rtcConfig,undefined,`${item.name} owns its own networking setup and must not receive the Trystero RTC config`);
finder.stop();

const position={x:0,y:0,z:10},velocity={x:20,y:0,z:0},nextPosition={x:0,y:0,z:0},nextVelocity={x:0,y:0,z:0};
integrateProjectile(position,velocity,1,nextPosition,nextVelocity);
assert.ok(Math.abs(nextPosition.x-20)<1e-9&&Math.abs(nextPosition.z-(10-PROJECTILE_GRAVITY_MPS2*.5))<1e-9,"projectile time-of-flight integration must include gravity drop");
assert.ok(Math.abs(nextVelocity.z+PROJECTILE_GRAVITY_MPS2)<1e-9,"projectile vertical velocity must accumulate gravity");
const snapshot={prisms:[{buildingKey:"wall",base:0,top:10,points:[[4,-1],[6,-1],[6,1],[4,1]]}]},hit=createProjectileHit();
const wall=traceProjectileWorldSegment(snapshot,{x:0,y:0,z:5},{x:10,y:0,z:5},hit);assert.ok(wall&&wall.kind==="building"&&Math.abs(wall.point.x-4)<1e-9&&wall.normal.x<-.99,"projectile segment must physically stop on a building wall");
const roof=traceProjectileWorldSegment(snapshot,{x:5,y:0,z:20},{x:5,y:0,z:0},hit);assert.ok(roof&&roof.kind==="building"&&Math.abs(roof.point.z-10)<1e-9&&roof.normal.z>.99,"projectile segment must physically stop on a roof");
const ground=traceProjectileWorldSegment({prisms:[]},{x:0,y:0,z:2},{x:0,y:0,z:-2},hit);assert.ok(ground&&ground.kind==="ground"&&Math.abs(ground.point.z)<1e-9,"projectile segment must physically stop on the ground");
const miss=traceProjectileWorldSegment(snapshot,{x:0,y:3,z:5},{x:10,y:3,z:5},hit);assert.equal(miss,null,"projectile collision must not invent hits outside the footprint");

const fireSource=readFileSync(new URL("../sim/flight_fire_fx.mjs",import.meta.url),"utf8");
for(const marker of ["PROJECTILE_POOL_SIZE=36","TRACER_SPEED_MPS=210","PROJECTILE_TTL_MS=1800","VS_COMBAT_VISUAL_SCALE=12","VS_HITBOX_PADDING=1.16","FIRE_CANDIDATE_REFRESH_MS=120","vsCombatHitbox=true","vsPeerHitboxM","traceProjectileWorldSegment","flightFireTracer","vsPeerHitProxy"])
  assert.ok(fireSource.includes(marker),`physical VS projectile/readability contract missing: ${marker}`);
assert.equal(fireSource.includes('viewport.dataset.vsPeerHitboxScale="1"'),false,"visible 12x enemy must never regress to a hidden 1x hitbox");
assert.equal(fireSource.includes("worldBridge?.registerVsHit?.(hit)"),false,"legacy instant hitscan damage path must not return");
assert.ok(fireSource.includes("integrateProjectile(projectile.position,projectile.velocity,dt,projectile.nextPosition,projectile.nextVelocity);if(resolveProjectileHit(projectile,projectile.position,projectile.nextPosition,now))continue;"),"projectile time-of-flight must advance before segment collision resolution");assert.ok(fireSource.includes("registerVsHit?.(sceneHit)"),"VS damage must be emitted only from resolved projectile impact");
const presentationSource=readFileSync(new URL("../sim/vs_combat_presentation.mjs",import.meta.url),"utf8");
for(const marker of ["RESPAWN_RADIUS_MIN_M=12","RESPAWN_RADIUS_MAX_M=30","RESET SIM TO RESPAWN NEARBY","WAITING FOR RESET","vsRespawnLocalOffset","vsManualRespawns","MOBILE_WORLD_COLLISION_SYNC_MS=1400"])
  assert.ok(presentationSource.includes(marker),`VS death/respawn/performance contract missing: ${marker}`);
const multiplayerSource=readFileSync(new URL("../sim/vs_multiplayer.mjs",import.meta.url),"utf8");
for(const marker of ["MAX_PLAYERS=9","PALETTE=[","vsPlayerId","hit-request","authorityHit","MATES ${peers.size} ✓","flightFireTracer","sendFx(packet)"])
  assert.ok(multiplayerSource.includes(marker),`multiplayer gameplay/FX contract missing: ${marker}`);
const populationSource=readFileSync(new URL("../sim/world_population.mjs",import.meta.url),"utf8");
for(const marker of ["CAR_COUNT","PERSON_COUNT","worldPopulationId","registerWorldPopulationHit","CAR_RESPAWN_MS","PERSON_RESPAWN_MS","kind:\"car\"","kind:\"person\""])
  assert.ok(populationSource.includes(marker),`WORLD traffic/population contract missing: ${marker}`);
const buildingSource=readFileSync(new URL("../sim/world_building_collision_physics.mjs",import.meta.url),"utf8");
assert.equal(buildingSource.includes("skipWholeBuilding"),false,"WORLD launch must never delete the building collider it started inside");assert.ok(buildingSource.includes("pointHasLaunchClearance(candidate,active,clearance)"),"WORLD launch must search for a truly clear footprint location");

await import("./multiplayer_mesh_smoke.mjs");
console.log("Staged VS smoke passed: direct P2P UDP mesh, unique players, replicated fire/explosions, 3+ peers, hardened WORLD spawn and lightweight road traffic retained.");