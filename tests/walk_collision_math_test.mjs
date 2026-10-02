import assert from "node:assert/strict";
import {insideEscapeImproves,pointInsidePolygon,polygonEdgeDistance,sweptPointClear} from "../sim/walk_collision_math.mjs";

const building=[[0,0],[4,0],[4,4],[0,4]];
assert.equal(pointInsidePolygon(2,2,building),true,"center must be inside");
assert.equal(pointInsidePolygon(5,2,building),false,"outside point must stay outside");
assert.equal(polygonEdgeDistance(2,2,building),2,"edge distance must be geometric");

const crossesThinWall=sweptPointClear({x:-1,y:2},{x:5,y:2},(x,y)=>pointInsidePolygon(x,y,building),.1);
assert.equal(crossesThinWall,false,"a free endpoint must not tunnel through a building");
assert.equal(sweptPointClear({x:-1,y:-1},{x:5,y:-1},(x,y)=>pointInsidePolygon(x,y,building),.1),true,"clear path must remain usable");

assert.equal(insideEscapeImproves({x:2,y:2},{x:1.5,y:2},[building]),true,"legacy inside spawns may move toward the nearest exit");
assert.equal(insideEscapeImproves({x:2,y:2},{x:2.5,y:2},[building]),true,"either equally near exit direction is valid from center");
assert.equal(insideEscapeImproves({x:1,y:2},{x:2,y:2},[building]),false,"inside spawns may not walk deeper through a building");
assert.equal(insideEscapeImproves({x:-1,y:2},{x:-2,y:2},[building]),false,"normal outside movement is not an escape case");

console.log("Swept pedestrian/building collision math passed.");
