import assert from "node:assert/strict";
import {pedestrianPointBlocked,projectPedestrianOutsideBuildings,steerPedestrianStep} from "../sim/world_pedestrian_navigation.mjs";

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
console.log("Pedestrian navigation passed: building interiors eject agents, blocked paths deflect without penetration, and clear paths advance normally.");
