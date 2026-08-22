import * as THREE from "three";

const MAX_PRISMS=512;
let mesh=null,lastHash="",sceneRef=null;

function viewport(){return globalThis.document?.getElementById?.("viewport")||null;}
function finitePoint(point){return Array.isArray(point)&&point.length>=2&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1]));}
function pushTri(out,a,b,c){out.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);}

export function buildBuildingDepthGeometry(prisms,{maxPrisms=MAX_PRISMS}={}){
  const positions=[];let used=0;
  for(const prism of Array.isArray(prisms)?prisms:[]){
    if(used>=maxPrisms)break;
    const raw=(prism?.points||[]).filter(finitePoint).map(point=>new THREE.Vector2(Number(point[0]),Number(point[1])));
    if(raw.length<3)continue;
    if(raw[0].distanceToSquared(raw.at(-1))<1e-10)raw.pop();
    if(raw.length<3)continue;
    const base=Number(prism.base)||0,top=Math.max(base+.05,Number(prism.top)||8),faces=THREE.ShapeUtils.triangulateShape(raw,[]);
    for(const face of faces){
      const a=raw[face[0]],b=raw[face[1]],c=raw[face[2]];
      pushTri(positions,new THREE.Vector3(a.x,a.y,top),new THREE.Vector3(b.x,b.y,top),new THREE.Vector3(c.x,c.y,top));
      pushTri(positions,new THREE.Vector3(c.x,c.y,base),new THREE.Vector3(b.x,b.y,base),new THREE.Vector3(a.x,a.y,base));
    }
    for(let i=0;i<raw.length;i++){
      const a=raw[i],b=raw[(i+1)%raw.length],ab=new THREE.Vector3(a.x,a.y,base),bb=new THREE.Vector3(b.x,b.y,base),at=new THREE.Vector3(a.x,a.y,top),bt=new THREE.Vector3(b.x,b.y,top);
      pushTri(positions,ab,bb,bt);pushTri(positions,ab,bt,at);
    }
    used++;
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));if(positions.length)geometry.computeBoundingSphere();geometry.userData.worldBuildingOccluderPrisms=used;return geometry;
}

function ensureMesh(scene){
  if(mesh&&sceneRef===scene)return mesh;
  if(mesh?.parent)mesh.parent.remove(mesh);mesh?.geometry?.dispose?.();
  const material=new THREE.MeshBasicMaterial({color:0x000000,side:THREE.DoubleSide,depthTest:true,depthWrite:true,transparent:false});material.colorWrite=false;
  mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);mesh.name="WORLD_BUILDING_DEPTH_OCCLUDER";mesh.renderOrder=-10000;mesh.frustumCulled=true;mesh.userData.worldBuildingDepthOccluder=true;mesh.userData.flightFireIgnore=true;scene.add(mesh);sceneRef=scene;lastHash="";return mesh;
}

export function syncWorldBuildingDepthOcclusion(bridge=globalThis.__arondightRealWorld){
  const scene=bridge?.threeScene;if(!scene)return 0;const target=ensureMesh(scene),snapshot=bridge?.buildingCollisionSnapshot,prisms=Array.isArray(snapshot?.prisms)?snapshot.prisms:[],hash=String(snapshot?.hash||"");
  if(!bridge?.active||!prisms.length){target.visible=false;const view=viewport();if(view){view.dataset.worldBuildingDepthOccluders="0";view.dataset.worldBuildingOcclusion="inactive";}return 0;}
  if(hash!==lastHash){const geometry=buildBuildingDepthGeometry(prisms);target.geometry.dispose?.();target.geometry=geometry;lastHash=hash;target.userData.worldBuildingDepthHash=hash;target.userData.worldBuildingDepthPrisms=geometry.userData.worldBuildingOccluderPrisms||0;}
  const count=Number(target.userData.worldBuildingDepthPrisms)||0;target.visible=count>0;const view=viewport();if(view){view.dataset.worldBuildingDepthOccluders=String(count);view.dataset.worldBuildingOcclusion=count?"depth-active":"inactive";}return count;
}

export function buildingDepthOcclusionState(){return{mesh,hash:lastHash,scene:sceneRef};}
