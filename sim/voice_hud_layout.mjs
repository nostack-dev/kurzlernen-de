// Compact voice controls stay near a player's thumb, not in the centre of the view.
// Pure geometry: use real HUD rectangles and reject intersecting touch targets.
export const VOICE_HUD_LAYOUT_VERSION="edge-thumb-voice-v1";
export function voiceHudPosition({width,height,move=null,look=null,blocked=[],size=38,gap=5,safe=8}={}){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<320||height<230)return null;
  const s=Math.max(8,Number(safe)||8),unit=Math.max(30,Number(size)||38),step=Math.max(3,Number(gap)||5),w=unit,h=unit*2+step;
  const edges=[
    {x:s,y:(move?.top??height*.62)-h-8},
    {x:width-s-w,y:(look?.top??height*.62)-h-8},
    {x:s,y:(move?.top??height*.62)-h-48},
    {x:width-s-w,y:(look?.top??height*.62)-h-48},
    {x:s,y:s+46},
    {x:width-s-w,y:s+46},
    {x:s,y:height-h-s},
    {x:width-s-w,y:height-h-s}
  ];
  for(const c of edges){
    const x=Math.round(c.x),y=Math.round(c.y),box={left:x,top:y,right:x+w,bottom:y+h};
    if(box.left<s-1||box.right>width-s+1||box.top<s-1||box.bottom>height-s+1)continue;
    // Left and right thirds only. The centre is deliberately left clear for aiming.
    if(box.left<width*.35&&box.right>width*.35||box.left<width*.65&&box.right>width*.65)continue;
    const overlap=blocked.some(other=>other&&Number.isFinite(other.left)&&box.left<other.right+4&&box.right>other.left-4&&box.top<other.bottom+4&&box.bottom>other.top-4);
    if(!overlap)return{x,y,width:w,height:h,side:x<width/2?"left":"right"};
  }
  return null; // Never draw over controls when the screen has no safe slot.
}
