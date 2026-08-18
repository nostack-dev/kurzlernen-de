const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export const WORLD_DEM_ZOOM=14;
export const WORLD_DEM_TILE_SIZE=512;
export const WORLD_DEM_TILE_URL='https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
export const WORLD_DEM_ENCODING='terrarium';
export const WORLD_DEM_ATTRIBUTION='Terrain © Mapterhorn contributors';

export function decodeTerrariumHeight(r,g,b){return Number(r)*256+Number(g)+Number(b)/256-32768;}
export function lonLatToGlobalDemPixel(longitude,latitude,{zoom=WORLD_DEM_ZOOM,tileSize=WORLD_DEM_TILE_SIZE}={}){
  const lon=clamp(Number(longitude),-180,180),lat=clamp(Number(latitude),-85.05112878,85.05112878),n=2**zoom,sin=Math.sin(lat*Math.PI/180),tileX=(lon+180)/360*n,tileY=(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*n;
  return{x:tileX*tileSize,y:tileY*tileSize,zoom,tileSize};
}
function tileKey(z,x,y){return`${z}/${x}/${y}`;}
function wrappedTileX(x,z){const n=2**z;return((x%n)+n)%n;}

export class WorldDemSampler{
  constructor({zoom=WORLD_DEM_ZOOM,tileSize=WORLD_DEM_TILE_SIZE,urlTemplate=WORLD_DEM_TILE_URL,maxCache=32}={}){this.zoom=zoom;this.tileSize=tileSize;this.urlTemplate=urlTemplate;this.maxCache=maxCache;this.cache=new Map();this.pending=new Map();}
  tileUrl(x,y){return this.urlTemplate.replace('{z}',String(this.zoom)).replace('{x}',String(wrappedTileX(x,this.zoom))).replace('{y}',String(y));}
  async loadTile(x,y){
    const n=2**this.zoom,tx=wrappedTileX(x,this.zoom);if(y<0||y>=n)throw new Error(`DEM tile outside WebMercator ${this.zoom}/${tx}/${y}`);const key=tileKey(this.zoom,tx,y),cached=this.cache.get(key);if(cached){cached.used=performance.now?.()||Date.now();return cached;}if(this.pending.has(key))return this.pending.get(key);
    const promise=(async()=>{const response=await fetch(this.tileUrl(tx,y),{mode:'cors',cache:'force-cache'});if(!response.ok)throw new Error(`DEM HTTP ${response.status} for ${key}`);const blob=await response.blob(),bitmap=await createImageBitmap(blob),width=bitmap.width,height=bitmap.height;if(width!==this.tileSize||height!==this.tileSize){bitmap.close?.();throw new Error(`DEM tile ${key} is ${width}x${height}, expected ${this.tileSize}`);}const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(width,height):document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close?.();const pixels=ctx.getImageData(0,0,width,height).data,entry={pixels,width,height,used:performance.now?.()||Date.now()};this.cache.set(key,entry);while(this.cache.size>this.maxCache){let oldestKey=null,oldest=Infinity;for(const[k,v]of this.cache){if(v.used<oldest){oldest=v.used;oldestKey=k;}}if(oldestKey===null)break;this.cache.delete(oldestKey);}return entry;})().finally(()=>this.pending.delete(key));this.pending.set(key,promise);return promise;
  }
  async ensurePixels(points){const keys=new Map();for(const point of points){const base=lonLatToGlobalDemPixel(point[0],point[1],{zoom:this.zoom,tileSize:this.tileSize}),x0=Math.floor(base.x),y0=Math.floor(base.y);for(const[px,py]of[[x0,y0],[x0+1,y0],[x0,y0+1],[x0+1,y0+1]]){const tx=Math.floor(px/this.tileSize),ty=Math.floor(py/this.tileSize);keys.set(tileKey(this.zoom,wrappedTileX(tx,this.zoom),ty),[tx,ty]);}}await Promise.all([...keys.values()].map(([x,y])=>this.loadTile(x,y)));}
  pixelHeight(globalX,globalY){const tx=Math.floor(globalX/this.tileSize),ty=Math.floor(globalY/this.tileSize),lx=((globalX%this.tileSize)+this.tileSize)%this.tileSize,ly=((globalY%this.tileSize)+this.tileSize)%this.tileSize,key=tileKey(this.zoom,wrappedTileX(tx,this.zoom),ty),tile=this.cache.get(key);if(!tile)return null;tile.used=performance.now?.()||Date.now();const offset=(ly*tile.width+lx)*4,p=tile.pixels;return decodeTerrariumHeight(p[offset],p[offset+1],p[offset+2]);}
  sampleCached(longitude,latitude){const p=lonLatToGlobalDemPixel(longitude,latitude,{zoom:this.zoom,tileSize:this.tileSize}),x0=Math.floor(p.x),y0=Math.floor(p.y),tx=p.x-x0,ty=p.y-y0,h00=this.pixelHeight(x0,y0),h10=this.pixelHeight(x0+1,y0),h01=this.pixelHeight(x0,y0+1),h11=this.pixelHeight(x0+1,y0+1);if(![h00,h10,h01,h11].every(Number.isFinite))return null;return(h00*(1-tx)+h10*tx)*(1-ty)+(h01*(1-tx)+h11*tx)*ty;}
  async sampleMany(points){const list=points.map(point=>[Number(point[0]),Number(point[1])]);if(list.some(point=>!point.every(Number.isFinite)))throw new Error('DEM sample coordinates must be finite');await this.ensurePixels(list);return list.map(point=>this.sampleCached(point[0],point[1]));}
  async sample(longitude,latitude){return(await this.sampleMany([[longitude,latitude]]))[0];}
}
