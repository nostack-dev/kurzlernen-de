const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const smoothstep=(edge0,edge1,value)=>{const t=clamp((value-edge0)/(edge1-edge0),0,1);return t*t*(3-2*t);};
const gaussian=(x,y,cx,cy,sx,sy,amplitude)=>{const dx=(x-cx)/sx,dy=(y-cy)/sy;return amplitude*Math.exp(-.5*(dx*dx+dy*dy));};

export const TERRAIN_GRID_COUNT=177;
export const TERRAIN_CELL_M=8;
export const TERRAIN_HALF_EXTENT_M=(TERRAIN_GRID_COUNT-1)*TERRAIN_CELL_M/2;
export const TERRAIN_FLAT_RADIUS_M=170;
export const TERRAIN_BLEND_RADIUS_M=260;
export const TERRAIN_SAFETY_BED_Z_M=-36;

function proceduralHeight(x,y){
  let h=9.5*Math.sin((x+70)*.0105)*Math.cos((y-35)*.0085);
  h+=5.8*Math.sin((x+y)*.017);
  h+=3.2*Math.cos((x-1.7*y)*.024);
  h+=gaussian(x,y,300,-210,145,120,22);
  h+=gaussian(x,y,-320,230,170,140,18);
  h+=gaussian(x,y,110,390,130,190,-13);
  h+=gaussian(x,y,-100,-420,190,120,12);
  const radius=Math.hypot(x,y),cityBlend=smoothstep(TERRAIN_FLAT_RADIUS_M,TERRAIN_BLEND_RADIUS_M,radius);
  const edgeBlend=1-smoothstep(TERRAIN_HALF_EXTENT_M-80,TERRAIN_HALF_EXTENT_M,Math.max(Math.abs(x),Math.abs(y)));
  return clamp(h*cityBlend*edgeBlend,-18,34);
}

const HEIGHTS=new Float32Array(TERRAIN_GRID_COUNT*TERRAIN_GRID_COUNT);
let minHeight=Infinity,maxHeight=-Infinity;
for(let iz=0;iz<TERRAIN_GRID_COUNT;iz++){
  const y=-TERRAIN_HALF_EXTENT_M+iz*TERRAIN_CELL_M;
  for(let ix=0;ix<TERRAIN_GRID_COUNT;ix++){
    const x=-TERRAIN_HALF_EXTENT_M+ix*TERRAIN_CELL_M,h=proceduralHeight(x,y),index=iz*TERRAIN_GRID_COUNT+ix;
    HEIGHTS[index]=h;minHeight=Math.min(minHeight,h);maxHeight=Math.max(maxHeight,h);
  }
}

const sample=(ix,iz)=>HEIGHTS[iz*TERRAIN_GRID_COUNT+ix];
export function terrainHeightAt(x,y){
  const px=Number(x),py=Number(y);
  if(!Number.isFinite(px)||!Number.isFinite(py))throw new Error('terrainHeightAt expects finite x/y');
  if(px<-TERRAIN_HALF_EXTENT_M||px>TERRAIN_HALF_EXTENT_M||py<-TERRAIN_HALF_EXTENT_M||py>TERRAIN_HALF_EXTENT_M)return TERRAIN_SAFETY_BED_Z_M;
  const fx=(px+TERRAIN_HALF_EXTENT_M)/TERRAIN_CELL_M,fz=(py+TERRAIN_HALF_EXTENT_M)/TERRAIN_CELL_M;
  const ix=Math.min(TERRAIN_GRID_COUNT-2,Math.max(0,Math.floor(fx))),iz=Math.min(TERRAIN_GRID_COUNT-2,Math.max(0,Math.floor(fz)));
  const tx=clamp(fx-ix,0,1),tz=clamp(fz-iz,0,1),h00=sample(ix,iz),h10=sample(ix+1,iz),h01=sample(ix,iz+1),h11=sample(ix+1,iz+1);
  if(tx>=tz)return h00+tx*(h10-h00)+tz*(h11-h10);
  return h00+tx*(h11-h01)+tz*(h01-h00);
}

export function createTerrainMeshData(){
  const vertexCount=TERRAIN_GRID_COUNT*TERRAIN_GRID_COUNT,quadCount=(TERRAIN_GRID_COUNT-1)*(TERRAIN_GRID_COUNT-1),positions=new Float32Array(vertexCount*3),indices=new Uint32Array(quadCount*6);
  let p=0;
  for(let iz=0;iz<TERRAIN_GRID_COUNT;iz++){
    const y=-TERRAIN_HALF_EXTENT_M+iz*TERRAIN_CELL_M;
    for(let ix=0;ix<TERRAIN_GRID_COUNT;ix++){
      const x=-TERRAIN_HALF_EXTENT_M+ix*TERRAIN_CELL_M,index=iz*TERRAIN_GRID_COUNT+ix;
      positions[p++]=x;positions[p++]=y;positions[p++]=HEIGHTS[index];
    }
  }
  let q=0;
  for(let iz=0;iz<TERRAIN_GRID_COUNT-1;iz++)for(let ix=0;ix<TERRAIN_GRID_COUNT-1;ix++){
    const i00=iz*TERRAIN_GRID_COUNT+ix,i10=i00+1,i01=i00+TERRAIN_GRID_COUNT,i11=i01+1;
    indices[q++]=i00;indices[q++]=i10;indices[q++]=i11;
    indices[q++]=i00;indices[q++]=i11;indices[q++]=i01;
  }
  return {positions,indices};
}

export function terrainStats(){
  return Object.freeze({gridCount:TERRAIN_GRID_COUNT,cellM:TERRAIN_CELL_M,halfExtentM:TERRAIN_HALF_EXTENT_M,minHeightM:minHeight,maxHeightM:maxHeight,triangleCount:(TERRAIN_GRID_COUNT-1)*(TERRAIN_GRID_COUNT-1)*2});
}

export function createTerrainThreeMesh(THREE){
  const {positions,indices}=createTerrainMeshData(),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));
  const colors=new Float32Array((positions.length/3)*3),color=new THREE.Color();
  for(let iz=0;iz<TERRAIN_GRID_COUNT;iz++)for(let ix=0;ix<TERRAIN_GRID_COUNT;ix++){
    const index=iz*TERRAIN_GRID_COUNT+ix,h=sample(ix,iz),left=sample(Math.max(0,ix-1),iz),right=sample(Math.min(TERRAIN_GRID_COUNT-1,ix+1),iz),down=sample(ix,Math.max(0,iz-1)),up=sample(ix,Math.min(TERRAIN_GRID_COUNT-1,iz+1)),slope=Math.hypot((right-left)/(2*TERRAIN_CELL_M),(up-down)/(2*TERRAIN_CELL_M));
    if(Math.hypot(-TERRAIN_HALF_EXTENT_M+ix*TERRAIN_CELL_M,-TERRAIN_HALF_EXTENT_M+iz*TERRAIN_CELL_M)<TERRAIN_FLAT_RADIUS_M)color.setRGB(.34,.50,.24);
    else if(slope>.34)color.setRGB(.43,.42,.39);
    else if(h>18)color.setRGB(.48,.47,.36);
    else if(h<-7)color.setRGB(.20,.35,.18);
    else color.setRGB(.31,.47,.22);
    colors[index*3]=color.r;colors[index*3+1]=color.g;colors[index*3+2]=color.b;
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,metalness:0});
  const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;mesh.name='physical-terrain-heightfield';return mesh;
}
