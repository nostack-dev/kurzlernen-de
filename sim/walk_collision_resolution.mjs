const WALK_RADIUS_M=.28;
const MAX_SUBSTEP_M=.14;
const EDGE_SEARCH_M=WALK_RADIUS_M*2.5;
const EPS=1e-7;

const finite=value=>Number.isFinite(Number(value));
const point=value=>({x:finite(value?.x)?Number(value.x):0,y:finite(value?.y)?Number(value.y):0});
const distanceSq=(a,b)=>{const dx=a.x-b.x,dy=a.y-b.y;return dx*dx+dy*dy;};

function closestPointOnSegment(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
  if(l2<=EPS)return{x:a[0],y:a[1],tangent:null};
  const t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.y-a[1])*dy)/l2)),len=Math.sqrt(l2);
  return{x:a[0]+dx*t,y:a[1]+dy*t,tangent:{x:dx/len,y:dy/len}};
}

function nearbyBuildingEdges(p,prisms,maxDistance=EDGE_SEARCH_M){
  const maxD2=maxDistance*maxDistance,edges=[];
  for(const prism of prisms||[]){
    const points=Array.isArray(prism?.points)?prism.points:null;if(!points||points.length<2)continue;
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];if(!Array.isArray(a)||!Array.isArray(b))continue;
      const q=closestPointOnSegment(p,a,b);if(!q.tangent)continue;const d2=distanceSq(p,q);if(d2<=maxD2)edges.push({distanceSq:d2,tangent:q.tangent});
    }
  }
  edges.sort((a,b)=>a.distanceSq-b.distanceSq);return edges.slice(0,6);
}

function safeOccupy(canOccupy,x,y){try{return Boolean(canOccupy(x,y));}catch{return false;}}

export function resolveWalkCollisionMove(fromValue,toValue,{canOccupy,baseResolve,prisms=[]}={}){
  const from=point(fromValue),to=point(toValue),fallback=()=>typeof baseResolve==="function"?baseResolve(fromValue,toValue):from;
  if(typeof canOccupy!=="function")return fallback();
  if(!safeOccupy(canOccupy,from.x,from.y))return fallback();
  if(safeOccupy(canOccupy,to.x,to.y))return to;
  const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);if(distance<=EPS)return from;
  const steps=Math.max(1,Math.ceil(distance/MAX_SUBSTEP_M)),stepX=dx/steps,stepY=dy/steps;
  let current={...from},moved=false,slid=false;
  for(let i=0;i<steps;i++){
    const desired={x:current.x+stepX,y:current.y+stepY};
    if(safeOccupy(canOccupy,desired.x,desired.y)){current=desired;moved=true;continue;}
    let best=null,bestMagnitude=0;
    for(const edge of nearbyBuildingEdges(desired,prisms)){
      const t=edge.tangent,projection=stepX*t.x+stepY*t.y;if(Math.abs(projection)<=EPS)continue;
      const candidate={x:current.x+t.x*projection,y:current.y+t.y*projection};if(!safeOccupy(canOccupy,candidate.x,candidate.y))continue;
      const magnitude=Math.abs(projection);if(magnitude>bestMagnitude+EPS){best=candidate;bestMagnitude=magnitude;}
    }
    if(best){current=best;moved=true;slid=true;continue;}
    let shortened=null;
    for(const scale of[.5,.25]){const candidate={x:current.x+stepX*scale,y:current.y+stepY*scale};if(safeOccupy(canOccupy,candidate.x,candidate.y)){shortened=candidate;break;}}
    if(shortened){current=shortened;moved=true;continue;}
    break;
  }
  if(!moved)return fallback();
  return{x:current.x,y:current.y,__walkCollisionSlide:slid};
}

function viewport(){return typeof document!=="undefined"?document.getElementById("viewport"):null;}
function bridge(){return globalThis.__arondightRealWorld||null;}
let installed=false,installFrame=0;
export function installWalkCollisionResolution(){
  if(installed)return true;const runtime=globalThis.__arondightPlayerVehicleRuntime;if(!runtime||typeof runtime.resolveWalkMove!=="function"||typeof runtime.canOccupyWalkPoint!=="function")return false;
  const base=runtime.resolveWalkMove.bind(runtime),canOccupy=runtime.canOccupyWalkPoint.bind(runtime),resolved=(from,to)=>resolveWalkCollisionMove(from,to,{canOccupy,baseResolve:base,prisms:bridge()?.buildingCollisionSnapshot?.prisms||[]});
  resolved.__walkCollisionResolutionV1=true;runtime.resolveWalkMove=resolved;installed=true;const view=viewport();if(view){view.dataset.walkCollisionResolution="substep+building-edge-tangent-v1";view.dataset.walkCollisionOwner="walk-collision-resolution-v1";}return true;
}
function installWhenReady(){if(installWalkCollisionResolution())return;installFrame=requestAnimationFrame(installWhenReady);}
if(typeof requestAnimationFrame==="function")installWhenReady();
