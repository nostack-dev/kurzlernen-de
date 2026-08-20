import * as THREE from "three";

const MAX_PRISMS=512;
let mesh=null,lastHash="",sceneRef=null;

function viewport(){return globalThis.document?.getElementById?.("viewport")||null;}
function finitePoint(point){return Array.isArray(point)&&point.length>=2&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1]));}
function pushTri(out,a,b,c){out.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);}

export function buildBuildingDepthGeometry(prisms,{maxPrisms=MAX_PRISMS}={}){
  const positions=[];let used=0;
  for(const prism of Array.isArray(prisms)?prisms:[]){
    if(used>=maxPrisms)break;const points=(prism?.points||[]).filter(finitePoint);if(points.length<3)continue;
    const base=Number(prism.base)||0,top=Math.max(base+.05,Number(prism.top)||8);
    for(let i=1;i<points.length-1;i++){
      const a=points[0],b=points[i],c=points[i+1];
      pushTri(positions,[a[0],a[1],top],[b[0],b[1],top],[c[0],c[1],top]);
      pushTri(positions,[c[0],c[1],base],[b[0],b[1],base],[a[0],a[1],base]);
    }
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],ab=[a[0],a[1],base],bb=[b[0],b[1],base],at=[a[0],a[1],top],bt=[b[0],b[1],top];
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
  target.visible=true;const count=Number(target.userData.worldBuildingDepthPrisms)||0,view=viewport();if(view){view.dataset.worldBuildingDepthOccluders=String(count);view.dataset.worldBuildingOcclusion=count?"depth-active":"inactive";}return count;
}

export function buildingDepthOcclusionState(){return{mesh,hash:lastHash,scene:sceneRef};}
