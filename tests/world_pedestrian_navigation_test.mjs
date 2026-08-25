import assert from "node:assert/strict";
import {createPedestrianNavigationIndex,pedestrianNavigationStats,pedestrianPointBlocked,projectPedestrianOutsideBuildings,steerPedestrianStep} from "../sim/world_pedestrian_navigation.mjs";

const prisms=[{points:[[0,0],[6,0],[6,6],[0,6]],base:0,top:8}];
assert.equal(pedestrianPointBlocked(3,3,prisms,.2),true);
assert.equal(pedestrianPointBlocked(-2,3,prisms,.2),false);
const ejected=projectPedestrianOutsideBuildings(3,3,prisms,{clearanceM:.4});
assert.equal(pedestrianPointBlocked(ejected.x,ejected.y,prisms,.2),false);

let p={x:-1,y:3,heading:NaN},maxLateral=0;
for(let i=0;i<600;i++){
  const step=steerPedestrianStep({x:p.x,y:p.y,targetX:8,targetY:3,speedMps:1.7,dtS:1/60,prisms,clearanceM:.3,sideBias:1,headingHint:p.heading});
  p=step;maxLateral=Math.max(maxLateral,Math.abs(p.y-3));
  assert.equal(pedestrianPointBlocked(p.x,p.y,prisms,.2),false);
}
assert.ok(maxLateral>.6,`agent did not deflect around a blocked building path: ${JSON.stringify({p,maxLateral})}`);

let clear={x:-4,y:-2,heading:NaN};
for(let i=0;i<120;i++)clear=steerPedestrianStep({x:clear.x,y:clear.y,targetX:-1,targetY:-2,speedMps:1.5,dtS:1/60,prisms,clearanceM:.3,headingHint:clear.heading});
assert.ok(clear.x>-2,`clear-space pedestrian failed to advance: ${JSON.stringify(clear)}`);

const panicStep=steerPedestrianStep({x:3,y:3,targetX:-5,targetY:3,speedMps:4.6,dtS:1/30,prisms,clearanceM:.32,sideBias:-1});
assert.equal(pedestrianPointBlocked(panicStep.x,panicStep.y,prisms,.2),false);

const dense=[];
for(let gy=0;gy<16;gy++)for(let gx=0;gx<32;gx++){const x=gx*20,y=gy*20;dense.push({points:[[x,y],[x+6,y],[x+6,y+6],[x,y+6]],base:0,top:10});}
const navigation=createPedestrianNavigationIndex(dense,{cellSizeM:16});
const agents=Array.from({length:30},(_,index)=>({x:(index%10)*20-3,y:Math.floor(index/10)*20+3,heading:0}));
for(let tick=0;tick<240;tick++)for(const agent of agents){const step=steerPedestrianStep({x:agent.x,y:agent.y,targetX:agent.x+8,targetY:agent.y,speedMps:1.6,dtS:1/60,navigation,clearanceM:.3,headingHint:agent.heading});agent.x=step.x;agent.y=step.y;agent.heading=step.heading;assert.equal(pedestrianPointBlocked(agent.x,agent.y,navigation,.2),false);}
const stats=pedestrianNavigationStats(navigation);
assert.equal(stats.totalPrisms,512);
assert.ok(stats.averageCandidates<8,`pedestrian broadphase regressed to near-global scans: ${JSON.stringify(stats)}`);
assert.ok(stats.maxCandidates<24,`pedestrian broadphase local candidate set exploded: ${JSON.stringify(stats)}`);
console.log(`Pedestrian navigation passed: collision-safe steering plus indexed broadphase averages ${stats.averageCandidates.toFixed(2)} of ${stats.totalPrisms} building prisms per local query.`);
