export const PROJECTILE_GRAVITY_MPS2=9.80665;

const finite3=v=>v&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z);
function pointInRing(x,y,ring){
  if(!Array.isArray(ring)||ring.length<3)return false;
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if(!Array.isArray(a)||!Array.isArray(b))continue;
    const ax=Number(a[0]),ay=Number(a[1]),bx=Number(b[0]),by=Number(b[1]);if(![ax,ay,bx,by].every(Number.isFinite))continue;
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/((by-ay)||1e-12)+ax)inside=!inside;
  }
  return inside;
}
function setHit(out,start,dx,dy,dz,fraction,nx,ny,nz,kind,buildingKey=""){
  const length=Math.hypot(nx,ny,nz)||1;nx/=length;ny/=length;nz/=length;
  if(nx*dx+ny*dy+nz*dz>0){nx=-nx;ny=-ny;nz=-nz;}
  out.fraction=fraction;out.distanceM=Math.hypot(dx,dy,dz)*fraction;out.point.x=start.x+dx*fraction;out.point.y=start.y+dy*fraction;out.point.z=start.z+dz*fraction;out.normal.x=nx;out.normal.y=ny;out.normal.z=nz;out.kind=kind;out.buildingKey=buildingKey;return out;
}

export function createProjectileHit(){return{fraction:1,distanceM:0,point:{x:0,y:0,z:0},normal:{x:0,y:0,z:1},kind:"",buildingKey:""};}

export function integrateProjectile(position,velocity,dt,outPosition=position,outVelocity=velocity,gravity=PROJECTILE_GRAVITY_MPS2){
  const step=Math.max(0,Number(dt)||0),g=Math.max(0,Number(gravity)||0),vx=velocity.x,vy=velocity.y,vz=velocity.z;
  outPosition.x=position.x+vx*step;outPosition.y=position.y+vy*step;outPosition.z=position.z+vz*step-.5*g*step*step;
  outVelocity.x=vx;outVelocity.y=vy;outVelocity.z=vz-g*step;return outPosition;
}

export function traceProjectileWorldSegment(snapshot,start,end,out=createProjectileHit()){
  if(!finite3(start)||!finite3(end))return null;const dx=end.x-start.x,dy=end.y-start.y,dz=end.z-start.z,segmentLength=Math.hypot(dx,dy,dz);if(segmentLength<1e-8)return null;
  let best=1.0000001,bestNx=0,bestNy=0,bestNz=1,bestKind="",bestKey="";
  const consider=(fraction,nx,ny,nz,kind,key="")=>{if(!(fraction>=0)||fraction>1||fraction>=best||!Number.isFinite(fraction))return;best=fraction;bestNx=nx;bestNy=ny;bestNz=nz;bestKind=kind;bestKey=key;};
  for(const prism of Array.isArray(snapshot?.prisms)?snapshot.prisms:[]){
    const ring=prism?.points,base=Number(prism?.base),top=Number(prism?.top);if(!Array.isArray(ring)||ring.length<3||!Number.isFinite(base)||!Number.isFinite(top))continue;
    if(Math.abs(dz)>1e-10){
      const roofT=(top-start.z)/dz;if(roofT>=0&&roofT<=1){const x=start.x+dx*roofT,y=start.y+dy*roofT;if(pointInRing(x,y,ring))consider(roofT,0,0,1,"building",String(prism.buildingKey||""));}
      const floorT=(base-start.z)/dz;if(floorT>=0&&floorT<=1){const x=start.x+dx*floorT,y=start.y+dy*floorT;if(pointInRing(x,y,ring))consider(floorT,0,0,-1,"building",String(prism.buildingKey||""));}
    }
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[j],b=ring[i],ax=Number(a?.[0]),ay=Number(a?.[1]),bx=Number(b?.[0]),by=Number(b?.[1]);if(![ax,ay,bx,by].every(Number.isFinite))continue;
      const sx=bx-ax,sy=by-ay,den=dx*sy-dy*sx;if(Math.abs(den)<1e-12)continue;const qx=ax-start.x,qy=ay-start.y,t=(qx*sy-qy*sx)/den,u=(qx*dy-qy*dx)/den;if(t<0||t>1||u<0||u>1||t>=best)continue;const z=start.z+dz*t;if(z<base-1e-5||z>top+1e-5)continue;consider(t,sy,-sx,0,"building",String(prism.buildingKey||""));
    }
  }
  if(dz<0&&start.z>=0){const groundT=-start.z/dz;if(groundT>=0&&groundT<=1)consider(groundT,0,0,1,"ground","");}
  if(best>1)return null;return setHit(out,start,dx,dy,dz,best,bestNx,bestNy,bestNz,bestKind,bestKey);
}
