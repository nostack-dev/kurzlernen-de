import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {WorldRigidBodyPhysics} from "../sim/world_rigid_body_physics.mjs";
import {setRoadCorridors,groundSurfaceAt} from "../sim/terrain_craters.mjs";
// the test field is a wide asphalt road (tyre grip depends on the ground material)
setRoadCorridors([{pts:[[-600,0],[600,0]],w:420}]);

// Steering + drive feel of the physical car (tyre model, steering column vs.
// aligning torque, power assist, TCS/ABS) — all measured on the Box3D world:
//   * the stick is progressive at every speed (more stick -> more lateral g)
//     and full stick sits near the tyres' grip at speed, full lock when slow;
//   * no spin-outs: body slip stays small, the car self-centres on release;
//   * straight full throttle tracks straight, a lane change ends straight,
//     braking is ABS-short and straight;
//   * terrain tile seams do not launch fast bodies (no ghost collisions).
const modulePath=process.argv[2];
if(!modulePath)throw new Error("usage: node tests/vehicle_steering_box3d_test.mjs <box3d.inline.mjs>");
const b3=await (await import(pathToFileURL(resolve(modulePath)).href)).default();
const world=()=>new WorldRigidBodyPhysics(b3,{buildingSnapshot:{hash:"none",footprintCount:0,prisms:[]}});
const speedOf=(ph,id)=>{const v=ph.pose(id).velocity;return Math.hypot(v[0],v[1]);};

function steer(v,stick){
  const ph=world();let t=0;const step=n=>{for(let i=0;i<n;i++)ph.step(1/60,4,(t++)*1000/60);};
  ph.addBody({id:"c",kind:"car",position:[-300,0,.6],yaw:0});step(60);const rec=ph.records.get("c");
  ph.setDrive("c",{pedal:1,steer:0,maxSpeed:v});for(let i=0;i<900&&speedOf(ph,"c")<v*.97;i++)step(1);step(30);
  ph.setDrive("c",{pedal:1,steer:stick,maxSpeed:v});const yr=[];for(let i=0;i<180;i++){step(1);yr.push(ph.pose("c").angularVelocity[2]);}
  const ss=yr.slice(-30).reduce((a,b)=>a+b,0)/30,p=ph.pose("c"),f=[Math.cos(p.yaw),Math.sin(p.yaw)],vx=p.velocity[0]*f[0]+p.velocity[1]*f[1],vy=-p.velocity[0]*f[1]+p.velocity[1]*f[0];
  const out={latG:Math.abs(ss*speedOf(ph,"c"))/9.81,wheelDeg:Math.abs(b3.b3WheelJoint_GetSteeringAngle(rec.wheels[0].joint))*57.3,betaDeg:Math.abs(Math.atan2(vy,vx))*57.3};
  ph.setDrive("c",{pedal:1,steer:0,maxSpeed:v});step(90);out.releasedYawRate=Math.abs(ph.pose("c").angularVelocity[2]);out.releasedWheelDeg=Math.abs(b3.b3WheelJoint_GetSteeringAngle(rec.wheels[0].joint))*57.3;
  ph.destroy();return out;
}
for(const v of[15,25]){
  const r=[.3,.6,1].map(s=>steer(v,s));console.log(`${v} m/s`,r.map(x=>`${x.latG.toFixed(2)}g/${x.wheelDeg.toFixed(1)}°`).join("  "));
  assert.ok(r[0].latG<r[1].latG&&r[1].latG<r[2].latG,`steering must be progressive at ${v} m/s`);
  assert.ok(r[2].latG>.7,`full stick at ${v} m/s must use the tyres' grip: ${r[2].latG}`);
  for(const x of r){assert.ok(x.betaDeg<8,`no spin-out at ${v} m/s (body slip ${x.betaDeg}°)`);assert.ok(x.releasedYawRate<.06&&x.releasedWheelDeg<1,`self-centring on release at ${v} m/s`);}
}
{const slow=steer(5,1);console.log("5 m/s full stick",slow.wheelDeg.toFixed(1),"°");assert.ok(slow.wheelDeg>20,"near full lock at walking pace");}

// straight full throttle, lane change, braking
{const ph=world();let t=0;const step=n=>{for(let i=0;i<n;i++)ph.step(1/60,4,(t++)*1000/60);};
  ph.addBody({id:"c",kind:"car",position:[-300,0,.6],yaw:0});step(60);
  ph.setDrive("c",{pedal:1,steer:0,maxSpeed:50});step(300);const p=ph.pose("c");console.log("5 s full throttle",speedOf(ph,"c").toFixed(1),"m/s, y",p.position[1].toFixed(2),"yaw",p.yaw.toFixed(3));
  assert.ok(speedOf(ph,"c")>20,"accelerates");assert.ok(Math.abs(p.position[1])<1&&Math.abs(p.yaw)<.05,"full throttle tracks straight (traction control, no power spin)");
  ph.setDrive("c",{pedal:1,steer:0,maxSpeed:25});step(120);
  for(const[s,n]of[[.35,36],[-.35,36],[0,150]]){ph.setDrive("c",{pedal:.4,steer:s,maxSpeed:25});step(n);}
  console.log("lane change end yaw",ph.pose("c").yaw.toFixed(3));assert.ok(Math.abs(ph.pose("c").yaw)<.1,"a lane change ends straight");
  ph.setDrive("c",{pedal:1,steer:0,maxSpeed:25});step(120);const v0=speedOf(ph,"c"),x0=ph.pose("c").position;ph.setDrive("c",{pedal:-1,steer:0});let n=0;while(speedOf(ph,"c")>.5&&n<600){step(1);n++;}
  const d=Math.hypot(ph.pose("c").position[0]-x0[0],ph.pose("c").position[1]-x0[1]),decel=v0*v0/(2*d)/9.81;console.log("braking from",v0.toFixed(1),"m/s in",d.toFixed(1),"m =",decel.toFixed(2),"g");
  assert.ok(decel>.8,"ABS braking near the tyres' grip");assert.ok(Math.abs(ph.pose("c").yaw)<.05,"brakes straight");ph.destroy();}

// tile seams: a fast frictionless sphere crossing a seam stays on the ground
{const ph=world();let worst=0;for(const x0 of[-3,-1.5,-163,157]){const bd=b3.b3DefaultBodyDef();bd.type=b3.b3BodyType.b3_dynamicBody;bd.position=[x0,1.7,.34];bd.enableSleep=false;bd.motionLocks={linearX:false,linearY:false,linearZ:false,angularX:true,angularY:true,angularZ:true};bd.linearVelocity=[35,0,0];
  const body=b3.b3CreateBody(ph.world,bd),sd=b3.b3DefaultShapeDef();sd.density=200;sd.baseMaterial.friction=0;b3.b3CreateSphereShape(body,sd,{center:[0,0,0],radius:.34});
  for(let i=0;i<12;i++){ph.step(1/60,4,i*16.7);worst=Math.max(worst,b3.b3Body_GetPosition([0,0,0],body)[2]-.34);}b3.b3DestroyBody(body);}
  console.log("seam crossing max lift",(worst*100).toFixed(1),"cm");assert.ok(worst<.05,"terrain tile seams must not launch fast bodies (ghost collisions)");ph.destroy();}
console.log("vehicle steering test passed");
// grip is a property of tyre rubber x ground material
assert.equal(groundSurfaceAt(0,0).kind,"asphalt");assert.ok(groundSurfaceAt(0,0).mu<1&&groundSurfaceAt(0,0).mu>.8,"asphalt is not 100 % grip");
assert.ok(groundSurfaceAt(0,500).mu<groundSurfaceAt(0,0).mu,"off-road paving grips less than the carriageway");
