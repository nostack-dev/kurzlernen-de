import assert from 'node:assert/strict';
import {vehicleFootprintsOverlap} from '../sim/vehicle_spawn_clearance.mjs';
const car={x:0,y:0,yaw:0,half:[1.78,.82]};
assert.ok(vehicleFootprintsOverlap(car,{...car,x:1}));
assert.ok(vehicleFootprintsOverlap(car,{...car,x:1.8,yaw:Math.PI/2}));
assert.ok(!vehicleFootprintsOverlap(car,{...car,y:3}));
assert.ok(!vehicleFootprintsOverlap(car,{...car,x:5}));
import Box3D from '../node_modules/box3d.js/dist/box3d.inline.mjs';
import {PlaneGeometry} from 'three';
import {setElevationGrid} from '../sim/terrain_elevation.mjs';
import {staticGroundHeightAt} from '../sim/terrain_craters.mjs';
import {drapeTerrainTriangle} from '../sim/terrain_surface.mjs';
import {WorldRigidBodyPhysics} from '../sim/world_rigid_body_physics.mjs';
import {resolvePlayerCapsuleMove} from '../sim/player_capsule_collision.mjs';

const b3=await Box3D(),n=81,step=5,h=new Float32Array(n*n);
for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=-200+i*step,y=-200+j*step;h[j*n+i]=.08*x+.05*y+.8*Math.sin(x/11)*Math.cos(y/9);}
setElevationGrid({x0:-200,y0:-200,step,n,h,cx:0,cy:0});
const physics=new WorldRigidBodyPhysics(b3,{buildingSnapshot:{hash:'none',prisms:[]}});
const filter=b3.b3DefaultQueryFilter();filter.categoryBits=8n;filter.maskBits=1n;
// Off-grid points exercise the actual diagonal, signs and negative elevations.
for(let i=0;i<50;i++){
  const x=-91+i*3.71,y=53-i*2.19,z=staticGroundHeightAt(x,y);
  const hit=b3.b3World_CastRayClosest(physics.world,[x,y,z+5],[0,0,-10],filter);
  assert.ok(hit.hit);assert.ok(Math.abs(hit.point[2]-z)<.001,`query vs Box3D at ${x},${y}: ${z} vs ${hit.point[2]}`);
}
// Three's ground triangles must be the same planes as Box3D.
const g=new PlaneGeometry(200,200,40,40),p=g.attributes.position;
for(let i=0;i<p.count;i++)p.setZ(i,staticGroundHeightAt(p.getX(i),p.getY(i)));
for(let i=0;i<g.index.count;i+=39){const ids=[0,1,2].map(k=>g.index.getX(i+k)),x=ids.reduce((s,k)=>s+p.getX(k),0)/3,y=ids.reduce((s,k)=>s+p.getY(k),0)/3,z=ids.reduce((s,k)=>s+p.getZ(k),0)/3;assert.ok(Math.abs(z-staticGroundHeightAt(x,y))<2e-6);}
// An oblique road crossing many cells cannot sink into the ground between vertices.
let area=0,count=0;
drapeTerrainTriangle([-33.3,-15.2],[27.4,3.1],[-22.2,9.5],staticGroundHeightAt,.112,(a,b,c)=>{
  area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;count++;
  for(const w of [[1/3,1/3,1/3],[.1,.7,.2],[.6,.3,.1]]){const x=a[0]*w[0]+b[0]*w[1]+c[0]*w[2],y=a[1]*w[0]+b[1]*w[1]+c[1]*w[2],z=a[2]*w[0]+b[2]*w[1]+c[2]*w[2];assert.ok(Math.abs(z-staticGroundHeightAt(x,y)-.112)<1e-9);}
});
assert.ok(count>20);assert.ok(Math.abs(area-Math.abs(60.7*24.7-18.3*11.1)/2)<1e-7,'clipping preserves road coverage');
for(const start of [{x:70,y:25},{x:-70,y:-25}]){
  let p={...start};for(let i=0;i<80;i++){const to={x:p.x+.08,y:p.y+.03},r=resolvePlayerCapsuleMove(physics,p,to);assert.ok(r&&Math.hypot(r.x-to.x,r.y-to.y)<.015,`walk stuck on slope: ${JSON.stringify({p,to,r})}`);p=r;}
}
// Wall at nonzero elevation, including starting with capsule penetration.
physics.syncBuildings({hash:'hill-wall',prisms:[{buildingKey:'wall',base:0,top:4,points:[[72,23],[73,23],[73,28],[72,28]]}]});
const blocked=resolvePlayerCapsuleMove(physics,{x:71,y:25},{x:74,y:25});assert.ok(blocked.blocked&&blocked.x<71.8,JSON.stringify(blocked));
const escape=resolvePlayerCapsuleMove(physics,{x:71.85,y:25},{x:71.3,y:25});assert.ok(escape.x<71.5,'capsule can recover from wall overlap');
console.log(`Terrain alignment passed: Box3D rays, Three ground, ${count} road triangles, uphill/downhill walking and overlap recovery.`);
