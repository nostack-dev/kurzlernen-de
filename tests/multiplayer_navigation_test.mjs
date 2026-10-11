import assert from "node:assert/strict";
import {headingFromQuaternion,navPoseFromPacket} from "../sim/multiplayer_navigation.mjs";
const close=(actual,expected,epsilon=1e-5)=>assert.ok(Math.abs(actual-expected)<epsilon,`${actual} != ${expected}`);
const at=(pose,settings={})=>navPoseFromPacket(pose,settings);

close(headingFromQuaternion([0,0,0,1]),0);
close(headingFromQuaternion([0,0,0,1],"minus-x"),-Math.PI/2);
close(headingFromQuaternion([0,0,Math.sin(Math.PI/4),Math.cos(Math.PI/4)]),-Math.PI/2);
close(at({pm:"foot",av:[10,20,0],ay:Math.PI/2},{offset:[2,3]}).p[0],8);
close(at({pm:"foot",av:[10,20,0],ay:Math.PI/2},{offset:[2,3]}).headingRad,Math.PI/2);
close(at({pm:"car",cv:[10,20,0],cy:Math.PI/2}).headingRad,-Math.PI/2);
close(at({pm:"jet",jv:[12,23,0],jq:[0,0,0,1]}).p[0],12);
close(at({pm:"jet",jv:[12,23,0],jq:[0,0,0,1]}).headingRad,0);
close(at({pm:"drone",p:[5,6,7],q:[0,0,0,1]}).headingRad,-Math.PI/2);
const geo=at({pm:"jet",jv:[999,999,0],jg:[9.001,47.001],jq:[0,0,0,1]},{originLon:9,originLat:47});
assert.ok(geo.p[0]>70&&geo.p[0]<80&&geo.p[1]>110&&geo.p[1]<113);
assert.equal(at({pm:"jet",jq:[0,0,0,1]}),null);
assert.equal(at(null),null);
console.log("multiplayer navigation: pass");
