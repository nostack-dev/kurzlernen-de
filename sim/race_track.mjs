import * as THREE from "three";

export const RACE_LAPS = 3;

// Ordered course. Gate direction is derived from the next gate, so a pass only
// counts in the intended race direction. Coordinates are metres in the same
// Z-up world as the flight physics.
export const RACE_GATES = Object.freeze([
  {name:"START / FINISH", center:[-2.0, 0.0, 1.15], width:1.90, height:1.55, start:true},
  {name:"GATE 2", center:[-5.0,-1.7, 1.55], width:1.75, height:1.45},
  {name:"GATE 3", center:[-7.0, 1.25,1.05], width:1.65, height:1.35},
  {name:"HIGH GATE",center:[-4.2, 4.45,1.85], width:1.70, height:1.45},
  {name:"GATE 5", center:[ 0.0, 5.55,1.20], width:1.75, height:1.40},
  {name:"GATE 6", center:[ 4.0, 3.10,1.65], width:1.65, height:1.35},
  {name:"LOW GATE", center:[ 4.55,-1.10,1.00], width:1.60, height:1.25},
  {name:"GATE 8", center:[ 1.55,-3.85,1.45], width:1.70, height:1.40},
]);

const ACTIVE = 0x6df5a8;
const NORMAL = 0xf2f5f7;
const START = 0xffc857;
const PASSED = 0x58b8ff;
const POST = 0.055;

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const normalize=v=>{const n=Math.hypot(v[0],v[1],v[2])||1;return[v[0]/n,v[1]/n,v[2]/n];};

function formatTime(seconds){
  if(!Number.isFinite(seconds)||seconds<0)return "—";
  const minutes=Math.floor(seconds/60),rest=seconds-minutes*60;
  return `${String(minutes).padStart(2,"0")}:${rest.toFixed(3).padStart(6,"0")}`;
}

function gateFrame(scene,gate,index){
  const group=new THREE.Group();
  const material=new THREE.MeshStandardMaterial({color:gate.start?START:NORMAL,roughness:.42,metalness:.08,emissive:0x000000,emissiveIntensity:.0});
  const geometryH=new THREE.BoxGeometry(gate.width+POST*2,POST,POST);
  const geometryV=new THREE.BoxGeometry(POST,POST,gate.height+POST*2);
  const top=new THREE.Mesh(geometryH,material),bottom=new THREE.Mesh(geometryH,material);
  const left=new THREE.Mesh(geometryV,material),right=new THREE.Mesh(geometryV,material);
  top.position.z=gate.height/2;bottom.position.z=-gate.height/2;
  left.position.x=-gate.width/2;right.position.x=gate.width/2;
  for(const mesh of [top,bottom,left,right]){mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}

  const next=RACE_GATES[(index+1)%RACE_GATES.length];
  const normal=normalize([next.center[0]-gate.center[0],next.center[1]-gate.center[1],0]);
  const rightAxis=[-normal[1],normal[0],0];
  // Local +X is the horizontal opening axis, local +Y is race-forward.
  group.rotation.z=Math.atan2(rightAxis[1],rightAxis[0]);
  group.position.set(...gate.center);
  group.userData={material,normal,rightAxis,index};
  scene.add(group);
  return group;
}

function addCourseMarkers(group){
  const coneMaterial=new THREE.MeshStandardMaterial({color:0xff714d,roughness:.75});
  const poleMaterial=new THREE.MeshStandardMaterial({color:0x2e4150,roughness:.7});
  const coneGeometry=new THREE.ConeGeometry(.095,.34,14);
  const poleGeometry=new THREE.CylinderGeometry(.025,.025,.75,10);
  const points=[[-3.6,1.7],[-5.7,3.1],[-2.0,5.5],[2.0,4.6],[4.8,1.0],[3.4,-3.0],[-.4,-4.15]];
  for(const [x,y] of points){
    const cone=new THREE.Mesh(coneGeometry,coneMaterial);cone.position.set(x,y,.17);cone.rotation.x=Math.PI/2;cone.castShadow=true;group.add(cone);
  }
  // Two simple slalom poles make the route readable without clutter.
  for(const [x,y] of [[-5.8,.1],[2.8,1.1]]){
    const pole=new THREE.Mesh(poleGeometry,poleMaterial);pole.position.set(x,y,.375);pole.rotation.x=Math.PI/2;pole.castShadow=true;group.add(pole);
  }
  const startPad=new THREE.Mesh(new THREE.CylinderGeometry(.72,.72,.018,48),new THREE.MeshStandardMaterial({color:0x34495a,roughness:.9}));
  startPad.position.set(0,0,.012);group.add(startPad);
  const stripe=new THREE.Mesh(new THREE.BoxGeometry(1.2,.08,.012),new THREE.MeshStandardMaterial({color:START,roughness:.8}));
  stripe.position.set(-1.2,0,.012);group.add(stripe);
}

export class RaceTrack {
  constructor(scene,{laps=RACE_LAPS}={}){
    this.scene=scene;this.totalLaps=laps;
    this.group=new THREE.Group();scene.add(this.group);
    this.gates=RACE_GATES.map((gate,index)=>gateFrame(this.group,gate,index));
    addCourseMarkers(this.group);
    this.visible=false;this.group.visible=false;
    this.bestLap=this._loadBest();
    this.reset();
  }
  _loadBest(){try{const value=Number(localStorage.getItem("arondight45RaceBestLap"));return Number.isFinite(value)&&value>0?value:null;}catch{return null;}}
  _saveBest(){try{if(this.bestLap)localStorage.setItem("arondight45RaceBestLap",String(this.bestLap));}catch{}}
  setVisible(value){this.visible=Boolean(value);this.group.visible=this.visible;this._paint();}
  reset(){
    this.started=false;this.finished=false;this.lap=0;this.nextGate=0;this.raceStart=0;this.lapStart=0;this.finishTime=null;this.lastLap=null;this.prevPosition=null;this.lastPassTime=-Infinity;this._paint();
  }
  _paint(){
    if(!this.gates)return;
    this.gates.forEach((group,index)=>{
      const material=group.userData.material;
      let color=RACE_GATES[index].start?START:NORMAL;
      if(this.started&&!this.finished&&index<this.nextGate&&this.nextGate!==0)color=PASSED;
      if(!this.finished&&index===this.nextGate)color=ACTIVE;
      material.color.setHex(color);
      material.emissive.setHex(index===this.nextGate&&!this.finished?ACTIVE:0x000000);
      material.emissiveIntensity=index===this.nextGate&&!this.finished?.32:0;
    });
  }
  _crossedGate(index,a,b){
    const gate=RACE_GATES[index],frame=this.gates[index],normal=frame.userData.normal,right=frame.userData.rightAxis;
    const ar=sub(a,gate.center),br=sub(b,gate.center),da=dot(ar,normal),db=dot(br,normal);
    if(!(da<0&&db>=0))return false;
    const denom=da-db;if(Math.abs(denom)<1e-8)return false;
    const t=da/denom;
    const hit=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
    const rel=sub(hit,gate.center),u=dot(rel,right),v=rel[2];
    return Math.abs(u)<=gate.width*.5&&Math.abs(v)<=gate.height*.5;
  }
  update(position,simTime,enabled=true){
    const p=[position[0],position[1],position[2]];
    if(!this.visible||!enabled){this.prevPosition=p;return null;}
    if(!this.prevPosition){this.prevPosition=p;return null;}
    if(this.finished){this.prevPosition=p;return null;}
    if(simTime-this.lastPassTime<.20){this.prevPosition=p;return null;}
    if(!this._crossedGate(this.nextGate,this.prevPosition,p)){this.prevPosition=p;return null;}
    this.lastPassTime=simTime;
    const passed=this.nextGate;
    if(!this.started){
      // First correct crossing must be START/FINISH.
      this.started=true;this.lap=1;this.raceStart=simTime;this.lapStart=simTime;this.nextGate=1;
    }else if(passed===0){
      const lapTime=simTime-this.lapStart;this.lastLap=lapTime;
      if(!this.bestLap||lapTime<this.bestLap){this.bestLap=lapTime;this._saveBest();}
      if(this.lap>=this.totalLaps){this.finished=true;this.finishTime=simTime-this.raceStart;this.nextGate=0;}
      else{this.lap++;this.lapStart=simTime;this.nextGate=1;}
    }else if(passed===RACE_GATES.length-1){this.nextGate=0;}
    else{this.nextGate=passed+1;}
    this.prevPosition=p;this._paint();
    return {passed,lap:this.lap,finished:this.finished};
  }
  snapshot(simTime){
    const current=this.started?(this.finished?this.lastLap:simTime-this.lapStart):0;
    const total=this.started?(this.finished?this.finishTime:simTime-this.raceStart):0;
    return {
      started:this.started,finished:this.finished,lap:this.lap,totalLaps:this.totalLaps,nextGate:this.nextGate,gateCount:RACE_GATES.length,
      currentLap:current,totalTime:total,lastLap:this.lastLap,bestLap:this.bestLap,
      currentLapText:formatTime(current),totalTimeText:formatTime(total),lastLapText:formatTime(this.lastLap),bestLapText:formatTime(this.bestLap),
      nextGateText:this.finished?"FINISHED":RACE_GATES[this.nextGate].name,
    };
  }
}

export {formatTime};
