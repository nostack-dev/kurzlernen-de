import * as THREE from "three";

// First-person arms (CoD style): dark tactical gloves with hard knuckle guards and
// wrist straps, fingers wrapped around each grip, camo fabric sleeves on the forearms.
// Everything is procedural (no assets). Each arm is merged into one mesh per material
// (glove, guard, sleeve = 3 draw calls) and all arms share the same three materials.
// The sleeve camo is baked into vertex colours (no texture, no UVs).
//
// Hand design frame (right hand, real-size metres): the grip axis is +y (index side up),
// the back of the hand faces +x, the fingers wrap around the front (−z) to the left side
// and the palm heel / wrist sit behind the grip (+z). A left hand is the mirror image.
// The viewmodel weapons are modelled ~2.6× real size, so the hands are scaled to match.

export const VIEWMODEL_ARMS_VERSION="tactical-gloves-camo-sleeves-v1";
export const HAND_SCALE=2.6;
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),UP=V(0,1,0);
let MATS=null;
export function armMaterials(){
  if(MATS)return MATS;
  const std=(color,roughness,metalness=0,extra={})=>new THREE.MeshStandardMaterial({color,roughness,metalness,...extra});
  MATS={glove:std(0x2e3238,.8,.04),guard:std(0x121417,.45,.2),sleeve:std(0xffffff,.96,0,{vertexColors:true})};
  return MATS;
}
// muted woodland/multicam-like palette
const CAMO=[[.15,.16,.12],[.23,.205,.15],[.08,.10,.068],[.045,.048,.042]].map(c=>new THREE.Color(c[0],c[1],c[2]));
function camoColor(p,out){
  const a=Math.sin(p.x*52+p.y*19)+Math.sin(p.y*47-p.z*36+1.3)+Math.sin(p.z*58+p.x*27+2.1)*.8;
  const b=Math.sin(p.x*83-p.z*41+.7)+Math.sin(p.y*74+p.z*23+2.9);
  const i=a>1.1?3:a>.1?(b>.3?1:2):b>.9?2:0;out.copy(CAMO[i]);
  return out.multiplyScalar(.9+.1*Math.sin(p.x*260+p.y*230+p.z*210));
}

// Rounded box: a segmented box whose edge vertices are pulled onto a radius-r rim.
function roundedBox(w,h,d,r,seg=3){
  const g=new THREE.BoxGeometry(w,h,d,seg,seg,seg),p=g.attributes.position,n=g.attributes.normal,hx=w/2-r,hy=h/2-r,hz=d/2-r,v=V(),c=V(),o=V();
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);c.set(Math.max(-hx,Math.min(hx,v.x)),Math.max(-hy,Math.min(hy,v.y)),Math.max(-hz,Math.min(hz,v.z)));o.subVectors(v,c);if(o.lengthSq()<1e-12)continue;o.normalize();n.setXYZ(i,o.x,o.y,o.z);o.multiplyScalar(r).add(c);p.setXYZ(i,o.x,o.y,o.z);}
  return g;
}
const ONE=V(1,1,1);
function along(a,b){const d=V().subVectors(b,a),len=Math.max(1e-5,d.length());return{mid:V().addVectors(a,b).multiplyScalar(.5),q:new THREE.Quaternion().setFromUnitVectors(UP,d.divideScalar(len)),len};}

// Collects primitives (with a local matrix, optionally inside a frame matrix), then
// merges them into one mesh per material.
export class PartBatch{
  constructor(){this.items=[];}
  push(geo,mat,local,frame){const m=new THREE.Matrix4();if(frame)m.multiplyMatrices(frame,local);else m.copy(local);this.items.push({geo,mat,m});return this;}
  capsule(a,b,r,mat,frame,seg=8){const{mid,q,len}=along(a,b);return this.push(new THREE.CapsuleGeometry(r,len,3,seg),mat,new THREE.Matrix4().compose(mid,q,ONE),frame);}
  tube(a,b,r0,r1,mat,frame,{seg=12,hseg=1,open=true,shape=null}={}){const{mid,q,len}=along(a,b),g=new THREE.CylinderGeometry(r1,r0,len,seg,hseg,open);if(shape)shape(g,len);return this.push(g,mat,new THREE.Matrix4().compose(mid,q,ONE),frame);}
  box(size,r,mat,pos,rot,frame){return this.push(roundedBox(size[0],size[1],size[2],r),mat,new THREE.Matrix4().compose(pos,new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0]||0,rot[1]||0,rot[2]||0)),ONE),frame);}
  build(name,{renderOrder=9997,userData={}}={}){
    const group=new THREE.Group();group.name=name;const byMat=new Map();
    for(const it of this.items){let l=byMat.get(it.mat);if(!l)byMat.set(it.mat,l=[]);l.push(it);}
    const col=new THREE.Color(),pv=V();let index=0;
    for(const[mat,list]of byMat){
      const geos=list.map(({geo,m})=>{const g=geo.index?geo.toNonIndexed():geo.clone();geo.dispose();g.applyMatrix4(m);
        if(m.determinant()<0){const p=g.attributes.position.array,n=g.attributes.normal.array;for(let i=0;i<p.length;i+=9)for(let k=0;k<3;k++){let t=p[i+3+k];p[i+3+k]=p[i+6+k];p[i+6+k]=t;t=n[i+3+k];n[i+3+k]=n[i+6+k];n[i+6+k]=t;}}
        return g;});
      let count=0;for(const g of geos)count+=g.attributes.position.count;
      const pos=new Float32Array(count*3),nrm=new Float32Array(count*3),clr=mat.vertexColors?new Float32Array(count*3):null;let o=0;
      for(const g of geos){const p=g.attributes.position;pos.set(p.array,o*3);nrm.set(g.attributes.normal.array,o*3);
        if(clr)for(let i=0;i<p.count;i++){pv.fromBufferAttribute(p,i);camoColor(pv,col);clr[(o+i)*3]=col.r;clr[(o+i)*3+1]=col.g;clr[(o+i)*3+2]=col.b;}
        o+=p.count;g.dispose();}
      const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(pos,3));geo.setAttribute("normal",new THREE.BufferAttribute(nrm,3));if(clr)geo.setAttribute("color",new THREE.BufferAttribute(clr,3));geo.computeBoundingSphere();
      const mesh=new THREE.Mesh(geo,mat);mesh.name=`${name}_PART${index++}`;mesh.frustumCulled=false;mesh.renderOrder=renderOrder;mesh.userData.flightFireIgnore=true;mesh.userData.walkWeaponPart=true;Object.assign(mesh.userData,userData);group.add(mesh);
    }
    group.userData.flightFireIgnore=true;group.userData.walkWeaponPart=true;return group;
  }
}

// --- the hand -------------------------------------------------------------------------
// o.rx/o.rz: half size (hand units) of what the hand holds across the back of the hand
// and front-to-back; o.wrap scales finger curl; o.curls per finger (index..pinky);
// o.thumb: "side" (along the grip) | "over" (closed fist, thumb across the fingers).
function hand(P,H,o){
  const M=armMaterials(),rx=Math.max(.008,o.rx??.02),rz=Math.max(.008,o.rz??.018),wrap=o.wrap??1,curls=o.curls||[1,1,1,1],th0=o.knuckle??.25;
  const ys=[.0285,.0095,-.0095,-.0275],rad=[.0088,.0092,.0089,.0079],lens=[1,1.06,1,.84];
  const ring=(t,i,k)=>{const r=.0095+(k===0?.003:0);return V((rx+r)*Math.cos(t),ys[i]-k*.0012*(i-1.5),-(rz+r)*Math.sin(t));};
  const S=Math.max(.6,.034/(rx+rz+.02)); // radians per phalanx so each phalanx stays ~real length
  for(let i=0;i<4;i++){
    const st=[0,1.05,1.95,2.65].map(a=>th0+a*S*lens[i]*wrap*curls[i]),pts=st.map((t,k)=>ring(t,i,k));
    pts[0].x+=.003;
    for(let k=0;k<3;k++)P.capsule(pts[k],pts[k+1],rad[i]*(k===2?.88:k===1?.95:1),M.glove,H,7);
    const g0=ring(st[0]+.25*S,i,0).multiplyScalar(1.12),g1=ring(st[0]+.75*S,i,0).multiplyScalar(1.12); // padded finger guard
    P.capsule(g0.setY(ys[i]+.0035),g1.setY(ys[i]-.0035),.0058,M.guard,H,6);
  }
  // back of the hand, knuckle guard, back-of-hand plate
  P.box([.026,.083,.088],.011,M.glove,V(rx+.011,0,.03),[0,-.12,0],H);
  P.box([.012,.079,.024],.005,M.guard,V(rx+.022,0,-.002),[0,-.38,0],H);
  P.box([.007,.046,.04],.0035,M.guard,V(rx+.024,0,.04),[0,-.06,0],H);
  // palm heel + thenar muscle behind the grip
  P.box([.046,.08,.03],.013,M.glove,V(rx*.3,-.004,rz+.016),[0,.32,0],H);
  P.capsule(V(rx*.6,-.012,rz+.024),V(-rx*.1,.022,rz+.024),.017,M.glove,H);
  // thumb (3 segments)
  const t=o.thumb==="over"?[V(rx*.2,.036,rz+.016),V(-rx-.012,.04,rz*.3),V(-rx*.6,.033,-rz-.012),V(rx*.25,.025,-rz-.019)]
    :[V(rx*.25,.032,rz+.022),V(-rx*.35,.043,rz*.75),V(-rx-.009,.047,rz*.05),V(-rx-.01,.048,-rz*.6)];
  P.capsule(t[0],t[1],.0125,M.glove,H);P.capsule(t[1],t[2],.0108,M.glove,H);P.capsule(t[2],t[3],.0095,M.glove,H);
  return V(rx*.45,-.01,rz+.052); // wrist (hand units)
}

// Builds one arm into a PartBatch (or a new one) and returns {batch, hand} where hand is
// the hand's design frame (Matrix4, includes scale and mirror).
//   side: 1 right / −1 left; pos: centre of what the hand holds; axis: grip axis (index
//   side); back: direction the back of the hand faces; forearm: wrist → elbow direction;
//   grip: hand options (rx/rz in the same units as pos).
export function addArm(P,{side=1,pos=[0,0,0],axis=[0,1,0],back=[1,0,0],forearm=[.1,-.5,.86],length=.3,scale=HAND_SCALE,grip={}}={}){
  const M=armMaterials(),s=scale,ay=V(...axis).normalize(),bx=V(...back);bx.addScaledVector(ay,-bx.dot(ay)).normalize();
  const c0=side<0?bx.clone().negate():bx.clone(),c2=V().crossVectors(c0,ay).normalize();c0.crossVectors(ay,c2).normalize();
  const H=new THREE.Matrix4().makeBasis(c0,ay,c2).multiply(new THREE.Matrix4().makeScale(side<0?-s:s,s,s)).setPosition(V(...pos));
  const wrist=hand(P,H,{...grip,rx:(grip.rx??.05)/s,rz:(grip.rz??.045)/s}).applyMatrix4(H),d=V(...forearm).normalize(),at=k=>wrist.clone().addScaledVector(d,k*s);
  // glove cuff + velcro strap
  P.tube(at(-.016),at(.05),.031*s,.035*s,M.glove,null,{open:false});
  P.tube(at(.01),at(.03),.0345*s,.0365*s,M.guard,null,{open:false});
  // sleeve: rolled hem, then the forearm with a few fabric folds
  P.tube(at(.04),at(.066),.038*s,.04*s,M.sleeve,null,{open:false});
  P.tube(at(.052),at(.052+length),.0355*s,.044*s,M.sleeve,null,{hseg:8,open:false,shape:(g,len)=>{
    const p=g.attributes.position,v=V();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);const u=.5-v.y/len,a=Math.atan2(v.z,v.x),k=1+.06*Math.sin(a*3+u*9)*Math.sin(u*Math.PI)+.035*Math.sin(a*5-u*14)+(u<.3?.03*Math.sin(u*55):0);p.setXYZ(i,v.x*k,v.y,v.z*k);}g.computeVertexNormals();}});
  return{batch:P,hand:H};
}
export function buildArm(name,options){const{batch,hand}=addArm(new PartBatch(),options);const g=batch.build(name,{userData:{walkArmPart:true}});g.userData.walkArms=VIEWMODEL_ARMS_VERSION;g.userData.walkArmSide=(options?.side??1)>0?"right":"left";g.userData.handMatrix=hand;return g;}

// Per-weapon arm poses in the weapon builder's local frame (before the builder's own
// scale; attachWeaponArms compensates it). Right hand on the pistol grip, left hand
// on the handguard / fore grip (C-clamp from below: knuckles down, wrist outward).
const POSES={
  smg:{right:{pos:[0,-.108,-.141],axis:[0,1,-.14],back:[1,0,.1],grip:{rx:.054,rz:.047,curls:[.9,1,1,1]},forearm:[.18,-.4,.9]},
       left:{pos:[0,-.01,-.47],axis:[0,0,-1],back:[-.35,-1,0],grip:{rx:.062,rz:.083,wrap:.9},forearm:[-.3,-.85,.42]}},
  sniper:{right:{pos:[0,-.12,0],axis:[0,1,-.2],back:[1,0,.1],grip:{rx:.034,rz:.045,curls:[.9,1,1,1]},forearm:[.18,-.4,.9]},
          left:{pos:[0,.01,-.62],axis:[0,0,-1],back:[-.35,-1,0],grip:{rx:.035,rz:.04,wrap:.95},forearm:[-.3,-.85,.42]}},
  grenade:{right:{pos:[0,-.13,-.098],axis:[0,1,-.1],back:[1,0,.1],grip:{rx:.052,rz:.047,curls:[.9,1,1,1]},forearm:[.18,-.4,.9]}},
  rocket:{right:{pos:[0,-.1,-.142],axis:[0,1,-.12],back:[1,0,.1],grip:{rx:.032,rz:.042,curls:[.9,1,1,1]},forearm:[.2,-.45,.87]},
          left:{pos:[0,-.085,-.473],axis:[0,1,-.06],back:[-1,0,.1],grip:{rx:.03,rz:.035},forearm:[-.3,-.85,.42]}},
  glock:{right:{pos:[0,-.14,-.022],axis:[0,1,-.15],back:[1,0,.12],grip:{rx:.04,rz:.055,curls:[.85,1,1,1]},forearm:[.25,-.45,.86],scale:HAND_SCALE/1.35}}, /* one hand: a support hand in the middle of the view hid too much */
};
// Adds WALK_ARMS_<MODE> to a weapon group (right + left arm merged together: 3 draw
// calls). The arm geometry is built in the weapon's local frame and keeps real hand
// size on scaled weapons via the per-pose scale.
export function attachWeaponArms(group,mode){
  const pose=POSES[mode];if(!group||!pose)return null;const name=`WALK_ARMS_${mode.toUpperCase()}`;let arms=group.getObjectByName?.(name);if(arms)return arms;
  const k=Math.max(.05,group.scale?.x||1),P=new PartBatch();
  for(const[key,side]of[["right",1],["left",-1]]){const p=pose[key];if(!p)continue;addArm(P,{side,...p,scale:(p.scale||HAND_SCALE/k)*.88,length:p.length||.13/* short sleeves: the arms must not wall off the lower middle of the picture */,grip:{...p.grip,rx:p.grip.rx,rz:p.grip.rz}});}
  arms=P.build(name,{userData:{walkArmPart:true}});arms.userData.walkArms=VIEWMODEL_ARMS_VERSION;group.add(arms);return arms;
}
