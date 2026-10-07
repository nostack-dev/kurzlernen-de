import * as THREE from "three";

// Detailed traffic vehicles in ONE draw call each: a bevelled sedan /
// city-bus body from side profiles, glass greenhouse, wheels with rims,
// head/tail lights, bumpers, mirrors — all merged into one geometry with
// baked vertex colours (one cached geometry per paint colour). Replaces the
// 6-mesh box cars (prettier and ~6x fewer draw calls for the traffic).
// Frame: x = length (front +x), y = width, z = up, origin on the ground.

const cache=new Map();
export const vehicleMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.32,metalness:.28});
function extrudeProfile(points,width,bevel){
  const s=new THREE.Shape();points.forEach(([x,z],i)=>i?s.lineTo(x,z):s.moveTo(x,z));s.closePath();
  const g=new THREE.ExtrudeGeometry(s,{depth:Math.max(.01,width-bevel*2),bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:3});
  g.rotateX(Math.PI/2);g.translate(0,(width-bevel*2)/2,0);return g;
}
function cyl(r,len,seg=14){const g=new THREE.CylinderGeometry(r,r,len,seg);return g;} // axis = y (width)
function box(sx,sy,sz){return new THREE.BoxGeometry(sx,sy,sz);}
function merge(parts){
  let n=0;const geos=parts.map(({g,at=[0,0,0],c})=>{const q=g.index?g.toNonIndexed():g;if(q!==g)g.dispose();q.translate(at[0],at[1],at[2]);q.computeVertexNormals();n+=q.attributes.position.count;return{q,c:new THREE.Color(c)};});
  const pos=new Float32Array(n*3),nrm=new Float32Array(n*3),col=new Float32Array(n*3);let o=0;
  for(const{q,c}of geos){const p=q.attributes.position,nn=q.attributes.normal;pos.set(p.array,o*3);nrm.set(nn.array,o*3);for(let i=0;i<p.count;i++){col[(o+i)*3]=c.r;col[(o+i)*3+1]=c.g;col[(o+i)*3+2]=c.b;}o+=p.count;q.dispose();}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(pos,3));g.setAttribute("normal",new THREE.BufferAttribute(nrm,3));g.setAttribute("color",new THREE.BufferAttribute(col,3));g.computeBoundingSphere();return g;
}
const GLASS=0x1a2630,RUBBER=0x15161a,RIM=0xb9bec4,TRIM=0x2b2d31,HEAD=0xfff4d6,TAIL=0xb3121a,PLATE=0xe8e6df;
function sedan(paint){
  const P=[];
  P.push({g:extrudeProfile([[-1.8,.3],[-1.8,.62],[-1.62,.8],[-.98,.84],[.72,.84],[1.62,.7],[1.8,.55],[1.8,.3]],1.64,.07),c:paint});
  P.push({g:extrudeProfile([[-1.02,.8],[-.64,1.32],[.3,1.34],[.86,.8]],1.42,.06),c:GLASS});
  P.push({g:box(.9,1.36,.06),at:[-.17,0,1.36],c:paint}); // roof
  for(const y of[-.7,.7])P.push({g:box(.08,.04,.5),at:[-.15,y,1.07],c:paint}); // B-pillars
  for(const x of[-1.15,1.2])for(const y of[-.78,.78]){P.push({g:cyl(.34,.22),at:[x,y,.34],c:RUBBER});P.push({g:cyl(.21,.235,12),at:[x,y,.34],c:RIM});}
  P.push({g:box(.08,1.5,.2),at:[1.83,0,.36],c:TRIM},{g:box(.08,1.5,.2),at:[-1.83,0,.36],c:TRIM});
  for(const y of[-.56,.56]){P.push({g:box(.06,.32,.1),at:[1.82,y,.62],c:HEAD},{g:box(.06,.34,.1),at:[-1.82,y,.64],c:TAIL});}
  P.push({g:box(.03,.36,.11),at:[-1.86,0,.45],c:PLATE},{g:box(.03,.36,.11),at:[1.86,0,.45],c:PLATE});
  for(const y of[-.86,.86])P.push({g:box(.14,.08,.08),at:[.62,y,.92],c:paint});
  return merge(P);
}
function bus(paint){
  const P=[];
  P.push({g:extrudeProfile([[-4,.3],[-4,2.9],[-3.85,3.05],[3.8,3.05],[4,2.85],[4,.3]],2.42,.1),c:paint});
  P.push({g:box(7.2,2.46,.95),at:[.1,0,2.05],c:GLASS});
  P.push({g:box(.05,2.0,1.3),at:[4.03,0,1.95],c:GLASS});
  P.push({g:box(8.04,2.44,.12),at:[0,0,.62],c:TRIM});
  for(const x of[-2.55,2.6])for(const y of[-1.08,1.08]){P.push({g:cyl(.46,.28),at:[x,y,.46],c:RUBBER});P.push({g:cyl(.27,.3,12),at:[x,y,.46],c:RIM});}
  for(const y of[-.95,.95]){P.push({g:box(.06,.28,.16),at:[4.02,y,.75],c:HEAD},{g:box(.06,.24,.3),at:[-4.02,y,.95],c:TAIL});}
  P.push({g:box(.05,1.6,.28),at:[4.03,0,2.85],c:0x111111});
  return merge(P);
}
export function vehicleGeometry(kind,paint){const key=`${kind}:${paint}`;let g=cache.get(key);if(!g){g=kind==="bus"?bus(paint):sedan(paint);cache.set(key,g);}return g;}
