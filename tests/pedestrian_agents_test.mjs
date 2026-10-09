import assert from "node:assert/strict";
import {createPedestrianNetwork,seedRouteAgents,stepAgent,routePointInto,projectOnRoute,frighten} from "../sim/pedestrian_agents.mjs";

// the offline training range's streets
function route(key,points){const segments=[];let length=0;for(let i=0;i<points.length-1;i++){const a=points[i],c=points[i+1],dx=c[0]-a[0],dy=c[1]-a[1],d=Math.hypot(dx,dy);segments.push({a,c,dx,dy,d,start:length});length+=d;}return{key,points,segments,length};}
const routes=[route("loop",[[-62,-38],[62,-38],[62,38],[-62,38],[-62,-38]]),route("ew",[[-84,0],[-24,0],[24,0],[84,0]]),route("ns",[[0,-76],[0,-28],[0,28],[0,76]]),route("wf",[[-70,54],[-28,54],[18,54],[70,54]])];
const net=createPedestrianNetwork();assert.ok(net.sync(routes));assert.ok(!net.sync(routes),"unchanged network must not be rebuilt");
assert.ok(net.junctions.get("ew").some(j=>j.other==="ns"&&Math.abs(j.s-84)<.5),"crossing streets must be linked");
assert.ok(net.junctions.get("wf").some(j=>j.other==="ns"),"T-junctions must be linked");
const p={};routePointInto(routes[1],10,2,p);assert.ok(Math.abs(p.x+74)<1e-9&&Math.abs(p.y-2)<1e-9,"left offset");
const pr={};projectOnRoute(routes[1],-74,2,pr);assert.ok(Math.abs(pr.s-10)<1e-9&&Math.abs(pr.lateral-2)<1e-9);

const agents=routes.flatMap(r=>seedRouteAgents(r,{spacingM:8.6,cap:60}));
assert.ok(agents.length>=95,`training range needs ~100 people, got ${agents.length}`);
assert.equal(new Set(agents.map(a=>a.id)).size,agents.length,"ids are unique");
assert.deepEqual(routes.flatMap(r=>seedRouteAgents(r,{spacingM:8.6,cap:60})).map(a=>[a.id,a.x,a.y]),agents.map(a=>[a.id,a.x,a.y]),"seeding is deterministic");
assert.ok(agents.some(a=>a.leader),"some people walk in company");

// 10 simulated minutes at 30 Hz: nobody ever moves faster than a person can walk, everybody keeps
// travelling to destinations and arrives at them, and the people stay where the streets are
let now=0,maxRatio=0,maxStep=0;const trips=new Map(agents.map(a=>[a.id,0])),arrivals=new Map(agents.map(a=>[a.id,0]));let lastState=new Map();
for(let k=0;k<30*600;k++){const dt=1/30;now+=dt*1000;
  for(const a of agents){const x=a.x,y=a.y;stepAgent(a,dt,now,net);const step=Math.hypot(a.x-x,a.y-y);maxStep=Math.max(maxStep,step);maxRatio=Math.max(maxRatio,step/(a.speed*1.9*dt+1e-9));
    if(lastState.get(a.id)==="walk"&&a.state==="wait")arrivals.set(a.id,arrivals.get(a.id)+1);lastState.set(a.id,a.state);trips.set(a.id,a.trip);}}
assert.ok(maxRatio<=1.0001,`a person outran its own legs (ratio ${maxRatio})`);
const leaders=agents.filter(a=>!a.leader);
assert.ok(leaders.every(a=>trips.get(a.id)>=3),`every person keeps making trips: min ${Math.min(...leaders.map(a=>trips.get(a.id)))}`);
assert.ok(leaders.every(a=>arrivals.get(a.id)>=2),"every person arrives at destinations");
assert.ok(agents.every(a=>Math.abs(a.x)<95&&Math.abs(a.y)<90),"people stay in their neighbourhood");
assert.ok(agents.every(a=>a.state==="wait"||a.dest),"walking people always have a destination");
// low-rate simulation of far people (2 Hz) stays bounded too
for(const a of agents){const x=a.x,y=a.y;stepAgent(a,.5,now+500,net);assert.ok(Math.hypot(a.x-x,a.y-y)<=a.speed*1.9*.5+1e-6);}
// a shot nearby: the person runs away from it, then calms down and walks on to a new destination
{const a=agents.find(q=>!q.leader),x0=a.x,y0=a.y;frighten(a,x0-3,y0,now);for(let k=0;k<30*4;k++){now+=1000/30;stepAgent(a,1/30,now,net);}
  assert.ok(a.x-x0>6&&a.state==="flee","a frightened person runs away from the danger");for(let k=0;k<30*12;k++){now+=1000/30;stepAgent(a,1/30,now,net);}assert.ok(a.state!=="flee"&&a.fleeUntil===0,"and calms down again");
  for(let k=0;k<30*30&&a.state!=="walk";k++){now+=1000/30;stepAgent(a,1/30,now,net);}assert.ok(a.state==="walk"&&a.dest,"then goes on to a destination");}
// nobody steps onto the road in front of a car: crossings wait for a gap
{const net2=createPedestrianNetwork();net2.sync(routes);let clear=false;net2.crossingClear=()=>clear;const a=seedRouteAgents(routes[1],{spacingM:200,cap:1})[0];a.legs=[{route:"ew",fromS:a.s,toS:a.s,side:-a.side}];a.li=0;a.state="walk";a.trip=1;const y0=a.y;
  for(let k=0;k<60;k++){now+=1000/30;stepAgent(a,1/30,now,net2);}assert.ok(Math.abs(a.y-y0)<.05,"waits at the kerb while traffic comes");clear=true;for(let k=0;k<30*8;k++){now+=1000/30;stepAgent(a,1/30,now,net2);}assert.ok(Math.abs(a.y-y0)>5,"crosses once the road is clear");}
console.log(`pedestrian agents: ${agents.length} people, max step ${maxStep.toFixed(3)} m, trips ${Math.min(...leaders.map(a=>trips.get(a.id)))}..${Math.max(...leaders.map(a=>trips.get(a.id)))}`);
