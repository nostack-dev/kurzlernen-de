// Manual P2P must keep direct LAN candidates while retaining STUN fallback, and must never emit a candidate-less pairing code.
import assert from "node:assert/strict";
import {P2P_RTC_CONFIG,waitForIceComplete} from "../sim/p2p_link.mjs";
assert.equal(P2P_RTC_CONFIG.iceTransportPolicy,"all");
assert.ok(P2P_RTC_CONFIG.iceServers.length>=2);
assert.ok(JSON.stringify(P2P_RTC_CONFIG.iceServers).includes("stun.cloudflare.com"));
function mockPc(sdp,state="gathering"){const listeners=new Map();return{iceGatheringState:state,localDescription:{sdp},addEventListener(n,f){listeners.set(n,f);},removeEventListener(n,f){if(listeners.get(n)===f)listeners.delete(n);}};}
const candidate="v=0\na=candidate:1 1 udp 1 192.168.1.2 5000 typ host\n";
await waitForIceComplete(mockPc(candidate),5);
await waitForIceComplete(mockPc(candidate,"complete"),5);
await assert.rejects(()=>waitForIceComplete(mockPc("v=0\n","complete"),5),/completed without any usable candidate/);
await assert.rejects(()=>waitForIceComplete(mockPc("v=0\n"),5),/timed out before any usable candidate/);
console.log("P2P ICE reliability passed: direct candidate, STUN fallback, and candidate-less completion guarded.");
