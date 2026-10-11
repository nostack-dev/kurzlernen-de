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
