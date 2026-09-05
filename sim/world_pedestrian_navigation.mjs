const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const finitePoint=point=>Array.isArray(point)&&point.length>=2&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1]));
const DEFAULT_CELL_M=16;

export function pedestrianPointInPolygon(x,y,points){
  if(!Array.isArray(points)||points.length<3)return false;
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];if(!finitePoint(a)||!finitePoint(b))continue;
    const xi=Number(a[0]),yi=Number(a[1]),xj=Number(b[0]),yj=Number(b[1]);
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi)inside=!inside;
  }
  return inside;
}

function closestPointOnSegment(x,y,a,b){
  const ax=Number(a[0]),ay=Number(a[1]),bx=Number(b[0]),by=Number(b[1]),dx=bx-ax,dy=by-ay,length2=dx*dx+dy*dy;
  if(length2<=1e-12)return{x:ax,y:ay,t:0};
  const t=clamp(((x-ax)*dx+(y-ay)*dy)/length2,0,1);return{x:ax+dx*t,y:ay+dy*t,t};
}
function orient(a,b,c){return(Number(b[0])-Number(a[0]))*(Number(c[1])-Number(a[1]))-(Number(b[1])-Number(a[1]))*(Number(c[0])-Number(a[0]));}
function segmentIntersects(a,b,c,d){
  const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b),eps=1e-9;
  if(Math.abs(o1)<eps||Math.abs(o2)<eps||Math.abs(o3)<eps||Math.abs(o4)<eps)return o1*o2<=eps&&o3*o4<=eps;
  return(o1>0)!==(o2>0)&&(o3>0)!==(o4>0);
}
function prismBlocksPoint(x,y,prism,clearanceM=0){
  const points=prism?.points;if(!Array.isArray(points)||points.length<3)return false;
  if(pedestrianPointInPolygon(x,y,points))return true;
  const clearance=Math.max(0,Number(clearanceM)||0);if(clearance<=0)return false;
  for(let i=0;i<points.length;i++){const q=closestPointOnSegment(x,y,points[i],points[(i+1)%points.length]);if(Math.hypot(x-q.x,y-q.y)<clearance)return true;}
  return false;
}

function cellKey(x,y){return`${x}:${y}`;}
function isIndex(value){return Boolean(value?.__pedestrianNavigationIndex);}
export function createPedestrianNavigationIndex(prisms=[],{cellSizeM=DEFAULT_CELL_M}={}){
  const cellSize=Math.max(4,Number(cellSizeM)||DEFAULT_CELL_M),items=[],cells=new Map();
  for(const prism of Array.isArray(prisms)?prisms:[]){
    const points=prism?.points;if(!Array.isArray(points)||points.length<3||!points.every(finitePoint))continue;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const point of points){const x=Number(point[0]),y=Number(point[1]);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    const item={prism,minX,minY,maxX,maxY},index=items.push(item)-1,cx0=Math.floor(minX/cellSize),cx1=Math.floor(maxX/cellSize),cy0=Math.floor(minY/cellSize),cy1=Math.floor(maxY/cellSize);
    for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++){const key=cellKey(cx,cy),bucket=cells.get(key);if(bucket)bucket.push(index);else cells.set(key,[index]);}
  }
  return{__pedestrianNavigationIndex:true,cellSize,items,cells,marks:new Uint32Array(items.length),stamp:0,scratch:[],queries:0,candidates:0,maxCandidates:0};
}
function queryCandidates(environment,minX,minY,maxX,maxY){
  if(!isIndex(environment))return Array.isArray(environment)?environment:[];
  const index=environment,cell=index.cellSize,cx0=Math.floor(minX/cell),cx1=Math.floor(maxX/cell),cy0=Math.floor(minY/cell),cy1=Math.floor(maxY/cell),out=index.scratch;out.length=0;
  index.stamp=(index.stamp+1)>>>0;if(index.stamp===0){index.marks.fill(0);index.stamp=1;}const stamp=index.stamp;
  for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++)for(const itemIndex of index.cells.get(cellKey(cx,cy))||[]){if(index.marks[itemIndex]===stamp)continue;index.marks[itemIndex]=stamp;const item=index.items[itemIndex];if(item.maxX<minX||item.minX>maxX||item.maxY<minY||item.minY>maxY)continue;out.push(item.prism);}
  index.queries++;index.candidates+=out.length;index.maxCandidates=Math.max(index.maxCandidates,out.length);return out;
}
export function pedestrianNavigationStats(environment){
  if(!isIndex(environment))return{indexed:false,totalPrisms:Array.isArray(environment)?environment.length:0,queries:0,candidates:0,averageCandidates:0,maxCandidates:0,cells:0};
  return{indexed:true,totalPrisms:environment.items.length,queries:environment.queries,candidates:environment.candidates,averageCandidates:environment.queries?environment.candidates/environment.queries:0,maxCandidates:environment.maxCandidates,cells:environment.cells.size};
}
export function pedestrianPointBlocked(x,y,environment=[],clearanceM=.28){
  const clearance=Math.max(0,Number(clearanceM)||0),candidates=queryCandidates(environment,x-clearance,y-clearance,x+clearance,y+clearance);for(const prism of candidates)if(prismBlocksPoint(x,y,prism,clearance))return true;return false;
}
function segmentBlockedCandidates(x0,y0,x1,y1,candidates=[],clearanceM=.28){
  if(candidates.some(prism=>prismBlocksPoint(x1,y1,prism,clearanceM)))return true;
  const a=[x0,y0],b=[x1,y1];
  for(const prism of candidates){const points=prism?.points;if(!Array.isArray(points)||points.length<3)continue;if(pedestrianPointInPolygon(x0,y0,points))return true;for(let i=0;i<points.length;i++)if(segmentIntersects(a,b,points[i],points[(i+1)%points.length]))return true;}
  return false;
}

export function projectPedestrianOutsideBuildings(x,y,environment=[],{clearanceM=.36,maxPasses=6}={}){
  let px=Number(x)||0,py=Number(y)||0,moved=false;const clearance=Math.max(.08,Number(clearanceM)||.36);
  for(let pass=0;pass<Math.max(1,Math.floor(maxPasses));pass++){
    let blocker=null,best=null,inside=false;const candidates=queryCandidates(environment,px-clearance,py-clearance,px+clearance,py+clearance);
    for(const prism of candidates){const points=prism?.points;if(!Array.isArray(points)||points.length<3)continue;const isInside=pedestrianPointInPolygon(px,py,points);let nearest=null;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],q=closestPointOnSegment(px,py,a,b),distance=Math.hypot(px-q.x,py-q.y);if(!nearest||distance<nearest.distance)nearest={a,b,q,distance};}if(isInside||(nearest&&nearest.distance<clearance)){if(!best||isInside&&!inside||isInside===inside&&nearest.distance<best.distance){blocker=prism;best=nearest;inside=isInside;}}}
    if(!blocker||!best)break;
    const points=blocker.points,dx=Number(best.b[0])-Number(best.a[0]),dy=Number(best.b[1])-Number(best.a[1]),length=Math.hypot(dx,dy)||1,n1={x:-dy/length,y:dx/length},n2={x:dy/length,y:-dx/length},probe=Math.max(.06,clearance*.5),outside1=!pedestrianPointInPolygon(best.q.x+n1.x*probe,best.q.y+n1.y*probe,points),normal=outside1?n1:n2;
    px=best.q.x+normal.x*(clearance+.01);py=best.q.y+normal.y*(clearance+.01);moved=true;
  }
  return{x:px,y:py,moved,blocked:pedestrianPointBlocked(px,py,environment,Math.min(clearance*.45,.18))};
}

export function steerPedestrianStep({x=0,y=0,targetX=0,targetY=0,speedMps=1.3,dtS=1/60,prisms=[],navigation=null,clearanceM=.30,sideBias=1,headingHint=NaN}={}){
  const environment=navigation||prisms,clearance=Math.max(.08,Number(clearanceM)||.30),start=projectPedestrianOutsideBuildings(x,y,environment,{clearanceM:clearance}),sx=start.x,sy=start.y,dx=(Number(targetX)||0)-sx,dy=(Number(targetY)||0)-sy,distance=Math.hypot(dx,dy);
  if(distance<1e-5)return{x:sx,y:sy,heading:Number.isFinite(headingHint)?headingHint:0,blocked:false,ejected:start.moved};
  const desiredHeading=Math.atan2(dy,dx),step=Math.min(distance,Math.max(0,Number(speedMps)||0)*clamp(dtS,0,.08));
  if(step<=1e-6)return{x:sx,y:sy,heading:desiredHeading,blocked:false,ejected:start.moved};
  const reach=step+clearance,candidates=queryCandidates(environment,sx-reach,sy-reach,sx+reach,sy+reach),directX=sx+Math.cos(desiredHeading)*step,directY=sy+Math.sin(desiredHeading)*step;
  if(!segmentBlockedCandidates(sx,sy,directX,directY,candidates,clearance))return{x:directX,y:directY,heading:desiredHeading,blocked:false,ejected:start.moved};
  const bias=Number(sideBias)<0?-1:1,hint=Number(headingHint),alternates=[];
  for(let i=1;i<=12;i++){const magnitude=i*Math.PI/24;for(const sign of[bias,-bias]){const heading=desiredHeading+sign*magnitude,nx=sx+Math.cos(heading)*step,ny=sy+Math.sin(heading)*step;if(segmentBlockedCandidates(sx,sy,nx,ny,candidates,clearance*.86))continue;const progress=Math.cos(magnitude),continuity=Number.isFinite(hint)?Math.cos(heading-hint):0,sideBonus=sign===bias?.08:0;alternates.push({x:nx,y:ny,heading,score:progress*2.3+continuity*.85+sideBonus});}}
  if(alternates.length){alternates.sort((a,b)=>b.score-a.score);const best=alternates[0];return{...best,blocked:true,ejected:start.moved};}
  return{x:sx,y:sy,heading:Number.isFinite(hint)?hint:desiredHeading,blocked:true,ejected:start.moved};
}
