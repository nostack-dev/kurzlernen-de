export function distanceToFoci(x,y,foci=[]){
  if(!Array.isArray(foci)||!foci.length)return 0;
  let best=Infinity;
  for(const focus of foci){
    const fx=Number(focus?.x),fy=Number(focus?.y);
    if(!Number.isFinite(fx)||!Number.isFinite(fy))continue;
    best=Math.min(best,Math.hypot((Number(x)||0)-fx,(Number(y)||0)-fy));
  }
  return Number.isFinite(best)?best:0;
}

export function retentionDecision({distanceM=0,nowMs=0,outsideSinceMs=0,lastProtectedAtMs=0,retentionRadiusM,recycleRadiusM,recycleGraceMs,viewGraceMs=4000,protectedNow=false}={}){
  const distance=Math.max(0,Number(distanceM)||0),now=Math.max(0,Number(nowMs)||0),retention=Math.max(0,Number(retentionRadiusM)||0),recycle=Math.max(retention,Number(recycleRadiusM)||retention),grace=Math.max(0,Number(recycleGraceMs)||0),viewGrace=Math.max(0,Number(viewGraceMs)||0);
  let outside=Math.max(0,Number(outsideSinceMs)||0),protectedAt=Math.max(0,Number(lastProtectedAtMs)||0);
  if(protectedNow)protectedAt=now;
  if(distance<=retention)return{recycle:false,outsideSinceMs:0,lastProtectedAtMs:protectedAt,reason:"retention"};
  if(distance<=recycle)return{recycle:false,outsideSinceMs:outside,lastProtectedAtMs:protectedAt,reason:"hysteresis"};
  if(!outside)outside=now;
  if(now-outside<grace)return{recycle:false,outsideSinceMs:outside,lastProtectedAtMs:protectedAt,reason:"grace"};
  if(protectedNow||protectedAt&&now-protectedAt<viewGrace)return{recycle:false,outsideSinceMs:outside,lastProtectedAtMs:protectedAt,reason:"view-grace"};
  return{recycle:true,outsideSinceMs:outside,lastProtectedAtMs:protectedAt,reason:"retire"};
}
