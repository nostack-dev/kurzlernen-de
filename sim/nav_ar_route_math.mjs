// Pure, world-metric polyline sampling for AR wayfinding. No rendering dependencies.
const finitePoint=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function sampleNavBreadcrumbs(points,position,{count=5,spacingM=18,startM=9}={}){
  if(!Array.isArray(points)||points.length<2||!finitePoint(position)||!points.every(finitePoint))return [];
  const lengths=[],cumulative=[0];
  for(let i=0;i<points.length-1;i++){
    const length=Math.hypot(points[i+1][0]-points[i][0],points[i+1][1]-points[i][1]);
    lengths.push(length);cumulative.push(cumulative[i]+length);
  }
  const total=cumulative.at(-1);if(total<.01)return [];
  let bestDistance=Infinity,along=0;
  for(let i=0;i<lengths.length;i++){
    const d=lengths[i];if(d<.001)continue;
    const [ax,ay]=points[i],[bx,by]=points[i+1];
    const t=clamp(((position[0]-ax)*(bx-ax)+(position[1]-ay)*(by-ay))/(d*d),0,1);
    const distance=Math.hypot(position[0]-(ax+(bx-ax)*t),position[1]-(ay+(by-ay)*t));
    if(distance<bestDistance){bestDistance=distance;along=cumulative[i]+d*t;}
  }
  const result=[];const maxCount=clamp(Math.floor(count),0,8),step=clamp(spacingM,2,500),first=clamp(startM,1,500);
  for(let j=0;j<maxCount;j++){
    const at=along+first+j*step;if(at>total+.001)break;
    for(let i=0;i<lengths.length;i++){
      if(at>cumulative[i+1]+.0001||lengths[i]<.001)continue;
      const t=clamp((at-cumulative[i])/lengths[i],0,1),a=points[i],b=points[i+1];
      result.push({p:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],bearingRad:Math.atan2(b[0]-a[0],b[1]-a[1]),leftM:total-at});break;
    }
  }
  return result;
}
// First meaningful turn ahead on a routed polyline. Distances follow the route,
// not the straight-line distance, and headings are smoothed over windowM.
export function findUpcomingNavTurn(points,position,{scanM=250,windowM=12,minAngleDeg=38}={}){
  if(!Array.isArray(points)||points.length<3||!finitePoint(position)||!points.every(finitePoint))return null;
  const cumulative=[0];
  for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  const total=cumulative.at(-1);if(total<2)return null;
  let along=0,best=Infinity;
  for(let i=0;i<points.length-1;i++){
    const len=cumulative[i+1]-cumulative[i];if(len<.001)continue;
    const a=points[i],b=points[i+1],t=clamp(((position[0]-a[0])*(b[0]-a[0])+(position[1]-a[1])*(b[1]-a[1]))/(len*len),0,1);
    const d=Math.hypot(position[0]-a[0]-(b[0]-a[0])*t,position[1]-a[1]-(b[1]-a[1])*t);
    if(d<best){best=d;along=cumulative[i]+len*t;}
  }
  function pointAt(distance){
    const d=clamp(distance,0,total);let lo=0,hi=cumulative.length-1;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(cumulative[mid]<d)lo=mid;else hi=mid;}
    const i=Math.min(cumulative.length-2,lo),len=cumulative[i+1]-cumulative[i];
    const t=len>1e-6?clamp((d-cumulative[i])/len,0,1):0;
    return[points[i][0]+(points[i+1][0]-points[i][0])*t,points[i][1]+(points[i+1][1]-points[i][1])*t];
  }
  const scan=clamp(scanM,5,1000),window=clamp(windowM,3,80),minAngle=clamp(minAngleDeg,15,160);
  for(let i=1;i<points.length-1;i++){
    const at=cumulative[i],away=at-along;if(away<1||away>scan)continue;
    const center=points[i],prev=pointAt(at-window),next=pointAt(at+window);
    const bx=center[0]-prev[0],by=center[1]-prev[1],ax=next[0]-center[0],ay=next[1]-center[1];
    if(Math.hypot(bx,by)<2||Math.hypot(ax,ay)<2)continue;
    const angle=Math.atan2(bx*ay-by*ax,bx*ax+by*ay)*180/Math.PI;
    if(Math.abs(angle)<minAngle)continue;
    return{direction:Math.abs(angle)>155?'u-turn':angle<0?'right':'left',distanceM:away,angleDeg:Math.abs(angle)};
  }
  return null;
}
