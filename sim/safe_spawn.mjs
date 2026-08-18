const finite=value=>Number.isFinite(Number(value));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export const SAFE_SPAWN_MAX_SLOPE_DEG=18;
export const SAFE_SPAWN_RESPAWN_MIN_M=18;
export const SAFE_SPAWN_RESPAWN_MAX_M=35;
export const SAFE_SPAWN_EXTRA_RINGS_M=Object.freeze([50,70,95]);

function seededUnit(seed){let state=(Number(seed)>>>0)||0x9e3779b9;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};}
function offsets(mode,rng){
  if(mode==='respawn'){
    const result=[];for(let i=0;i<20;i++){const angle=(i/20)*Math.PI*2+(rng()-.5)*.22,radius=SAFE_SPAWN_RESPAWN_MIN_M+(SAFE_SPAWN_RESPAWN_MAX_M-SAFE_SPAWN_RESPAWN_MIN_M)*(.35+.65*rng());result.push([Math.cos(angle)*radius,Math.sin(angle)*radius]);}
    for(const radius of SAFE_SPAWN_EXTRA_RINGS_M)for(let i=0;i<16;i++){const angle=(i/16)*Math.PI*2+rng()*Math.PI*2;result.push([Math.cos(angle)*radius,Math.sin(angle)*radius]);}return result;
  }
  const result=[[0,0]];for(const radius of [2,4,7,11,16,24,34,48])for(let i=0;i<12;i++){const angle=(i/12)*Math.PI*2;result.push([Math.cos(angle)*radius,Math.sin(angle)*radius]);}return result;
}

export function findSafeSpawn({around=[0,0,0],mode='initial',seed=1,clearanceRadiusM=.22,supportM=.022,separationM=.025,maxSlopeDeg=SAFE_SPAWN_MAX_SLOPE_DEG,probe}={}){
  if(typeof probe!=='function')throw new Error('safe spawn requires a physical probe');const ax=Number(around?.[0])||0,ay=Number(around?.[1])||0,radius=Math.max(.05,Number(clearanceRadiusM)||.22),rng=seededUnit(seed),minNormalZ=Math.cos(clamp(Number(maxSlopeDeg)||SAFE_SPAWN_MAX_SLOPE_DEG,1,60)*Math.PI/180),ring=[[0,0]];
  for(let i=0;i<8;i++){const angle=i*Math.PI/4;ring.push([Math.cos(angle)*radius,Math.sin(angle)*radius]);}
  let attempts=0;
  for(const [dx,dy] of offsets(mode,rng)){
    const x=ax+dx,y=ay+dy;let highest=-Infinity,lowest=Infinity,ok=true;
    for(const [rx,ry] of ring){attempts++;const hit=probe(x+rx,y+ry);if(!hit||!finite(hit.terrainZ)||!finite(hit.obstructionZ)||!finite(hit.normalZ)||hit.normalZ<minNormalZ||hit.obstructionZ>hit.terrainZ+.12){ok=false;break;}highest=Math.max(highest,Number(hit.terrainZ));lowest=Math.min(lowest,Number(hit.terrainZ));}
    if(!ok||!finite(highest)||highest-lowest>radius*.55)continue;
    return Object.freeze({x,y,z:highest+Math.max(.001,Number(supportM)||.022)+Math.max(.005,Number(separationM)||.025),groundZ:highest,offsetM:Math.hypot(dx,dy),attempts,mode});
  }
  return null;
}
