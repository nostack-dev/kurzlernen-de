// Final regression probe v2: direct LAN candidates may complete before STUN while retaining a valid fallback path.
import assert from "node:assert/strict";
import {P2P_RTC_CONFIG,waitForIceComplete} from "../sim/p2p_link.mjs";
assert.equal(P2P_RTC_CONFIG.iceTransportPolicy,"all");
assert.ok(P2P_RTC_CONFIG.iceServers.length>=2);
assert.ok(JSON.stringify(P2P_RTC_CONFIG.iceServers).includes("stun.cloudflare.com"));
function mockPc(sdp){const listeners=new Map();return{iceGatheringState:"gathering",localDescription:{sdp},addEventListener(n,f){listeners.set(n,f);},removeEventListener(n,f){if(listeners.get(n)===f)listeners.delete(n);}};}
await waitForIceComplete(mockPc("v=0\na=candidate:1 1 udp 1 192.168.1.2 5000 typ host\n"),5);
await assert.rejects(()=>waitForIceComplete(mockPc("v=0\n"),5),/before any usable candidate/);
console.log("P2P ICE reliability passed");