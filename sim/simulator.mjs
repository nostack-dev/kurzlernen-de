import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js";
import Box3DFactory from "https://cdn.jsdelivr.net/npm/box3d.js@0.1.1/dist/box3d.inline.mjs";

const DT = 0.001;
const G = 9.80665;
const INPUT_MAGIC = 0x314c4948;
const OUTPUT_MAGIC = 0x314f4c48;
const INPUT_BYTES = 64;
const OUTPUT_BYTES = 32;
const FLAG_IMU_VALID = 1;
const FLAG_RESET = 2;
const STATE_ARMED = 1;
const STATE_CALIBRATING = 2;
const STATE_FAULT = 4;
const $ = id => document.getElementById(id);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const norm = v => Math.hypot(v[0], v[1], v[2]);
const add = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const scale = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

const ui = Object.fromEntries([
  "modeInfo","connect","run","reset","status","tMode","tController","fcState","simTime","altitude","velocity","attitude","motors","rpm","battery","current","processing","rtt","speed","armSwitch","throttle","logFile","fit","fitProgress","fitStatus","logSamples","touchRoll","touchPitch","touchYaw","touchThrottle","touchArm"
].map(id => [id,$(id)]));

function crc32(bytes, length=bytes.byteLength) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let c = 0xffffffff;
  for (let i=0;i<length;i++) {
    c ^= u[i];
    for (let b=0;b<8;b++) c = (c>>>1) ^ ((c&1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function parseOutput(bytes) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength !== OUTPUT_BYTES || d.getUint32(0,true) !== OUTPUT_MAGIC) throw Error("Invalid HLO1 response");
  if (crc32(bytes,28) !== d.getUint32(28,true)) throw Error("HLO1 CRC mismatch");
  return {
    sequence:d.getUint32(4,true),
    motors:[d.getUint16(8,true),d.getUint16(10,true),d.getUint16(12,true),d.getUint16(14,true)],
    attitude:[d.getInt16(16,true)/100,d.getInt16(18,true)/100,d.getInt16(20,true)/100],
    state:d.getUint16(22,true),processingUs:d.getUint32(24,true)
  };
}
function encodeSbus(ch) {
  const p = new Uint8Array(25); p[0]=0x0f; p[24]=0;
  for (let c=0;c<16;c++) {
    const v = ch[c] & 2047;
    for (let b=0;b<11;b++) if (v & (1<<b)) { const k=8+c*11+b; p[k>>3] |= 1<<(k&7); }
  }
  return p;
}
function makeInput(seq, imu, sbus, flags, dtUs=1000) {
  const b = new Uint8Array(INPUT_BYTES), d = new DataView(b.buffer);
  d.setUint32(0,INPUT_MAGIC,true); d.setUint32(4,seq,true); d.setUint32(8,dtUs,true);
  b.set(imu,12); b.set(sbus,26); b[51]=flags; d.setUint32(60,crc32(b,60),true);
  return b;
}

class WasmBackend {
  constructor(){this.module=null;this.inPtr=0;this.outPtr=0;this.ready=false;}
  async connect(){
    const {default:createCore} = await import("../generated/flight_core.mjs");
    this.module = await createCore();
    if (this.module._fc_input_size() !== INPUT_BYTES || this.module._fc_output_size() !== OUTPUT_BYTES) throw Error("WASM HIL protocol size mismatch");
    this.inPtr=this.module._fc_input_buffer(); this.outPtr=this.module._fc_output_buffer(); this.module._fc_reset(); this.ready=true;
  }
  async disconnect(){this.ready=false;this.module=null;}
  async reset(){if(this.module)this.module._fc_reset();}
  async exchange(packet){
    if(!this.ready) throw Error("WASM flight core not ready");
    this.module.HEAPU8.set(packet,this.inPtr); this.module._fc_process();
    return parseOutput(this.module.HEAPU8.slice(this.outPtr,this.outPtr+OUTPUT_BYTES));
  }
  label(){return "production C++ / WASM";}
}

class ByteResponseParser {
  constructor(){this.rx=new Uint8Array(0);this.waiters=new Map();}
  feed(chunk){
    const merged=new Uint8Array(this.rx.length+chunk.length); merged.set(this.rx); merged.set(chunk,this.rx.length); this.rx=merged;
    const magic=[72,76,79,49];
    while(this.rx.length>=4){
      let start=-1; outer: for(let i=0;i<=this.rx.length-4;i++){for(let k=0;k<4;k++) if(this.rx[i+k]!==magic[k]) continue outer; start=i; break;}
      if(start<0){this.rx=this.rx.slice(Math.max(0,this.rx.length-3));return;}
      if(start>0)this.rx=this.rx.slice(start); if(this.rx.length<OUTPUT_BYTES)return;
      const packet=this.rx.slice(0,OUTPUT_BYTES); this.rx=this.rx.slice(OUTPUT_BYTES);
      try { const out=parseOutput(packet), w=this.waiters.get(out.sequence); if(w){this.waiters.delete(out.sequence);clearTimeout(w.timer);w.resolve(out);} } catch(e){console.warn(e);}
    }
  }
  wait(seq,timeout=2000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.waiters.delete(seq);reject(Error("S31 response timeout"));},timeout);this.waiters.set(seq,{resolve,reject,timer});});}
  fail(error){for(const w of this.waiters.values()){clearTimeout(w.timer);w.reject(error);}this.waiters.clear();}
}
class HardwareBackend {
  constructor(){this.kind=null;this.port=null;this.reader=null;this.writer=null;this.socket=null;this.parser=new ByteResponseParser();this.reading=false;}
  async connect(){
    if("serial" in navigator){
      this.kind="usb"; this.port=await navigator.serial.requestPort(); await this.port.open({baudRate:2000000,bufferSize:65536});
      this.reader=this.port.readable.getReader();this.writer=this.port.writable.getWriter();this.reading=true;this.readLoop();return;
    }
    const fromQuery=new URLSearchParams(location.search).get("bridge");
    let url=fromQuery || localStorage.getItem("arondight45BridgeUrl") || "";
    if(!url && location.protocol==="http:" && location.port) url=`ws://${location.host}/hil`;
    if(!url) url=prompt("S31 HIL bridge URL","ws://192.168.1.20:8765/hil")||"";
    if(!/^wss?:\/\//i.test(url)) throw Error("iPhone requires the real S31 LAN bridge URL");
    if(location.protocol==="https:" && url.startsWith("ws://")) throw Error("Open the HTTP address served by tools/s31_hil_bridge.mjs on the iPhone, then connect.");
    localStorage.setItem("arondight45BridgeUrl",url);this.kind="lan";
    this.socket=new WebSocket(url);this.socket.binaryType="arraybuffer";
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error("LAN bridge timeout")),5000);this.socket.onopen=()=>{clearTimeout(t);resolve();};this.socket.onerror=()=>{clearTimeout(t);reject(Error("Cannot reach S31 LAN bridge"));};});
    this.socket.onmessage=e=>this.parser.feed(new Uint8Array(e.data));this.socket.onclose=()=>this.parser.fail(Error("S31 LAN bridge disconnected"));
  }
  async readLoop(){try{while(this.reading){const{value,done}=await this.reader.read();if(done)break;if(value?.length)this.parser.feed(value);}}catch(e){this.parser.fail(e);}}
  async exchange(packet,seq){const response=this.parser.wait(seq);if(this.kind==="usb")await this.writer.write(packet);else if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(packet);else throw Error("Physical S31 not connected");return response;}
  async reset(){}
  async disconnect(){this.reading=false;try{await this.reader?.cancel();}catch{}try{this.reader?.releaseLock();}catch{}try{this.writer?.releaseLock();}catch{}try{await this.port?.close();}catch{}try{this.socket?.close();}catch{}this.port=this.reader=this.writer=this.socket=null;this.parser.fail(Error("Disconnected"));}
  label(){return this.kind==="usb"?"physical S31 / USB":"physical S31 / LAN";}
}

class Noise {
  constructor(seed=0x45a31f27){this.s=seed>>>0;this.spare=null;this.gyroBias=[0.08,-0.05,0.04];this.accBias=[0.001,-0.0015,0.002];}
  uniform(){let x=this.s;x^=x<<13;x^=x>>>17;x^=x<<5;this.s=x>>>0;return(this.s+1)/4294967297;}
  gaussian(){if(this.spare!==null){const z=this.spare;this.spare=null;return z;}const u=Math.max(1e-12,this.uniform()),v=this.uniform(),r=Math.sqrt(-2*Math.log(u));this.spare=r*Math.sin(2*Math.PI*v);return r*Math.cos(2*Math.PI*v);}
  stepBias(dt){for(let i=0;i<3;i++){this.gyroBias[i]+=this.gaussian()*0.002*Math.sqrt(dt);this.accBias[i]+=this.gaussian()*0.00002*Math.sqrt(dt);}}
}

const b3 = await Box3DFactory();

function defaultParams(){return {
  mass:+$("mass").value,span:+$("span").value/1000,propD:+$("propD").value*.0254,kv:+$("kv").value,R:+$("resistance").value,J:+$("rotorJ").value,
  Ct:+$("ct").value,Cq:+$("cq").value,capacity:+$("capacity").value,batteryR:+$("batteryR").value,Ixx:+$("ixx").value,Iyy:+$("iyy").value,Izz:+$("izz").value,rho:+$("rho").value,
  dragScale:+$("dragScale").value,groundEffect:+$("groundEffect").value,wind:[+$("windX").value,+$("windY").value,0],failed:+$("failedMotor").value,imuValid:$("imuValid").value==="1"
};}
function validateParams(p){
  for(const[k,v]of Object.entries(p))if(typeof v==="number"&&!Number.isFinite(v))throw Error(`Invalid physical parameter ${k}`);
  for(const k of ["mass","span","propD","kv","R","J","Ct","Cq","capacity","batteryR","Ixx","Iyy","Izz","rho","dragScale"])if(!(p[k]>0))throw Error(`${k} must be positive`);
  if(p.Ixx+p.Iyy<=p.Izz||p.Ixx+p.Izz<=p.Iyy||p.Iyy+p.Izz<=p.Ixx)throw Error("Inertia tensor violates rigid-body triangle inequalities");
}
function quatToEuler(q){
  const[x,y,z,w]=q;const sinr=2*(w*x+y*z),cosr=1-2*(x*x+y*y),roll=Math.atan2(sinr,cosr);const sinp=2*(w*y-z*x),pitch=Math.abs(sinp)>=1?Math.sign(sinp)*Math.PI/2:Math.asin(sinp);const siny=2*(w*z+x*y),cosy=1-2*(y*y+z*z),yaw=Math.atan2(siny,cosy);return[roll*180/Math.PI,pitch*180/Math.PI,yaw*180/Math.PI];
}
function eulerToQuat(r,p,y){r*=Math.PI/360;p*=Math.PI/360;y*=Math.PI/360;const cr=Math.cos(r),sr=Math.sin(r),cp=Math.cos(p),sp=Math.sin(p),cy=Math.cos(y),sy=Math.sin(y);return[sr*cp*cy-cr*sp*sy,cr*sp*cy+sr*cp*sy,cr*cp*sy-sr*sp*cy,cr*cp*cy+sr*sp*sy];}

class PhysicsModel {
  constructor(params,{graphics=false,scene=null}={}){this.graphics=graphics;this.scene=scene;this.noise=new Noise();this.world=null;this.body=null;this.group=null;this.rotors=[];this.reset(params);}
  reset(p,initial=null){validateParams(p);this.p={...p,wind:[...p.wind]};if(this.world)b3.b3DestroyWorld(this.world);const wd=b3.b3DefaultWorldDef();wd.gravity=[0,0,-G];wd.enableSleep=false;wd.enableContinuous=true;this.world=b3.b3CreateWorld(wd);
    const gd=b3.b3DefaultBodyDef();gd.position=[0,0,-.05];const ground=b3.b3CreateBody(this.world,gd),gs=b3.b3DefaultShapeDef();gs.baseMaterial.friction=.75;gs.baseMaterial.restitution=.03;b3.b3CreateBoxShape(ground,gs,10,10,.05);
    const bd=b3.b3DefaultBodyDef();bd.type=b3.b3BodyType.b3_dynamicBody;bd.position=[initial?.x||0,initial?.y||0,Math.max(.08,initial?.z||.08)];bd.rotation=initial?[...eulerToQuat(initial.roll_deg||0,initial.pitch_deg||0,initial.yaw_deg||0)]:[0,0,0,1];bd.linearDamping=.002;bd.angularDamping=.002;bd.enableSleep=false;this.body=b3.b3CreateBody(this.world,bd);
    const sd=b3.b3DefaultShapeDef();sd.density=100;sd.baseMaterial.friction=.65;sd.baseMaterial.restitution=.08;b3.b3CreateBoxShape(this.body,sd,.055,.045,.022);const a=p.span/(2*Math.sqrt(2));this.motorPos=[[-a,-a,0],[-a,a,0],[a,a,0],[a,-a,0]];for(const r of this.motorPos){b3.b3CreateCapsuleShape(this.body,sd,{center1:[0,0,0],center2:r,radius:.008});b3.b3CreateSphereShape(this.body,sd,{center:r,radius:.018});}
    const md=b3.b3Body_GetMassData(this.body);md.mass=p.mass;md.center=[0,0,-.006];md.inertia={cx:[p.Ixx,0,0],cy:[0,p.Iyy,0],cz:[0,0,p.Izz]};b3.b3Body_SetMassData(this.body,md);
    if(initial?.vx!=null && b3.b3Body_SetLinearVelocity)b3.b3Body_SetLinearVelocity(this.body,[initial.vx||0,initial.vy||0,initial.vz||0]);
    this.motorOmega=[0,0,0,0];this.batterySoc=1;this.batteryVoltage=16.8;this.batteryCurrent=0;this.worldAcceleration=[0,0,0];this.prevOmegaBody=[0,0,0];this.lastLinear=this.linear();
    if(this.graphics)this.buildGraphics();
  }
  buildGraphics(){if(this.group)this.scene.remove(this.group);this.group=new THREE.Group();this.scene.add(this.group);this.rotors=[];const fm=new THREE.MeshStandardMaterial({color:0x252d3b,metalness:.35,roughness:.35}),bm=new THREE.MeshStandardMaterial({color:0x121820,metalness:.5,roughness:.25});const center=new THREE.Mesh(new THREE.BoxGeometry(.11,.09,.044),bm);center.castShadow=true;this.group.add(center);for(let i=0;i<4;i++){const r=this.motorPos[i],len=Math.hypot(r[0],r[1]),arm=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,len,12),fm);arm.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(r[0],r[1],0).normalize());arm.position.set(r[0]/2,r[1]/2,0);this.group.add(arm);const motor=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.025,20),bm);motor.rotation.x=Math.PI/2;motor.position.set(...r);this.group.add(motor);const rotor=new THREE.Mesh(new THREE.BoxGeometry(this.p.propD,.012,.002),new THREE.MeshStandardMaterial({color:i%2?0xffa34d:0x4dd6ff,transparent:true,opacity:.72}));rotor.position.set(...r);this.group.add(rotor);this.rotors.push(rotor);}const nose=new THREE.Mesh(new THREE.ConeGeometry(.018,.06,16),new THREE.MeshStandardMaterial({color:0xff4f65}));nose.rotation.z=-Math.PI/2;nose.position.x=-.075;this.group.add(nose);}
  localVector(v){return b3.b3Body_GetLocalVector([0,0,0],this.body,v);} worldVector(v){return b3.b3Body_GetWorldVector([0,0,0],this.body,v);} worldPoint(v){return b3.b3Body_GetWorldPoint([0,0,0],this.body,v);} linear(){return b3.b3Body_GetLinearVelocity([0,0,0],this.body);} angular(){return b3.b3Body_GetAngularVelocity([0,0,0],this.body);} position(){return b3.b3Body_GetPosition([0,0,0],this.body);} rotation(){return b3.b3Body_GetRotation([0,0,0,1],this.body);}
  imuRaw(dt=DT){this.noise.stepBias(dt);const ow=this.localVector(this.angular()),alpha=scale(sub(ow,this.prevOmegaBody),1/dt);this.prevOmegaBody=ow.slice();const specific=this.localVector(sub(this.worldAcceleration,[0,0,-G])),r=[0,0,.008],accel=add(specific,add(cross(alpha,r),cross(ow,cross(ow,r)))),gyro=scale(ow,180/Math.PI);for(let i=0;i<3;i++){accel[i]+=this.noise.accBias[i]*G+this.noise.gaussian()*.0025*G;gyro[i]+=this.noise.gyroBias[i]+this.noise.gaussian()*.035;}const raw=new Uint8Array(14),d=new DataView(raw.buffer),sat=x=>clamp(Math.round(x),-32767,32767);d.setInt16(0,0,false);d.setInt16(2,sat(accel[0]/G*2048),false);d.setInt16(4,sat(accel[1]/G*2048),false);d.setInt16(6,sat(accel[2]/G*2048),false);d.setInt16(8,sat(gyro[0]*16.4),false);d.setInt16(10,sat(gyro[1]*16.4),false);d.setInt16(12,sat(gyro[2]*16.4),false);return raw;}
  batteryOcv(){const s=this.batterySoc;return 13.2+3.6*clamp(s,0,1)+.15*Math.tanh((s-.12)*18);}
  applyForces(pulses,dt=DT){const p=this.p,yawSign=[-1,1,-1,1],D=p.propD,ke=60/(2*Math.PI*p.kv),kt=ke,ocv=this.batteryOcv();let currents=[0,0,0,0],total=0;for(let pass=0;pass<2;pass++){total=0;for(let i=0;i<4;i++){let command=clamp((pulses[i]-1050)/950,0,1);if(i===p.failed)command=0;const volts=command*(pass?this.batteryVoltage:ocv);currents[i]=clamp((volts-ke*this.motorOmega[i])/p.R,0,45);total+=currents[i];}this.batteryVoltage=clamp(ocv-total*p.batteryR,10,16.8);}this.batteryCurrent=total;this.batterySoc=clamp(this.batterySoc-total*dt/(p.capacity*3600),0,1);
    const localVelocity=this.localVector(this.linear()),alt=Math.max(.001,this.position()[2]);for(let i=0;i<4;i++){const n=this.motorOmega[i]/(2*Math.PI),propTorque=p.Cq*p.rho*n*n*D**5,motorTorque=kt*currents[i];this.motorOmega[i]=Math.max(0,this.motorOmega[i]+(motorTorque-propTorque-1.5e-7*this.motorOmega[i])*dt/p.J);const n2=this.motorOmega[i]/(2*Math.PI);let thrust=p.Ct*p.rho*n2*n2*D**4;const advance=localVelocity[2]/Math.max(1,n2*D);thrust*=clamp(1-.12*advance,.55,1.25);thrust*=1+p.groundEffect*Math.exp(-alt/Math.max(.02,.75*D));b3.b3Body_ApplyForce(this.body,this.worldVector([0,0,thrust]),this.worldPoint(this.motorPos[i]),true);b3.b3Body_ApplyTorque(this.body,this.worldVector([0,0,yawSign[i]*propTorque]),true);}
    const rel=this.localVector(sub(this.linear(),p.wind)),cdA=[.035,.04,.07].map(x=>x*p.dragScale),drag=rel.map((v,i)=>-.5*p.rho*cdA[i]*v*Math.abs(v));b3.b3Body_ApplyForceToCenter(this.body,this.worldVector(drag),true);const w=this.localVector(this.angular()),ad=w.map(v=>-.0012*p.dragScale*v*Math.abs(v));b3.b3Body_ApplyTorque(this.body,this.worldVector(ad),true);
  }
  step(pulses,dt=DT){this.applyForces(pulses,dt);const before=this.linear();b3.b3World_Step(this.world,dt,4);this.worldAcceleration=scale(sub(this.linear(),before),1/dt);return this.state();}
  state(){const p=this.position(),q=this.rotation(),v=this.linear();return{x:p[0],y:p[1],z:p[2],vx:v[0],vy:v[1],vz:v[2],speed:norm(v),attitude:quatToEuler(q),battery_v:this.batteryVoltage,current_a:this.batteryCurrent};}
  render(){if(!this.graphics||!this.group)return;const p=this.position(),q=this.rotation();this.group.position.set(...p);this.group.quaternion.set(q[0],q[1],q[2],q[3]);this.rotors.forEach((r,i)=>r.rotation.z+=(i%2?-1:1)*this.motorOmega[i]/60);}
}

THREE.Object3D.DEFAULT_UP.set(0,0,1);const scene=new THREE.Scene();scene.background=new THREE.Color(0x080d16);scene.fog=new THREE.Fog(0x080d16,8,35);const camera=new THREE.PerspectiveCamera(58,1,.01,100);camera.up.set(0,0,1);camera.position.set(3.3,-4.2,2.6);const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;$("viewport").appendChild(renderer.domElement);scene.add(new THREE.HemisphereLight(0xbfd8ff,0x263248,1.4));const sun=new THREE.DirectionalLight(0xffffff,2.3);sun.position.set(-4,-5,8);sun.castShadow=true;scene.add(sun);const grid=new THREE.GridHelper(20,40,0x40506b,0x202a3a);grid.rotation.x=Math.PI/2;scene.add(grid);const groundMesh=new THREE.Mesh(new THREE.BoxGeometry(20,20,.1),new THREE.MeshStandardMaterial({color:0x182231,roughness:.9}));groundMesh.position.z=-.05;groundMesh.receiveShadow=true;scene.add(groundMesh);
function resize(){const r=$("viewport").getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();}addEventListener("resize",resize);resize();

let physics=new PhysicsModel(defaultParams(),{graphics:true,scene}),mode="sim",backend=null,running=false,sequence=1,simTime=0,resetFlag=true,latest={motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0},wallStart=performance.now(),simStart=0;const keys=new Set();let arm=false,throttle=0,realLog=[];
function setStatus(text,cls=""){ui.status.textContent=text;ui.status.className="statusline "+cls;}
function modeDescription(){if(mode==="sim")return "SIM · default. Exact production C++ controller compiled to WASM. No physical board required.";if(mode==="hil")return "HIL · same HIL1/HLO1 packets, but controller executes on a physical ESP32-S31 over USB or LAN bridge.";return "REAL LOG · recorded motor outputs drive the identical Box3D airframe model. Use Fit physics to identify parameters against measured flight data.";}
function updateModeUI(){ui.modeInfo.textContent=modeDescription();ui.tMode.textContent=mode.toUpperCase();for(const [id,m] of [["modeSim","sim"],["modeHil","hil"],["modeReplay","replay"]])$(id).classList.toggle("active",mode===m);ui.connect.textContent=mode==="sim"?"Reload flight core":mode==="hil"?"Connect physical S31":"Load real log";ui.connect.disabled=mode==="replay";ui.run.disabled=mode==="replay"?!realLog.length:!backend;ui.run.textContent=running?"Pause":"Start";}
async function switchMode(next){running=false;ui.run.textContent="Start";if(backend)try{await backend.disconnect();}catch{}backend=null;mode=next;resetSimulation();if(mode==="sim"){setStatus("Loading exact C++ flight core…");try{backend=new WasmBackend();await backend.connect();ui.tController.textContent=backend.label();ui.tController.className="good";setStatus("SIM ready: production C++ flight core active.","good");ui.run.disabled=false;}catch(e){ui.tController.textContent="WASM load failed";ui.tController.className="bad";setStatus(e.message,"bad");}}else if(mode==="hil"){ui.tController.textContent="not connected";ui.tController.className="warn";setStatus("Connect the physical S31.");}else{ui.tController.textContent="real motor log";ui.tController.className="good";setStatus(realLog.length?`${realLog.length} real samples loaded.`:"Load a real flight log.");}updateModeUI();}
function resetSimulation(initial=null){physics.reset(defaultParams(),initial);sequence=1;simTime=0;resetFlag=true;latest={motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0};throttle=0;arm=false;ui.touchThrottle.value="0";ui.touchRoll.value=ui.touchPitch.value=ui.touchYaw.value="0";ui.touchArm.textContent="ARM switch: LOW";wallStart=performance.now();simStart=0;if(backend?.reset)backend.reset();}
function controls(){let roll=+ui.touchRoll.value,pitch=+ui.touchPitch.value,yaw=+ui.touchYaw.value;if(keys.has("KeyD"))roll=1;if(keys.has("KeyA"))roll=-1;if(keys.has("KeyW"))pitch=1;if(keys.has("KeyS"))pitch=-1;if(keys.has("KeyE"))yaw=1;if(keys.has("KeyQ"))yaw=-1;if(keys.has("KeyR"))throttle=clamp(throttle+1.2*DT,0,1);else if(keys.has("KeyF"))throttle=clamp(throttle-1.2*DT,0,1);else throttle=+ui.touchThrottle.value;const ch=new Array(16).fill(992);ch[0]=Math.round(992+820*roll);ch[1]=Math.round(992+820*pitch);ch[2]=Math.round(172+1639*throttle);ch[3]=Math.round(992+820*yaw);ch[4]=arm?1811:172;return encodeSbus(ch);}
async function controllerStep(){const p=defaultParams(),seq=sequence++,packet=makeInput(seq,physics.imuRaw(DT),controls(),(p.imuValid?FLAG_IMU_VALID:0)|(resetFlag?FLAG_RESET:0));resetFlag=false;const t=performance.now(),out=await backend.exchange(packet,seq);ui.rtt.textContent=(performance.now()-t).toFixed(2)+" ms";return out;}
async function loop(){while(running){if(mode==="replay"){await replayStep();}else{latest=await controllerStep();physics.step(latest.motors,DT);simTime+=DT;}if((sequence&7)===0)await new Promise(requestAnimationFrame);}}
let replayIndex=0;async function replayStep(){if(!realLog.length||replayIndex>=realLog.length-1){running=false;return;}const a=realLog[replayIndex],b=realLog[++replayIndex],dt=clamp((b.time_s-a.time_s)||DT,.0005,.05),motors=[b.motor1_us,b.motor2_us,b.motor3_us,b.motor4_us].map(v=>Number.isFinite(v)?v:1000);physics.step(motors,dt);latest={motors,attitude:physics.state().attitude,state:0,processingUs:0};simTime=b.time_s;await new Promise(requestAnimationFrame);}

function render(){requestAnimationFrame(render);physics.render();const s=physics.state(),p=physics.position(),target=new THREE.Vector3(...p),desired=target.clone().add(new THREE.Vector3(3.3,-4.2,2.4));camera.position.lerp(desired,.025);camera.lookAt(target);const state=latest.state,fault=state>>8&255;ui.fcState.textContent=state&STATE_FAULT?`FAULT ${fault}`:state&STATE_CALIBRATING?"CALIBRATING":state&STATE_ARMED?"ARMED":"DISARMED";ui.fcState.className=state&STATE_FAULT?"bad":state&STATE_ARMED?"good":"warn";ui.simTime.textContent=simTime.toFixed(3)+" s";ui.altitude.textContent=Math.max(0,s.z).toFixed(3)+" m";ui.velocity.textContent=s.speed.toFixed(3)+" m/s";ui.attitude.textContent=latest.attitude.map(x=>x.toFixed(1)).join(" / ")+"°";ui.motors.textContent=latest.motors.map(x=>Math.round(x)).join(" ");ui.rpm.textContent=physics.motorOmega.map(w=>Math.round(w*60/(2*Math.PI))).join(" ");ui.battery.textContent=physics.batteryVoltage.toFixed(2)+" V";ui.current.textContent=physics.batteryCurrent.toFixed(1)+" A";ui.processing.textContent=latest.processingUs+" μs";ui.armSwitch.textContent=arm?"HIGH":"LOW";ui.throttle.textContent=(throttle*100).toFixed(1)+"%";const wall=(performance.now()-wallStart)/1000;ui.speed.textContent=(wall>0?(simTime-simStart)/wall:0).toFixed(2)+"×";renderer.render(scene,camera);}render();

function parseCsv(text){const lines=text.trim().split(/\r?\n/).filter(Boolean);if(lines.length<2)return[];const headers=lines[0].split(",").map(x=>x.trim());return lines.slice(1).map(line=>{const cols=line.split(","),o={};headers.forEach((h,i)=>{const v=Number(cols[i]);o[h]=Number.isFinite(v)?v:cols[i]?.trim();});return o;});}
function normalizeLog(rows){const aliases={time:["time_s","time","t","timestamp_s"],m1:["motor1_us","m1_us","m1"],m2:["motor2_us","m2_us","m2"],m3:["motor3_us","m3_us","m3"],m4:["motor4_us","m4_us","m4"]};const pick=(r,keys)=>{for(const k of keys)if(Number.isFinite(+r[k]))return+r[k];return NaN;};return rows.map((r,i)=>({time_s:pick(r,aliases.time),motor1_us:pick(r,aliases.m1),motor2_us:pick(r,aliases.m2),motor3_us:pick(r,aliases.m3),motor4_us:pick(r,aliases.m4),x:+r.x,y:+r.y,z:+r.z,vx:+r.vx,vy:+r.vy,vz:+r.vz,roll_deg:+r.roll_deg,pitch_deg:+r.pitch_deg,yaw_deg:+r.yaw_deg,battery_v:+r.battery_v,current_a:+r.current_a,_i:i})).filter(r=>Number.isFinite(r.time_s)&&[r.motor1_us,r.motor2_us,r.motor3_us,r.motor4_us].every(Number.isFinite)).sort((a,b)=>a.time_s-b.time_s);}
async function loadLog(file){const text=await file.text();let rows;if(file.name.toLowerCase().endsWith(".json")){const x=JSON.parse(text);rows=Array.isArray(x)?x:(x.samples||x.data||[]);}else rows=parseCsv(text);realLog=normalizeLog(rows);ui.logSamples.textContent=realLog.length;ui.fit.disabled=realLog.length<3;ui.fitStatus.textContent=realLog.length?`${realLog.length} real samples loaded.`:"No usable samples. Need time + 4 motor outputs.";replayIndex=0;if(mode==="replay"&&realLog.length){resetSimulation(realLog[0]);ui.run.disabled=false;}}

function angleDiff(a,b){let d=(a-b)%360;if(d>180)d-=360;if(d<-180)d+=360;return d;}
async function objective(testParams,samples){const model=new PhysicsModel(testParams);model.reset(testParams,samples[0]);let error=0,weight=0;for(let i=1;i<samples.length;i++){const prev=samples[i-1],cur=samples[i],dt=clamp(cur.time_s-prev.time_s,.0005,.05),motors=[cur.motor1_us,cur.motor2_us,cur.motor3_us,cur.motor4_us];const s=model.step(motors,dt);if(Number.isFinite(cur.z)){error+=((s.z-cur.z)/.5)**2;weight++;}if(Number.isFinite(cur.roll_deg)){error+=(angleDiff(s.attitude[0],cur.roll_deg)/25)**2;weight++;}if(Number.isFinite(cur.pitch_deg)){error+=(angleDiff(s.attitude[1],cur.pitch_deg)/25)**2;weight++;}if(Number.isFinite(cur.yaw_deg)){error+=(angleDiff(s.attitude[2],cur.yaw_deg)/40)**2;weight++;}if(Number.isFinite(cur.battery_v)){error+=((s.battery_v-cur.battery_v)/1.5)**2*.5;weight+=.5;}}b3.b3DestroyWorld(model.world);return weight?Math.sqrt(error/weight):Infinity;}
async function fitPhysics(){if(realLog.length<3)return;ui.fit.disabled=true;ui.fitStatus.textContent="Fitting Box3D + motor/prop/battery model…";const stride=Math.max(1,Math.floor(realLog.length/600)),samples=realLog.filter((_,i)=>i%stride===0);let p=defaultParams(),best=await objective(p,samples);const vars=[{k:"Ct",step:.12,min:.03,max:.25},{k:"Cq",step:.15,min:.003,max:.04},{k:"J",step:.18,min:2e-6,max:8e-5},{k:"dragScale",step:.2,min:.2,max:4},{k:"batteryR",step:.18,min:.005,max:.2}];const total=4*vars.length*2;let done=0;for(let pass=0;pass<4;pass++){for(const v of vars){for(const dir of [-1,1]){const q={...p,wind:[...p.wind]};q[v.k]=clamp(p[v.k]*(1+dir*v.step/(1+pass*.7)),v.min,v.max);const score=await objective(q,samples);if(score<best){best=score;p=q;}done++;ui.fitProgress.style.width=`${100*done/total}%`;ui.fitStatus.textContent=`fit RMSE ${best.toFixed(4)} · testing ${v.k}`;await new Promise(requestAnimationFrame);}}}
  $("ct").value=p.Ct.toFixed(6);$("cq").value=p.Cq.toFixed(6);$("rotorJ").value=p.J.toFixed(8);$("dragScale").value=p.dragScale.toFixed(4);$("batteryR").value=p.batteryR.toFixed(6);localStorage.setItem("arondight45FittedPhysics",JSON.stringify({Ct:p.Ct,Cq:p.Cq,J:p.J,dragScale:p.dragScale,batteryR:p.batteryR,rmse:best}));ui.fitStatus.textContent=`Fit complete · normalized RMSE ${best.toFixed(4)}. Parameters applied.`;ui.fit.disabled=false;resetSimulation(mode==="replay"?realLog[0]:null);}

$("modeSim").onclick=()=>switchMode("sim");$("modeHil").onclick=()=>switchMode("hil");$("modeReplay").onclick=()=>switchMode("replay");
ui.connect.onclick=async()=>{if(mode==="sim")return switchMode("sim");if(mode!=="hil")return;try{backend=new HardwareBackend();setStatus("Connecting physical S31…");await backend.connect();ui.tController.textContent=backend.label();ui.tController.className="good";setStatus(`HIL ready: ${backend.label()}.`,"good");ui.run.disabled=false;}catch(e){backend=null;ui.tController.textContent="connection failed";ui.tController.className="bad";setStatus(e.message,"bad");}};
ui.run.onclick=()=>{if(mode!=="replay"&&!backend)return;if(mode==="replay"&&!realLog.length)return;running=!running;ui.run.textContent=running?"Pause":"Start";if(running){wallStart=performance.now();simStart=simTime;loop().catch(e=>{running=false;ui.run.textContent="Start";setStatus(e.message,"bad");});}};
ui.reset.onclick=()=>{running=false;replayIndex=0;ui.run.textContent="Start";resetSimulation(mode==="replay"&&realLog.length?realLog[0]:null);};ui.logFile.onchange=e=>e.target.files[0]&&loadLog(e.target.files[0]).catch(e=>ui.fitStatus.textContent=e.message);ui.fit.onclick=()=>fitPhysics().catch(e=>{ui.fit.disabled=false;ui.fitStatus.textContent=e.message;});
addEventListener("keydown",e=>{if(e.code==="Space"&&!e.repeat){arm=!arm;ui.touchArm.textContent=`ARM switch: ${arm?"HIGH":"LOW"}`;e.preventDefault();}keys.add(e.code);});addEventListener("keyup",e=>keys.delete(e.code));ui.touchArm.onclick=()=>{arm=!arm;ui.touchArm.textContent=`ARM switch: ${arm?"HIGH":"LOW"}`;};
const fitted=localStorage.getItem("arondight45FittedPhysics");if(fitted)try{const p=JSON.parse(fitted);if(p.Ct)$("ct").value=p.Ct;if(p.Cq)$("cq").value=p.Cq;if(p.J)$("rotorJ").value=p.J;if(p.dragScale)$("dragScale").value=p.dragScale;if(p.batteryR)$("batteryR").value=p.batteryR;}catch{}
await switchMode("sim");
