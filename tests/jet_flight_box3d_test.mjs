import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {WorldRigidBodyPhysics,WORLD_PHYSICS_CATEGORIES} from "../sim/world_rigid_body_physics.mjs";
import {JET_SPEC,createAirframe,airframeStep,setFlightMode} from "../sim/jet_flight_dynamics.mjs";

// The VTOL jet is a Box3D rigid body; jet_flight_dynamics.mjs supplies only
// forces (aero, engine, reaction control, gear) inside each physics step.
// Measured on the real Box3D world:
//   * parks on its gear (no drift), lifts off and holds a hover, goes where
//     the stick says and stops again, yaws, lands softly;
//   * transitions to wing-borne flight and flies level, accelerates beyond
//     150 m/s, pulls g (limited), rolls and stops the roll near where the
//     stick was released, holds the bank;
//   * selecting hover at speed brakes it back to a hover;
//   * an unpiloted, unpowered jet glides down without tumbling and hits the
//     ground with a real Box3D contact (the damage model's crash input).
const modulePath=process.argv[2];
if(!modulePath)throw new Error("usage: node tests/jet_flight_box3d_test.mjs <box3d.inline.mjs>");
const b3=await (await import(pathToFileURL(resolve(modulePath)).href)).default();
const impacts=[];
function make(){
  const ph=new WorldRigidBodyPhysics(b3,{buildingSnapshot:{hash:"none",footprintCount:0,prisms:[]},onImpact:d=>impacts.push(d)});
  const af=createAirframe();let t=0;let gi=0;
  ph.addBody({id:"j",kind:"aircraft",position:[0,0,JET_SPEC.gearHeight+.1],yaw:0,massKg:JET_SPEC.massKg,hulls:JET_SPEC.hulls,inertia:JET_SPEC.inertia,linearDamping:0,angularDamping:0,wheeled:false,friction:.35,
    controller:(st,dt,eng)=>{const out=airframeStep(af,st,dt,{raycast:(o,d,l)=>eng.raycast(o,d,l,{maskBits:WORLD_PHYSICS_CATEGORIES.terrain})});gi=Math.max(gi,af.gearImpact);return out;}});
  const step=n=>{for(let i=0;i<n;i++)ph.step(1/60,4,(t++)*1000/60);};
  const set=o=>Object.assign(af.input,{lift:0,yawIn:0,pitchIn:0,rollIn:0,brake:0},o);
  const pose=()=>ph.pose("j");
  return{ph,af,step,set,pose,get gearImpact(){return gi;},resetGi(){gi=0;}};
}
const deg=r=>r*57.2958;
{
  const J=make(),{af,step,set,pose}=J;
  set({brake:1});step(300);let p=pose();
  console.log("parked z",p.position[2].toFixed(3),"v",Math.hypot(...p.velocity).toFixed(3),"contacts",af.contacts);
  assert.equal(af.contacts,3,"parked on all three wheels");assert.ok(Math.hypot(...p.velocity)<.05,"no drift when parked");assert.ok(Math.abs(p.position[2]-JET_SPEC.gearHeight)<.12,"sits on its gear");
  af.pilot=true;af.engineOn=true;set({lift:1});step(180);p=pose();console.log("climb vz",p.velocity[2].toFixed(2),"z",p.position[2].toFixed(1));assert.ok(p.velocity[2]>6,"vertical take-off");
  set({});step(180);const z0=pose().position[2];step(120);p=pose();console.log("hover dz",(p.position[2]-z0).toFixed(2),"pitch",deg(af.tele.pitch).toFixed(1),"roll",deg(af.tele.roll).toFixed(1));
  assert.ok(Math.abs(p.position[2]-z0)<1.5&&Math.abs(p.velocity[2])<.6,"holds a hover");assert.ok(Math.abs(af.tele.pitch)<.05&&Math.abs(af.tele.roll)<.05,"level in the hover");
  set({pitchIn:-1});step(360);p=pose();const vf=p.velocity[1];console.log("TRC forward",vf.toFixed(1));assert.ok(vf>12&&vf<16,"stick forward = ~14 m/s forward");
  set({});step(420);p=pose();console.log("TRC stop",Math.hypot(p.velocity[0],p.velocity[1]).toFixed(2));assert.ok(Math.hypot(p.velocity[0],p.velocity[1])<1,"stops when released");
  const h0=af.tele.heading;set({yawIn:1});step(120);set({});const h1=af.tele.heading;step(120);const h2=af.tele.heading;console.log("yaw",deg(h0-h1).toFixed(1),"overrun",deg(h1-h2).toFixed(1));
  assert.ok(deg(h0-h1)>40,"yaws right in the hover");assert.ok(Math.abs(deg(h1-h2))<20,"yaw stops near the release");
  // transition and wing-borne flight
  setFlightMode(af,"flight");set({});const zt=pose().position[2];step(60*25);p=pose();const V=Math.hypot(...p.velocity);console.log("flight V",V.toFixed(0),"dz",(p.position[2]-zt).toFixed(1),"gamma",deg(Math.asin(p.velocity[2]/V)).toFixed(1));
  assert.ok(V>150,"accelerates to wing-borne flight");assert.ok(Math.abs(p.position[2]-zt)<60&&Math.abs(p.velocity[2])<4,"flies level after the transition");
  set({pitchIn:1});let nz=0;for(let i=0;i<120;i++){step(1);nz=Math.max(nz,af.tele.nz);}set({});step(240);console.log("pull nz",nz.toFixed(2));assert.ok(nz>6&&nz<10,"pulls hard but within the g limit");
  // roll: stop near the release, hold the bank
  set({});step(240);const r0=af.tele.roll;set({rollIn:1});step(24);const rRel=af.tele.roll;set({});step(60);const rStop=af.tele.roll;step(180);const rHold=af.tele.roll;
  console.log("roll",deg(rRel-r0).toFixed(1),"overrun",deg(rStop-rRel).toFixed(1),"hold drift",deg(rHold-rStop).toFixed(1));
  assert.ok(deg(rRel-r0)>35,"rolls briskly (0.4 s full stick)");assert.ok(deg(rStop-rRel)<20,"roll stops near the release");assert.ok(Math.abs(deg(rHold-rStop))<6,"holds the bank");
  set({rollIn:-1});for(let i=0;i<120&&af.tele.roll>.02;i++)step(1);set({});
  // level off (push until the climb is gone), then select hover at speed
  for(let i=0;i<60*20&&Math.abs(pose().velocity[2])>3;i++){set({pitchIn:pose().velocity[2]>0?-.4:.4});step(1);}set({});step(180);
  // hover selected at speed: brake down to a hover, then land
  af.lever=.6;setFlightMode(af,"hover");const zb=pose().position[2];let tB=0;for(;tB<60*90;tB++){step(1);const v=pose().velocity;if(Math.hypot(v[0],v[1])<3)break;}p=pose();console.log("braked in",(tB/60).toFixed(1),"s dz",(p.position[2]-zb).toFixed(1));
  assert.ok(tB<60*80,"braking stop to a hover");assert.ok(Math.abs(p.position[2]-zb)<40,"holds height while braking");
  J.ph.destroy();
}
{// vertical landing near the pad: from a 40 m hover, full stick down all the way
  const J=make(),{af,step,set,pose}=J;af.pilot=true;af.engineOn=true;set({lift:1});step(240);set({pitchIn:-1});step(180);set({});step(360);
  J.resetGi();set({lift:-1});for(let i=0;i<60*60&&!(af.contacts>=2&&Math.abs(pose().velocity[2])<.1);i++)step(1);set({});step(120);
  console.log("touchdown",J.gearImpact.toFixed(2),"m/s contacts",af.contacts,"landed",af.landed);
  assert.ok(af.contacts===3&&J.gearImpact<3.2,"soft vertical landing");assert.ok(af.landed,"landed (engine to idle)");
  J.ph.destroy();
}
{// unpiloted, unpowered from 150 m/s: glides down without tumbling, hits the ground with a Box3D contact
  const J=make(),{af,step,set,pose,ph}=J;af.pilot=true;af.engineOn=true;set({lift:1});step(240);setFlightMode(af,"flight");set({});step(60*20);
  af.pilot=false;af.engineOn=false;set({});let wMax=0,z=pose().position[2];impacts.length=0;
  for(let i=0;i<60*120&&pose().position[2]>JET_SPEC.gearHeight+1.5;i++){step(1);if(i>60)wMax=Math.max(wMax,Math.hypot(...pose().angularVelocity));}
  step(30);const hit=impacts.filter(d=>d.id==="j").reduce((m,d)=>Math.max(m,Number(d.approachSpeedMps??d.deltaVelocityMps)||0),0);
  console.log("ghost glide: from",z.toFixed(0),"m, max body rate",wMax.toFixed(2),"rad/s, ground hit",hit.toFixed(1),"m/s");
  assert.ok(wMax<1.2,"an unpiloted jet does not tumble");assert.ok(hit>5,"the crash is a real Box3D contact");
  ph.destroy();
}
console.log("jet flight Box3D test passed");
