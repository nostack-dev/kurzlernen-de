import * as THREE from 'three';
import {buildingAppearanceProfile} from './world_building_style.mjs';

function disposeMaterial(material){if(!material)return;for(const value of Object.values(material)){if(value?.isTexture)value.dispose?.();}material.dispose?.();}
function makeFacadeTexture(profile){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle=profile.wall;ctx.fillRect(0,0,256,256);
  ctx.globalAlpha=.23;ctx.fillStyle=profile.mortar;for(let y=0;y<256;y+=32)ctx.fillRect(0,y,256,2);for(let y=0;y<256;y+=32){const offset=((y/32)&1)?16:0;for(let x=offset;x<256;x+=32)ctx.fillRect(x,y,2,32);}ctx.globalAlpha=1;
  const cols=profile.windowColumns,rows=Math.max(2,Math.min(8,profile.windowRows)),padX=10,padY=10,cellW=(256-padX*2)/cols,cellH=(256-padY*2)/rows;ctx.fillStyle=profile.window;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){const w=cellW*.52,h=Math.min(cellH*.48,w/profile.windowAspect),x=padX+col*cellW+(cellW-w)/2,y=padY+row*cellH+(cellH-h)/2;ctx.fillRect(x,y,w,h);ctx.globalAlpha=.25;ctx.fillStyle='#ffffff';ctx.fillRect(x+1,y+1,w-2,Math.max(1,h*.18));ctx.globalAlpha=1;ctx.fillStyle=profile.window;}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(.09,.18);texture.anisotropy=2;return texture;
}
function makeRoofTexture(profile){const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle=profile.roof;ctx.fillRect(0,0,128,128);ctx.globalAlpha=.2;ctx.strokeStyle='#ffffff';ctx.lineWidth=1;for(let i=-128;i<256;i+=18){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i+128,128);ctx.stroke();}ctx.globalAlpha=1;const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(.08,.08);texture.anisotropy=2;return texture;}
function shapeFromFootprint(footprint){const outer=footprint.outer||[];if(outer.length<3)return null;const shape=new THREE.Shape();shape.moveTo(outer[0][0],outer[0][1]);for(let i=1;i<outer.length;i++)shape.lineTo(outer[i][0],outer[i][1]);shape.closePath();for(const hole of footprint.holes||[]){if(hole.length<3)continue;const path=new THREE.Path();path.moveTo(hole[0][0],hole[0][1]);for(let i=1;i<hole.length;i++)path.lineTo(hole[i][0],hole[i][1]);path.closePath();shape.holes.push(path);}return shape;}

export class WorldBuildingVisualLayer{
  constructor(scene){this.scene=scene;this.group=new THREE.Group();this.group.name='WORLD_REAL_BUILDINGS_TEXTURED';this.group.userData.worldRealBuildings=true;this.group.visible=false;scene?.add(this.group);this.hash='';this.meshCount=0;}
  clear(){for(const child of [...this.group.children]){this.group.remove(child);child.geometry?.dispose?.();if(Array.isArray(child.material))child.material.forEach(disposeMaterial);else disposeMaterial(child.material);}this.hash='';this.meshCount=0;}
  setVisible(visible){this.group.visible=Boolean(visible);}
  update(footprints,hash=''){
    if(hash&&hash===this.hash){this.group.visible=true;return false;}this.clear();
    for(const footprint of Array.isArray(footprints)?footprints:[]){const height=Math.max(.5,Number(footprint.top)-Number(footprint.base)),shape=shapeFromFootprint(footprint);if(!shape||!Number.isFinite(height))continue;const profile=buildingAppearanceProfile(footprint),geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,steps:1,curveSegments:1});geometry.computeVertexNormals();const roofMap=makeRoofTexture(profile),facadeMap=makeFacadeTexture(profile),roofMaterial=new THREE.MeshStandardMaterial({color:0xffffff,map:roofMap,roughness:.92,metalness:0}),wallMaterial=new THREE.MeshStandardMaterial({color:0xffffff,map:facadeMap,roughness:profile.roughness,metalness:profile.material==='metal'?.18:profile.material==='glass'?.08:0});const mesh=new THREE.Mesh(geometry,[roofMaterial,wallMaterial]);mesh.position.z=Number(footprint.base)||0;mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=true;mesh.userData.worldBuildingKey=footprint.key;mesh.userData.worldBuildingMaterial=profile.material;this.group.add(mesh);this.meshCount++;}
    this.hash=hash||String(Date.now());this.group.visible=true;return true;
  }
  destroy(){this.clear();this.group.removeFromParent();}
}
