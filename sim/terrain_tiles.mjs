import {terrainNodeHeightAt,bridgeDecks,TERRAIN_FIELD_HALF_M,TERRAIN_FIELD_STEP_M} from "./terrain_craters.mjs";
import {elevationAt,elevationCenter} from "./terrain_elevation.mjs";
import {shockHeightAt,shockFieldState} from "./nuke_shock_field.mjs";

// The physical terrain as Box3D height-field tiles — the one truth that the
// rendered ground (world_ground.mjs, same 5 m nodes, same SW–NE diagonal),
// walkers, crowds, cars and the drone all share.
//
// Box3D rules followed here (official repo, docs/collision.md "Height Fields"
// and src/shape.c):
//   * a height-field shape keeps a *pointer* to its b3HeightFieldData — the
//     data must stay alive as long as the shape exists and may only be
//     destroyed after the shape referencing it ("Destroy the height field
//     after the shape referencing it has been destroyed");
//   * height fields are static-only and immutable, so terrain deformation =
//     build a new field for the changed tile, swap the shape, then free the
//     old field. Tiles keep that cheap: a crater touches a handful of tiles,
//     the moving nuke pressure wave only the ring of tiles under its front;
//   * height fields side by side line up at their seams (each tile shares its
//     border nodes with its neighbours; quantisation error < 2 mm).
//
// No ghost collisions at seams: Box3D smooths internal edges only inside one
// height field — at the boundary edge of a separate tile a fast body (a wheel
// at 35 m/s) got a tilted contact normal and was launched. Each tile therefore
// reaches one cell into its neighbours with its outer ring sunk SKIRT_DROP_M
// below the true surface: the seam is an interior edge of both tiles and every
// boundary edge lies hidden under the neighbour's surface.
//
// Frame: Box3D height fields are y-up; each tile body is rotated +90° about x
// so local y -> world z and local z -> world -y (rows run north -> south).

export const TERRAIN_TILES_VERSION="box3d-heightfield-tiles-v2-overlap-skirts";
export const TILE_CELLS=32;
const ST=TERRAIN_FIELD_STEP_M,TILE_M=TILE_CELLS*ST,N=TILE_CELLS+3,ROT=[Math.SQRT1_2,0,0,Math.SQRT1_2],SKIRT_DROP_M=.05;
const SHOCK_BAND_BEHIND_M=150,SHOCK_BAND_AHEAD_M=80,SHOCK_UPDATE_MS=40;

export class TerrainTiles{
  constructor(b3,world,shapeDef,{floorHalfM=10000}={}){
    this.b3=b3;this.world=world;this.shapeDef=shapeDef;this.floorHalfM=floorHalfM;
    this.tiles=new Map();this.extraBodies=[];this.centerKey="";this.heights=new Float32Array(N*N);
    this.shocked=new Set();this.lastShockAt=-Infinity;this.tileBuilds=0;this.available=typeof b3?.b3CreateHeightField==="function"&&typeof b3?.b3CreateHeightFieldShape==="function"&&typeof b3?.b3DestroyShape==="function";
  }
  get bodies(){return[...[...this.tiles.values()].map(t=>t.body),...this.extraBodies];}
  get shapeCount(){return this.tiles.size+this.extraBodies.length;}
  // regions: null = rebuild everything, else [[x0,y0,x1,y1],...] that changed
  update(regions=null){
    if(!this.available||!this.world)return 0;
    const[cx,cy]=elevationCenter(),key=`${Math.round(cx)},${Math.round(cy)}`;
    if(regions===null||key!==this.centerKey){this.rebuildAll(cx,cy);this.centerKey=key;return this.tiles.size;}
    let n=0;for(const t of this.tiles.values())if(regions.some(r=>r[0]<=t.x1+ST&&r[2]>=t.x0-ST&&r[1]<=t.y1+ST&&r[3]>=t.y0-ST)){this.writeTile(t,this.shocked.has(t));n++;}
    return n;
  }
  rebuildAll(cx,cy){
    this.destroyAll();const b3=this.b3,H=TERRAIN_FIELD_HALF_M,i0=Math.floor((cx-H)/TILE_M),i1=Math.ceil((cx+H)/TILE_M)-1,j0=Math.floor((cy-H)/TILE_M),j1=Math.ceil((cy+H)/TILE_M)-1;let mn=Infinity;
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const x0=i*TILE_M,y0=j*TILE_M,def=b3.b3DefaultBodyDef();def.type=b3.b3BodyType.b3_staticBody;def.position=[x0-ST,y0+TILE_M+ST,0];def.rotation=[...ROT];
      const t={i,j,x0,y0,x1:x0+TILE_M,y1:y0+TILE_M,body:b3.b3CreateBody(this.world,def),shape:null,field:null};this.tiles.set(`${i},${j}`,t);
      this.writeTile(t,false);if(t.min<mn)mn=t.min;
    }
    // beyond the tiles: a flat floor well below the lowest terrain
    const floorDef=b3.b3DefaultBodyDef();floorDef.type=b3.b3BodyType.b3_staticBody;floorDef.position=[cx,cy,(Number.isFinite(mn)?mn:0)-6];const floor=b3.b3CreateBody(this.world,floorDef);b3.b3CreateBoxShape(floor,this.shapeDef,this.floorHalfM,this.floorHalfM,.5);this.extraBodies.push(floor);
    for(const br of bridgeDecks()){const e=elevationAt(br.cx,br.cy),d=b3.b3DefaultBodyDef();d.type=b3.b3BodyType.b3_staticBody;d.position=[br.cx,br.cy,e-.25];d.rotation=[0,0,Math.sin(br.yaw/2),Math.cos(br.yaw/2)];const body=b3.b3CreateBody(this.world,d);b3.b3CreateBoxShape(body,this.shapeDef,br.hl,br.hw,.25);this.extraBodies.push(body);}
    this.shocked.clear();
  }
  // New field first, then swap the shape, then free the old field (never the
  // other way round: the live shape points at its field's memory).
  writeTile(t,withShock){
    const b3=this.b3,h=this.heights;let mn=Infinity;
    for(let r=0;r<N;r++){const y=t.y1+ST-r*ST;for(let c=0;c<N;c++){const x=t.x0-ST+c*ST;let v=terrainNodeHeightAt(x,y);if(withShock)v+=shockHeightAt(x,y);if(r===0||c===0||r===N-1||c===N-1)v-=SKIRT_DROP_M;h[r*N+c]=v;if(v<mn)mn=v;}}
    const field=b3.b3CreateHeightField(h,N,N,[ST,1,ST]);if(!field)return false;
    if(t.shape){b3.b3DestroyShape(t.shape,false);t.shape=null;}
    t.shape=b3.b3CreateHeightFieldShape(t.body,this.shapeDef,field);
    if(t.field)b3.b3DestroyHeightField(t.field);t.field=field;t.min=mn;this.tileBuilds++;return true;
  }
  // The nuke pressure wave is real ground motion: tiles under the moving front
  // carry static height + heave (rebuilt at 25 Hz), tiles it has passed return
  // to their static height. Between updates the wave lags < 40 ms.
  tick(now=performance.now?.()??Date.now()){
    if(!this.available||!this.tiles.size||now-this.lastShockAt<SHOCK_UPDATE_MS)return 0;
    const s=shockFieldState();if(!s&&!this.shocked.size)return 0;this.lastShockAt=now;
    const want=new Set();
    if(s&&s.heave>0){const lo=Math.max(0,s.radius-SHOCK_BAND_BEHIND_M),hi=s.radius+SHOCK_BAND_AHEAD_M;
      for(const t of this.tiles.values()){const nx=Math.max(t.x0,Math.min(s.x,t.x1)),ny=Math.max(t.y0,Math.min(s.y,t.y1)),dmin=Math.hypot(nx-s.x,ny-s.y),fx=Math.max(Math.abs(t.x0-s.x),Math.abs(t.x1-s.x)),fy=Math.max(Math.abs(t.y0-s.y),Math.abs(t.y1-s.y)),dmax=Math.hypot(fx,fy);if(dmax>=lo&&dmin<=hi)want.add(t);}}
    let n=0;for(const t of want){this.writeTile(t,true);n++;}
    for(const t of this.shocked)if(!want.has(t)){this.writeTile(t,false);n++;}
    this.shocked=want;return n;
  }
  destroyAll(){
    const b3=this.b3;
    for(const t of this.tiles.values()){if(t.shape&&b3.b3Shape_IsValid?.(t.shape)!==false)b3.b3DestroyShape(t.shape,false);t.shape=null;if(t.body&&b3.b3Body_IsValid?.(t.body)!==false)b3.b3DestroyBody(t.body);if(t.field)b3.b3DestroyHeightField(t.field);t.field=null;}
    this.tiles.clear();for(const body of this.extraBodies)if(b3.b3Body_IsValid?.(body)!==false)b3.b3DestroyBody(body);this.extraBodies=[];this.shocked.clear();
  }
}
