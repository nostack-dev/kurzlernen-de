const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const finitePoint=point=>Array.isArray(point)&&point.length>=2&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1]));

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
export function pedestrianPointBlocked(x,y,prisms=[],clearanceM=.28){for(const prism of prisms||[])if(prismBlocksPoint(x,y,prism,clearanceM))return true;return false;}

function segmentBlocked(x0,y0,x1,y1,prisms=[],clearanceM=.28){
  if(pedestrianPointBlocked(x1,y1,prisms,clearanceM))return true;
  const a=[x0,y0],b=[x1,y1];
  for(const prism of prisms||[]){const points=prism?.points;if(!Array.isArray(points)||points.length<3)continue;if(pedestrianPointInPolygon(x0,y0,points))return true;for(let i=0;i<points.length;i++)if(segmentIntersects(a,b,points[i],points[(i+1)%points.length]))return true;}
  return false;
}

export function projectPedestrianOutsideBuildings(x,y,prisms=[],{clearanceM=.36,maxPasses=6}={}){
  let px=Number(x)||0,py=Number(y)||0,moved=false;const clearance=Math.max(.08,Number(clearanceM)||.36);
  for(let pass=0;pass<Math.max(1,Math.floor(maxPasses));pass++){
    let blocker=null,best=null,inside=false;
    for(const prism of prisms||[]){const points=prism?.points;if(!Array.isArray(points)||points.length<3)continue;const isInside=pedestrianPointInPolygon(px,py,points);let nearest=null;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],q=closestPointOnSegment(px,py,a,b),distance=Math.hypot(px-q.x,py-q.y);if(!nearest||distance<nearest.distance)nearest={a,b,q,distance};}if(isInside||(nearest&&nearest.distance<clearance)){if(!best||isInside&&!inside||isInside===inside&&nearest.distance<best.distance){blocker=prism;best=nearest;inside=isInside;}}}
    if(!blocker||!best)break;
    const points=blocker.points,dx=Number(best.b[0])-Number(best.a[0]),dy=Number(best.b[1])-Number(best.a[1]),length=Math.hypot(dx,dy)||1,n1={x:-dy/length,y:dx/length},n2={x:dy/length,y:-dx/length},probe=Math.max(.06,clearance*.5),outside1=!pedestrianPointInPolygon(best.q.x+n1.x*probe,best.q.y+n1.y*probe,points),normal=outside1?n1:n2;
    px=best.q.x+normal.x*(clearance+.01);py=best.q.y+normal.y*(clearance+.01);moved=true;
  }
  return{x:px,y:py,moved,blocked:pedestrianPointBlocked(px,py,prisms,Math.min(clearance*.45,.18))};
}

export function steerPedestrianStep({x=0,y=0,targetX=0,targetY=0,speedMps=1.3,dtS=1/60,prisms=[],clearanceM=.30,sideBias=1,headingHint=NaN}={}){
  const clearance=Math.max(.08,Number(clearanceM)||.30),start=projectPedestrianOutsideBuildings(x,y,prisms,{clearanceM:clearance}),sx=start.x,sy=start.y,dx=(Number(targetX)||0)-sx,dy=(Number(targetY)||0)-sy,distance=Math.hypot(dx,dy);
  if(distance<1e-5)return{x:sx,y:sy,heading:Number.isFinite(headingHint)?headingHint:0,blocked:false,ejected:start.moved};
  const desiredHeading=Math.atan2(dy,dx),step=Math.min(distance,Math.max(0,Number(speedMps)||0)*clamp(dtS,0,.08));
  if(step<=1e-6)return{x:sx,y:sy,heading:desiredHeading,blocked:false,ejected:start.moved};
  const directX=sx+Math.cos(desiredHeading)*step,directY=sy+Math.sin(desiredHeading)*step;
  if(!segmentBlocked(sx,sy,directX,directY,prisms,clearance))return{x:directX,y:directY,heading:desiredHeading,blocked:false,ejected:start.moved};
  const bias=Number(sideBias)<0?-1:1,hint=Number(headingHint),candidates=[];
  for(let i=1;i<=12;i++){const magnitude=i*Math.PI/24;for(const sign of[bias,-bias]){const heading=desiredHeading+sign*magnitude,nx=sx+Math.cos(heading)*step,ny=sy+Math.sin(heading)*step;if(segmentBlocked(sx,sy,nx,ny,prisms,clearance*.86))continue;const progress=Math.cos(magnitude),continuity=Number.isFinite(hint)?Math.cos(heading-hint):0,sideBonus=sign===bias?.08:0;candidates.push({x:nx,y:ny,heading,score:progress*2.3+continuity*.85+sideBonus});}}
  if(candidates.length){candidates.sort((a,b)=>b.score-a.score);const best=candidates[0];return{...best,blocked:true,ejected:start.moved};}
  return{x:sx,y:sy,heading:Number.isFinite(hint)?hint:desiredHeading,blocked:true,ejected:start.moved};
}
