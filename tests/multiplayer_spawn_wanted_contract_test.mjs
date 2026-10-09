import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const file=name=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const vs=file("sim/vs_multiplayer.mjs"),reset=file("sim/game_reset.mjs"),wanted=file("sim/wanted_police_drones.mjs");
const lan=file("sim/lan_vs.mjs"),presentation=file("sim/vs_combat_presentation.mjs");
const world=file("sim/real_world_bootstrap.mjs"),ui=file("sim/game_exit_button.mjs");
const between=(s,a,b)=>{const p=s.indexOf(a),q=s.indexOf(b,p+a.length);assert(p>=0&&q>p,"missing function "+a);return s.slice(p,q);};

assert.match(lan,/packet\.type==="spawn-anchor"/);
assert.match(presentation,/RESPAWN_RADIUS_MIN_M=3/);
assert.match(presentation,/RESPAWN_RADIUS_MAX_M=5/);
assert.match(presentation,/RESPAWN_COOLDOWN_MS=3000/);
assert.match(ui,/#viewport #mobileGameplayMultiplayer\{display:flex!important/);
assert.match(world,/const first=!this\.vsConnected/);
assert.match(world,/if\(first\)this\.resetVsCombat\(true\)/);
assert.match(world,/if\(remaining>0\)\{this\.vsConnected=true/);

const spawnFn=between(vs,"function applySpawnAnchor(","function onGameEvent(event){");
function simulateJoin(id,ids,packet,source,location={}){
  const placed=[],spawnedFrom=new Set(),view={dataset:{}},b={active:false,...location};
  const global={__arondightSpawnAt:(x,y,options)=>placed.push({x,y,options})};
  const apply=new Function("globalThis","selfId","authorityId","spawnedFrom","bridge","viewport","participantIds","setTimeout",spawnFn+"return applySpawnAnchor;")(
    global,id,source,spawnedFrom,()=>b,()=>view,()=>ids,()=>{}
  );
  apply(packet,source);apply(packet,source);
  return placed;
}
for(let index=1;index<=8;index++){
  const ids=Array.from({length:index+1},(_,i)=>"p"+i);
  const placed=simulateJoin("p"+index,ids,{playerId:"p"+index,p:[1000,-1000,0],f:"local-metric"},"p0");
  assert.equal(placed.length,1,"exactly one spawn per join");
  const d=Math.hypot(placed[0].x-1000,placed[0].y+1000);
  assert(d>=5&&d<=15,"player spawned outside 5–15m: "+d);
  assert.equal(placed[0].options.spawnRadiusOnly,true);
}
const origin={active:true,originLon:8.7,originLat:47.66},geo=[8.70001,47.66003],R=6378137;
const p=simulateJoin("p1",["p0","p1"],{playerId:"p1",p:[0,0,0],g:geo,f:"canonical"},"p0",origin)[0];
const gx=(geo[0]-origin.originLon)*Math.PI/180*R*Math.cos(origin.originLat*Math.PI/180);
const gy=(geo[1]-origin.originLat)*Math.PI/180*R;
assert(Math.abs(Math.hypot(p.x-gx,p.y-gy)-10)<.001,"GPS frames must agree");
assert.equal(simulateJoin("p1",["p0","p1"],{playerId:"p2",p:[0,0,0]},"p0").length,0,"wrong recipient must be ignored");

const resetFn=between(reset,"function spawnAt(bx,by","globalThis.__arondightSpawnAt=spawnAt;");
let location=null,blocked=false;
const walk={mode:"foot",yaw:0,canWalkTo:()=>!blocked,setPose:p=>{location=p;},setMode:()=>{}};
const resetSpawn=new Function("globalThis","requestAnimationFrame","setData","SLOT_R","document",resetFn+"return spawnAt;")(
  {__arondightWalkMode:walk,__arondightPlayerVehicleRuntime:{teleportDrone:()=>{}}},f=>f(),()=>{},7,{getElementById:()=>null}
);
resetSpawn(40,20,{slot:1,n:3});
assert(Math.abs(Math.hypot(location.x-40,location.y-20)-7)<.001,"agreed multiplayer reset ring");
blocked=true;location=null;resetSpawn(40,20,{slot:1,n:3});
assert.equal(location,null,"blocked reset must not silently spawn far away");
assert.match(reset,/gameResetMeetSource/);
assert.match(reset,/spawnRadiusOnly=false/);

const crimeFn=between(wanted,"function reportCrime(detail={}){","function clearWanted(");
const crimeSetup='let heat=0,stars=0,phase="clear",lastCrimeAt=-Infinity,clearReason="",lastContactAt=-Infinity;'+
  'const drones=[],wantedStarsForHeat=h=>h>=2?1:0,wantedEscapeDurationMs=()=>1000,wantedPoliceEngageDelayMs=()=>300,'+
  'wantedCrimeSeverity=k=>({person:2,"person-hit":1,car:1}[k]||0),currentPlayerPosition=()=>({x:1,y:2,z:3}),'+
  'lastKnownPosition={copy:()=>{}},rememberCrime=()=>true,renderHud=()=>{},playTone=()=>{};';
const crime=new Function("bridge","viewport","performance",crimeSetup+crimeFn+"return {reportCrime,state:()=>({heat,stars})};")(
  ()=>({vsSession:{getSelfId:()=>"p0"}}),()=>({dataset:{}}),{now:()=>10000}
);
assert.equal(crime.reportCrime({kind:"person",playerId:"p1"}),false,"peer crimes cannot create local wanted");
assert.equal(crime.reportCrime({kind:"person",remote:true}),false);
assert.equal(crime.reportCrime({kind:"person",network:false}),false);
assert.equal(crime.state().stars,0);
assert.equal(crime.reportCrime({kind:"person",playerId:"p0"}),true);
assert.equal(crime.state().stars,1);
assert.equal(crime.reportCrime({kind:"person",playerId:"p1"}),false);
assert.equal(crime.state().stars,1);

assert.match(wanted,/wantedOwnerId=/);
assert.match(wanted,/wantedTargetId=/);
assert.match(wanted,/p\.ownerId!==owner/);
assert.match(wanted,/lastDirectHitAt/);
assert.match(wanted,/if\(detail\.playerAction!==true/);
assert.match(vs,/kind:"player",playerId:selfId/);
console.log("multiplayer spawn + owner-specific wanted regression contracts: PASS");
