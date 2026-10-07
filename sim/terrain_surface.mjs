// Box3D's rotated height field and Three.PlaneGeometry share the SW–NE
// diagonal. Every query and overlay uses these same world-aligned cells.
export const TERRAIN_GRID_STEP_M=5;
export function triangleHeightAt(x,y,sample,step=TERRAIN_GRID_STEP_M){
  const x0=Math.floor(x/step)*step,y0=Math.floor(y/step)*step,u=(x-x0)/step,v=(y-y0)/step;
  const a=sample(x0,y0),d=sample(x0+step,y0+step);
  return u>=v?a+(sample(x0+step,y0)-a)*(u-v)+(d-a)*v:a+(sample(x0,y0+step)-a)*(v-u)+(d-a)*u;
}
function clip(poly,distance){
  const out=[];if(!poly.length)return out;
  let a=poly.at(-1),da=distance(a);
  for(const b of poly){const db=distance(b);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}if(db>=0)out.push(b);a=b;da=db;}return out;
}
// Split a decoration triangle along grid edges AND the height-field diagonal.
// Sampling just its three vertices lets curved terrain cut through roads.
export function drapeTerrainTriangle(a,b,c,heightAt,offset,emit,step=TERRAIN_GRID_STEP_M){
  const loX=Math.floor(Math.min(a[0],b[0],c[0])/step),hiX=Math.floor(Math.max(a[0],b[0],c[0])/step);
  const loY=Math.floor(Math.min(a[1],b[1],c[1])/step),hiY=Math.floor(Math.max(a[1],b[1],c[1])/step);
  for(let iy=loY;iy<=hiY;iy++)for(let ix=loX;ix<=hiX;ix++){
    const x=ix*step,y=iy*step;
    let p=clip([a,b,c],v=>v[0]-x);p=clip(p,v=>x+step-v[0]);p=clip(p,v=>v[1]-y);p=clip(p,v=>y+step-v[1]);
    for(const sign of[1,-1]){const q=clip(p,v=>sign*((v[0]-x)-(v[1]-y)));for(let i=1;i+1<q.length;i++){
      const A=q[0],B=q[i],C=q[i+1];if(Math.abs((B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0]))<1e-9)continue;
      emit(...[A,B,C].map(v=>[v[0],v[1],heightAt(v[0],v[1])+offset]));
    }}
  }
}
