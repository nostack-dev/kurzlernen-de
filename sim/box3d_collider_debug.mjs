import * as THREE from "three";

const AIRFRAME_COLOR=0xff5a6f;
const BUILDING_COLOR=0x58e7ff;
const GROUND_COLOR=0xffd166;
const DEBUG_RENDER_ORDER=1900;
const PROPELLER_SWEEP_HALF_THICKNESS_M=.002;

function lineMaterial(color,opacity=.95){
  return new THREE.LineBasicMaterial({color,transparent:true,opacity,depthTest:false,depthWrite:false,toneMapped:false});
}
function lineSegments(positions,color,opacity=.95){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  const lines=new THREE.LineSegments(geometry,lineMaterial(color,opacity));
  lines.renderOrder=DEBUG_RENDER_ORDER;lines.frustumCulled=false;return lines;
}
function wireObject(geometry,color=AIRFRAME_COLOR,opacity=.95){
  const wire=new THREE.WireframeGeometry(geometry);geometry.dispose();
  const lines=new THREE.LineSegments(wire,lineMaterial(color,opacity));
  lines.renderOrder=DEBUG_RENDER_ORDER;lines.frustumCulled=false;return lines;
}
function disposeChildren(group){
  for(const child of [...group.children]){
    group.remove(child);
    child.traverse?.(object=>{object.geometry?.dispose?.();if(Array.isArray(object.material))object.material.forEach(material=>material?.dispose?.());else object.material?.dispose?.();});
  }
}
function addSphere(group,point,radius,color=AIRFRAME_COLOR){
  const sphere=wireObject(new THREE.SphereGeometry(radius,8,6),color,.88);sphere.position.set(...point);group.add(sphere);
}
function addCapsule(group,start,end,radius,color=AIRFRAME_COLOR){
  const a=new THREE.Vector3(...start),b=new THREE.Vector3(...end),axis=b.clone().sub(a),length=axis.length();
  if(length>1e-8){
    const cylinder=wireObject(new THREE.CylinderGeometry(radius,radius,length,8,1,true),color,.88);
    cylinder.position.copy(a).add(b).multiplyScalar(.5);
    cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize());
    group.add(cylinder);
  }
  addSphere(group,start,radius,color);addSphere(group,end,radius,color);
}
function addPropellerSweep(group,point,diameter,color=AIRFRAME_COLOR){
  const radius=Number(diameter)/2;if(!(radius>.018))return;
  const sweep=wireObject(new THREE.CylinderGeometry(radius,radius,PROPELLER_SWEEP_HALF_THICKNESS_M*2,24,1,true),color,.72);
  sweep.rotation.x=Math.PI/2;sweep.position.set(...point);sweep.name="BOX3D_PROPELLER_SWEEP";group.add(sweep);
}
function prismEdgePositions(prisms){
  const positions=[];
  for(const prism of Array.isArray(prisms)?prisms:[]){
    const ring=Array.isArray(prism?.points)?prism.points:[],base=Number(prism?.base),top=Number(prism?.top);
    if(ring.length<3||!Number.isFinite(base)||!Number.isFinite(top))continue;
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      positions.push(a[0],a[1],base,b[0],b[1],base,a[0],a[1],top,b[0],b[1],top,a[0],a[1],base,a[0],a[1],top);
    }
  }
  return positions;
}

export class Box3dColliderDebugDraw{
  constructor(scene){
    if(!scene)throw Error("Box3D collider debug draw requires THREE scene");
    this.root=new THREE.Group();this.root.name="BOX3D_COLLIDER_DEBUG_DRAW";this.root.visible=false;this.root.renderOrder=DEBUG_RENDER_ORDER;
    this.staticRoot=new THREE.Group();this.staticRoot.name="BOX3D_STATIC_COLLIDERS";
    this.airframeRoot=new THREE.Group();this.airframeRoot.name="BOX3D_AIRFRAME_COLLIDERS";
    this.root.add(this.staticRoot,this.airframeRoot);scene.add(this.root);
    const ground=new THREE.GridHelper(30,30,GROUND_COLOR,GROUND_COLOR);ground.rotation.x=Math.PI/2;ground.position.z=.002;ground.material.transparent=true;ground.material.opacity=.28;ground.material.depthTest=false;ground.material.depthWrite=false;ground.renderOrder=DEBUG_RENDER_ORDER;ground.frustumCulled=false;ground.name="BOX3D_GROUND_COLLIDER_LOCAL_PATCH";this.root.add(ground);
    this.enabled=false;this.worldRevision=-1;this.airframeKey="";this.activePrismCount=0;
  }
  setEnabled(value){this.enabled=Boolean(value);this.root.visible=this.enabled;if(!this.enabled)this.activePrismCount=0;else this.worldRevision=-1;return this.enabled;}
  syncWorld(state,revision=0){
    if(!this.enabled)return false;const nextRevision=Number(revision)||0;if(nextRevision===this.worldRevision)return false;this.worldRevision=nextRevision;disposeChildren(this.staticRoot);
    const active=Array.isArray(state?.activePrisms)?state.activePrisms:[],positions=prismEdgePositions(active);this.activePrismCount=active.length;
    if(positions.length){const lines=lineSegments(positions,BUILDING_COLOR,.98);lines.name="BOX3D_BUILDING_COLLIDERS";this.staticRoot.add(lines);}return true;
  }
  syncAirframe(motorPositions,airframeHalfZ=.022,propellerDiameter=0){
    if(!this.enabled)return false;const motors=(Array.isArray(motorPositions)?motorPositions:[]).map(point=>point.map(Number)),halfZ=Number(airframeHalfZ)||.022,propD=Math.max(0,Number(propellerDiameter)||0),key=JSON.stringify([halfZ,propD,motors]);if(key===this.airframeKey)return false;this.airframeKey=key;disposeChildren(this.airframeRoot);
    const body=wireObject(new THREE.BoxGeometry(.11,.09,halfZ*2),AIRFRAME_COLOR,1);body.name="BOX3D_AIRFRAME_BODY";this.airframeRoot.add(body);
    for(const motor of motors){if(motor.length<3||motor.some(value=>!Number.isFinite(value)))continue;addCapsule(this.airframeRoot,[0,0,0],motor,.008);addSphere(this.airframeRoot,motor,.018);addPropellerSweep(this.airframeRoot,motor,propD);}
    return true;
  }
  updateAirframe(pose){
    if(!this.enabled||!pose)return;this.airframeRoot.position.copy(pose.position);this.airframeRoot.quaternion.copy(pose.quaternion);this.airframeRoot.updateMatrixWorld();
  }
}
