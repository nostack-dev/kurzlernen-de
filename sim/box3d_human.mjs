// Box3D ragdoll human — a port of Erin Catto's shared/human.c (Box3D samples).
//
// Twelve bones (pelvis, two spine segments, neck+head, thighs, calves+feet,
// upper and lower arms) as capsule bodies, spherical joints with cone and
// twist limits at hips / spine / neck / shoulders, revolute joints with
// limits at knees and elbows. Joint friction is a motor with zero target
// speed and a bounded torque: it soaks up the energy that makes a naive
// ragdoll jitter and hop on the ground. Rolling resistance on the shapes,
// filter joints between the thighs and between neck and upper arms (no
// self-snagging), and Box3D sleeping lets a body come to a real rest.
//
// The sample is Y-up; the world here is Z-up. Body frames are rotated as a
// whole (G = yaw · half-turn · +90° about X), so every local frame from the
// sample — joint frames, capsules — is used unchanged.
const D=Math.PI/180;
const Q=(x,y,z,w)=>{const l=Math.hypot(x,y,z,w)||1;return[x/l,y/l,z/l,w/l];};
// bone: ref = [position, quaternion] in the sample's Y-up frame; caps = capsules [c1,c2,r,(densityScale)];
// joint (to the parent): frameA, frameB, type, limits, friction scale
export const HUMAN_BONES=[
  {name:"pelvis",parent:-1,ref:[[0,.996219,-.023868],[1,0,0,0]],group:0,friction:.6,rolling:.1,caps:[[[.04,.000001,0],[-.04,-.000001,0],.15]]},
  {name:"spine_01",parent:0,ref:[[0,1.017288,-.024882],[1,0,0,0]],group:-1,friction:.5,rolling:.1,caps:[[[.029876,-.146581,.00626],[-.029876,-.146574,.00626],.145663]],
    joint:{type:"spherical",A:[[0,-.021069,.001014],[-.642737,0,0,-.766087]],B:[[0,0,0],[-.707107,0,0,-.707107]],swing:35,twist:[-17.5,17.5]}},
  {name:"spine_03",parent:1,ref:[[0,1.267766,-.02232],[1,0,0,0]],group:0,friction:.5,rolling:.1,caps:[[[.063996,-.117434,-.040199],[-.063996,-.117432,-.040199],.165004]],
    joint:{type:"spherical",A:[[0,-.250478,-.002562],[-.642766,0,0,-.766063]],B:[[0,0,0],[-.707107,0,0,-.707107]],swing:35,twist:[-17.5,17.5]}},
  {name:"neck_01",parent:2,ref:[[0,1.498783,.024462],[.987879,0,0,.155228]],group:0,friction:.2,rolling:.05,caps:[[[0,-.21234,0],[0,-.08734,0],.11]],
    joint:{type:"spherical",A:[[0,-.231017,-.046781],[-.516157,-.000002,.000003,-.856494]],B:[[0,0,0],[-.707108,-.000002,.000002,-.707106]],swing:30,twist:[-17.5,17.5]}},
  {name:"thigh_l",parent:0,ref:[[.092175,.971562,-.011177],[.471412,.52951,-.499888,-.497495]],group:-1,friction:.6,rolling:.1,caps:[[[-.047269,.000001,0],[-.379769,.000005,0],.091539]],
    joint:{type:"spherical",A:[[.092175,.024656,-.012691],[-.460186,-.365368,-.637662,.498118]],B:[[0,0,0],[-.499997,-.500003,.500002,.499998]],swing:30,twist:[-10,10]}},
  {name:"calf_l",parent:4,ref:[[.11872,.534541,-.035362],[.521188,.480597,-.54638,-.445935]],group:0,friction:.1,rolling:0,caps:[[[-.445,.000001,0],[.005,-.000001,0],.08],[[-.456371,.129321,.000013],[-.359977,.014394,.000013],.07,.5]],
    joint:{type:"revolute",A:[[-.438494,-.000175,0],[.344866,-.938652,.000002,-.000008]],B:[[0,0,0],[-.008182,-.999967,.000001,-.000007]],limit:[-30,30]}},
  {name:"thigh_r",parent:0,ref:[[-.092175,.971562,-.011177],[-.497495,.499888,.52951,-.471412]],group:-1,friction:.6,rolling:.1,caps:[[[.047269,-.000001,0],[.379769,-.000005,0],.092587]],
    joint:{type:"spherical",A:[[-.092175,.024656,-.012691],[.380666,.491846,.488644,-.611889]],B:[[0,0,0],[-.500002,.499998,-.499998,.500002]],swing:30,twist:[-10,10]}},
  {name:"calf_r",parent:6,ref:[[-.11872,.534541,-.035362],[-.445935,.54638,.480597,-.521188]],group:0,friction:.1,rolling:0,caps:[[[.445,-.000002,.000003],[-.005,0,.000003],.08],[[.369113,-.00683,.000017],[.465507,-.121757,.000017],.07,.5]],
    joint:{type:"revolute",A:[[.438494,.000175,0],[.000007,.000005,-.34486,-.938654]],B:[[0,0,0],[.000006,.000005,.008188,-.999966]],limit:[-30,30]}},
  {name:"upperarm_l",parent:2,ref:[[.185817,1.44363,.031306],[.56022,-.307179,.366233,-.676512]],group:0,friction:.6,rolling:.1,caps:[[[.296038,.004386,-.000794],[-.016086,.004384,-.016127],.065]],
    joint:{type:"spherical",A:[[.185817,-.175865,-.053625],[-.559466,-.213784,-.670199,.438323]],B:[[0,0,0],[-.500953,-.502617,-.509318,-.486844]],swing:45,twist:[-20,20],jf:.8}},
  {name:"lowerarm_l",parent:8,ref:[[.347683,1.193455,.029378],[.406736,-.493012,.089135,-.763911]],group:0,friction:.3,rolling:.1,caps:[[[.312329,-.008256,-.016454],[.033153,.008259,-.002741],.06]],
    joint:{type:"revolute",A:[[.297979,.000361,0],[.916726,.399352,.000839,-.011456]],B:[[0,0,0],[.999922,-.003857,.004659,-.010908]],limit:[-35,35],jf:.06}},
  {name:"upperarm_r",parent:2,ref:[[-.185817,1.44363,.031306],[.676512,.366233,.307179,.56022]],group:0,friction:.6,rolling:.1,caps:[[[-.300237,-.000001,-.000319],[.011887,.000001,.015013],.065]],
    joint:{type:"spherical",A:[[-.185817,-.175865,-.053625],[.213793,.559449,.438334,-.670204]],B:[[0,0,0],[-.509319,.486843,.500954,-.502617]],swing:45,twist:[-20,20],jf:.8}},
  {name:"lowerarm_r",parent:10,ref:[[-.347683,1.193455,.029378],[.763911,.089135,.493012,.406736]],group:0,friction:.3,rolling:.1,caps:[[[-.312649,-.000003,.016471],[-.032986,0,.002732],.06]],
    joint:{type:"revolute",A:[[-.297979,-.000361,0],[-.405444,.914059,.010541,.000852]],B:[[0,0,0],[-.002794,.999936,.010042,.004364]],limit:[-35,35],jf:.06}},
];
export const HUMAN_BONE_INDEX=Object.fromEntries(HUMAN_BONES.map((b,i)=>[b.name,i]));
// quaternions as in the sample, written ({x,y,z}, w) -> [x,y,z,w] (the pelvis / spine reference frames are a half turn about X)

function qmul(a,b){return[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
function qrot(q,v){const[x,y,z,w]=q,tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return[v[0]+w*tx+(y*tz-z*ty),v[1]+w*ty+(z*tx-x*tz),v[2]+w*tz+(x*ty-y*tx)];}
const XUP=[Math.sin(Math.PI/4),0,0,Math.cos(Math.PI/4)];// +90° about X: sample Y-up -> Z-up
export function humanWorldFrame(yaw){const h=(Number(yaw)||0)+Math.PI;return qmul([0,0,Math.sin(h/2),Math.cos(h/2)],XUP);}

// Create one human. opts: position (feet, Z-up), yaw, groupIndex (>0, unique per human),
// frictionTorque, hertz, dampingRatio, categoryBits, maskBits, velocity
export function createBox3dHuman(b3,world,{position=[0,0,0],yaw=0,groupIndex=1,frictionTorque=8,hertz=0,dampingRatio=.7,categoryBits=2n,maskBits=0xffffn,velocity=null}={}){
  const G=humanWorldFrame(yaw),bodies=[],joints=[],filters=[],bodyDef=b3.b3DefaultBodyDef(),baseShape=b3.b3DefaultShapeDef(),density=baseShape.density;
  bodyDef.type=b3.b3BodyType.b3_dynamicBody;bodyDef.enableSleep=true;
  for(const bone of HUMAN_BONES){const p=qrot(G,bone.ref[0]),q=qmul(G,Q(...bone.ref[1]));bodyDef.position=[position[0]+p[0],position[1]+p[1],position[2]+p[2]];bodyDef.rotation=q;
    const body=b3.b3CreateBody(world,bodyDef);if(velocity)b3.b3Body_SetLinearVelocity(body,[...velocity]);
    for(const c of bone.caps){const sd=b3.b3DefaultShapeDef();sd.density=density*(c[3]??1);sd.baseMaterial.friction=bone.friction;sd.baseMaterial.rollingResistance=bone.rolling;sd.baseMaterial.restitution=0;sd.enableContactEvents=false;sd.filter={categoryBits:BigInt(categoryBits),maskBits:BigInt(maskBits),groupIndex:bone.group<0?-Math.abs(groupIndex):0};b3.b3CreateCapsuleShape(body,sd,{center1:c[0],center2:c[1],radius:c[2]});}
    bodies.push(body);}
  const frame=f=>({position:[...f[0]],quaternion:Q(...f[1])});
  HUMAN_BONES.forEach((bone,i)=>{if(bone.parent<0)return;const j=bone.joint;let id;
    if(j.type==="revolute"){const d=b3.b3DefaultRevoluteJointDef();d.base.bodyIdA=bodies[bone.parent];d.base.bodyIdB=bodies[i];d.base.localFrameA=frame(j.A);d.base.localFrameB=frame(j.B);d.enableLimit=true;d.lowerAngle=j.limit[0]*D;d.upperAngle=j.limit[1]*D;d.enableSpring=hertz>0;d.hertz=hertz;d.dampingRatio=dampingRatio;d.enableMotor=true;d.motorSpeed=0;d.maxMotorTorque=(j.jf??1)*frictionTorque;id=b3.b3CreateRevoluteJoint(world,d);}
    else{const d=b3.b3DefaultSphericalJointDef();d.base.bodyIdA=bodies[bone.parent];d.base.bodyIdB=bodies[i];d.base.localFrameA=frame(j.A);d.base.localFrameB=frame(j.B);d.enableConeLimit=true;d.coneAngle=j.swing*D;d.enableTwistLimit=true;d.lowerTwistAngle=j.twist[0]*D;d.upperTwistAngle=j.twist[1]*D;d.enableSpring=hertz>0;d.hertz=hertz;d.dampingRatio=dampingRatio;d.enableMotor=true;d.maxMotorTorque=(j.jf??1)*frictionTorque;id=b3.b3CreateSphericalJoint(world,d);}
    joints.push(id);});
  // no self-snagging: thighs with each other, neck with the upper arms
  const I=HUMAN_BONE_INDEX;for(const[a,b]of[[I.thigh_l,I.thigh_r],[I.neck_01,I.upperarm_l],[I.neck_01,I.upperarm_r]]){const d=b3.b3DefaultFilterJointDef();d.base.bodyIdA=bodies[a];d.base.bodyIdB=bodies[b];filters.push(b3.b3CreateFilterJoint(world,d));}
  return{bodies,joints,filters};
}
export function destroyBox3dHuman(b3,human){if(!human)return;for(const j of[...(human.filters||[]),...(human.joints||[])])try{b3.b3DestroyJoint(j,false);}catch{}for(const b of human.bodies||[])try{if(b3.b3Body_IsValid(b))b3.b3DestroyBody(b);}catch{}human.bodies=[];human.joints=[];human.filters=[];}
// a point given in a bone's local (sample) frame, in world space
export function humanPoint(b3,human,boneIndex,local,out=[0,0,0]){const body=human.bodies[boneIndex];if(!body)return null;const p=b3.b3Body_GetPosition([0,0,0],body),q=b3.b3Body_GetRotation([0,0,0,1],body),r=qrot(q,local);out[0]=p[0]+r[0];out[1]=p[1]+r[1];out[2]=p[2]+r[2];return out;}
