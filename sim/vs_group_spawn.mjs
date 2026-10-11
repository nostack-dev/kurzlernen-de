// Select the densest connected set of active players, never a remote home GPS.
// Points are all in the already-validated local shared frame (metres).
export function groupSpawnCenter(points,{linkM=65}={}){
  const valid=(Array.isArray(points)?points:[]).filter(p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!valid.length)return null;
  const seen=new Set();let best=[];
  for(let i=0;i<valid.length;i++){
    if(seen.has(i))continue;
    const component=[],queue=[i];seen.add(i);
    for(let k=0;k<queue.length;k++){
      const a=queue[k];component.push(valid[a]);
      for(let b=0;b<valid.length;b++)if(!seen.has(b)&&Math.hypot(valid[a][0]-valid[b][0],valid[a][1]-valid[b][1])<=linkM){seen.add(b);queue.push(b);}
    }
    if(component.length>best.length)best=component;
  }
  // Medoid stays on an actual player, not at an empty centroid across buildings.
  let winner=best[0],score=Infinity;
  for(const p of best){const d=best.reduce((sum,q)=>sum+Math.hypot(p[0]-q[0],p[1]-q[1]),0);
    if(d<score){score=d;winner=p;}}
  return [...winner];
}
