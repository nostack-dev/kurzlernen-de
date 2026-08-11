import assert from "node:assert/strict";
import {LanVsFinder} from "../sim/lan_vs.mjs";

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const opened=[];

function harness(name,{connect=false,fail=false}={}){
  return async()=>({
    joinRoom(config,roomId,callbacks={}){
      opened.push({name,roomId,config});
      const room={
        onPeerJoin:null,onPeerLeave:null,
        makeAction(){return{onMessage:null,send:async()=>{}};},
        getPeers:()=>({}),ping:async()=>1,leave(){}
      };
      if(fail)queueMicrotask(()=>callbacks.onJoinError?.({peerId:"x",error:new Error(`${name} failed`)}));
      if(connect)queueMicrotask(()=>room.onPeerJoin?.("peer-ok"));
      return room;
    },
    getRelaySockets:()=>({})
  });
}

let connected="";
const finder=new LanVsFinder({
  stageMs:25,
  maxRoomsPerStage:3,
  transportStrategies:[
    {name:"Nostr",load:harness("Nostr",{fail:true})},
    {name:"Torrent",load:harness("Torrent",{connect:true})},
    {name:"MQTT",load:harness("MQTT")},
    {name:"Broker",load:harness("Broker")}
  ],
  onPeer:(_peer,_room,transport)=>connected=transport
});

await finder.start(["net-exact","net-secondary","net-third","tap-current","tap-previous","net-extra"]);
await sleep(100);

assert.equal(connected,"Torrent","second staged transport must take over after first transport fails");
assert.ok(opened.length<=6,`staged finder opened too many sessions before connection: ${opened.length}`);
const firstStage=opened.filter(x=>x.name==="Nostr");
assert.equal(firstStage.length,3,"mobile stage must cap simultaneous rooms at three");
assert.deepEqual(firstStage.map(x=>x.roomId),["tap-current","tap-previous","net-exact"],"gesture rooms plus first trusted network room must be first");
for(const item of opened.filter(x=>x.name!=="Broker")){
  assert.equal(item.config.trickleIce,true,`${item.name} must force trickle ICE`);
  assert.equal(item.config.rtcConfig?.iceTransportPolicy,"all",`${item.name} must explicitly keep direct ICE paths enabled`);
  assert.ok(Array.isArray(item.config.rtcConfig?.iceServers)&&item.config.rtcConfig.iceServers.length>=2,`${item.name} must explicitly carry STUN config`);
}

finder.stop();
console.log("Staged VS smoke passed: <=3 concurrent sessions, gesture+LAN priority, sequential transports, explicit ICE");
