import assert from "node:assert/strict";

const viewport={dataset:{},style:{setProperty(){}}};
globalThis.document={readyState:"complete",getElementById:id=>id==="viewport"?viewport:null};
globalThis.addEventListener=()=>{};
globalThis.requestAnimationFrame=()=>0;
let walkPose={x:0,y:0,z:1.68},lastPose=null;
globalThis.__arondightWalkMode={mode:"foot",get position(){return walkPose;},yaw:0,pitch:0,dead:false,setPose({x,y}){walkPose={x,y,z:1.68};}};
globalThis.__arondightVehicleDrive={active:false};
globalThis.__arondightPlayerVehicleRuntime={canOccupyWalkPoint:(x,y)=>Math.hypot(x,y)>=1};
globalThis.__arondightFootWeapons={mode:"pistol"};
globalThis.__arondightPlayerDamageModel={hp:100,dead:false};
globalThis.__arondightRealWorld={active:false,buildingCollisionSnapshot:{hash:"test",prisms:[]},vsSession:{pendingPose:null,setPose(pose){this.pendingPose=pose;lastPose=pose;return true;}}};

await import(`../sim/first_person_authority_runtime.mjs?test=${Date.now()}`);
const api=globalThis.__arondightFirstPersonAuthority;
assert.ok(api,"authority API missing");
const clear=api.nearestClearPoint(0,0,0);
assert.equal(clear.moved,true,"blocked spawn must move");
assert.ok(Math.hypot(clear.x,clear.y)>=1,"spawn must use collision authority");
assert.equal(api.ensureClearSpawn("test",performance.now()+1000),true,"blocked active foot spawn must relocate");
assert.ok(Math.hypot(walkPose.x,walkPose.y)>=1,"walk pose was not relocated");

walkPose={x:2,y:3,z:1.68};
assert.equal(api.replicateFoot(performance.now()+2000),true,"foot pose heartbeat must publish without a drone pending pose");
assert.equal(lastPose.pm,"foot");
assert.deepEqual(lastPose.p.slice(0,2),[2,3]);
assert.equal(lastPose.ph.weapon,"pistol");
const firstSeq=lastPose.ps;
walkPose={x:2.5,y:3,z:1.68};
assert.equal(api.replicateFoot(performance.now()+2100),true,"moving walk pose must publish on movement cadence");
assert.ok(lastPose.ps>firstSeq);
assert.deepEqual(lastPose.p.slice(0,2),[2.5,3]);
assert.equal(lastPose.ph.moving,1);
console.log("first person authority test: ok");
