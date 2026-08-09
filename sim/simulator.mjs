import * as THREE from "three";
import Box3DFactory from "box3d.js/dist/box3d.inline.mjs";
import createCore from "../generated/flight_core.mjs";
import {ViewPeerLink,copySignal,shareSignal} from "./p2p_link.mjs";
import {QrScanner,renderQr} from "./qr_pairing.mjs";
import {neutralControls,copyControls,armReady as sharedArmReady,normalizedPointer,endPointerDrag,applyStick,releaseStick,knobAxes,knobPercent,phoneAxis,inversePhoneAxis,applyGameStick,gameKnobAxes} from "./control_semantics.mjs";
import {RaceTrack} from "./race_track.mjs";
import {loadPhoneControlSettings,mountPhoneControlSettings} from "./control_settings.mjs";
import {loadCameraSettings,mountCameraSettings} from "./camera_settings.mjs";
import {HybridMotorSound} from "./motor_sound.mjs";

const DT = 0.001;
const G = 9.80665;
const INPUT_MAGIC = 0x314c4948;
const OUTPUT_MAGIC = 0x314f4c48;
const INPUT_BYTES = 80;
const OUTPUT_BYTES = 32;
const NAVIGATION_BYTES = 20;
const FLAG_IMU_PRESENT = 1;
const FLAG_RESET = 2;
const FLAG_SBUS_PRESENT = 4;
const FLAG_NAVIGATION_PRESENT = 8;
const STATE_ARMED = 1;
const STATE_CALIBRATING = 2;
const STATE_FAULT = 4;
const STATE_NAVIGATION_VALID = 1 << 5;
const STATE_GAME_MODE = 1 << 6;
const TERRAIN_SIZE = 600;
const TERRAIN_HALF = TERRAIN_SIZE / 2;
const COLLISION_TERRAIN = 1n;
const COLLISION_AIRFRAME = 2n;
const QUERY_RANGEFINDER = 4n;
const $ = id => document.getElementById(id);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const norm = v => Math.hypot(v[0], v[1], v[2]);
const add = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const scale = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

const ui = Object.fromEntries([
  "modeInfo","connect","run","reset","status","tMode","tController","fcState","simTime","altitude","velocity","attitude","motors","rpm","battery","current","processing","rtt","speed","armSwitch","throttle","logFile","fit","fitProgress","fitStatus","logSamples","touchRoll","touchPitch","touchYaw","touchThrottle","touchArm","exportLog","inputSource","remoteConnect","remoteStatus","controllerLink","pairDialog","remoteOffer","remoteAnswer","acceptOffer","copyAnswer","shareAnswer","pairStatus","closePair","offerVideo","offerCanvas","answerQr"
].map(id => [id,$(id)]));

function crc32(bytes, length=bytes.byteLength) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let c = 0xffffffff;
  for (let i=0;i<length;i++) {
    c ^= u[i];
    for (let bit=0;bit<8;bit++) c = (c>>>1) ^ ((c&1) ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function crc16Ccitt(bytes,length=bytes.byteLength){
  let crc=0xffff;
  for(let i=0;i<length;i++){crc^=bytes[i]<<8;for(let bit=0;bit<8;bit++)crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff;}
  return crc;
}
function encodeNavigationWire(sequence,measurement){
  const bytes=new Uint8Array(NAVIGATION_BYTES),view=new DataView(bytes.buffer),s16=value=>clamp(Math.round(value*100),-32767,32767);
  view.setUint32(0,0x3156414e,true);view.setUint16(4,1,true);view.setUint16(6,sequence&0xffff,true);
  view.setInt16(8,s16(measurement.vx),true);view.setInt16(10,s16(measurement.vy),true);view.setInt16(12,s16(measurement.vz),true);
  view.setUint16(14,clamp(Math.round(Math.max(0,measurement.agl)*1000),0,65535),true);view.setUint16(16,measurement.valid?1:0,true);
  view.setUint16(18,crc16Ccitt(bytes,18),true);return bytes;
}

function parseOutput(bytes) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength !== OUTPUT_BYTES || d.getUint32(0,true) !== OUTPUT_MAGIC) throw Error("Invalid HLO1 response");
  if (crc32(bytes,28) !== d.getUint32(28,true)) throw Error("HLO1 CRC mismatch");
  return {
    sequence:d.getUint32(4,true),
    motors:[d.getUint16(8,true),d.getUint16(10,true),d.getUint16(12,true),d.getUint16(14,true)],
    attitude:[d.getInt16(16,true)/100,d.getInt16(18,true)/100,d.getInt16(20,true)/100],
    state:d.getUint16(22,true),
    processingUs:d.getUint32(24,true)
  };
}

function encodeSbus(channels) {
  const packet = new Uint8Array(25);
  packet[0]=0x0f;
  packet[24]=0;
  for (let channel=0;channel<16;channel++) {
    const value = channels[channel] & 2047;
    for (let bit=0;bit<11;bit++) {
      if (value & (1<<bit)) {
        const k=8+channel*11+bit;
        packet[k>>3] |= 1<<(k&7);
      }
    }
  }
  return packet;
}

function makeInput(sequence,imu,sbus,flags,dtUs=1000,navigationFrame=null,missedSamples=0) {
  const bytes=new Uint8Array(INPUT_BYTES),view=new DataView(bytes.buffer);
  view.setUint32(0,INPUT_MAGIC,true);view.setUint32(4,sequence,true);view.setUint32(8,dtUs,true);
  view.setUint16(12,clamp(missedSamples|0,0,65535),true);view.setUint16(14,flags,true);
  bytes.set(imu,16);if(sbus)bytes.set(sbus,30);if(navigationFrame)bytes.set(navigationFrame,55);
  view.setUint32(76,crc32(bytes,76),true);return bytes;
}

class WasmBackend {
  constructor(){this.module=null;this.inPtr=0;this.outPtr=0;this.ready=false;}
  async connect(){
    this.module = await createCore();
    if (this.module._fc_input_size() !== INPUT_BYTES || this.module._fc_output_size() !== OUTPUT_BYTES) throw Error("WASM HIL protocol size mismatch");
    if (this.module._fc_protocol_version() !== 3) throw Error("WASM HIL protocol version mismatch");
    this.inPtr=this.module._fc_input_buffer();
    this.outPtr=this.module._fc_output_buffer();
    this.module._fc_reset();
    this.ready=true;
  }
  async disconnect(){this.ready=false;this.module=null;}
  async reset(){if(this.module)this.module._fc_reset();}
  async exchange(packet){
    if(!this.ready) throw Error("WASM flight core not ready");
    this.module.HEAPU8.set(packet,this.inPtr);
    this.module._fc_process();
    return parseOutput(this.module.HEAPU8.slice(this.outPtr,this.outPtr+OUTPUT_BYTES));
  }
  label(){return "raw sensor wire → shared fc::FirmwareRuntime → shared fc::StateRuntime → fc::Runtime / WASM";}
}

class ByteResponseParser {
  constructor(){this.rx=new Uint8Array(0);this.waiters=new Map();}
  feed(chunk){
    const merged=new Uint8Array(this.rx.length+chunk.length);
    merged.set(this.rx);
    merged.set(chunk,this.rx.length);
    this.rx=merged;
    const magic=[72,76,79,49];
    while(this.rx.length>=4){
      let start=-1;
      outer: for(let i=0;i<=this.rx.length-4;i++){
        for(let k=0;k<4;k++) if(this.rx[i+k]!==magic[k]) continue outer;
        start=i; break;
      }
      if(start<0){this.rx=this.rx.slice(Math.max(0,this.rx.length-3));return;}
      if(start>0)this.rx=this.rx.slice(start);
      if(this.rx.length<OUTPUT_BYTES)return;
      const packet=this.rx.slice(0,OUTPUT_BYTES);
      this.rx=this.rx.slice(OUTPUT_BYTES);
      try {
        const out=parseOutput(packet), waiter=this.waiters.get(out.sequence);
        if(waiter){this.waiters.delete(out.sequence);clearTimeout(waiter.timer);waiter.resolve(out);}
      } catch(error) { console.warn(error); }
    }
  }
  wait(sequence,timeout=2000){
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.waiters.delete(sequence);reject(Error("S31 response timeout"));},timeout);
      this.waiters.set(sequence,{resolve,reject,timer});
    });
  }
  fail(error){for(const waiter of this.waiters.values()){clearTimeout(waiter.timer);waiter.reject(error);}this.waiters.clear();}
}

class HardwareBackend {
  constructor(){this.kind=null;this.port=null;this.reader=null;this.writer=null;this.socket=null;this.parser=new ByteResponseParser();this.reading=false;}
  async connect(){
    if("serial" in navigator){
      this.kind="usb";
      this.port=await navigator.serial.requestPort();
      await this.port.open({baudRate:2000000,bufferSize:65536});
      this.reader=this.port.readable.getReader();
      this.writer=this.port.writable.getWriter();
      this.reading=true;
      this.readLoop();
      return;
    }
    const fromQuery=new URLSearchParams(location.search).get("bridge");
    let url=fromQuery || localStorage.getItem("arondight45BridgeUrl") || "";
    if(!url && location.protocol==="http:" && location.port) url=`ws://${location.host}/hil`;
    if(!url) url=prompt("S31 HIL bridge URL","ws://192.168.1.20:8765/hil")||"";
    if(!/^wss?:\/\//i.test(url)) throw Error("A real S31 LAN bridge URL is required");
    if(location.protocol==="https:" && url.startsWith("ws://")) throw Error("Open the HTTP address served by tools/s31_hil_bridge.mjs on this device, then connect");
    localStorage.setItem("arondight45BridgeUrl",url);
    this.kind="lan";
    this.socket=new WebSocket(url);
    this.socket.binaryType="arraybuffer";
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("LAN bridge timeout")),5000);
      this.socket.onopen=()=>{clearTimeout(timer);resolve();};
      this.socket.onerror=()=>{clearTimeout(timer);reject(Error("Cannot reach S31 LAN bridge"));};
    });
    this.socket.onmessage=event=>this.parser.feed(new Uint8Array(event.data));
    this.socket.onclose=()=>this.parser.fail(Error("S31 LAN bridge disconnected"));
  }
  async readLoop(){
    try{
      while(this.reading){
        const {value,done}=await this.reader.read();
        if(done)break;
        if(value?.length)this.parser.feed(new Uint8Array(value));
      }
    }catch(error){this.parser.fail(error);}
  }
  async exchange(packet,sequence){
    const response=this.parser.wait(sequence);
    if(this.kind==="usb") await this.writer.write(packet);
    else if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(packet);
    else throw Error("Physical S31 not connected");
    return response;
  }
  async reset(){}
  async disconnect(){
    this.reading=false;
    try{await this.reader?.cancel();}catch{}
    try{this.reader?.releaseLock();}catch{}
    try{this.writer?.releaseLock();}catch{}
    try{await this.port?.close();}catch{}
    try{this.socket?.close();}catch{}
    this.port=this.reader=this.writer=this.socket=null;
    this.parser.fail(Error("Disconnected"));
  }
  label(){return this.kind==="usb"?"physical S31 / USB · functional HIL":"physical S31 / LAN · functional HIL";}
}

class Noise {
  constructor(seed=0x45a31f27){this.s=seed>>>0;this.spare=null;this.gyroBias=[0.08,-0.05,0.04];this.accBias=[0.001,-0.0015,0.002];}
  uniform(){let x=this.s;x^=x<<13;x^=x>>>17;x^=x<<5;this.s=x>>>0;return(this.s+1)/4294967297;}
  gaussian(){if(this.spare!==null){const z=this.spare;this.spare=null;return z;}const u=Math.max(1e-12,this.uniform()),v=this.uniform(),r=Math.sqrt(-2*Math.log(u));this.spare=r*Math.sin(2*Math.PI*v);return r*Math.cos(2*Math.PI*v);}
  stepBias(dt){for(let i=0;i<3;i++){this.gyroBias[i]+=this.gaussian()*0.002*Math.sqrt(dt);this.accBias[i]+=this.gaussian()*0.00002*Math.sqrt(dt);}}
}

// World truth terminates at the sensor model. The navigation twin emits the same
// NAV1 bytes accepted by the target UART; FirmwareRuntime owns decode/freshness.
class SimNavigationSensors {
  constructor(){this.reset();}
  reset(){this.noise=new Noise(0x7193ab21);this.elapsed=.01;this.filtered=[0,0,0];this.sequence=1;this.last={vx:0,vy:0,vz:0,agl:0,valid:false};}
  sampleFrame(model,dt=DT){
    this.elapsed+=dt;if(this.elapsed<.01)return null;this.elapsed-=.01;
    const truth=model.linear(),alpha=.42;
    for(let i=0;i<3;i++){const measured=truth[i]+this.noise.gaussian()*.025;this.filtered[i]+=alpha*(measured-this.filtered[i]);}
    const range=model.groundRange(12);let valid=range.valid,agl=0;
    if(valid){const measuredSlant=Math.max(0,range.slant+this.noise.gaussian()*.004);agl=measuredSlant*range.verticalProjection;}
    this.last={vx:this.filtered[0],vy:this.filtered[1],vz:this.filtered[2],agl,valid};
    return encodeNavigationWire(this.sequence++,this.last);
  }
}

// Receiver UART is asynchronous too: a raw SBUS frame arrives at 100 Hz while
// the DRDY-driven inner loop runs at 1 kHz. FirmwareRuntime alone owns staleness.
class SimSbusReceiver {
  constructor(){this.reset();}
  reset(){this.elapsed=.01;}
  sample(makeFrame,dt=DT){this.elapsed+=dt;if(this.elapsed<.01)return null;this.elapsed-=.01;return makeFrame();}
}

const b3 = await Box3DFactory();

function defaultParams(){return {
  mass:+$("mass").value,
  span:+$("span").value/1000,
  propD:+$("propD").value*.0254,
  kv:+$("kv").value,
  R:+$("resistance").value,
  J:+$("rotorJ").value,
  Ct:+$("ct").value,
  Cq:+$("cq").value,
  capacity:+$("capacity").value,
  batteryR:+$("batteryR").value,
  Ixx:+$("ixx").value,
  Iyy:+$("iyy").value,
  Izz:+$("izz").value,
  rho:+$("rho").value,
  dragScale:+$("dragScale").value,
  groundEffect:+$("groundEffect").value,
  wind:[+$("windX").value,+$("windY").value,0],
  failed:+$("failedMotor").value,
  imuValid:$("imuValid").value==="1"
};}

function validateParams(p){
  for(const[k,v]of Object.entries(p))if(typeof v==="number"&&!Number.isFinite(v))throw Error(`Invalid physical parameter ${k}`);
  for(const k of ["mass","span","propD","kv","R","J","Ct","Cq","capacity","batteryR","Ixx","Iyy","Izz","rho","dragScale"])if(!(p[k]>0))throw Error(`${k} must be positive`);
  if(!(p.groundEffect>=0))throw Error("groundEffect must be non-negative");
  if(p.Ixx+p.Iyy<=p.Izz||p.Ixx+p.Izz<=p.Iyy||p.Iyy+p.Izz<=p.Ixx)throw Error("Inertia tensor violates rigid-body triangle inequalities");
}

function quatToEuler(q){
  const[x,y,z,w]=q;
  const sinr=2*(w*x+y*z),cosr=1-2*(x*x+y*y),roll=Math.atan2(sinr,cosr);
  const sinp=2*(w*y-z*x),pitch=Math.abs(sinp)>=1?Math.sign(sinp)*Math.PI/2:Math.asin(sinp);
  const siny=2*(w*z+x*y),cosy=1-2*(y*y+z*z),yaw=Math.atan2(siny,cosy);
  return[roll*180/Math.PI,pitch*180/Math.PI,yaw*180/Math.PI];
}

function eulerToQuat(r,p,y){
  r*=Math.PI/360;p*=Math.PI/360;y*=Math.PI/360;
  const cr=Math.cos(r),sr=Math.sin(r),cp=Math.cos(p),sp=Math.sin(p),cy=Math.cos(y),sy=Math.sin(y);
  return[sr*cp*cy-cr*sp*sy,cr*sp*cy+sr*cp*sy,cr*cp*sy-sr*sp*cy,cr*cp*cy+sr*sp*sy];
}

class PhysicsModel {
  constructor(params,{graphics=false,scene=null}={}){this.graphics=graphics;this.scene=scene;this.noise=new Noise();this.world=null;this.body=null;this.group=null;this.rotors=[];this.reset(params);}
  reset(p,initial=null){
    validateParams(p);
    this.noise=new Noise();
    this.p={...p,wind:[...p.wind]};
    if(this.world)b3.b3DestroyWorld(this.world);
    const worldDef=b3.b3DefaultWorldDef();worldDef.gravity=[0,0,-G];worldDef.enableSleep=false;worldDef.enableContinuous=true;this.world=b3.b3CreateWorld(worldDef);
    const groundDef=b3.b3DefaultBodyDef();groundDef.position=[0,0,-.05];const ground=b3.b3CreateBody(this.world,groundDef),groundShape=b3.b3DefaultShapeDef();groundShape.baseMaterial.friction=.75;groundShape.baseMaterial.restitution=.03;groundShape.filter={categoryBits:COLLISION_TERRAIN,maskBits:COLLISION_AIRFRAME|QUERY_RANGEFINDER,groupIndex:0};b3.b3CreateBoxShape(ground,groundShape,TERRAIN_HALF,TERRAIN_HALF,.05);
    const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_dynamicBody;const initialZ=Number.isFinite(initial?.z)?initial.z:.024;bodyDef.position=[initial?.x||0,initial?.y||0,Math.max(.024,initialZ)];bodyDef.rotation=initial?[...eulerToQuat(initial.roll_deg||0,initial.pitch_deg||0,initial.yaw_deg||0)]:[0,0,0,1];bodyDef.linearDamping=.002;bodyDef.angularDamping=.002;bodyDef.enableSleep=false;this.body=b3.b3CreateBody(this.world,bodyDef);
    const shapeDef=b3.b3DefaultShapeDef();shapeDef.density=100;shapeDef.baseMaterial.friction=.65;shapeDef.baseMaterial.restitution=.08;shapeDef.filter={categoryBits:COLLISION_AIRFRAME,maskBits:COLLISION_TERRAIN,groupIndex:0};b3.b3CreateBoxShape(this.body,shapeDef,.055,.045,.022);
    const arm=p.span/(2*Math.sqrt(2));this.motorPos=[[-arm,-arm,0],[-arm,arm,0],[arm,arm,0],[arm,-arm,0]];
    for(const position of this.motorPos){b3.b3CreateCapsuleShape(this.body,shapeDef,{center1:[0,0,0],center2:position,radius:.008});b3.b3CreateSphereShape(this.body,shapeDef,{center:position,radius:.018});}
    const mass=b3.b3Body_GetMassData(this.body);mass.mass=p.mass;mass.center=[0,0,-.006];mass.inertia={cx:[p.Ixx,0,0],cy:[0,p.Iyy,0],cz:[0,0,p.Izz]};b3.b3Body_SetMassData(this.body,mass);
    if(initial?.vx!=null && b3.b3Body_SetLinearVelocity)b3.b3Body_SetLinearVelocity(this.body,[initial.vx||0,initial.vy||0,initial.vz||0]);
    this.motorOmega=[0,0,0,0];this.motorCurrent=[0,0,0,0];this.motorTorque=[0,0,0,0];this.propTorque=[0,0,0,0];this.motorPower=[0,0,0,0];this.batterySoc=1;this.batteryVoltage=16.8;this.batteryCurrent=0;this.worldAcceleration=[0,0,0];this.prevOmegaBody=[0,0,0];
    if(this.graphics)this.buildGraphics();
  }
  buildGraphics(){
    if(this.group)this.scene.remove(this.group);
    this.group=new THREE.Group();this.scene.add(this.group);this.rotors=[];
    const frameMaterial=new THREE.MeshStandardMaterial({color:0x252d3b,metalness:.35,roughness:.35}),bodyMaterial=new THREE.MeshStandardMaterial({color:0x121820,metalness:.5,roughness:.25});
    const center=new THREE.Mesh(new THREE.BoxGeometry(.11,.09,.044),bodyMaterial);center.castShadow=true;this.group.add(center);
    for(let i=0;i<4;i++){
      const position=this.motorPos[i],length=Math.hypot(position[0],position[1]),armMesh=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,length,12),frameMaterial);armMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(position[0],position[1],0).normalize());armMesh.position.set(position[0]/2,position[1]/2,0);this.group.add(armMesh);
      const motor=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.025,20),bodyMaterial);motor.rotation.x=Math.PI/2;motor.position.set(...position);this.group.add(motor);
      const rotor=new THREE.Mesh(new THREE.BoxGeometry(this.p.propD,.012,.002),new THREE.MeshStandardMaterial({color:i%2?0xffa34d:0x4dd6ff,transparent:true,opacity:.72}));rotor.position.set(...position);this.group.add(rotor);this.rotors.push(rotor);
    }
    const nose=new THREE.Mesh(new THREE.ConeGeometry(.018,.06,16),new THREE.MeshStandardMaterial({color:0xff4f65}));nose.rotation.z=-Math.PI/2;nose.position.x=-.075;this.group.add(nose);
  }
  localVector(v){return b3.b3Body_GetLocalVector([0,0,0],this.body,v);}
  worldVector(v){return b3.b3Body_GetWorldVector([0,0,0],this.body,v);}
  worldPoint(v){return b3.b3Body_GetWorldPoint([0,0,0],this.body,v);}
  linear(){return b3.b3Body_GetLinearVelocity([0,0,0],this.body);}
  angular(){return b3.b3Body_GetAngularVelocity([0,0,0],this.body);}
  position(){return b3.b3Body_GetPosition([0,0,0],this.body);}
  rotation(){return b3.b3Body_GetRotation([0,0,0,1],this.body);}
  groundRange(maxRange=12){
    const range=clamp(Number(maxRange)||12,.05,50),origin=this.worldPoint([0,0,-.018]),down=this.worldVector([0,0,-1]),verticalProjection=-down[2];
    if(!(verticalProjection>.55))return{valid:false,slant:0,agl:0,verticalProjection};
    const filter=b3.b3DefaultQueryFilter();filter.categoryBits=QUERY_RANGEFINDER;filter.maskBits=COLLISION_TERRAIN;const hit=b3.b3World_CastRayClosest(this.world,origin,scale(down,range),filter),fraction=Number(hit?.fraction);
    if(!hit?.hit||!Number.isFinite(fraction)||fraction<0||fraction>1)return{valid:false,slant:0,agl:0,verticalProjection};
    const slant=fraction*range,agl=slant*verticalProjection;
    return{valid:slant>=.001&&slant<=range&&Number.isFinite(agl),slant,agl,verticalProjection};
  }
  imuRaw(dt=DT){
    this.noise.stepBias(dt);
    const omegaBody=this.localVector(this.angular()),alpha=scale(sub(omegaBody,this.prevOmegaBody),1/dt);this.prevOmegaBody=omegaBody.slice();
    const specific=this.localVector(sub(this.worldAcceleration,[0,0,-G])),sensorOffset=[0,0,.008],accel=add(specific,add(cross(alpha,sensorOffset),cross(omegaBody,cross(omegaBody,sensorOffset)))),gyro=scale(omegaBody,180/Math.PI);
    for(let i=0;i<3;i++){accel[i]+=this.noise.accBias[i]*G+this.noise.gaussian()*.0025*G;gyro[i]+=this.noise.gyroBias[i]+this.noise.gaussian()*.035;}
    const raw=new Uint8Array(14),view=new DataView(raw.buffer),sat=x=>clamp(Math.round(x),-32767,32767);
    view.setInt16(0,0,false);view.setInt16(2,sat(accel[0]/G*2048),false);view.setInt16(4,sat(accel[1]/G*2048),false);view.setInt16(6,sat(accel[2]/G*2048),false);view.setInt16(8,sat(gyro[0]*16.4),false);view.setInt16(10,sat(gyro[1]*16.4),false);view.setInt16(12,sat(gyro[2]*16.4),false);
    return raw;
  }
  batteryOcv(){const s=this.batterySoc;return 13.2+3.6*clamp(s,0,1)+.15*Math.tanh((s-.12)*18);}
  applyForces(pulses,dt=DT){
    const p=this.p,yawSign=[-1,1,-1,1],diameter=p.propD,backEmf=60/(2*Math.PI*p.kv),torqueConstant=backEmf,ocv=this.batteryOcv();
    const currents=[0,0,0,0];let total=0;
    for(let pass=0;pass<2;pass++){
      total=0;
      for(let i=0;i<4;i++){
        let command=clamp((pulses[i]-1000)/1000,0,1);
        if(i===p.failed)command=0;
        const volts=command*(pass?this.batteryVoltage:ocv);
        currents[i]=clamp((volts-backEmf*this.motorOmega[i])/p.R,0,45);
        total+=currents[i];
      }
      this.batteryVoltage=clamp(ocv-total*p.batteryR,10,16.8);
    }
    this.batteryCurrent=total;this.motorCurrent=currents.slice();
    this.batterySoc=clamp(this.batterySoc-total*dt/(p.capacity*3600),0,1);
    const localVelocity=this.localVector(this.linear()),altitude=Math.max(.001,this.position()[2]);
    for(let i=0;i<4;i++){
      const revolutions=this.motorOmega[i]/(2*Math.PI),propTorque=p.Cq*p.rho*revolutions*revolutions*diameter**5,motorTorque=torqueConstant*currents[i];
      this.motorTorque[i]=motorTorque;this.propTorque[i]=propTorque;this.motorPower[i]=Math.max(0,motorTorque*this.motorOmega[i]);
      this.motorOmega[i]=Math.max(0,this.motorOmega[i]+(motorTorque-propTorque-1.5e-7*this.motorOmega[i])*dt/p.J);
      const n=this.motorOmega[i]/(2*Math.PI);let thrust=p.Ct*p.rho*n*n*diameter**4;
      const advance=localVelocity[2]/Math.max(1,n*diameter);thrust*=clamp(1-.12*advance,.55,1.25);thrust*=1+p.groundEffect*Math.exp(-altitude/Math.max(.02,.75*diameter));
      b3.b3Body_ApplyForce(this.body,this.worldVector([0,0,thrust]),this.worldPoint(this.motorPos[i]),true);
      b3.b3Body_ApplyTorque(this.body,this.worldVector([0,0,yawSign[i]*motorTorque]),true);
    }
    const relative=this.localVector(sub(this.linear(),p.wind)),cdA=[.035,.04,.07].map(x=>x*p.dragScale),drag=relative.map((v,i)=>-.5*p.rho*cdA[i]*v*Math.abs(v));b3.b3Body_ApplyForceToCenter(this.body,this.worldVector(drag),true);
    const omega=this.localVector(this.angular()),angularDrag=omega.map(v=>-.0012*p.dragScale*v*Math.abs(v));b3.b3Body_ApplyTorque(this.body,this.worldVector(angularDrag),true);
  }
  step(pulses,dt=DT){
    this.applyForces(pulses,dt);
    const before=this.linear();
    b3.b3World_Step(this.world,dt,4);
    this.worldAcceleration=scale(sub(this.linear(),before),1/dt);
    return this.state();
  }
  state(){const p=this.position(),q=this.rotation(),v=this.linear();return{x:p[0],y:p[1],z:p[2],vx:v[0],vy:v[1],vz:v[2],speed:norm(v),attitude:quatToEuler(q),battery_v:this.batteryVoltage,current_a:this.batteryCurrent};}
  render(){if(!this.graphics||!this.group)return;const p=this.position(),q=this.rotation();this.group.position.set(...p);this.group.quaternion.set(q[0],q[1],q[2],q[3]);this.rotors.forEach((rotor,i)=>rotor.rotation.z+=(i%2?-1:1)*this.motorOmega[i]/60);}
}

function integrateDuration(model,pulses,duration){
  if(!(duration>0))return model.state();
  let remaining=duration,state=model.state();
  while(remaining>1e-9){const step=Math.min(DT,remaining);state=model.step(pulses,step);remaining-=step;}
  return state;
}

THREE.Object3D.DEFAULT_UP.set(0,0,1);
function daylightSky(){
  const canvas=document.createElement("canvas");canvas.width=4;canvas.height=512;
  const ctx=canvas.getContext("2d"),gradient=ctx.createLinearGradient(0,0,0,canvas.height);
  gradient.addColorStop(0,"#82c5ff");gradient.addColorStop(.58,"#d7ecfb");gradient.addColorStop(1,"#f5f4e9");
  ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
const scene=new THREE.Scene();scene.background=daylightSky();scene.fog=new THREE.Fog(0xd7e8f2,90,700);
const camera=new THREE.PerspectiveCamera(52,1,.01,1500);camera.up.set(0,0,1);camera.position.set(1.65,0,.8);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;$("viewport").appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xf8fcff,0x7f946d,2.0));const sun=new THREE.DirectionalLight(0xfff7e8,2.6);sun.position.set(-4,-6,10);sun.castShadow=true;scene.add(sun);
const grid=new THREE.GridHelper(TERRAIN_SIZE,120,0x6b7d89,0xa7b6bd);grid.rotation.x=Math.PI/2;grid.position.z=.002;scene.add(grid);const groundMesh=new THREE.Mesh(new THREE.BoxGeometry(TERRAIN_SIZE,TERRAIN_SIZE,.1),new THREE.MeshStandardMaterial({color:0xa9b99a,roughness:.96,metalness:0}));groundMesh.position.z=-.05;groundMesh.receiveShadow=true;scene.add(groundMesh);
const raceTrack=new RaceTrack(scene,{laps:3});
const cameraHud=document.createElement("div");cameraHud.id="cameraModes";cameraHud.setAttribute("aria-label","Camera mode");cameraHud.innerHTML='<button id="camFollow" type="button">FOLLOW</button><button id="camFpv" type="button">FPV</button><button id="camThird" type="button">THIRD</button><button id="camSolo" class="start-sim-cta" type="button">START SIM</button><button id="soundToggle" type="button">SOUND</button>';
Object.assign(cameraHud.style,{position:"absolute",zIndex:"4",top:"12px",left:"50%",transform:"translateX(-50%)",display:"flex",gap:"6px",padding:"5px",borderRadius:"10px",background:"rgba(20,31,45,.72)",border:"1px solid rgba(255,255,255,.28)",backdropFilter:"blur(8px)",boxShadow:"0 5px 18px rgba(0,0,0,.18)"});
for(const button of cameraHud.querySelectorAll("button"))Object.assign(button.style,{minWidth:"76px",padding:"7px 10px",borderRadius:"7px",border:"1px solid rgba(255,255,255,.3)",background:"rgba(17,29,43,.82)",color:"#fff",font:"700 12px system-ui,-apple-system,sans-serif",letterSpacing:".04em"});
$("viewport").appendChild(cameraHud);
function resize(){const bounds=$("viewport").getBoundingClientRect();renderer.setSize(bounds.width,bounds.height,false);camera.aspect=bounds.width/Math.max(1,bounds.height);camera.updateProjectionMatrix();}addEventListener("resize",resize);resize();

let physics=new PhysicsModel(defaultParams(),{graphics:true,scene});
const motorSound=new HybridMotorSound($("viewport"));
function updateSoundButton(){const button=$("soundToggle");if(button)button.textContent=motorSound.enabled?(motorSound.isRunning()?"SOUND ON":"SOUND TAP"):"SOUND OFF";}
$("soundToggle").onclick=async()=>{if(!motorSound.enabled||!motorSound.isRunning()){motorSound.setEnabled(true);await motorSound.unlock();}else motorSound.setEnabled(false);updateSoundButton();};
document.addEventListener("pointerdown",event=>{if(event.target?.id!=="soundToggle"&&motorSound.enabled&&!motorSound.isRunning())motorSound.unlock().then(updateSoundButton);},{passive:true});
document.addEventListener("visibilitychange",()=>{motorSound.syncState();updateSoundButton();},{passive:true});
updateSoundButton();
const navigationSensors=new SimNavigationSensors();
const sbusReceiver=new SimSbusReceiver();
let latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false};
const savedCameraMode=localStorage.getItem("arondight45CameraMode");
let cameraMode=["follow","fpv","third"].includes(savedCameraMode)?savedCameraMode:"follow",cameraFollowInitialized=false;
const followHeading=new THREE.Vector3(-1,0,0),thirdHeading=new THREE.Vector3(-1,0,0);
let cameraSettings=loadCameraSettings();
function applyCameraSettings(next){cameraSettings=next;cameraFollowInitialized=false;$("viewport").dataset.fpvTiltDeg=String(cameraSettings.fpvTiltDeg);$("viewport").dataset.fpvFovDeg=String(cameraSettings.fpvFovDeg);$("viewport").dataset.thirdCameraDistanceM=String(cameraSettings.thirdDistanceM);}
applyCameraSettings(cameraSettings);
function setCameraMode(next){
  cameraMode=["follow","fpv","third"].includes(next)?next:"follow";cameraFollowInitialized=false;localStorage.setItem("arondight45CameraMode",cameraMode);$("viewport").dataset.cameraMode=cameraMode;
  for(const [id,value] of [["camFollow","follow"],["camFpv","fpv"],["camThird","third"]]){
    const button=$(id),active=cameraMode===value;button.dataset.active=active?"1":"0";button.style.background=active?"#17694f":"rgba(17,29,43,.82)";button.style.borderColor=active?"#62d6aa":"rgba(255,255,255,.3)";
  }
}
function updateCamera(){
  const position=new THREE.Vector3(...physics.position()),raw=physics.rotation(),q=new THREE.Quaternion(raw[0],raw[1],raw[2],raw[3]);
  const bodyForward=new THREE.Vector3(-1,0,0).applyQuaternion(q).normalize();
  if(cameraMode==="fpv"){
    const bodyUp=new THREE.Vector3(0,0,1).applyQuaternion(q).normalize();
    // FPV optics are rigidly mounted to the airframe. GAME right-stick pitch now
    // moves the physical body through the motors; there is no virtual camera axis.
    const fpvTiltRad=cameraSettings.fpvTiltDeg*Math.PI/180,c=Math.cos(fpvTiltRad),si=Math.sin(fpvTiltRad);
    const fpvForward=bodyForward.clone().multiplyScalar(c).addScaledVector(bodyUp,si).normalize();
    const fpvUp=bodyUp.clone().multiplyScalar(c).addScaledVector(bodyForward,-si).normalize();
    camera.position.copy(position).addScaledVector(bodyForward,.095).addScaledVector(bodyUp,.045);
    camera.up.copy(fpvUp);camera.lookAt(camera.position.clone().addScaledVector(fpvForward,4));
    if(camera.fov!==cameraSettings.fpvFovDeg){camera.fov=cameraSettings.fpvFovDeg;camera.updateProjectionMatrix();}
    $("viewport").dataset.cameraFov=String(camera.fov);$("viewport").dataset.cameraTiltDeg=String(cameraSettings.fpvTiltDeg);$("viewport").dataset.cameraDistanceM="0";
    return;
  }
  const horizontal=bodyForward.clone();horizontal.z=0;
  if(horizontal.lengthSq()>.04)horizontal.normalize();
  if(cameraMode==="third"){
    if(horizontal.lengthSq()>.04)thirdHeading.lerp(horizontal,.22).normalize();
    const thirdBaseLength=Math.hypot(2.25,1.05),thirdBack=cameraSettings.thirdDistanceM*(2.25/thirdBaseLength),thirdUp=cameraSettings.thirdDistanceM*(1.05/thirdBaseLength);
    const desired=position.clone().addScaledVector(thirdHeading,-thirdBack);desired.z+=thirdUp;
    const look=position.clone().addScaledVector(thirdHeading,.55);look.z+=.18;
    camera.up.set(0,0,1);
    if(!cameraFollowInitialized){camera.position.copy(desired);cameraFollowInitialized=true;}else camera.position.lerp(desired,.16);
    camera.lookAt(look);
    if(camera.fov!==62){camera.fov=62;camera.updateProjectionMatrix();}
    $("viewport").dataset.cameraFov=String(camera.fov);$("viewport").dataset.cameraTiltDeg="0";$("viewport").dataset.cameraDistanceM=String(camera.position.distanceTo(position));
    return;
  }
  if(horizontal.lengthSq()>.04)followHeading.lerp(horizontal,.12).normalize();
  const desired=position.clone().addScaledVector(followHeading,-1.65);desired.z+=.78;
  const look=position.clone().addScaledVector(followHeading,.38);look.z+=.10;
  camera.up.set(0,0,1);
  if(!cameraFollowInitialized){camera.position.copy(desired);cameraFollowInitialized=true;}else camera.position.lerp(desired,.075);
  camera.lookAt(look);
  if(camera.fov!==52){camera.fov=52;camera.updateProjectionMatrix();}
}
$("camFollow").onclick=()=>setCameraMode("follow");$("camFpv").onclick=()=>setCameraMode("fpv");$("camThird").onclick=()=>setCameraMode("third");setCameraMode(cameraMode);

const soloHud=document.createElement("div");soloHud.id="soloHud";soloHud.hidden=true;
soloHud.innerHTML=`
  <div id="soloTopbar"><button id="soloExit" type="button">EXIT</button><button id="soloReset" type="button">RESET SIM</button><span id="soloState">DISARMED</span><span id="soloAlt">0.0 m</span><button id="soloCamera" type="button">FOLLOW</button></div>
  <div id="soloRaceHud"><span id="soloLap">READY · 3 LAPS</span><strong id="soloRaceTime">00:00.000</strong><span id="soloGate">NEXT · START / FINISH</span><span id="soloBest">BEST —</span></div>
  <div id="soloRotate">ROTATE PHONE TO LANDSCAPE</div>
  <div id="soloLeft" class="solo-stick"><div class="solo-ring"></div><div class="solo-knob"></div><span>FWD / STRAFE</span></div>
  <div id="soloClearance"><small>FLY HEIGHT</small><strong id="soloClearanceValue">2.0 m</strong><div class="solo-range-shell"><input id="soloClearanceSlider" type="range" min="0.5" max="5" step="0.1"></div><span id="soloRangeStatus">AGL —</span></div>
  <div id="soloRight" class="solo-stick"><div class="solo-ring"></div><div class="solo-knob"></div><span>TURN / PITCH</span></div>
  <button id="soloArm" class="solo-action arm-start-cta" type="button">ARM</button>
  <button id="soloKill" class="solo-action" type="button">KILL</button>`;
$("viewport").appendChild(soloHud);
const soloStyle=document.createElement("style");soloStyle.textContent=`
  body.solo-flight{overflow:hidden!important;background:#000!important}
  body.solo-flight .panel,body.solo-flight .telemetry{display:none!important}
  body.solo-flight #viewport{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;min-height:0!important;max-height:none!important;margin:0!important;z-index:50!important}
  body.solo-flight #cameraModes{top:max(8px,env(safe-area-inset-top))!important;left:50%!important}
  #soloHud{position:absolute;inset:0;z-index:8;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;color:#fff;touch-action:none;user-select:none;-webkit-user-select:none}
  #soloHud[hidden]{display:none!important}
  #soloTopbar{position:absolute;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));display:flex;gap:8px;align-items:center;justify-content:flex-start;pointer-events:auto}
  #soloTopbar span,#soloTopbar button{border:1px solid #ffffff55;background:#112033cc;color:#fff;border-radius:9px;padding:7px 10px;font-weight:800;font-size:12px;backdrop-filter:blur(8px)}
  #soloTopbar #soloExit{background:#6b2330dd} #soloTopbar #soloReset{background:#9a5b18dd} #soloTopbar #soloCamera{margin-left:auto;background:#174f70dd}
  #soloRaceHud{position:absolute;top:max(52px,calc(env(safe-area-inset-top) + 44px));left:50%;transform:translateX(-50%);display:grid;grid-template-columns:auto auto;gap:3px 12px;align-items:center;min-width:290px;padding:7px 12px;border:1px solid #ffffff55;border-radius:10px;background:#112033c7;backdrop-filter:blur(8px);box-shadow:0 5px 18px #0004;text-align:center;pointer-events:none}
  #soloRaceHud span{font-size:10px;font-weight:850;letter-spacing:.06em;white-space:nowrap} #soloRaceTime{font-size:19px;line-height:1;font-variant-numeric:tabular-nums;color:#fff}
  .solo-stick{position:absolute;width:min(34vw,230px);aspect-ratio:1;bottom:max(18px,env(safe-area-inset-bottom));pointer-events:auto;touch-action:none;border-radius:50%}
  #soloLeft{left:max(16px,env(safe-area-inset-left))} #soloRight{right:max(16px,env(safe-area-inset-right))}
  .solo-ring{position:absolute;inset:0;border-radius:50%;border:2px solid #ffffff66;background:#0b18265c;box-shadow:inset 0 0 45px #0005,0 6px 22px #0005}
  .solo-knob{position:absolute;left:50%;top:50%;width:31%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:#f3f7ffcc;border:2px solid #fff;box-shadow:0 3px 14px #0008}
  .solo-stick span{position:absolute;left:50%;bottom:-18px;transform:translateX(-50%);font-size:10px;font-weight:800;letter-spacing:.08em;text-shadow:0 2px 5px #000;white-space:nowrap}
  #soloClearance{position:absolute;left:50%;bottom:max(96px,calc(env(safe-area-inset-bottom) + 80px));transform:translateX(-50%);width:66px;height:176px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:8px 5px;border:1px solid #ffffff55;border-radius:13px;background:#0b1826c9;backdrop-filter:blur(8px);pointer-events:auto;box-shadow:0 6px 22px #0005}
  #soloClearance small{font-size:8px;font-weight:850;line-height:1.05;text-align:center;letter-spacing:.06em}#soloClearance strong{font:900 13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#6be4b0;white-space:nowrap}#soloClearance span{font-size:8px;font-weight:850;color:#ffd06d;white-space:nowrap}
  .solo-range-shell{height:98px;width:36px;display:grid;place-items:center;overflow:visible}.solo-range-shell input{width:98px;transform:rotate(-90deg);accent-color:#6be4b0}
  .solo-action{position:absolute;bottom:max(34px,calc(env(safe-area-inset-bottom) + 18px));pointer-events:auto;border-radius:999px!important;width:86px;height:52px;font-weight:900!important;color:#fff!important;border:2px solid #ffffff55!important;backdrop-filter:blur(8px)}
  @keyframes startSimPulse{0%,100%{box-shadow:0 0 0 0 #63e7b833,0 0 10px #32d89a44}50%{box-shadow:0 0 0 5px #63e7b822,0 0 26px #32d89a99}}
  @keyframes armStartPulse{0%,100%{box-shadow:0 0 0 0 #63e7b844,0 0 12px #32d89a55}50%{box-shadow:0 0 0 6px #63e7b822,0 0 30px #32d89aaa}}
  #camSolo.start-sim-cta{background:#17694f!important;border-color:#63e7b8!important;color:#fff!important;animation:startSimPulse 1.55s ease-in-out infinite;transition:filter .14s ease,background .14s ease,border-color .14s ease,box-shadow .14s ease}
  #camSolo.start-sim-cta:hover,#camSolo.start-sim-cta:focus-visible{background:#218865!important;border-color:#b2ffe3!important;filter:brightness(1.14);box-shadow:0 0 0 4px #63e7b833,0 0 32px #32d89acc!important;outline:none}
  #soloArm{left:50%;transform:translateX(-105%);background:#17694fdd!important;transition:filter .14s ease,background .14s ease,border-color .14s ease,box-shadow .14s ease}
  body.solo-flight #soloArm.arm-start-cta.attention:not(:disabled){animation:armStartPulse 1.3s ease-in-out infinite;border-color:#7ff0c5!important}
  body.solo-flight #soloArm:not(:disabled):hover,body.solo-flight #soloArm:not(:disabled):focus-visible{background:#218865!important;border-color:#c2ffea!important;filter:brightness(1.16);box-shadow:0 0 0 4px #63e7b833,0 0 32px #32d89acc!important;outline:none}
  body.solo-flight #soloArm.arming,body.solo-flight #soloArm.armed{animation:none!important}
  #soloKill{left:50%;transform:translateX(5%);background:#8b2436e6!important}
  #soloRotate{display:none;position:absolute;inset:0;align-items:center;justify-content:center;background:#07101aee;font-size:18px;font-weight:900;letter-spacing:.08em;text-align:center;padding:30px;pointer-events:none}
  @media(orientation:portrait){body.solo-flight #soloRotate{display:flex}.solo-stick,.solo-action{opacity:.18}}
  @media(max-height:430px){.solo-stick{width:min(30vw,180px)}.solo-action{width:76px;height:46px}}
`;
document.head.appendChild(soloStyle);

let soloMode=false,soloPreviousInputSource="remote",phoneSettings=loadPhoneControlSettings();
let soloGroundClearance=phoneSettings.defaultHoverAgl;
function neutralSoloControls(){return{...neutralControls(),gameMode:true,groundClearance:soloGroundClearance};}
let soloControls=neutralSoloControls();
const soloClearanceSlider=$("soloClearanceSlider"),soloClearanceValue=$("soloClearanceValue"),soloRangeStatus=$("soloRangeStatus");soloClearanceSlider.value=String(soloGroundClearance);
function updateSoloSticks(){
  const left=gameKnobAxes(soloControls,"left",phoneSettings);
  const right=gameKnobAxes(soloControls,"right",phoneSettings);
  for(const [id,axes] of [["soloLeft",left],["soloRight",right]]){const knob=$(id).querySelector(".solo-knob");knob.style.left=`${knobPercent(axes.x)}%`;knob.style.top=`${knobPercent(axes.y)}%`;}
  soloClearanceValue.textContent=`${soloGroundClearance.toFixed(1)} m`;
}
function soloStick(el,kind){
  let pointer=null;
  const apply=e=>{const point=normalizedPointer(el,e);applyGameStick(soloControls,kind,point,phoneSettings);updateSoloSticks();e.preventDefault();};
  el.addEventListener("pointerdown",e=>{pointer=e.pointerId;el.setPointerCapture(pointer);apply(e);});
  el.addEventListener("pointermove",e=>{if(e.pointerId===pointer)apply(e);});
  const release=e=>{if(e.pointerId!==pointer)return;endPointerDrag(el,e.pointerId);pointer=null;if(kind==="left"){soloControls.roll=0;soloControls.pitch=0;soloControls.throttle=0;}else{soloControls.yaw=0;soloControls.bodyPitch=0;}updateSoloSticks();e.preventDefault();};
  el.addEventListener("pointerup",release);el.addEventListener("pointercancel",release);
}
soloClearanceSlider.oninput=()=>{soloGroundClearance=clamp(Number(soloClearanceSlider.value),.5,5);soloControls.groundClearance=soloGroundClearance;updateSoloSticks();};
soloStick($("soloLeft"),"left");soloStick($("soloRight"),"right");updateSoloSticks();
const soloSettingsMount=mountPhoneControlSettings({
  parent:$("soloTopbar"),
  buttonText:"SETTINGS",
  onChange:next=>{phoneSettings=next;const keepArm=soloControls.arm;if(!keepArm){soloGroundClearance=next.defaultHoverAgl;soloClearanceSlider.value=String(soloGroundClearance);}soloControls=neutralSoloControls();soloControls.arm=keepArm;updateSoloSticks();arm=keepArm;throttle=0;},
});
mountCameraSettings({dialog:soloSettingsMount.dialog,onChange:applyCameraSettings});
async function enterSolo(){
  soloMode=true;soloPreviousInputSource=inputSource;phoneSettings=loadPhoneControlSettings();soloGroundClearance=phoneSettings.defaultHoverAgl;soloClearanceSlider.value=String(soloGroundClearance);soloControls=neutralSoloControls();updateSoloSticks();raceTrack.reset();raceTrack.setVisible(true);document.body.classList.add("solo-flight");soloHud.hidden=false;inputSource="local";ui.inputSource.value="local";localArm=false;arm=false;localThrottle=0;updateRemoteUI();resize();
  try{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:"hide"});}catch{}
  try{await screen.orientation?.lock?.("landscape");}catch{}
  if(mode==="sim"&&backend&&!running)startRun();
}
async function exitSolo(){
  soloControls=neutralSoloControls();updateSoloSticks();localArm=false;arm=false;localThrottle=0;inputSource=soloPreviousInputSource;ui.inputSource.value=inputSource;soloMode=false;soloHud.hidden=true;raceTrack.setVisible(false);document.body.classList.remove("solo-flight");try{screen.orientation?.unlock?.();}catch{}try{if(document.fullscreenElement)await document.exitFullscreen();}catch{}updateRemoteUI();resize();
}
$("camSolo").onclick=enterSolo;$("soloExit").onclick=exitSolo;
function resetSoloSimulation(){const restart=mode==="sim"&&Boolean(backend);stopRun();remoteAutoStarted=false;resetSimulation(mode==="replay"&&realLog.length?realLog[0]:null);if(restart)startRun();}
$("soloReset").onclick=resetSoloSimulation;
$("soloArm").onclick=()=>{if(soloControls.arm){soloControls.arm=false;return;}if((latest.state&STATE_NAVIGATION_VALID)&&sharedArmReady(currentFcStateText(),soloControls,true,phoneSettings))soloControls.arm=true;};
$("soloKill").onclick=()=>{soloControls=neutralSoloControls();updateSoloSticks();arm=false;throttle=0;};
$("soloCamera").onclick=()=>{const next=cameraMode==="follow"?"third":cameraMode==="third"?"fpv":"follow";setCameraMode(next);$("soloCamera").textContent=cameraMode.toUpperCase();};
document.addEventListener("fullscreenchange",()=>{if(soloMode&&!document.fullscreenElement&&document.fullscreenEnabled)exitSolo();});
let mode="sim",backend=null,running=false,sequence=1,simTime=0,resetFlag=true;
let latest={motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0};
let wallStart=performance.now(),simStart=0,replayIndex=0;
const keys=new Set();let localArm=false,localThrottle=0,arm=false,throttle=0,realLog=[],sessionLog=[];let inputSource="remote",effectiveInput=neutralControls(),lastRemoteTelemetry=0,remoteAutoStarted=false;const remoteLink=new ViewPeerLink();const offerScanner=new QrScanner(ui.offerVideo,ui.offerCanvas);

function setStatus(text,cls=""){ui.status.textContent=text;ui.status.className="statusline "+cls;}
function modeDescription(){
  if(mode==="sim")return "SIM · raw ICM/SBUS/NAV1 hardware-wire twin. Exact production FirmwareRuntime → StateRuntime → Runtime executes as WebAssembly; only environment and sensor hardware are simulated.";
  if(mode==="hil")return "HIL · exact raw-hardware FirmwareRuntime executes on the physical ESP32-S31; host supplies ICM/SBUS/NAV1 bytes and receives only ESC pulses.";
  return "REAL LOG · measured motor outputs replay through the same physics model. Parameter fitting compares measured position, velocity, attitude, battery and current when those fields exist.";
}
function updateModeUI(){ui.modeInfo.textContent=modeDescription();ui.tMode.textContent=mode.toUpperCase();for(const [id,value] of [["modeSim","sim"],["modeHil","hil"],["modeReplay","replay"]])$(id).classList.toggle("active",mode===value);ui.connect.textContent=mode==="sim"?"Reload flight core":mode==="hil"?"Connect physical S31":"Real log loaded via file";ui.connect.disabled=mode==="replay";ui.run.disabled=mode==="replay"?!realLog.length:!backend;ui.run.textContent=running?"Pause":"Start";}
async function switchMode(next){
  running=false;ui.run.textContent="Start";
  if(backend)try{await backend.disconnect();}catch{}
  backend=null;mode=next;resetSimulation();
  if(mode==="sim"){
    setStatus("Loading shared C++ flight core…");
    try{backend=new WasmBackend();await backend.connect();ui.tController.textContent=backend.label();ui.tController.className="good";setStatus("SIM ready: shared production runtime active.","good");ui.run.disabled=false;}
    catch(error){ui.tController.textContent="WASM load failed";ui.tController.className="bad";setStatus(error.message,"bad");}
  }else if(mode==="hil"){
    ui.tController.textContent="not connected";ui.tController.className="warn";setStatus("Connect the physical S31. HIL validates real-MCU execution, not production interrupt timing.");
  }else{
    ui.tController.textContent="real motor log";ui.tController.className="good";setStatus(realLog.length?`${realLog.length} real samples loaded.`:"Load a real flight log.");
  }
  updateModeUI();
}
function resetSimulation(initial=null){
  phoneSettings=loadPhoneControlSettings();soloGroundClearance=phoneSettings.defaultHoverAgl;soloClearanceSlider.value=String(soloGroundClearance);
  physics.reset(defaultParams(),initial);navigationSensors.reset();sbusReceiver.reset();latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false};raceTrack.reset();sequence=1;simTime=0;resetFlag=true;latest={motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0};soloControls=neutralSoloControls();updateSoloSticks();localThrottle=throttle=0;localArm=arm=false;effectiveInput=neutralControls();replayIndex=0;sessionLog=[];
  ui.touchThrottle.value="0";ui.touchRoll.value=ui.touchPitch.value=ui.touchYaw.value="0";ui.touchArm.textContent="ARM request: OFF";wallStart=performance.now();simStart=0;if(backend?.reset)backend.reset();
}
function localControlState(){
  let roll=+ui.touchRoll.value,pitch=+ui.touchPitch.value,yaw=+ui.touchYaw.value;
  if(keys.has("KeyD"))roll=1;if(keys.has("KeyA"))roll=-1;if(keys.has("KeyW"))pitch=1;if(keys.has("KeyS"))pitch=-1;if(keys.has("KeyE"))yaw=1;if(keys.has("KeyQ"))yaw=-1;
  if(keys.has("KeyR"))localThrottle=clamp(localThrottle+1.2*DT,0,1);else if(keys.has("KeyF"))localThrottle=clamp(localThrottle-1.2*DT,0,1);else localThrottle=+ui.touchThrottle.value;
  return{roll,pitch,yaw,throttle:localThrottle,bodyPitch:0,arm:localArm};
}
function activeControlState(){
  const neutral=neutralControls();
  effectiveInput=soloMode?copyControls(soloControls):(inputSource==="remote"?(remoteLink.current()||neutral):localControlState());
  arm=effectiveInput.arm;throttle=effectiveInput.throttle;return effectiveInput;
}
function controls(){
  const c=activeControlState(),channels=new Array(16).fill(992);
  channels[0]=Math.round(992+820*clamp(c.roll||0,-1,1));channels[1]=Math.round(992+820*clamp(c.pitch||0,-1,1));channels[3]=Math.round(992+820*clamp(c.yaw||0,-1,1));channels[4]=c.arm?1811:172;
  if(c.gameMode){channels[2]=172;const clearance=clamp(Number(c.groundClearance)||2,.5,5),normalized=(clearance-.5)/4.5;channels[5]=Math.round(172+1639*normalized);channels[6]=1811;channels[7]=Math.round(992+820*clamp(c.bodyPitch||0,-1,1));}else channels[2]=Math.round(172+1639*clamp(c.throttle||0,0,1));
  return encodeSbus(channels);
}
async function controllerStep(){
  const params=defaultParams(),seq=sequence++,navigationFrame=navigationSensors.sampleFrame(physics,DT),sbusFrame=sbusReceiver.sample(controls,DT);
  latestNavigation=navigationSensors.last;
  let flags=(params.imuValid?FLAG_IMU_PRESENT:0)|(resetFlag?FLAG_RESET:0);if(sbusFrame)flags|=FLAG_SBUS_PRESENT;if(navigationFrame)flags|=FLAG_NAVIGATION_PRESENT;
  const packet=makeInput(seq,physics.imuRaw(DT),sbusFrame,flags,1000,navigationFrame,0);resetFlag=false;
  const started=performance.now(),out=await backend.exchange(packet,seq);ui.rtt.textContent=(performance.now()-started).toFixed(2)+" ms";return out;
}
function recordSession(){
  const state=physics.state();
  sessionLog.push({time_s:simTime,motor1_us:latest.motors[0],motor2_us:latest.motors[1],motor3_us:latest.motors[2],motor4_us:latest.motors[3],x:state.x,y:state.y,z:state.z,vx:state.vx,vy:state.vy,vz:state.vz,roll_deg:state.attitude[0],pitch_deg:state.attitude[1],yaw_deg:state.attitude[2],fc_roll_deg:latest.attitude[0],fc_pitch_deg:latest.attitude[1],fc_yaw_deg:latest.attitude[2],battery_v:state.battery_v,current_a:state.current_a,fc_state:latest.state});
}
async function loop(){
  while(running){
    if(mode==="replay") await replayStep();
    else {latest=await controllerStep();physics.step(latest.motors,DT);simTime+=DT;raceTrack.update(physics.position(),simTime,Boolean(latest.state&STATE_ARMED));recordSession();}
    if((sequence&7)===0)await new Promise(requestAnimationFrame);
  }
}
async function replayStep(){
  if(!realLog.length||replayIndex>=realLog.length-1){running=false;ui.run.textContent="Start";return;}
  const previous=realLog[replayIndex],current=realLog[++replayIndex],duration=current.time_s-previous.time_s;
  if(!(duration>0))return;
  const motors=[previous.motor1_us,previous.motor2_us,previous.motor3_us,previous.motor4_us].map(value=>Number.isFinite(value)?value:1000);
  const state=integrateDuration(physics,motors,duration);latest={motors,attitude:state.attitude,state:0,processingUs:0};simTime=current.time_s;await new Promise(requestAnimationFrame);
}

function currentFcStateText(){const fcState=latest.state,fault=fcState>>8&255;return fcState&STATE_FAULT?`FAULT ${fault}`:fcState&STATE_CALIBRATING?"CALIBRATING":fcState&STATE_ARMED?"ARMED":"DISARMED";}
function render(){
  requestAnimationFrame(render);physics.render();updateCamera();const fcState=latest.state;motorSound.syncFcState(fcState,arm);motorSound.update(physics,camera.position);const state=physics.state();
  const fault=fcState>>8&255,stateText=currentFcStateText();ui.fcState.textContent=stateText;ui.fcState.className=fcState&STATE_FAULT?"bad":fcState&STATE_ARMED?"good":"warn";
  ui.simTime.textContent=simTime.toFixed(3)+" s";ui.altitude.textContent=Math.max(0,state.z).toFixed(3)+" m";ui.velocity.textContent=state.speed.toFixed(3)+" m/s";ui.attitude.textContent=latest.attitude.map(x=>x.toFixed(1)).join(" / ")+"°";ui.motors.textContent=latest.motors.map(x=>Math.round(x)).join(" ");ui.rpm.textContent=physics.motorOmega.map(w=>Math.round(w*60/(2*Math.PI))).join(" ");ui.battery.textContent=physics.batteryVoltage.toFixed(2)+" V";ui.current.textContent=physics.batteryCurrent.toFixed(1)+" A";ui.processing.textContent=latest.processingUs+" μs";ui.armSwitch.textContent=arm?"ON":"OFF";ui.throttle.textContent=(throttle*100).toFixed(1)+"%";
  const now=performance.now();if(now-lastRemoteTelemetry>=100){lastRemoteTelemetry=now;remoteLink.sendTelemetry({fc_state:stateText,mode,sim_time:simTime,altitude:Math.max(0,state.z),agl_m:latestNavigation.agl,nav_vx_mps:latestNavigation.vx,nav_vy_mps:latestNavigation.vy,nav_vz_mps:latestNavigation.vz,roll_deg:latest.attitude[0],pitch_deg:latest.attitude[1],yaw_deg:latest.attitude[2],speed:state.speed,battery_v:physics.batteryVoltage,current_a:physics.batteryCurrent,motors:latest.motors,rpm:physics.motorOmega.map(w=>w*60/(2*Math.PI)),armed:Boolean(fcState&STATE_ARMED),fault,game_mode:Boolean(fcState&STATE_GAME_MODE),navigation_valid:Boolean(fcState&STATE_NAVIGATION_VALID),target_ground_clearance:effectiveInput?.gameMode?clamp(Number(effectiveInput.groundClearance)||2,.5,5):null,body_pitch_input:effectiveInput?.gameMode?clamp(Number(effectiveInput.bodyPitch)||0,-1,1):0});}
  const wall=(now-wallStart)/1000;ui.speed.textContent=(wall>0?(simTime-simStart)/wall:0).toFixed(2)+"×";if(soloMode){const soloArm=$("soloArm");$("soloState").textContent=stateText;$("soloAlt").textContent=`AGL ${latestNavigation.valid?latestNavigation.agl.toFixed(1):"—"} m`;soloRangeStatus.textContent=latestNavigation.valid?`AGL ${latestNavigation.agl.toFixed(1)} m`:"NAV INVALID";soloRangeStatus.style.color=latestNavigation.valid?"#64e0ae":"#ffd06d";$("soloCamera").textContent=cameraMode.toUpperCase();const race=raceTrack.snapshot(simTime);$("soloLap").textContent=race.finished?`FINISH · ${race.totalTimeText}`:(race.started?`LAP ${race.lap}/${race.totalLaps}`:`READY · ${race.totalLaps} LAPS`);$("soloRaceTime").textContent=race.finished?race.totalTimeText:race.currentLapText;$("soloGate").textContent=race.finished?"COURSE COMPLETE":`GATE ${race.nextGate+1}/${race.gateCount} · ${race.nextGateText}`;$("soloBest").textContent=`BEST ${race.bestLapText}`;const soloCanArm=!soloControls.arm&&Boolean(fcState&STATE_NAVIGATION_VALID)&&sharedArmReady(stateText,soloControls,true,phoneSettings);soloArm.classList.toggle("arming",soloControls.arm&&stateText!=="ARMED");soloArm.classList.toggle("armed",stateText==="ARMED");soloArm.classList.toggle("attention",soloCanArm);soloArm.disabled=!soloControls.arm&&!soloCanArm;soloArm.textContent=soloControls.arm?(stateText==="ARMED"?"ARMED ✓":"ARMING…"):(stateText==="CALIBRATING"?"CALIBRATING…":"ARM");}renderer.render(scene,camera);
}
render();

function parseCsv(text){const lines=text.trim().split(/\r?\n/).filter(Boolean);if(lines.length<2)return[];const headers=lines[0].split(",").map(x=>x.trim());return lines.slice(1).map(line=>{const cols=line.split(","),row={};headers.forEach((header,i)=>{const value=Number(cols[i]);row[header]=Number.isFinite(value)?value:cols[i]?.trim();});return row;});}
function normalizeLog(rows){
  const aliases={time:["time_s","time","t","timestamp_s"],m1:["motor1_us","m1_us","m1"],m2:["motor2_us","m2_us","m2"],m3:["motor3_us","m3_us","m3"],m4:["motor4_us","m4_us","m4"]};
  const pick=(row,keys)=>{for(const key of keys)if(Number.isFinite(+row[key]))return+row[key];return NaN;};
  const normalized=rows.map((row,index)=>({time_s:pick(row,aliases.time),motor1_us:pick(row,aliases.m1),motor2_us:pick(row,aliases.m2),motor3_us:pick(row,aliases.m3),motor4_us:pick(row,aliases.m4),x:+row.x,y:+row.y,z:+row.z,vx:+row.vx,vy:+row.vy,vz:+row.vz,roll_deg:+row.roll_deg,pitch_deg:+row.pitch_deg,yaw_deg:+row.yaw_deg,battery_v:+row.battery_v,current_a:+row.current_a,_i:index})).filter(row=>Number.isFinite(row.time_s)&&[row.motor1_us,row.motor2_us,row.motor3_us,row.motor4_us].every(Number.isFinite)).sort((a,b)=>a.time_s-b.time_s);
  return normalized.filter((row,index)=>index===0||row.time_s>normalized[index-1].time_s);
}
async function loadLog(file){
  const text=await file.text();let rows;
  if(file.name.toLowerCase().endsWith(".json")){const parsed=JSON.parse(text);rows=Array.isArray(parsed)?parsed:(parsed.samples||parsed.data||[]);}else rows=parseCsv(text);
  realLog=normalizeLog(rows);ui.logSamples.textContent=realLog.length;ui.fit.disabled=realLog.length<3;ui.fitStatus.textContent=realLog.length?`${realLog.length} real samples loaded.`:"No usable samples. Need time + 4 motor outputs.";replayIndex=0;if(mode==="replay"&&realLog.length){resetSimulation(realLog[0]);ui.run.disabled=false;}
}
function downloadJson(name,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportSession(){
  if((latest.state&STATE_ARMED)&&inputSource==="remote"){
    setStatus("Disarm before exporting a full flight log during P2P control.","warn");
    return;
  }
  downloadJson(`arondight45-${mode}-${new Date().toISOString().replace(/[:.]/g,"-")}.json`,{schema:"arondight45-flight-log-v1",mode,samples:sessionLog,physics:defaultParams()});
}

function angleDiff(a,b){let difference=(a-b)%360;if(difference>180)difference-=360;if(difference<-180)difference+=360;return difference;}
function addResidual(accumulator,simulated,measured,scaleValue,weight=1){if(Number.isFinite(measured)){const e=(simulated-measured)/scaleValue;accumulator.error+=e*e*weight;accumulator.weight+=weight;}}
async function objective(testParams,samples){
  const model=new PhysicsModel(testParams);model.reset(testParams,samples[0]);const residual={error:0,weight:0};
  for(let i=1;i<samples.length;i++){
    const previous=samples[i-1],current=samples[i],duration=current.time_s-previous.time_s;if(!(duration>0))continue;
    const motors=[previous.motor1_us,previous.motor2_us,previous.motor3_us,previous.motor4_us];const state=integrateDuration(model,motors,duration);
    addResidual(residual,state.x,current.x,.5);addResidual(residual,state.y,current.y,.5);addResidual(residual,state.z,current.z,.5);
    addResidual(residual,state.vx,current.vx,2);addResidual(residual,state.vy,current.vy,2);addResidual(residual,state.vz,current.vz,2);
    if(Number.isFinite(current.roll_deg)){const e=angleDiff(state.attitude[0],current.roll_deg)/25;residual.error+=e*e;residual.weight++;}
    if(Number.isFinite(current.pitch_deg)){const e=angleDiff(state.attitude[1],current.pitch_deg)/25;residual.error+=e*e;residual.weight++;}
    if(Number.isFinite(current.yaw_deg)){const e=angleDiff(state.attitude[2],current.yaw_deg)/40;residual.error+=e*e;residual.weight++;}
    addResidual(residual,state.battery_v,current.battery_v,1.5,.5);addResidual(residual,state.current_a,current.current_a,20,.35);
  }
  b3.b3DestroyWorld(model.world);
  return residual.weight?Math.sqrt(residual.error/residual.weight):Infinity;
}
async function fitPhysics(){
  if(realLog.length<3)return;
  ui.fit.disabled=true;ui.fitStatus.textContent="Fitting motor / prop / drag / battery parameters against the real trajectory…";
  const stride=Math.max(1,Math.floor(realLog.length/800)),samples=realLog.filter((_,index)=>index%stride===0);
  let p=defaultParams(),best=await objective(p,samples);
  const variables=[
    {k:"Ct",step:.14,min:.03,max:.25},{k:"Cq",step:.16,min:.003,max:.04},{k:"J",step:.20,min:2e-6,max:8e-5},{k:"dragScale",step:.22,min:.2,max:4},{k:"batteryR",step:.18,min:.005,max:.2},{k:"R",step:.16,min:.02,max:.3}
  ];
  const passes=6,total=passes*variables.length*2;let done=0;
  for(let pass=0;pass<passes;pass++){
    for(const variable of variables){
      for(const direction of [-1,1]){
        const candidate={...p,wind:[...p.wind]};candidate[variable.k]=clamp(p[variable.k]*(1+direction*variable.step/(1+pass*.65)),variable.min,variable.max);
        const score=await objective(candidate,samples);if(score<best){best=score;p=candidate;}
        done++;ui.fitProgress.style.width=`${100*done/total}%`;ui.fitStatus.textContent=`normalized RMSE ${best.toFixed(4)} · testing ${variable.k}`;await new Promise(requestAnimationFrame);
      }
    }
  }
  $("ct").value=p.Ct.toFixed(6);$("cq").value=p.Cq.toFixed(6);$("rotorJ").value=p.J.toFixed(8);$("dragScale").value=p.dragScale.toFixed(4);$("batteryR").value=p.batteryR.toFixed(6);$("resistance").value=p.R.toFixed(6);
  localStorage.setItem("arondight45FittedPhysics",JSON.stringify({Ct:p.Ct,Cq:p.Cq,J:p.J,dragScale:p.dragScale,batteryR:p.batteryR,R:p.R,rmse:best}));ui.fitStatus.textContent=`Fit complete · normalized RMSE ${best.toFixed(4)}. Parameters applied.`;ui.fit.disabled=false;resetSimulation(mode==="replay"?realLog[0]:null);
}

$("modeSim").onclick=()=>switchMode("sim");$("modeHil").onclick=()=>switchMode("hil");$("modeReplay").onclick=()=>switchMode("replay");
ui.connect.onclick=async()=>{if(mode==="sim")return switchMode("sim");if(mode!=="hil")return;try{backend=new HardwareBackend();setStatus("Connecting physical S31…");await backend.connect();ui.tController.textContent=backend.label();ui.tController.className="good";setStatus(`HIL ready: ${backend.label()}.`,"good");ui.run.disabled=false;}catch(error){backend=null;ui.tController.textContent="connection failed";ui.tController.className="bad";setStatus(error.message,"bad");}};
function startRun(){
  if(running)return true;if(mode!=="replay"&&!backend)return false;if(mode==="replay"&&!realLog.length)return false;
  running=true;ui.run.textContent="Pause";wallStart=performance.now();simStart=simTime;loop().catch(error=>{running=false;ui.run.textContent="Start";setStatus(error.message,"bad");});return true;
}
function stopRun(){running=false;ui.run.textContent="Start";}
ui.run.onclick=()=>{if(running)stopRun();else startRun();};
ui.reset.onclick=()=>{stopRun();remoteAutoStarted=false;resetSimulation(mode==="replay"&&realLog.length?realLog[0]:null);};
ui.logFile.onchange=event=>event.target.files[0]&&loadLog(event.target.files[0]).catch(error=>ui.fitStatus.textContent=error.message);
ui.fit.onclick=()=>fitPhysics().catch(error=>{ui.fit.disabled=false;ui.fitStatus.textContent=error.message;});
ui.exportLog.onclick=exportSession;
addEventListener("keydown",event=>{if(event.code==="Space"&&!event.repeat){localArm=!localArm;ui.touchArm.textContent=`ARM request: ${localArm?"ON":"OFF"}`;event.preventDefault();}keys.add(event.code);});addEventListener("keyup",event=>keys.delete(event.code));ui.touchArm.onclick=()=>{localArm=!localArm;ui.touchArm.textContent=`ARM request: ${localArm?"ON":"OFF"}`;};
function updateRemoteUI(){
  const current=remoteLink.current();ui.controllerLink.href="./drone_controller.html";
  if(inputSource==="local"){ui.remoteStatus.textContent="LOCAL FALLBACK selected. P2P controller input is ignored.";ui.remoteStatus.className="statusline warn";}
  else if(remoteLink.linked&&current){
    ui.remoteStatus.textContent="P2P LINKED · direct control fresh";ui.remoteStatus.className="statusline good";
    if(mode==="sim"&&backend&&!running&&simTime===0&&!remoteAutoStarted){remoteAutoStarted=true;startRun();setStatus("SIM running · remote controller linked. Calibrating flight core…","good");}
  }
  else if(remoteLink.linked){ui.remoteStatus.textContent="P2P link alive but control stale (>350 ms) · fail-safe ARM OFF / throttle 0";ui.remoteStatus.className="statusline bad";}
  else if(remoteLink.pc&&remoteLink.recentlyLinked){ui.remoteStatus.textContent=`${remoteLink.stateLabel()} · fail-safe active · automatic recovery, no re-pairing`;ui.remoteStatus.className="statusline warn";}
  else if(remoteLink.pc){ui.remoteStatus.textContent=`${remoteLink.stateLabel()} · waiting for direct DataChannel`;ui.remoteStatus.className="statusline warn";}
  else{ui.remoteStatus.textContent="P2P disconnected · fail-safe ARM OFF / throttle 0.";ui.remoteStatus.className="statusline warn";}
  ui.remoteConnect.textContent=remoteLink.linked?"DISCONNECT":remoteLink.pc&&remoteLink.recentlyLinked?"SESSION ACTIVE":"PAIR CONTROLLER";
  if(remoteLink.linked&&ui.pairDialog.open){offerScanner.stop();ui.pairDialog.close();}
}
async function acceptControllerOffer(code=ui.remoteOffer.value){
  ui.acceptOffer.disabled=true;ui.pairStatus.textContent="Controller QR detected · creating direct WebRTC answer…";ui.pairStatus.className="statusline warn";
  try{
    ui.remoteOffer.value=code;ui.remoteAnswer.value=await remoteLink.acceptOffer(code);renderQr(ui.answerQr,ui.remoteAnswer.value);
    inputSource="remote";ui.inputSource.value="remote";localArm=false;localThrottle=0;arm=false;throttle=0;
    ui.pairStatus.textContent="Answer ready. Hold this QR toward the controller phone — it scans automatically.";ui.pairStatus.className="statusline good";
    return true;
  }catch(error){ui.pairStatus.textContent=error.message;ui.pairStatus.className="statusline bad";return false;}
  finally{ui.acceptOffer.disabled=false;updateRemoteUI();}
}
async function startOfferScanner(){
  ui.answerQr.hidden=true;ui.remoteOffer.value="";ui.remoteAnswer.value="";ui.pairStatus.textContent="Camera active · point it at the controller OFFER QR.";ui.pairStatus.className="statusline warn";
  try{await offerScanner.start(async code=>acceptControllerOffer(code));}
  catch(error){ui.pairStatus.textContent=`Camera unavailable: ${error.message}. Manual fallback is below.`;ui.pairStatus.className="statusline bad";}
}
async function toggleRemote(){
  if(remoteLink.linked){await remoteLink.disconnect();remoteAutoStarted=false;updateRemoteUI();return;}
  if(remoteLink.pc&&remoteLink.recentlyLinked){ui.pairDialog.showModal();ui.pairStatus.textContent="Recent session is reconnecting automatically. No QR scan needed unless it expires.";ui.pairStatus.className="statusline warn";return;}
  ui.pairDialog.showModal();await startOfferScanner();
}
remoteLink.onState=updateRemoteUI;
ui.remoteConnect.onclick=toggleRemote;
ui.acceptOffer.onclick=()=>acceptControllerOffer();
ui.copyAnswer.onclick=async()=>{try{await copySignal(ui.remoteAnswer.value);ui.pairStatus.textContent="Answer copied.";ui.pairStatus.className="statusline good";}catch(error){ui.pairStatus.textContent=error.message;ui.pairStatus.className="statusline bad";}};
ui.shareAnswer.onclick=async()=>{try{await shareSignal("Arondight45 VIEW answer",ui.remoteAnswer.value);ui.pairStatus.textContent="Answer shared.";ui.pairStatus.className="statusline good";}catch(error){if(error?.name!=="AbortError"){ui.pairStatus.textContent=error.message;ui.pairStatus.className="statusline bad";}}};
ui.closePair.onclick=async()=>{await offerScanner.stop();ui.pairDialog.close();};
ui.inputSource.onchange=()=>{inputSource=ui.inputSource.value;localArm=false;localThrottle=0;arm=false;throttle=0;updateRemoteUI();};
inputSource=ui.inputSource.value;updateRemoteUI();setInterval(updateRemoteUI,250);

const fitted=localStorage.getItem("arondight45FittedPhysics");if(fitted)try{const p=JSON.parse(fitted);if(p.Ct)$("ct").value=p.Ct;if(p.Cq)$("cq").value=p.Cq;if(p.J)$("rotorJ").value=p.J;if(p.dragScale)$("dragScale").value=p.dragScale;if(p.batteryR)$("batteryR").value=p.batteryR;if(p.R)$("resistance").value=p.R;}catch{}
await switchMode("sim");
