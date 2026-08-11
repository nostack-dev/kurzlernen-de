import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {createDefaultTurnConfig,LanVsSession} from "../sim/lan_vs.mjs";

const turnConfig=await createDefaultTurnConfig({nowMs:1800000000000,cryptoObj:webcrypto});
assert.equal(turnConfig.length,1);
assert.ok(turnConfig[0].urls.some(url=>url==="turn:staticauth.openrelay.metered.ca:80?transport=udp"));
assert.ok(turnConfig[0].urls.some(url=>url==="turns:staticauth.openrelay.metered.ca:443?transport=tcp"));
assert.match(turnConfig[0].username,/^\d+:kurzlernen$/);
assert.ok(turnConfig[0].credential.length>=28);

let seenConfig=null;
const loadTransport=async()=>({
  joinRoom(config,_roomId,callbacks={}){
    seenConfig=config;
    assert.equal(typeof callbacks.onJoinError,"function");
    const actions=new Map();
    return{
      makeAction(name){const action={onMessage:null,send:()=>Promise.resolve()};actions.set(name,action);return action;},
      getPeers(){return{};},
      leave(){}
    };
  },
  getRelaySockets:()=>({})
});
const session=new LanVsSession({loadTransport,transportName:"TURN-test",turnConfigProvider:async()=>turnConfig,joinDiagnosticMs:0});
await session.start("net-turn-test");
assert.deepEqual(seenConfig.turnConfig,turnConfig,"TURN config must be passed into Trystero joinRoom");
session.stop();
console.log("TURN config smoke passed: time-limited OpenRelay credentials + Trystero turnConfig injection");
