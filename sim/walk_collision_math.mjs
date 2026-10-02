const EPSILON=1e-6;

export function pointInsidePolygon(x,y,points){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    const crosses=(a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/((b[1]-a[1])||1e-12)+a[0];
    if(crosses)inside=!inside;
  }
  return inside;
}

export function polygonEdgeDistance(x,y,points){
  let best=Infinity;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[j],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
    const t=length2?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/length2)):0;
    best=Math.min(best,Math.hypot(x-(a[0]+dx*t),y-(a[1]+dy*t)));
  }
  return best;
}

export function sweptPointClear(from,to,isBlocked,step=.12){
  const distance=Math.hypot(to.x-from.x,to.y-from.y),samples=Math.max(1,Math.ceil(distance/Math.max(.03,step)));
  for(let i=1;i<=samples;i++){
    const t=i/samples;
    if(isBlocked(from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t))return false;
  }
  return true;
}

export function insideEscapeImproves(from,to,polygons){
  const blockers=polygons.filter(points=>pointInsidePolygon(from.x,from.y,points));
  if(!blockers.length)return false;
  return blockers.every(points=>!pointInsidePolygon(to.x,to.y,points)||polygonEdgeDistance(to.x,to.y,points)+EPSILON<polygonEdgeDistance(from.x,from.y,points));
}
