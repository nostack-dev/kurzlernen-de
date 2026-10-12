// Compact voice controls stay near a player's thumb, not in the centre of the view.
// Pure geometry: use real HUD rectangles and reject intersecting touch targets.
export const VOICE_HUD_LAYOUT_VERSION="edge-low-thumb-voice-v3";
export function voiceHudPosition({width,height,move=null,look=null,blocked=[],size=38,gap=5,safe=8}={}){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<320||height<230)return null;
  const s=Math.max(8,Number(safe)||8),unit=Math.max(30,Number(size)||38),step=Math.max(3,Number(gap)||5),w=unit,h=unit*2+step;
  const edges=[
    // Slightly LOWER than the old pair. Sit just inward of the two sticks
    // so this remains reachable without occupying the play/aim center.
    {x:(move?.right??(s+110))+10,y:(move?.top??height*.62)-h+13},
    {x:(look?.left??(width-s-110))-w-10,y:(look?.top??height*.62)-h+13},
    {x:s,y:(move?.top??height*.62)-h-4},
    {x:width-s-w,y:(look?.top??height*.62)-h-8},
    {x:s,y:(move?.top??height*.62)-h-48},
    {x:width-s-w,y:(look?.top??height*.62)-h-48},
    {x:s,y:s+46},
    {x:width-s-w,y:s+46},
    {x:s,y:height-h-s},
    {x:width-s-w,y:height-h-s}
  ];
  const trySlot=c=>{
    const x=Math.round(c.x),y=Math.round(c.y),box={left:x,top:y,right:x+w,bottom:y+h};
    if(box.left<s-1||box.right>width-s+1||box.top<s-1||box.bottom>height-s+1)return null;
    // Left and right thirds only. Never steal the centre of the player's sightline.
    if(box.left<width*.35&&box.right>width*.35||box.left<width*.65&&box.right>width*.65)return null;
    if(blocked.some(other=>other&&Number.isFinite(other.left)&&box.left<other.right+4&&box.right>other.left-4&&box.top<other.bottom+4&&box.bottom>other.top-4))return null;
    return{x,y,width:w,height:h,side:x<width/2?"left":"right"};
  };
  for(const c of edges){const slot=trySlot(c);if(slot)return slot;}
  // Vehicle boarding buttons may appear at runtime exactly where the normal
  // right-thumb voice slot sat (notably 360x740 CSS-rotated portrait).
  // Search the WHOLE safe border in 4px steps before giving up, ordered by
  // distance to the thumb's preferred y. No middle-screen fallback.
  const minY=s,maxY=Math.floor(height-h-s);
  const slots=[];
  for(const [side,edge,anchor] of [
    ["left",s,(move?.top??height*.62)-h+10],
    ["right",width-s-w,(look?.top??height*.62)-h+10]
  ]){
    // A vehicle button may occupy the complete outer strip, so try one or
    // two button-widths inward while remaining strictly in the outer third.
    for(let inset=0;inset<=2;inset++){
      const x=edge+(side==="left"?1:-1)*inset*(w+6);
      for(let y=minY;y<=maxY;y+=4)slots.push({x,y,side,rank:Math.abs(y-anchor)+inset*18});
      if((maxY-minY)%4)slots.push({x,y:maxY,side,rank:Math.abs(maxY-anchor)+inset*18});
    }
  }
  slots.sort((a,b)=>a.rank-b.rank||(a.side==="left"?-1:1));
  for(const slot of slots){const found=trySlot(slot);if(found)return found;}
  return null; // Only when literally no unobstructed touch-edge slot remains.
}
