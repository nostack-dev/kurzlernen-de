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
function sedan(paint,sel=()=>true){
  const P=[];
  P.push({g:extrudeProfile([[-1.8,.3],[-1.8,.62],[-1.62,.8],[-.98,.84],[.72,.84],[1.62,.7],[1.8,.55],[1.8,.3]],1.64,.07),c:paint});
  P.push({g:extrudeProfile([[-1.02,.8],[-.64,1.32],[.3,1.34],[.86,.8]],1.42,.06),c:GLASS});
  P.push({g:box(.9,1.36,.06),at:[-.17,0,1.36],c:paint}); // roof
  for(const y of[-.7,.7])P.push({g:box(.08,.04,.5),at:[-.15,y,1.07],c:paint}); // B-pillars
  // wheels are separate (physical, instanced): see wheelGeometry()
  for(const x of[-1.15,1.2])for(const y of[-.8,.8])P.push({g:box(.8,.05,.06),at:[x,y,.7],c:TRIM}); // wheel-arch trims
  P.push({g:box(.08,1.5,.2),at:[1.83,0,.36],c:TRIM},{g:box(.08,1.5,.2),at:[-1.83,0,.36],c:TRIM});
  for(const y of[-.56,.56]){P.push({g:box(.06,.32,.1),at:[1.82,y,.62],c:HEAD},{g:box(.06,.34,.1),at:[-1.82,y,.64],c:TAIL});}
  P.push({g:box(.03,.36,.11),at:[-1.86,0,.45],c:PLATE},{g:box(.03,.36,.11),at:[1.86,0,.45],c:PLATE});
  for(const y of[-.86,.86])P.push({g:box(.14,.08,.08),at:[.62,y,.92],c:paint});
  return merge(P.filter(sel));
}
// More bodies on the same wheelbase (wheels at x -1.15 / +1.2, track ±.8) so the physics car
// (one shape for every car) still fits: an electric two-seat roadster, a hatchback, an SUV, a van.
function roadster(paint,sel=()=>true){
  const P=[];
  // long, low wedge with a short tail; the glass canopy is the roof
  P.push({g:extrudeProfile([[-1.95,.26],[-1.95,.6],[-1.7,.72],[-.75,.79],[.25,.76],[1.55,.6],[1.95,.42],[1.95,.26]],1.76,.08),c:paint});
  P.push({g:extrudeProfile([[-.85,.76],[-.5,1.09],[.1,1.11],[.62,.76]],1.38,.07),c:GLASS});
  P.push({g:box(1.98,1.6,.06),at:[0,0,.33],c:TRIM}); // sill line
  for(const x of[-1.15,1.2])for(const y of[-.82,.82])P.push({g:box(.82,.05,.05),at:[x,y,.66],c:TRIM});
  P.push({g:box(.05,1.5,.05),at:[1.96,0,.52],c:HEAD}); // one thin light bar across the nose
  P.push({g:box(.05,1.62,.07),at:[-1.96,0,.6],c:TAIL}); // full-width tail light strip
  P.push({g:box(.32,1.64,.05),at:[-1.82,0,.76],c:paint}); // lip spoiler
  P.push({g:box(.12,1.1,.12),at:[-1.9,0,.3],c:TRIM}); // diffuser
  for(const y of[-.84,.84])P.push({g:box(.12,.07,.06),at:[.45,y,.84],c:TRIM});
  return merge(P.filter(sel));
}
function hatch(paint,sel=()=>true){
  const P=[];
  P.push({g:extrudeProfile([[-1.6,.3],[-1.62,.82],[-1.45,.9],[.7,.86],[1.55,.72],[1.72,.55],[1.72,.3]],1.62,.07),c:paint});
  P.push({g:extrudeProfile([[-1.45,.86],[-1.32,1.42],[.18,1.44],[.8,.86]],1.42,.06),c:GLASS});
  P.push({g:box(1.5,1.36,.06),at:[-.58,0,1.45],c:paint});
  for(const x of[-1.15,1.2])for(const y of[-.8,.8])P.push({g:box(.8,.05,.06),at:[x,y,.7],c:TRIM});
  P.push({g:box(.08,1.46,.2),at:[1.75,0,.36],c:TRIM},{g:box(.08,1.46,.2),at:[-1.64,0,.36],c:TRIM});
  for(const y of[-.55,.55]){P.push({g:box(.06,.3,.12),at:[1.73,y,.62],c:HEAD},{g:box(.06,.2,.3),at:[-1.62,y,.98],c:TAIL});}
  return merge(P.filter(sel));
}
function suv(paint,sel=()=>true){
  const P=[];
  P.push({g:extrudeProfile([[-1.85,.38],[-1.88,1.02],[-1.7,1.1],[.85,1.06],[1.7,.92],[1.88,.72],[1.88,.38]],1.72,.08),c:paint});
  P.push({g:extrudeProfile([[-1.72,1.06],[-1.62,1.66],[.35,1.68],[.95,1.06]],1.52,.06),c:GLASS});
  P.push({g:box(2.05,1.5,.07),at:[-.62,0,1.69],c:paint});
  for(const y of[-.6,.6])P.push({g:box(1.7,.05,.05),at:[-.62,y,1.76],c:TRIM}); // roof rails
  for(const x of[-1.15,1.2])for(const y of[-.84,.84])P.push({g:box(.9,.08,.14),at:[x,y,.82],c:TRIM}); // chunky arches
  P.push({g:box(.1,1.6,.3),at:[1.9,0,.48],c:TRIM},{g:box(.1,1.6,.3),at:[-1.9,0,.48],c:TRIM});
  for(const y of[-.6,.6]){P.push({g:box(.06,.32,.12),at:[1.89,y,.86],c:HEAD},{g:box(.06,.22,.34),at:[-1.89,y,1.1],c:TAIL});}
  return merge(P.filter(sel));
}
function van(paint,sel=()=>true){
  const P=[];
  P.push({g:extrudeProfile([[-1.95,.32],[-1.95,1.92],[-1.85,2.0],[.7,2.0],[1.35,1.2],[1.95,.92],[1.95,.32]],1.78,.08),c:paint});
  P.push({g:extrudeProfile([[.62,1.92],[.72,1.92],[1.32,1.22],[1.22,1.2]],1.6,.02),c:GLASS}); // windscreen
  for(const y of[-.9,.9])P.push({g:box(.7,.04,.5),at:[.35,y,1.45],c:GLASS}); // cab side windows
  P.push({g:box(.06,1.7,.05),at:[-.2,0,2.02],c:TRIM});
  for(const x of[-1.15,1.2])for(const y of[-.9,.9])P.push({g:box(.82,.05,.06),at:[x,y,.72],c:TRIM});
  P.push({g:box(.08,1.7,.24),at:[1.98,0,.4],c:TRIM},{g:box(.08,1.7,.24),at:[-1.98,0,.4],c:TRIM});
  for(const y of[-.62,.62]){P.push({g:box(.06,.3,.14),at:[1.97,y,.78],c:HEAD},{g:box(.06,.16,.5),at:[-1.97,y,1.25],c:TAIL});}
  return merge(P.filter(sel));
}
export const CAR_STYLES=Object.freeze(["sedan","sedan","hatch","suv","roadster","van","sedan","hatch","suv"]);
// how far the seated driver sits below the default (sedan) seat, so heads stay under each roof
export const CAR_STYLE_SEAT_DROP=Object.freeze({sedan:0,hatch:0,suv:-.18,van:-.35,roadster:.28});
function body(kind,style,paint,sel){if(kind==="bus")return bus(paint,sel);return style==="roadster"?roadster(paint,sel):style==="hatch"?hatch(paint,sel):style==="suv"?suv(paint,sel):style==="van"?van(paint,sel):sedan(paint,sel);}
function bus(paint,sel=()=>true){
  const P=[];
  P.push({g:extrudeProfile([[-4,.3],[-4,2.9],[-3.85,3.05],[3.8,3.05],[4,2.85],[4,.3]],2.42,.1),c:paint});
  P.push({g:box(7.2,2.46,.95),at:[.1,0,2.05],c:GLASS});
  P.push({g:box(.05,2.0,1.3),at:[4.03,0,1.95],c:GLASS});
  P.push({g:box(8.04,2.44,.12),at:[0,0,.62],c:TRIM});
  for(const y of[-.95,.95]){P.push({g:box(.06,.28,.16),at:[4.02,y,.75],c:HEAD},{g:box(.06,.24,.3),at:[-4.02,y,.95],c:TAIL});}
  P.push({g:box(.05,1.6,.28),at:[4.03,0,2.85],c:0x111111});
  return merge(P.filter(sel));
}
// One tyre + rim + hub, radius .34 (scaled for buses), spin axis = y.
let wheelGeo=null;export function wheelGeometry(){if(!wheelGeo){const tread=new THREE.CylinderGeometry(.34,.34,.22,18),rim=new THREE.CylinderGeometry(.215,.215,.235,12),hub=new THREE.CylinderGeometry(.07,.07,.25,8),spokes=[0,1,2,3,4].map(i=>{const g=new THREE.BoxGeometry(.05,.236,.36);g.rotateY(i/5*Math.PI);return g;});wheelGeo=merge([{g:tread,c:RUBBER},{g:rim,c:0x8f959b},{g:hub,c:0x3a3d42},...spokes.map(g=>({g,c:RIM}))]);}return wheelGeo;}
export function vehicleGeometry(kind,paint,{glass=true,style="sedan"}={}){const key=`${kind}:${style}:${paint}:${glass?1:0}`;let g=cache.get(key);if(!g){const sel=glass?()=>true:p=>p.c!==GLASS;g=body(kind,style,paint,sel);cache.set(key,g);}return g;}
// the windows on their own, see-through: with them the drivers and passengers inside are visible
export const vehicleGlassMaterial=new THREE.MeshStandardMaterial({color:0x2a3b4a,roughness:.08,metalness:.55,transparent:true,opacity:.42,depthWrite:false});
export function vehicleGlassGeometry(kind,style="sedan"){const key=`${kind}:${style}:glass`;let g=cache.get(key);if(!g){const sel=p=>p.c===GLASS;g=body(kind,style,0,sel);g.deleteAttribute("color");cache.set(key,g);}return g;}
