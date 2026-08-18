const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export const WORLD_TERRAIN_HALF_EXTENT_M=240;
export const WORLD_TERRAIN_GRID_SIZE=49;
export const WORLD_TERRAIN_REBUILD_DISTANCE_M=100;
export const WORLD_TERRAIN_SYNC_MIN_MS=1200;

function hashRows(values){let hash=2166136261;for(const value of values){const text=String(value);for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}}return(hash>>>0).toString(16).padStart(8,'0');}

export function buildTerrainSnapshot({originElevationM,center=[0,0],halfExtentM=WORLD_TERRAIN_HALF_EXTENT_M,gridSize=WORLD_TERRAIN_GRID_SIZE,sampleMsl}={}){
  const origin=Number(originElevationM),cx=Number(center?.[0])||0,cy=Number(center?.[1])||0,half=Math.max(20,Number(halfExtentM)||WORLD_TERRAIN_HALF_EXTENT_M),size=Math.max(3,Math.floor(Number(gridSize)||WORLD_TERRAIN_GRID_SIZE));
  if(!finite(origin)||typeof sampleMsl!=='function')return null;
  const step=2*half/(size-1),positions=new Float32Array(size*size*3),elevations=new Float64Array(size*size);let minZ=Infinity,maxZ=-Infinity;
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const x=cx-half+col*step,y=cy-half+row*step,msl=sampleMsl(x,y);if(!finite(msl))return null;const z=Number(msl)-origin,index=row*size+col,offset=index*3;elevations[index]=z;positions[offset]=x;positions[offset+1]=y;positions[offset+2]=z;minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
  }
  const indices=new Uint32Array((size-1)*(size-1)*6);let k=0;
  for(let row=0;row<size-1;row++)for(let col=0;col<size-1;col++){
    const a=row*size+col,b=a+1,d=(row+1)*size+col,c=d+1;
    indices[k++]=a;indices[k++]=b;indices[k++]=c;indices[k++]=a;indices[k++]=c;indices[k++]=d;
  }
  const hash=`dem-${hashRows([origin.toFixed(2),cx.toFixed(1),cy.toFixed(1),half.toFixed(1),size,minZ.toFixed(2),maxZ.toFixed(2),...Array.from(elevations,(_,i)=>i%37===0?elevations[i].toFixed(2):'')])}`;
  return Object.freeze({hash,originElevationM:origin,center:Object.freeze([cx,cy]),halfExtentM:half,gridSize:size,stepM:step,minZ,maxZ,positions,indices,elevations});
}

export function normalizeTerrainSnapshot(snapshot){
  if(!snapshot||!finite(snapshot.originElevationM)||!Array.isArray(snapshot.center)||snapshot.center.length<2||!(snapshot.gridSize>=3)||!(snapshot.stepM>0)||!(snapshot.positions?.length>=27)||!(snapshot.indices?.length>=6))return null;
  return snapshot;
}

export function terrainHeightAt(snapshot,x,y){
  const s=normalizeTerrainSnapshot(snapshot);if(!s)return null;const size=s.gridSize,half=s.halfExtentM,cx=s.center[0],cy=s.center[1],fx=(Number(x)-(cx-half))/s.stepM,fy=(Number(y)-(cy-half))/s.stepM;if(!finite(fx)||!finite(fy)||fx<0||fy<0||fx>size-1||fy>size-1)return null;
  const x0=clamp(Math.floor(fx),0,size-2),y0=clamp(Math.floor(fy),0,size-2),tx=clamp(fx-x0,0,1),ty=clamp(fy-y0,0,1),e=s.elevations||null;
  const value=(row,col)=>e?Number(e[row*size+col]):Number(s.positions[(row*size+col)*3+2]);
  const z00=value(y0,x0),z10=value(y0,x0+1),z01=value(y0+1,x0),z11=value(y0+1,x0+1);if(![z00,z10,z01,z11].every(finite))return null;
  return(z00*(1-tx)+z10*tx)*(1-ty)+(z01*(1-tx)+z11*tx)*ty;
}

export function raycastTerrainSnapshot(snapshot,origin,direction,maxDistance=1200){
  const s=normalizeTerrainSnapshot(snapshot);if(!s||!origin||!direction)return null;const ox=Number(origin.x??origin[0]),oy=Number(origin.y??origin[1]),oz=Number(origin.z??origin[2]),dx=Number(direction.x??direction[0]),dy=Number(direction.y??direction[1]),dz=Number(direction.z??direction[2]),length=Math.hypot(dx,dy,dz);if(![ox,oy,oz,dx,dy,dz,length].every(finite)||length<1e-9)return null;const ux=dx/length,uy=dy/length,uz=dz/length,limit=Math.max(.1,Number(maxDistance)||1200),step=Math.max(.5,Math.min(4,s.stepM*.35));let previousT=0,previousDiff=null;
  for(let t=0;t<=limit;t+=step){const x=ox+ux*t,y=oy+uy*t,z=oz+uz*t,ground=terrainHeightAt(s,x,y);if(ground===null){previousDiff=null;previousT=t;continue;}const diff=z-ground;if(diff<=0&&previousDiff!==null&&previousDiff>0){let lo=previousT,hi=t;for(let i=0;i<18;i++){const mid=(lo+hi)/2,mx=ox+ux*mid,my=oy+uy*mid,mz=oz+uz*mid,mh=terrainHeightAt(s,mx,my);if(mh===null){lo=mid;continue;}if(mz-mh>0)lo=mid;else hi=mid;}const hitT=(lo+hi)/2,xh=ox+ux*hitT,yh=oy+uy*hitT,zh=terrainHeightAt(s,xh,yh);if(zh===null)return null;const eps=Math.max(.5,s.stepM*.2),zx1=terrainHeightAt(s,xh+eps,yh),zx0=terrainHeightAt(s,xh-eps,yh),zy1=terrainHeightAt(s,xh,yh+eps),zy0=terrainHeightAt(s,xh,yh-eps),nx=finite(zx1)&&finite(zx0)?-(zx1-zx0)/(2*eps):0,ny=finite(zy1)&&finite(zy0)?-(zy1-zy0)/(2*eps):0,nl=Math.hypot(nx,ny,1)||1;return{distance:hitT,point:[xh,yh,zh],normal:[nx/nl,ny/nl,1/nl]};}previousDiff=diff;previousT=t;}
  return null;
}