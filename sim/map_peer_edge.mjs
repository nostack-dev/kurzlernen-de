// Pure map-space clipping. Outside peers must point towards their real bearing,
// not always north-east. This module has no map or renderer dependency.
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const ARROWS=['→','↘','↓','↙','←','↖','↑','↗'];

export function locateMapPeer(px,py,width,height,{insetX=16,insetTop=16,insetBottom=30}={}){
  if(![px,py,width,height,insetX,insetTop,insetBottom].every(Number.isFinite)||width<=2*insetX||height<=insetTop+insetBottom)return null;
  const minX=insetX,maxX=width-insetX,minY=insetTop,maxY=height-insetBottom;
  if(px>=minX&&px<=maxX&&py>=minY&&py<=maxY)return{x:px,y:py,offmap:false,arrow:'',rotationDeg:null};
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2,dx=px-cx,dy=py-cy;
  if(!dx&&!dy)return{x:cx,y:cy,offmap:false,arrow:'',rotationDeg:null};
  const tx=dx>0?(maxX-cx)/dx:dx<0?(minX-cx)/dx:Infinity;
  const ty=dy>0?(maxY-cy)/dy:dy<0?(minY-cy)/dy:Infinity;
  const t=Math.max(0,Math.min(tx,ty));
  const angle=Math.atan2(dy,dx);
  const arrow=ARROWS[(Math.round(angle/(Math.PI/4))+8)%8];
  return{x:clamp(cx+dx*t,minX,maxX),y:clamp(cy+dy*t,minY,maxY),offmap:true,arrow,rotationDeg:angle*180/Math.PI+90};
}
