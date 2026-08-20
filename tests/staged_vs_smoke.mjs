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
      const room={onPeerJoin:null,onPeerLeave:null,makeAction(){return{onMessage:null,send:async()=>{}};},getPeers:()=>({}),ping:async()=>1,leave(){}};
      if(fail)queueMicrotask(()=>callbacks.onJoinError?.({peerId:"x",error:new Error(`${name} failed`)}));
      if(connect)queueMicrotask(()=>room.onPeerJoin?.("peer-ok"));
      return room;
    },getRelaySockets:()=>({})
  });
}

const source=readFileSync(new URL("../sim/lan_vs.mjs",import.meta.url),"utf8");
assert.ok(source.indexOf('{name:"Nostr"')<source.indexOf('{name:"NostrRelay"'),"direct Nostr must precede Nostr data relay in the default non-Safari order");
assert.ok(source.indexOf('{name:"NostrRelay"')<source.indexOf('{name:"MQTT"'),"Nostr data relay must precede MQTT/broker fallbacks in the default order");
const safariUa="Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const chromeUa="Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const safariFinder=new LanVsFinder({userAgent:safariUa});
assert.deepEqual(safariFinder.transportStrategies.map(item=>item.name).slice(0,3),["NostrRelay","Broker","Nostr"],"Safari must bypass WebRTC first and enter WebSocket relay matchmaking immediately");
assert.equal(safariFinder.transportMode,"safari-relay-first");
const chromeFinder=new LanVsFinder({userAgent:chromeUa});
assert.equal(chromeFinder.transportStrategies[0].name,"Nostr","non-Safari browsers must retain direct WebRTC-first matchmaking");
assert.equal(chromeFinder.transportMode,"direct-first");
const nostrRelaySource=readFileSync(new URL("../sim/nostr_data_relay.mjs",import.meta.url),"utf8");
assert.ok(nostrRelaySource.includes("function fastRelayTargets()"),"Safari relay pose path must compute redundant open relay targets");
assert.ok(nostrRelaySource.includes("const targets=fast?fastRelayTargets():RELAYS;"),"fast pose packets must fan out across open relays instead of one preferred relay");
assert.equal(nostrRelaySource.includes("fast&&this.preferredRelay?[this.preferredRelay]:RELAYS"),false,"single preferred-relay pose routing must not return");

let connected="";
const finder=new LanVsFinder({stageMs:250,maxRoomsPerStage:3,transportStrategies:[{name:"Nostr",load:harness("Nostr",{fail:true})},{name:"NostrRelay",load:harness("NostrRelay",{connect:true})},{name:"Torrent",load:harness("Torrent")},{name:"MQTT",load:harness("MQTT")},{name:"Broker",load:harness("Broker")}],onPeer:(_peer,_room,transport)=>connected=transport});
await finder.start(["net-exact","net-secondary","net-third","tap-current","tap-previous","net-extra"]);
await sleep(400);
assert.equal(connected,"NostrRelay","Nostr data relay must take over immediately after direct ICE fails");
assert.ok(opened.length<=6,`staged finder opened too many sessions before connection: ${opened.length}`);
const firstStage=opened.filter(x=>x.name==="Nostr");
assert.equal(firstStage.length,3,"mobile stage must cap simultaneous rooms at three");
assert.deepEqual(firstStage.map(x=>x.roomId),["net-exact","net-secondary","net-third"],"stable same-network/proximity rooms must be attempted before transient gesture rooms");
for(const item of opened.filter(x=>!["Broker","NostrRelay"].includes(x.name))){
  assert.equal(item.config.trickleIce,true,`${item.name} must force trickle ICE`);
  assert.equal(item.config.rtcConfig?.iceTransportPolicy,"all",`${item.name} must explicitly keep direct ICE paths enabled`);
  assert.ok(Array.isArray(item.config.rtcConfig?.iceServers)&&item.config.rtcConfig.iceServers.length>=2,`${item.name} must explicitly carry STUN config`);
}
for(const item of opened.filter(x=>["Broker","NostrRelay"].includes(x.name)))assert.equal(item.config.rtcConfig,undefined,`${item.name} must bypass WebRTC ICE entirely`);
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
for(const marker of ["PROJECTILE_POOL_SIZE=36","TRACER_SPEED_MPS=210","PROJECTILE_TTL_MS=1800","VS_COMBAT_VISUAL_SCALE=8","traceProjectileWorldSegment","flightFireTracer","vsPeerHitProxy","vsPeerHitboxScale=\"1\""])
  assert.ok(fireSource.includes(marker),`physical VS projectile/readability contract missing: ${marker}`);
assert.equal(fireSource.includes("worldBridge?.registerVsHit?.(hit)"),false,"legacy instant hitscan damage path must not return");
assert.ok(fireSource.includes("integrateProjectile(projectile.position,projectile.velocity,dt,projectile.nextPosition,projectile.nextVelocity);if(resolveProjectileHit(projectile,projectile.position,projectile.nextPosition,now))continue;"),"projectile time-of-flight must advance before segment collision resolution");assert.ok(fireSource.includes("registerVsHit?.(sceneHit)"),"VS damage must be emitted only from resolved projectile impact");

console.log("Staged VS smoke passed: Safari relay-first matchmaking with redundant live pose fanout, staged networking, pooled physical tracers, 8x readable peer/1x hitbox, and safe-building launch integration retained.");
