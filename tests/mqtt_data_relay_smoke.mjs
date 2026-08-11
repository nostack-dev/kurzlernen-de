import assert from "node:assert/strict";
import {MqttDataRelay,LanVsFinder} from "../sim/lan_vs.mjs";

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function fakeMqttNetwork(){
  const clients=new Set();
  const matches=(filter,topic)=>filter.endsWith("/+")?topic.startsWith(filter.slice(0,-1))&&!topic.slice(filter.length-1).includes("/"):filter===topic;
  function connect(url,opts={}){
    const handlers=new Map(),subscriptions=new Set();
    const client={
      connected:false,url,opts,_subscriptions:subscriptions,
      on(name,fn){const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);return client;},
      emit(name,...args){for(const fn of handlers.get(name)||[])fn(...args);},
      subscribe(filters,_options,callback){for(const filter of Array.isArray(filters)?filters:[filters])subscriptions.add(filter);queueMicrotask(()=>callback?.(null,[...subscriptions]));},
      publish(topic,payload,options={}){for(const peer of clients){if(peer===client)continue;if([...peer._subscriptions].some(filter=>matches(filter,topic)))queueMicrotask(()=>peer.emit("message",topic,new TextEncoder().encode(payload),{retain:Boolean(options.retain)}));}},
      end(){client.connected=false;clients.delete(client);client.emit("close");}
    };
    clients.add(client);queueMicrotask(()=>{client.connected=true;client.emit("connect",{});});return client;
  }
  return{loadMqtt:async()=>({connect})};
}

function failingTransport(){
  return{load:async()=>({joinRoom(_config,_roomId,callbacks={}){queueMicrotask(()=>callbacks.onJoinError?.({peerId:"peer-x",error:new Error("ICE failed")}));return{onPeerJoin:null,onPeerLeave:null,makeAction:()=>({onMessage:null,send:()=>Promise.resolve()}),getPeers:()=>({}),leave(){}};}})};
}

const network=fakeMqttNetwork();
let aPeers=0,bPeers=0,aPose=null,bPose=null,aOrigin=null,bOrigin=null,bCombat=null;
const a=new MqttDataRelay({loadMqtt:network.loadMqtt,brokerUrls:["wss://one"],localId:"relay-a",onPeer:()=>aPeers++,onPose:pose=>aPose=pose,onOrigin:origin=>aOrigin=origin});
const b=new MqttDataRelay({loadMqtt:network.loadMqtt,brokerUrls:["wss://one"],localId:"relay-b",onPeer:()=>bPeers++,onPose:pose=>bPose=pose,onOrigin:origin=>bOrigin=origin,onCombat:packet=>bCombat=packet});
await a.start(["net-shared"]);await b.start(["net-shared"]);await sleep(30);
assert.equal(aPeers,1);assert.equal(bPeers,1);
a.setPose({p:[1,2,3],q:[0,0,0,1]});b.setPose({p:[4,5,6],q:[0,0,0,1]});a.setOrigin({lon:9.17,lat:47.66,alt:0});b.setOrigin({lon:9.18,lat:47.67,alt:0});await sleep(110);
assert.deepEqual(aPose.p,[4,5,6]);assert.deepEqual(bPose.p,[1,2,3]);assert.equal(aOrigin.lon,9.18);assert.equal(bOrigin.lon,9.17);
assert.equal(a.sendCombat({type:"hit",id:"hit-relay",damage:25}),true);await sleep(10);assert.equal(bCombat.id,"hit-relay");
a.stop();b.stop();

const fallbackNetwork=fakeMqttNetwork(),strategy={name:"Broken WebRTC",load:failingTransport().load};
let faPeers=0,fbPeers=0,faPose=null,fbPose=null,faTransport="",fbTransport="";
const common={transportStrategies:[strategy],dataRelayDelayMs:0,loadMqtt:fallbackNetwork.loadMqtt,dataRelayBrokerUrls:["wss://one"],gestureDeferMs:0,joinDiagnosticMs:0};
const fa=new LanVsFinder({...common,onPeer:(_peer,_room,transport)=>{faPeers++;faTransport=transport;},onPose:pose=>faPose=pose});
const fb=new LanVsFinder({...common,onPeer:(_peer,_room,transport)=>{fbPeers++;fbTransport=transport;},onPose:pose=>fbPose=pose});
await fa.start(["net-shared"]);await fb.start(["net-shared"]);await sleep(70);
assert.equal(faPeers,1);assert.equal(fbPeers,1);assert.equal(faTransport,"MQTT DATA RELAY");assert.equal(fbTransport,"MQTT DATA RELAY");
fa.setPose({p:[7,8,9],q:[0,0,0,1]});fb.setPose({p:[9,8,7],q:[0,0,0,1]});await sleep(110);
assert.deepEqual(faPose.p,[9,8,7]);assert.deepEqual(fbPose.p,[7,8,9]);
fa.stop();fb.stop();

console.log("MQTT data relay smoke passed: static-only fallback pairs and carries pose/origin/combat after WebRTC ICE failure");
