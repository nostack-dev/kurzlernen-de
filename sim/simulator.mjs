import * as THREE from "three";
import Box3DFactory from "box3d.js/dist/box3d.inline.mjs";
import createCore from "../generated/flight_core.mjs";
import {ViewPeerLink,copySignal,shareSignal} from "./p2p_link.mjs";
import {QrScanner,renderQr} from "./qr_pairing.mjs";
import {neutralControls,copyControls,armReady as sharedArmReady,normalizedPointer,endPointerDrag,applyStick,releaseStick,knobAxes,knobPercent,phoneAxis,inversePhoneAxis,applyGameStick,gameKnobAxes,MIN_GAME_CLEARANCE_M,MAX_GAME_CLEARANCE_M,MIN_GAME_AGL_SENSOR_SLANT_RANGE_M,clearanceRateMps,stepGroundClearanceTarget} from "./control_semantics.mjs";
import {RaceTrack} from "./race_track.mjs";
import {loadPhoneControlSettings,mountPlayerControlSettings} from "./control_settings.mjs";
import {loadCameraSettings,mountCameraSettings} from "./camera_settings.mjs";
import {HybridMotorSound} from "./motor_sound.mjs";
import {FlightLogbook} from "./flight_logbook.mjs";
import {installFlightFireFx} from "./flight_fire_fx.mjs";
import {partitionCalibrationLog,evaluatePhysicsValidation,validationSummary,PHYSICS_VALIDATION_SCHEMA} from "./physics_validation.mjs";
import {findXboxGamepad,isXboxCompatibleGamepad,sampleXboxGamepad} from "./xbox_gamepad.mjs";
import {StabilizedExternalCameraRig,externalCameraFrame} from "./camera_stabilization.mjs";
import {StabilizedExternalAirframeVisual,EXTERNAL_AIRFRAME_VISUAL_PROFILES} from "./visual_pose_stabilization.mjs";
import {renderPlatformProfile,quantizedViewportSize,viewportSizeChanged} from "./render_stability.mjs";
import {normalizeBuildingCollisionSnapshot,createWorldBuildingCollisionBodies,destroyWorldBuildingCollisionBodies,findClearBuildingLaunchPoint,resolveBox3dCameraPath} from "./world_building_collision_physics.mjs";
import {Box3dColliderDebugDraw} from "./box3d_collider_debug.mjs";
import {addPropellerSweepColliders} from "./airframe_collision_envelope.mjs";
import {deriveQuadMassProperties} from "./component_mass_model.mjs";
import {batteryOcvVoltage,batteryVoltageUnderLoad,scaleCurrentsToPackLimit,solveStaticPropulsionAuthority,MOTOR_BEARING_DRAG_NM_PER_RAD_S} from "./propulsion_authority.mjs";
import {PlayerCameraModePolicy} from "./player_camera_mode_policy.mjs";

const DT = 0.001;
const G = 9.80665;
const MOTOR_YAW_SIGN=Object.freeze([-1,1,-1,1]);
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
const STATE_NAVIGATION_DEGRADED = 1 << 7;
const NAV_VELOCITY_VALID = 1 << 0;
const NAV_AGL_VALID = 1 << 1;
const NAV_HEADING_VALID = 1 << 2;
const NAV_HEADING_SHIFT = 3;
const NAV_SPLIT_VALIDITY = 1 << 15;
const TERRAIN_SIZE = 20000;
const TERRAIN_HALF = TERRAIN_SIZE / 2;
const DEBUG_GRID_STORAGE = "arondight45DebugGridlinesV1";
const BOX3D_COLLIDER_DEBUG_STORAGE = "arondight45Box3dColliderDebugV1";
const NAV_AGL_RAY_MAX_M = MIN_GAME_AGL_SENSOR_SLANT_RANGE_M;
const SIM_FIXED_STEP_MS = DT * 1000;
const SIM_MAX_CATCHUP_MS = 50;
// Keep work per slice bounded, but retain short scheduler stalls as wall-clock debt.
// Otherwise a >50 ms rAF/OS stall silently deletes real time and the digital twin
// runs permanently slow even when the CPU has enough capacity to catch up.
// Foreground renderer/fullscreen stalls are not allowed to erase physical time.
// Two seconds covers long mobile compositor stalls while keeping a genuinely
// suspended tab from attempting an unbounded catch-up on resume. Any overflow
// is reported as a timing discontinuity and invalidates real-time evidence.
const SIM_MAX_BACKLOG_MS = 2000;
const SIM_MAX_STEPS_PER_SLICE = Math.ceil(SIM_MAX_CATCHUP_MS / SIM_FIXED_STEP_MS);
const SIM_WORK_SLICE_MS = 6;
const SIM_AUX_INTERVAL_S = .01;

// Presentation is explicitly subordinate to the 1 kHz digital-twin clock.
// These budgets may skip visual work; they never skip FC/sensor/motor/Box3D ticks.
const PRESENTATION_HUD_INTERVAL_MS = 75;
const PRESENTATION_AUDIO_INTERVAL_MS = 50;
const PRESENTATION_SHADOW_INTERVAL_MS = 250;
// Keep the deadline below three 60 Hz refresh intervals so floating-point
// boundary jitter cannot turn a 50 ms budget into a fourth-frame (66.7 ms) draw.
const PRESENTATION_MAX_DRAW_GAP_MS = 48;
const PRESENTATION_SOFT_BACKLOG_MS = 1.5;
const PRESENTATION_CONSTRAINED_BACKLOG_MS = 4;
const PRESENTATION_HARD_BACKLOG_MS = 8;
const PRESENTATION_SKIP_DRAW_BACKLOG_MS = 12;
const PRESENTATION_SHADOW_BACKLOG_MS = 3;
const PRESENTATION_PIXEL_RATIO_MAX = 1.25;
const PRESENTATION_PIXEL_RATIO_MIN = .60;
const PRESENTATION_SOFTWARE_PIXEL_RATIO = .30;
const PRESENTATION_QUALITY_WINDOW_MS = 250;
const PRESENTATION_CADENCE_CRITICAL = .86;
const PRESENTATION_CADENCE_CONSTRAINED = .93;
const PRESENTATION_CADENCE_RECOVER = .985;
const PRESENTATION_RECOVERY_WINDOWS = 8;
const yieldToBrowser=(()=>{
  const queue=[],channel=new MessageChannel();
  channel.port1.onmessage=()=>queue.shift()?.();
  return()=>new Promise(resolve=>{queue.push(resolve);channel.port2.postMessage(0);});
})();
const waitForSimulationDeadline=accumulatorMs=>new Promise(resolve=>setTimeout(resolve,Math.max(0,SIM_FIXED_STEP_MS-accumulatorMs)));
const COLLISION_TERRAIN = 1n;
const COLLISION_AIRFRAME = 2n;
const QUERY_RANGEFINDER = 4n;
const QUERY_CAMERA = 8n;
const AIRFRAME_COLLISION_HALF_Z_M = .022;
const AIRFRAME_VISUAL_BODY_CENTER_Z_M = .006;
const AIRFRAME_LANDING_SKID_RADIUS_M = .004;
const AIRFRAME_VISUAL_SKID_CLEARANCE_M = .004;
const AIRFRAME_PRESENTATION_GROUND_BIAS_M = .002;
const AIRFRAME_LANDING_SKID_Z_M = -AIRFRAME_COLLISION_HALF_Z_M + AIRFRAME_LANDING_SKID_RADIUS_M + AIRFRAME_VISUAL_SKID_CLEARANCE_M;
const AIRFRAME_VISUAL_LOWEST_Z_M = Math.min(AIRFRAME_VISUAL_BODY_CENTER_Z_M-AIRFRAME_COLLISION_HALF_Z_M,AIRFRAME_LANDING_SKID_Z_M-AIRFRAME_LANDING_SKID_RADIUS_M);
const AIRFRAME_GROUND_SUPPORT_M = AIRFRAME_COLLISION_HALF_Z_M;
const AIRFRAME_SPAWN_SEPARATION_M = .002;
const AIRFRAME_SPAWN_Z_M = AIRFRAME_GROUND_SUPPORT_M + AIRFRAME_SPAWN_SEPARATION_M;
const FPV_CAMERA_MOUNT_FORWARD_OFFSET_M = .070;
const FPV_CAMERA_LENS_FORWARD_OFFSET_M = .093;
const FPV_CAMERA_LENS_HALF_DEPTH_M = .004;
const FPV_CAMERA_FORWARD_OFFSET_M = .102;
const FPV_CAMERA_UP_OFFSET_M = .028;
const FPV_CAMERA_OPTICAL_CLEARANCE_M = FPV_CAMERA_FORWARD_OFFSET_M - (FPV_CAMERA_LENS_FORWARD_OFFSET_M + FPV_CAMERA_LENS_HALF_DEPTH_M);
const $ = id => document.getElementById(id);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const norm = v => Math.hypot(v[0], v[1], v[2]);
const add = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const scale = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

const ui = Object.fromEntries([
  "modeInfo","connect","run","reset","status","tMode","tController","fcState","simTime","altitude","velocity","attitude","motors","rpm","battery","current","processing","rtt","speed","armSwitch","throttle","logFile","fit","fitProgress","fitStatus","modelValidationStatus","logSamples","touchRoll","touchPitch","touchYaw","touchThrottle","touchArm","exportLog","inputSource","remoteConnect","remoteStatus","controllerLink","pairDialog","remoteOffer","remoteAnswer","acceptOffer","copyAnswer","shareAnswer","pairStatus","closePair","offerVideo","offerCanvas","answerQr"
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
  let flags=NAV_SPLIT_VALIDITY|(measurement.velocityValid?NAV_VELOCITY_VALID:0)|(measurement.aglValid?NAV_AGL_VALID:0);
  if(measurement.headingValid&&Number.isFinite(measurement.headingDeg)){
    const wrapped=((measurement.headingDeg%360)+360)%360,code=Math.round(wrapped*10)%3600;
    flags|=NAV_HEADING_VALID|(code<<NAV_HEADING_SHIFT);
  }
  view.setUint16(14,clamp(Math.round(Math.max(0,measurement.agl)*1000),0,65535),true);view.setUint16(16,flags,true);
  view.setUint16(18,crc16Ccitt(bytes,18),true);return bytes;
}

function parseOutput(bytes,target=null) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength !== OUTPUT_BYTES || d.getUint32(0,true) !== OUTPUT_MAGIC) throw Error("Invalid HLO1 response");
  if (crc32(bytes,28) !== d.getUint32(28,true)) throw Error("HLO1 CRC mismatch");
  const output=target||{sequence:0,motors:[0,0,0,0],attitude:[0,0,0],state:0,processingUs:0};
  output.sequence=d.getUint32(4,true);output.motors[0]=d.getUint16(8,true);output.motors[1]=d.getUint16(10,true);output.motors[2]=d.getUint16(12,true);output.motors[3]=d.getUint16(14,true);
  output.attitude[0]=d.getInt16(16,true)/100;output.attitude[1]=d.getInt16(18,true)/100;output.attitude[2]=d.getInt16(20,true)/100;
  output.state=d.getUint16(22,true);output.processingUs=d.getUint32(24,true);return output;
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

const controllerInputPacket=new Uint8Array(INPUT_BYTES),controllerInputView=new DataView(controllerInputPacket.buffer);
function makeInput(sequence,imu,sbus,flags,dtUs=1000,navigationFrame=null,missedSamples=0) {
  const bytes=controllerInputPacket,view=controllerInputView;bytes.fill(0);
  view.setUint32(0,INPUT_MAGIC,true);view.setUint32(4,sequence,true);view.setUint32(8,dtUs,true);
  view.setUint16(12,clamp(missedSamples|0,0,65535),true);view.setUint16(14,flags,true);
  bytes.set(imu,16);if(sbus)bytes.set(sbus,30);if(navigationFrame)bytes.set(navigationFrame,55);
  view.setUint32(76,crc32(bytes,76),true);return bytes;
}

class WasmBackend {
  constructor(){this.module=null;this.inPtr=0;this.outPtr=0;this.ready=false;this.output={sequence:0,motors:[0,0,0,0],attitude:[0,0,0],state:0,processingUs:0};}
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
  exchangeSync(packet){
    if(!this.ready) throw Error("WASM flight core not ready");
    this.module.HEAPU8.set(packet,this.inPtr);
    this.module._fc_process();
    return parseOutput(this.module.HEAPU8.subarray(this.outPtr,this.outPtr+OUTPUT_BYTES),this.output);
  }
  async exchange(packet){return this.exchangeSync(packet);}
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
  reset(){this.noise=new Noise(0x7193ab21);this.headingNoise=new Noise(0x45a1d1a5);this.elapsed=.01;this.filtered=[0,0,0];this.sequence=1;this.last={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false,headingDeg:0,headingValid:false};}
  sampleFrame(model,dt=DT){
    this.elapsed+=dt;if(this.elapsed<.01)return null;this.elapsed-=.01;
    const truth=model.linear(),alpha=.42;
    for(let i=0;i<3;i++){const measured=truth[i]+this.noise.gaussian()*.025;this.filtered[i]+=alpha*(measured-this.filtered[i]);}
    const velocityValid=this.filtered.every(Number.isFinite),range=model.groundRange(NAV_AGL_RAY_MAX_M),aglValid=range.valid;let agl=0;
    if(aglValid){const measuredSlant=Math.max(0,range.slant+this.noise.gaussian()*.004);agl=measuredSlant*range.verticalProjection;}
    const truthHeading=quatToEuler(model.rotation())[2],headingDeg=(((truthHeading+this.headingNoise.gaussian()*.12+180)%360)+360)%360-180,headingValid=Number.isFinite(headingDeg);
    this.last={vx:this.filtered[0],vy:this.filtered[1],vz:this.filtered[2],agl,valid:velocityValid&&aglValid&&headingValid,velocityValid,aglValid,headingDeg,headingValid};
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
globalThis.__arondightBox3dRuntime=Object.freeze({b3,profile:"box3d-0.1-rigid-world-v1"});

function componentMassInputs(span,propD){
  return deriveQuadMassProperties({
    spanM:span,propDiameterM:propD,
    massesKg:{frame:+$("frameMassG").value/1000,motorEach:+$("motorMassG").value/1000,propEach:+$("propMassG").value/1000,battery:+$("batteryMassG").value/1000,esc:+$("escMassG").value/1000,fcRx:+$("fcRxMassG").value/1000,cameraVtx:+$("cameraVtxMassG").value/1000,wiringHardware:+$("wiringHardwareMassG").value/1000},
    placementM:{batteryX:+$("batteryXmm").value/1000,batteryZ:+$("batteryZmm").value/1000,cameraX:+$("cameraXmm").value/1000,cameraZ:+$("cameraZmm").value/1000},
  });
}
function syncDerivedPhysicsReadouts(massProperties,authority){
  $("mass").value=massProperties.massKg.toFixed(3);$("ixx").value=massProperties.Ixx.toFixed(6);$("iyy").value=massProperties.Iyy.toFixed(6);$("izz").value=massProperties.Izz.toFixed(6);
  const comMm=massProperties.centerM.map(value=>(value*1000).toFixed(1));$("componentMassSummary").textContent=`DERIVED · ${(massProperties.massKg*1000).toFixed(0)} g · CoM ${comMm.join(" / ")} mm · I ${massProperties.Ixx.toFixed(6)} / ${massProperties.Iyy.toFixed(6)} / ${massProperties.Izz.toFixed(6)} kg·m²`;
  $("physicalAuthority").textContent=`PLANT AUTHORITY · static ${authority.totalThrustN.toFixed(1)} N · T/W ${authority.thrustToWeight.toFixed(2)}× · ${authority.totalCurrentA.toFixed(0)} A @ ${authority.voltageV.toFixed(2)} V · ideal az ${authority.idealVerticalAccelerationMps2.toFixed(1)} m/s²`;
  const viewport=$("viewport");if(viewport){viewport.dataset.componentMassKg=massProperties.massKg.toFixed(6);viewport.dataset.componentComM=massProperties.centerM.map(value=>value.toFixed(6)).join(",");viewport.dataset.componentInertiaKgM2=[massProperties.Ixx,massProperties.Iyy,massProperties.Izz].map(value=>value.toFixed(8)).join(",");viewport.dataset.staticThrustN=authority.totalThrustN.toFixed(4);viewport.dataset.staticTwr=authority.thrustToWeight.toFixed(4);viewport.dataset.staticCurrentA=authority.totalCurrentA.toFixed(3);}
}
function defaultParams(){
  const span=+$("span").value/1000,propD=+$("propD").value*.0254,massProperties=componentMassInputs(span,propD);
  const params={mass:massProperties.massKg,massCenter:[...massProperties.centerM],inertiaTensor:massProperties.inertiaTensorKgM2.map(row=>[...row]),span,propD,kv:+$("kv").value,R:+$("resistance").value,J:+$("rotorJ").value,Ct:+$("ct").value,Cq:+$("cq").value,capacity:+$("capacity").value,batteryR:+$("batteryR").value,batteryCells:+$("batteryCells").value,batteryMaxCurrentA:+$("batteryMaxCurrentA").value,motorCurrentLimitA:+$("motorCurrentLimitA").value,escCurrentLimitA:+$("escCurrentLimitA").value,Ixx:massProperties.Ixx,Iyy:massProperties.Iyy,Izz:massProperties.Izz,rho:+$("rho").value,dragScale:+$("dragScale").value,groundEffect:+$("groundEffect").value,wind:[+$("windX").value,+$("windY").value,0],failed:+$("failedMotor").value,imuValid:$("imuValid").value==="1"};
  params.staticAuthority=solveStaticPropulsionAuthority(params);syncDerivedPhysicsReadouts(massProperties,params.staticAuthority);return params;
}

function validateParams(p){
  for(const[k,v]of Object.entries(p))if(typeof v==="number"&&!Number.isFinite(v))throw Error(`Invalid physical parameter ${k}`);
  for(const k of ["mass","span","propD","kv","R","J","Ct","Cq","capacity","batteryR","batteryCells","batteryMaxCurrentA","motorCurrentLimitA","escCurrentLimitA","Ixx","Iyy","Izz","rho","dragScale"])if(!(p[k]>0))throw Error(`${k} must be positive`);
  if(!Array.isArray(p.massCenter)||p.massCenter.length!==3||!p.massCenter.every(Number.isFinite))throw Error("Derived center of mass invalid");
  if(!Array.isArray(p.inertiaTensor)||p.inertiaTensor.length!==3||p.inertiaTensor.some(row=>!Array.isArray(row)||row.length!==3||!row.every(Number.isFinite)))throw Error("Derived inertia tensor invalid");
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
  constructor(params,{graphics=false,scene=null}={}){this.graphics=graphics;this.scene=scene;this.noise=new Noise();this.world=null;this.body=null;this.group=null;this.rotors=[];this.worldBuildingCollisionSnapshot=normalizeBuildingCollisionSnapshot(null);this.worldBuildingCollisionState=null;this.worldBuildingCollisionRevision=0;this.renderPreviousPosition=[0,0,0];this.renderCurrentPosition=[0,0,0];this.renderPreviousRotation=[0,0,0,1];this.renderCurrentRotation=[0,0,0,1];this.renderPreviousVelocity=[0,0,0];this.renderCurrentVelocity=[0,0,0];this.renderPosition=new THREE.Vector3();this.renderRotation=new THREE.Quaternion();this.renderVelocity=new THREE.Vector3();this.renderCurrentQuaternion=new THREE.Quaternion();this.presentationPoseCache={position:this.renderPosition,quaternion:this.renderRotation,velocity:this.renderVelocity};this.visualRelativePosition=new THREE.Vector3();this.visualDesiredPosition=new THREE.Vector3();this.visualInverseRootQuaternion=new THREE.Quaternion();this.visualRelativeQuaternion=new THREE.Quaternion();this.reset(params);}
  reset(p,initial=null){
    validateParams(p);
    this.noise=new Noise();
    this.p={...p,wind:[...p.wind]};
    this.worldBuildingLaunchResolved=false;this.worldBuildingLaunchPoint=[Number(initial?.x)||0,Number(initial?.y)||0];
    if(this.world){this.worldBuildingCollisionState=null;b3.b3DestroyWorld(this.world);}
    const worldDef=b3.b3DefaultWorldDef();worldDef.gravity=[0,0,-G];worldDef.enableSleep=false;worldDef.enableContinuous=true;this.world=b3.b3CreateWorld(worldDef);
    const groundDef=b3.b3DefaultBodyDef();groundDef.position=[0,0,-.05];const ground=b3.b3CreateBody(this.world,groundDef),groundShape=b3.b3DefaultShapeDef();groundShape.baseMaterial.friction=.75;groundShape.baseMaterial.restitution=.03;groundShape.filter={categoryBits:COLLISION_TERRAIN,maskBits:COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA,groupIndex:0};b3.b3CreateBoxShape(ground,groundShape,TERRAIN_HALF,TERRAIN_HALF,.05);
    const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_dynamicBody;const initialZ=Number.isFinite(initial?.z)?initial.z:AIRFRAME_SPAWN_Z_M;bodyDef.position=[initial?.x||0,initial?.y||0,Math.max(AIRFRAME_SPAWN_Z_M,initialZ)];bodyDef.rotation=initial?[...eulerToQuat(initial.roll_deg||0,initial.pitch_deg||0,initial.yaw_deg||0)]:[0,0,0,1];bodyDef.linearDamping=.002;bodyDef.angularDamping=.002;bodyDef.enableSleep=false;this.body=b3.b3CreateBody(this.world,bodyDef);
    const shapeDef=b3.b3DefaultShapeDef();shapeDef.density=100;shapeDef.baseMaterial.friction=.65;shapeDef.baseMaterial.restitution=.08;shapeDef.filter={categoryBits:COLLISION_AIRFRAME,maskBits:COLLISION_TERRAIN,groupIndex:0};b3.b3CreateBoxShape(this.body,shapeDef,.055,.045,AIRFRAME_COLLISION_HALF_Z_M);
    const arm=p.span/(2*Math.sqrt(2));this.motorPos=[[-arm,-arm,0],[-arm,arm,0],[arm,arm,0],[arm,-arm,0]];
    for(const position of this.motorPos){b3.b3CreateCapsuleShape(this.body,shapeDef,{center1:[0,0,0],center2:position,radius:.008});b3.b3CreateSphereShape(this.body,shapeDef,{center:position,radius:.018});}
    addPropellerSweepColliders(b3,this.body,shapeDef,this.motorPos,p.propD);
    this.skidHalfLength=Math.min(.045,Math.max(.03,p.span*.18));
    const mass=b3.b3Body_GetMassData(this.body);mass.mass=p.mass;mass.center=[...p.massCenter];const I=p.inertiaTensor;mass.inertia={cx:[I[0][0],I[1][0],I[2][0]],cy:[I[0][1],I[1][1],I[2][1]],cz:[I[0][2],I[1][2],I[2][2]]};b3.b3Body_SetMassData(this.body,mass);
    if(initial?.vx!=null && b3.b3Body_SetLinearVelocity)b3.b3Body_SetLinearVelocity(this.body,[initial.vx||0,initial.vy||0,initial.vz||0]);
    this.motorOmega=[0,0,0,0];this.motorCurrent=[0,0,0,0];this.motorTorque=[0,0,0,0];this.propTorque=[0,0,0,0];this.motorPower=[0,0,0,0];this.batterySoc=1;this.batteryVoltage=4.2*p.batteryCells;this.batteryCurrent=0;this.worldAcceleration=[0,0,0];this.prevOmegaBody=[0,0,0];this.imuBytes=new Uint8Array(14);this.imuView=new DataView(this.imuBytes.buffer);this.motorBackEmf=60/(2*Math.PI*p.kv);this.propDiameter4=p.propD**4;this.propDiameter5=p.propD**5;this.cdA=[.035*p.dragScale,.035*p.dragScale,.07*p.dragScale];this.rebuildWorldBuildingCollisions();this.syncPresentationSnapshots();
    if(this.graphics){
      this.buildGraphics();
      // A freshly constructed Object3D starts at z=0. Synchronize it with the
      // already-valid Box3D spawn immediately so no compositor frame can show
      // the landing gear inside the ground before the main render loop begins.
      this.render(this.presentationPose(1),0);
    }
  }
  setWorldBuildingCollisions(value){const snapshot=normalizeBuildingCollisionSnapshot(value);if(snapshot.hash===this.worldBuildingCollisionSnapshot.hash&&snapshot.prismCount===this.worldBuildingCollisionSnapshot.prismCount)return false;this.worldBuildingCollisionSnapshot=snapshot;this.rebuildWorldBuildingCollisions();return true;}
  resolveWorldBuildingLaunch(){
    if(!this.body||!this.worldBuildingCollisionSnapshot.prismCount)return false;
    const position=this.position(),velocity=this.linear(),angular=this.angular(),reference=Array.isArray(this.worldBuildingLaunchPoint)&&this.worldBuildingLaunchPoint.length===2&&this.worldBuildingLaunchPoint.every(Number.isFinite)?this.worldBuildingLaunchPoint:[position[0],position[1]],untouched=Math.hypot(position[0]-reference[0],position[1]-reference[1])<.14&&position[2]<=AIRFRAME_SPAWN_Z_M+.08&&norm(velocity)<.20&&norm(angular)<.80;
    if(!untouched){this.worldBuildingLaunchResolved=true;this.worldBuildingLaunchPoint=[Infinity,Infinity];return false;}
    const safe=findClearBuildingLaunchPoint(this.worldBuildingCollisionSnapshot,{point:[position[0],position[1]],clearanceM:.55,maxSearchM:80}),offset=Math.hypot(safe[0]-position[0],safe[1]-position[1]);
    this.worldBuildingLaunchResolved=false;this.worldBuildingLaunchPoint=[safe[0],safe[1]];
    const viewport=$("viewport");if(viewport){viewport.dataset.worldLaunchRelocated=offset>.01?"1":"0";viewport.dataset.worldLaunchOffsetM=offset.toFixed(3);viewport.dataset.worldLaunchX=Number(safe[0]).toFixed(3);viewport.dataset.worldLaunchY=Number(safe[1]).toFixed(3);}
    if(offset<=.01)return false;
    b3.b3Body_SetTransform(this.body,[safe[0],safe[1],AIRFRAME_SPAWN_Z_M],this.rotation());b3.b3Body_SetLinearVelocity(this.body,[0,0,0]);b3.b3Body_SetAngularVelocity(this.body,[0,0,0]);this.syncPresentationSnapshots();return true;
  }
  rebuildWorldBuildingCollisions(){
  if(!this.world)return;
  destroyWorldBuildingCollisionBodies(b3,this.worldBuildingCollisionState);
  this.resolveWorldBuildingLaunch();
  this.worldBuildingCollisionState=createWorldBuildingCollisionBodies(b3,this.world,this.worldBuildingCollisionSnapshot,{categoryBits:COLLISION_TERRAIN,maskBits:COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA,launchExclusionPoint:this.worldBuildingLaunchPoint||[Infinity,Infinity]});
  this.snapSpawnToGround();
  this.worldBuildingCollisionRevision++;
}
  buildGraphics(){
    if(this.group)this.scene.remove(this.group);
    this.group=new THREE.Group();this.group.userData.arondightAirframe=true;this.scene.add(this.group);this.rotors=[];
    const frameMaterial=new THREE.MeshStandardMaterial({color:0x6f8399,emissive:0x10273b,emissiveIntensity:.18,metalness:.30,roughness:.38}),bodyMaterial=new THREE.MeshStandardMaterial({color:0x26394e,emissive:0x0d2235,emissiveIntensity:.20,metalness:.42,roughness:.30}),skidMaterial=new THREE.MeshStandardMaterial({color:0x1b2938,emissive:0x07121d,emissiveIntensity:.12,metalness:.18,roughness:.62});
    const center=new THREE.Mesh(new THREE.BoxGeometry(.11,.09,.044),bodyMaterial);center.position.z=AIRFRAME_VISUAL_BODY_CENTER_Z_M;center.castShadow=true;this.group.add(center);
    for(let i=0;i<4;i++){
      const position=this.motorPos[i],length=Math.hypot(position[0],position[1]),armMesh=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,length,12),frameMaterial);armMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(position[0],position[1],0).normalize());armMesh.position.set(position[0]/2,position[1]/2,0);this.group.add(armMesh);
      const motor=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.025,20),bodyMaterial);motor.rotation.x=Math.PI/2;motor.position.set(...position);this.group.add(motor);
      const rotor=new THREE.Mesh(new THREE.BoxGeometry(this.p.propD,.012,.002),new THREE.MeshStandardMaterial({color:i%2?0xffa34d:0x4dd6ff,transparent:true,opacity:.72}));rotor.position.set(...position);this.group.add(rotor);this.rotors.push(rotor);
    }
    for(const y of [-.035,.035]){
      const skid=new THREE.Mesh(new THREE.CylinderGeometry(AIRFRAME_LANDING_SKID_RADIUS_M,AIRFRAME_LANDING_SKID_RADIUS_M,this.skidHalfLength*2,12),skidMaterial);skid.rotation.z=Math.PI/2;skid.position.set(0,y,AIRFRAME_LANDING_SKID_Z_M);skid.castShadow=true;this.group.add(skid);
      for(const x of [-this.skidHalfLength,this.skidHalfLength]){const foot=new THREE.Mesh(new THREE.SphereGeometry(AIRFRAME_LANDING_SKID_RADIUS_M,10,8),skidMaterial);foot.position.set(x,y,AIRFRAME_LANDING_SKID_Z_M);foot.castShadow=true;this.group.add(foot);}
    }
    const nose=new THREE.Mesh(new THREE.ConeGeometry(.018,.06,16),new THREE.MeshStandardMaterial({color:0xff4f65,emissive:0x66121f,emissiveIntensity:.35}));nose.rotation.z=-Math.PI/2;nose.position.x=-.075;this.group.add(nose);
    const fpvCameraBody=new THREE.Mesh(new THREE.BoxGeometry(.040,.030,.025),bodyMaterial);fpvCameraBody.position.set(-FPV_CAMERA_MOUNT_FORWARD_OFFSET_M,0,FPV_CAMERA_UP_OFFSET_M);fpvCameraBody.userData.arondightFpvCamera=true;fpvCameraBody.castShadow=true;this.group.add(fpvCameraBody);this.fpvCameraBody=fpvCameraBody;
    const fpvCameraLens=new THREE.Mesh(new THREE.CylinderGeometry(.010,.010,.008,18),new THREE.MeshStandardMaterial({color:0x111820,metalness:.15,roughness:.22}));fpvCameraLens.rotation.z=Math.PI/2;fpvCameraLens.position.set(-FPV_CAMERA_LENS_FORWARD_OFFSET_M,0,FPV_CAMERA_UP_OFFSET_M);fpvCameraLens.userData.arondightFpvCameraLens=true;this.group.add(fpvCameraLens);this.fpvCameraLens=fpvCameraLens;
    const worldHaloBack=new THREE.Mesh(new THREE.TorusGeometry(.158,.009,8,48),new THREE.MeshBasicMaterial({color:0x061018,transparent:true,opacity:.78,depthTest:false,depthWrite:false}));worldHaloBack.position.z=.034;worldHaloBack.visible=false;worldHaloBack.renderOrder=999;this.group.add(worldHaloBack);this.worldHaloBack=worldHaloBack;
    const worldHalo=new THREE.Mesh(new THREE.TorusGeometry(.15,.0055,8,48),new THREE.MeshBasicMaterial({color:0xaef3ff,transparent:true,opacity:.98,depthTest:false,depthWrite:false}));worldHalo.position.z=.035;worldHalo.visible=false;worldHalo.renderOrder=1000;this.group.add(worldHalo);this.worldHalo=worldHalo;
    const worldHeadingCue=new THREE.Mesh(new THREE.ConeGeometry(.012,.055,12),new THREE.MeshBasicMaterial({color:0xff405a,depthTest:false,depthWrite:false}));worldHeadingCue.rotation.z=-Math.PI/2;worldHeadingCue.position.set(-.19,0,.036);worldHeadingCue.visible=false;worldHeadingCue.renderOrder=1001;this.group.add(worldHeadingCue);this.worldHeadingCue=worldHeadingCue;
    // Root airframe stays authoritative for WORLD/VS/network state. Every visible
    // component lives under a presentation-only child that may be filtered in
    // external views without ever moving physics, hitboxes or multiplayer pose.
    this.visualGroup=new THREE.Group();this.visualGroup.userData.arondightVisualAirframe=true;const visualChildren=[...this.group.children];for(const child of visualChildren)this.visualGroup.add(child);this.group.add(this.visualGroup);
  }
  localVector(v){return b3.b3Body_GetLocalVector([0,0,0],this.body,v);}
  worldVector(v){return b3.b3Body_GetWorldVector([0,0,0],this.body,v);}
  worldPoint(v){return b3.b3Body_GetWorldPoint([0,0,0],this.body,v);}
  linear(){return b3.b3Body_GetLinearVelocity([0,0,0],this.body);}
  angular(){return b3.b3Body_GetAngularVelocity([0,0,0],this.body);}
  position(){return b3.b3Body_GetPosition([0,0,0],this.body);}
  rotation(){return b3.b3Body_GetRotation([0,0,0,1],this.body);}
  syncPresentationSnapshots(){
    const position=this.position(),rotation=this.rotation(),velocity=this.linear();
    for(let i=0;i<3;i++){this.renderPreviousPosition[i]=this.renderCurrentPosition[i]=position[i];this.renderPreviousVelocity[i]=this.renderCurrentVelocity[i]=velocity[i];}
    for(let i=0;i<4;i++)this.renderPreviousRotation[i]=this.renderCurrentRotation[i]=rotation[i];
  }
  capturePresentationStep(){
    for(let i=0;i<3;i++){this.renderPreviousPosition[i]=this.renderCurrentPosition[i];this.renderPreviousVelocity[i]=this.renderCurrentVelocity[i];}
    for(let i=0;i<4;i++)this.renderPreviousRotation[i]=this.renderCurrentRotation[i];
  }
  capturePresentationCurrent(){
    const position=this.position(),rotation=this.rotation(),velocity=this.linear();
    for(let i=0;i<3;i++){this.renderCurrentPosition[i]=position[i];this.renderCurrentVelocity[i]=velocity[i];}
    for(let i=0;i<4;i++)this.renderCurrentRotation[i]=rotation[i];
  }
  presentationPose(alpha=1){
    const a=clamp(Number(alpha)||0,0,1),p0=this.renderPreviousPosition,p1=this.renderCurrentPosition,v0=this.renderPreviousVelocity,v1=this.renderCurrentVelocity,q0=this.renderPreviousRotation,q1=this.renderCurrentRotation;
    this.renderPosition.set(p0[0]+(p1[0]-p0[0])*a,p0[1]+(p1[1]-p0[1])*a,p0[2]+(p1[2]-p0[2])*a);
    this.renderVelocity.set(v0[0]+(v1[0]-v0[0])*a,v0[1]+(v1[1]-v0[1])*a,v0[2]+(v1[2]-v0[2])*a);
    this.renderRotation.set(q0[0],q0[1],q0[2],q0[3]).slerp(this.renderCurrentQuaternion.set(q1[0],q1[1],q1[2],q1[3]),a).normalize();
    return this.presentationPoseCache;
  }
  spawnGroundRaycast(point=this.position()){
  const x=Number(point?.[0])||0,y=Number(point?.[1])||0,currentZ=Number(point?.[2])||0,top=Math.max(256,currentZ+128),bottom=-256,translation=[0,0,bottom-top],filter=b3.b3DefaultQueryFilter();
  filter.categoryBits=QUERY_CAMERA;filter.maskBits=COLLISION_TERRAIN;
  const hit=b3.b3World_CastRayClosest(this.world,[x,y,top],translation,filter),fraction=Number(hit?.fraction);
  if(!hit?.hit||!Number.isFinite(fraction)||fraction<0||fraction>1)return{valid:false,groundZ:0,spawnZ:AIRFRAME_SPAWN_Z_M,fraction:1};
  const groundZ=top+translation[2]*fraction,spawnZ=groundZ+AIRFRAME_GROUND_SUPPORT_M+AIRFRAME_SPAWN_SEPARATION_M;
  return{valid:Number.isFinite(groundZ)&&Number.isFinite(spawnZ),groundZ,spawnZ,fraction};
}
snapSpawnToGround(){
  if(!this.body)return false;
  const position=this.position(),velocity=this.linear(),angular=this.angular(),reference=Array.isArray(this.worldBuildingLaunchPoint)&&this.worldBuildingLaunchPoint.length===2&&this.worldBuildingLaunchPoint.every(Number.isFinite)?this.worldBuildingLaunchPoint:[position[0],position[1]],nearLaunch=Math.hypot(position[0]-reference[0],position[1]-reference[1])<.14,idle=norm(velocity)<.20&&norm(angular)<.80;
  if(!nearLaunch||!idle)return false;
  const ray=this.spawnGroundRaycast(position),viewport=$("viewport");
  if(!ray.valid){if(viewport)viewport.dataset.airframeSpawnGroundRaycast="miss";return false;}
  const moved=Math.abs(position[2]-ray.spawnZ)>.0005;
  if(moved){b3.b3Body_SetTransform(this.body,[position[0],position[1],ray.spawnZ],this.rotation());b3.b3Body_SetLinearVelocity(this.body,[0,0,0]);b3.b3Body_SetAngularVelocity(this.body,[0,0,0]);this.syncPresentationSnapshots();}
  if(viewport){viewport.dataset.airframeSpawnGroundRaycast="hit";viewport.dataset.airframeSpawnGroundZ=ray.groundZ.toFixed(4);viewport.dataset.airframeSpawnZ=ray.spawnZ.toFixed(4);viewport.dataset.airframeSpawnGroundClearanceM=(ray.spawnZ-ray.groundZ).toFixed(4);viewport.dataset.airframeSpawnGroundAdjusted=moved?"1":"0";}
  return moved;
}
  groundRange(maxRange=12){
    const range=clamp(Number(maxRange)||12,.05,NAV_AGL_RAY_MAX_M),origin=this.worldPoint([0,0,-.018]),down=this.worldVector([0,0,-1]),verticalProjection=-down[2];
    if(!(verticalProjection>.55))return{valid:false,slant:0,agl:0,verticalProjection};
    const filter=b3.b3DefaultQueryFilter();filter.categoryBits=QUERY_RANGEFINDER;filter.maskBits=COLLISION_TERRAIN;const hit=b3.b3World_CastRayClosest(this.world,origin,scale(down,range),filter),fraction=Number(hit?.fraction);
    if(!hit?.hit||!Number.isFinite(fraction)||fraction<0||fraction>1)return{valid:false,slant:0,agl:0,verticalProjection};
    const slant=fraction*range,agl=slant*verticalProjection;
    return{valid:slant>=.001&&slant<=range&&Number.isFinite(agl),slant,agl,verticalProjection};
  }
  resolveCameraPath(anchor,desired){return resolveBox3dCameraPath(b3,this.world,anchor,desired,{queryCategoryBits:QUERY_CAMERA,terrainCategoryBits:COLLISION_TERRAIN,clearanceM:.08});}
  imuRaw(dt=DT){
    this.noise.stepBias(dt);
    const omegaBody=this.localVector(this.angular()),alpha=scale(sub(omegaBody,this.prevOmegaBody),1/dt);this.prevOmegaBody=omegaBody.slice();
    const specific=this.localVector(sub(this.worldAcceleration,[0,0,-G])),sensorOffset=[0,0,.008],accel=add(specific,add(cross(alpha,sensorOffset),cross(omegaBody,cross(omegaBody,sensorOffset)))),gyro=scale(omegaBody,180/Math.PI);
    for(let i=0;i<3;i++){accel[i]+=this.noise.accBias[i]*G+this.noise.gaussian()*.0025*G;gyro[i]+=this.noise.gyroBias[i]+this.noise.gaussian()*.035;}
    const raw=this.imuBytes,view=this.imuView,sat=x=>clamp(Math.round(x),-32767,32767);
    view.setInt16(0,0,false);view.setInt16(2,sat(accel[0]/G*2048),false);view.setInt16(4,sat(accel[1]/G*2048),false);view.setInt16(6,sat(accel[2]/G*2048),false);view.setInt16(8,sat(gyro[0]*16.4),false);view.setInt16(10,sat(gyro[1]*16.4),false);view.setInt16(12,sat(gyro[2]*16.4),false);
    return raw;
  }
  batteryOcv(){return batteryOcvVoltage(this.batterySoc,this.p.batteryCells);}
  applyForces(pulses,dt=DT){
    const p=this.p,yawSign=MOTOR_YAW_SIGN,diameter=p.propD,backEmf=this.motorBackEmf,torqueConstant=backEmf,ocv=this.batteryOcv(),currents=this.motorCurrent;let total=0;
    for(let pass=0;pass<2;pass++){
      total=0;
      for(let i=0;i<4;i++){
        let command=clamp((pulses[i]-1000)/1000,0,1);
        if(i===p.failed)command=0;
        const volts=command*(pass?this.batteryVoltage:ocv);
        currents[i]=clamp((volts-backEmf*this.motorOmega[i])/p.R,0,Math.min(p.motorCurrentLimitA,p.escCurrentLimitA));
        total+=currents[i];
      }
      total=scaleCurrentsToPackLimit(currents,p.batteryMaxCurrentA);
      this.batteryVoltage=batteryVoltageUnderLoad(ocv,total,p.batteryR,p.batteryCells);
    }
    this.batteryCurrent=total;
    this.batterySoc=clamp(this.batterySoc-total*dt/(p.capacity*3600),0,1);
    const localVelocity=this.localVector(this.linear()),altitude=Math.max(.001,this.position()[2]);
    for(let i=0;i<4;i++){
      const revolutions=this.motorOmega[i]/(2*Math.PI),propTorque=p.Cq*p.rho*revolutions*revolutions*this.propDiameter5,motorTorque=torqueConstant*currents[i];
      this.motorTorque[i]=motorTorque;this.propTorque[i]=propTorque;this.motorPower[i]=Math.max(0,motorTorque*this.motorOmega[i]);
      this.motorOmega[i]=Math.max(0,this.motorOmega[i]+(motorTorque-propTorque-MOTOR_BEARING_DRAG_NM_PER_RAD_S*this.motorOmega[i])*dt/p.J);
      const n=this.motorOmega[i]/(2*Math.PI);let thrust=p.Ct*p.rho*n*n*this.propDiameter4;
      const advance=localVelocity[2]/Math.max(1,n*diameter);thrust*=clamp(1-.12*advance,.55,1.25);thrust*=1+p.groundEffect*Math.exp(-altitude/Math.max(.02,.75*diameter));
      b3.b3Body_ApplyForce(this.body,this.worldVector([0,0,thrust]),this.worldPoint(this.motorPos[i]),true);
      b3.b3Body_ApplyTorque(this.body,this.worldVector([0,0,yawSign[i]*motorTorque]),true);
    }
    const relative=this.localVector(sub(this.linear(),p.wind)),cdA=this.cdA,horizontalSpeed=Math.hypot(relative[0],relative[1]),drag=[-.5*p.rho*cdA[0]*relative[0]*horizontalSpeed,-.5*p.rho*cdA[1]*relative[1]*horizontalSpeed,-.5*p.rho*cdA[2]*relative[2]*Math.abs(relative[2])];b3.b3Body_ApplyForceToCenter(this.body,this.worldVector(drag),true);
    const omega=this.localVector(this.angular()),angularDrag=omega.map(v=>-.0012*v*Math.abs(v));b3.b3Body_ApplyTorque(this.body,this.worldVector(angularDrag),true);
  }
  step(pulses,dt=DT){
    this.capturePresentationStep();
    this.applyForces(pulses,dt);
    const before=this.linear();
    b3.b3World_Step(this.world,dt,4);
    this.worldAcceleration=scale(sub(this.linear(),before),1/dt);
    this.capturePresentationCurrent();
  }
  state(){const p=this.position(),q=this.rotation(),v=this.linear();return{x:p[0],y:p[1],z:p[2],vx:v[0],vy:v[1],vz:v[2],speed:norm(v),attitude:quatToEuler(q),battery_v:this.batteryVoltage,current_a:this.batteryCurrent};}
  render(pose=this.presentationPose(1),dt=1/60,visualPose=pose){if(!this.graphics||!this.group)return pose;this.group.position.copy(pose.position);this.group.position.z+=AIRFRAME_PRESENTATION_GROUND_BIAS_M;this.group.quaternion.copy(pose.quaternion);const visible=visualPose||pose;if(this.visualGroup){this.visualDesiredPosition.copy(visible.position);this.visualDesiredPosition.z+=AIRFRAME_PRESENTATION_GROUND_BIAS_M;this.visualInverseRootQuaternion.copy(this.group.quaternion).invert();this.visualRelativePosition.copy(this.visualDesiredPosition).sub(this.group.position).applyQuaternion(this.visualInverseRootQuaternion);this.visualGroup.position.copy(this.visualRelativePosition);this.visualRelativeQuaternion.copy(this.visualInverseRootQuaternion).multiply(visible.quaternion).normalize();this.visualGroup.quaternion.copy(this.visualRelativeQuaternion);}const presentationViewport=$("viewport");if(presentationViewport){presentationViewport.dataset.airframePresentationGroundBiasM=AIRFRAME_PRESENTATION_GROUND_BIAS_M.toFixed(3);presentationViewport.dataset.airframeVisualSupportZ=(visible.position.z+AIRFRAME_PRESENTATION_GROUND_BIAS_M+AIRFRAME_VISUAL_LOWEST_Z_M).toFixed(4);}const step=clamp(Number(dt)||0,0,.1);this.rotors.forEach((rotor,i)=>rotor.rotation.z=(rotor.rotation.z+(i%2?-1:1)*this.motorOmega[i]*step)%(2*Math.PI));const worldActive=Boolean(globalThis.__arondightRealWorld?.active),cameraMode=$("viewport")?.dataset.cameraMode||"follow",showWorldMarker=worldActive&&cameraMode!=="fpv";if(this.worldHalo)this.worldHalo.visible=showWorldMarker;if(this.worldHaloBack)this.worldHaloBack.visible=showWorldMarker;if(this.worldHeadingCue)this.worldHeadingCue.visible=showWorldMarker;return pose;}
}

function integrateDuration(model,pulses,duration){
  if(!(duration>0))return model.state();
  let remaining=duration;
  while(remaining>1e-9){const step=Math.min(DT,remaining);model.step(pulses,step);remaining-=step;}
  return model.state();
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
const initialRenderProfile=renderPlatformProfile({userAgent:navigator.userAgent,devicePixelRatio});
const renderer=new THREE.WebGLRenderer({antialias:false,alpha:true,powerPreference:initialRenderProfile.stableBackbuffer?"default":"high-performance",desynchronized:false,preserveDrawingBuffer:false});
const presentationGl=renderer.getContext(),presentationRendererInfo=presentationGl.getExtension("WEBGL_debug_renderer_info"),presentationRendererName=String(presentationGl.getParameter(presentationRendererInfo?.UNMASKED_RENDERER_WEBGL||presentationGl.RENDERER)||"");
const presentationRenderProfile=renderPlatformProfile({userAgent:navigator.userAgent,devicePixelRatio,rendererName:presentationRendererName}),presentationSoftwareRaster=presentationRenderProfile.software,presentationStableBackbuffer=presentationRenderProfile.stableBackbuffer,presentationNativePixelRatio=Math.min(presentationRenderProfile.pixelRatioCeiling,PRESENTATION_PIXEL_RATIO_MAX),presentationQualityCeiling=presentationSoftwareRaster?Math.min(presentationNativePixelRatio,PRESENTATION_SOFTWARE_PIXEL_RATIO):presentationNativePixelRatio;
let presentationPixelRatio=presentationQualityCeiling;renderer.setPixelRatio(presentationPixelRatio);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=presentationSoftwareRaster?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=!presentationSoftwareRaster;renderer.shadowMap.type=THREE.BasicShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=!presentationSoftwareRaster;
const presentationViewport=$("viewport");presentationViewport.appendChild(renderer.domElement);presentationViewport.dataset.renderPlatform=presentationRenderProfile.android?"android-stable":"standard";presentationViewport.dataset.presentationStableBackbuffer=presentationStableBackbuffer?"1":"0";presentationViewport.dataset.presentationCanvasDesynchronized="0";document.documentElement.classList.toggle("android-stable-webgl",presentationStableBackbuffer);globalThis.__arondightRealWorld?.attachThree?.(renderer,scene,camera);
scene.add(new THREE.HemisphereLight(0xf8fcff,0x7f946d,2.0));const sun=new THREE.DirectionalLight(0xfff7e8,2.6);sun.position.set(-4,-6,10);sun.castShadow=true;scene.add(sun);
const grid=new THREE.GridHelper(TERRAIN_SIZE,120,0x6b7d89,0xa7b6bd);grid.rotation.x=Math.PI/2;grid.position.z=.002;scene.add(grid);
let debugGridEnabled=false;try{debugGridEnabled=localStorage.getItem(DEBUG_GRID_STORAGE)==="1";}catch{}
function setDebugGridEnabled(enabled){debugGridEnabled=Boolean(enabled);grid.visible=debugGridEnabled;const viewport=$("viewport");if(viewport)viewport.dataset.debugGridEnabled=debugGridEnabled?"1":"0";try{localStorage.setItem(DEBUG_GRID_STORAGE,debugGridEnabled?"1":"0");}catch{}return debugGridEnabled;}
setDebugGridEnabled(debugGridEnabled);
const groundMesh=new THREE.Mesh(new THREE.BoxGeometry(TERRAIN_SIZE,TERRAIN_SIZE,.1),new THREE.MeshStandardMaterial({color:0xa9b99a,roughness:.96,metalness:0}));groundMesh.position.z=-.05;groundMesh.receiveShadow=true;scene.add(groundMesh);
const raceTrack=new RaceTrack(scene,{laps:3});
const cameraHud=document.createElement("div");cameraHud.id="cameraModes";cameraHud.setAttribute("aria-label","Camera mode");cameraHud.innerHTML='<button id="camFollow" type="button">FOLLOW</button><button id="camFpv" type="button">FPV</button><button id="camThird" type="button">THIRD</button><button id="camSolo" class="start-sim-cta" type="button">START SIM</button><button id="soundToggle" type="button">SOUND</button>';
Object.assign(cameraHud.style,{position:"absolute",zIndex:"4",top:"12px",left:"50%",transform:"translateX(-50%)",display:"flex",gap:"6px",padding:"5px",borderRadius:"10px",background:"rgba(20,31,45,.72)",border:"1px solid rgba(255,255,255,.28)",backdropFilter:"blur(8px)",boxShadow:"0 5px 18px rgba(0,0,0,.18)"});
for(const button of cameraHud.querySelectorAll("button"))Object.assign(button.style,{minWidth:"76px",padding:"7px 10px",borderRadius:"7px",border:"1px solid rgba(255,255,255,.3)",background:"rgba(17,29,43,.82)",color:"#fff",font:"700 12px system-ui,-apple-system,sans-serif",letterSpacing:".04em"});
$("viewport").appendChild(cameraHud);
function syncSoloPresentationOrientation(){
  const viewport=$("viewport"),solo=document.body.classList.contains("solo-flight");
  if(!solo){delete viewport.dataset.soloOrientation;delete viewport.dataset.orientationPolicy;return false;}
  const cssLandscape=globalThis.matchMedia?.("(orientation: portrait)")?.matches===true;
  viewport.dataset.orientationPolicy="landscape";
  viewport.dataset.soloOrientation=cssLandscape?"css-landscape":"native-landscape";
  return cssLandscape;
}
let presentationViewportSize=null,presentationResizeQueued=false,presentationBackbufferResizes=0;
function commitPresentationResize(){
  const viewport=$("viewport");syncSoloPresentationOrientation();const next=quantizedViewportSize(viewport.clientWidth,viewport.clientHeight);if(!viewportSizeChanged(presentationViewportSize,next))return false;presentationViewportSize=next;renderer.setSize(next.width,next.height,false);camera.aspect=next.width/next.height;camera.updateProjectionMatrix();presentationBackbufferResizes++;viewport.dataset.presentationBackbufferSize=`${next.width}x${next.height}`;viewport.dataset.presentationBackbufferResizes=String(presentationBackbufferResizes);return true;
}
function resize(){if(presentationResizeQueued)return;presentationResizeQueued=true;requestAnimationFrame(()=>{presentationResizeQueued=false;commitPresentationResize();});}
addEventListener("resize",resize,{passive:true});addEventListener("orientationchange",resize,{passive:true});globalThis.visualViewport?.addEventListener?.("resize",resize,{passive:true});const viewportResizeObserver=globalThis.ResizeObserver?new ResizeObserver(resize):null;viewportResizeObserver?.observe($("viewport"));commitPresentationResize();

let physics=new PhysicsModel(defaultParams(),{graphics:true,scene});
globalThis.__arondightRealWorld?.attachCameraCollisionResolver?.((anchor,desired)=>physics.resolveCameraPath(anchor,desired));
const box3dColliderDebugDraw=new Box3dColliderDebugDraw(scene);
let box3dColliderDebugEnabled=false;try{box3dColliderDebugEnabled=localStorage.getItem(BOX3D_COLLIDER_DEBUG_STORAGE)==="1";}catch{}
function setBox3dColliderDebugEnabled(enabled){
  box3dColliderDebugEnabled=Boolean(enabled);box3dColliderDebugDraw.setEnabled(box3dColliderDebugEnabled);const viewport=$("viewport");if(viewport){viewport.dataset.box3dColliderDebugDraw=box3dColliderDebugEnabled?"1":"0";viewport.dataset.box3dColliderDebugPrisms=box3dColliderDebugEnabled?String(box3dColliderDebugDraw.activePrismCount):"0";}try{localStorage.setItem(BOX3D_COLLIDER_DEBUG_STORAGE,box3dColliderDebugEnabled?"1":"0");}catch{}return box3dColliderDebugEnabled;
}
setBox3dColliderDebugEnabled(box3dColliderDebugEnabled);
globalThis.__arondightRealWorld?.attachBuildingCollisionSink?.(snapshot=>physics.setWorldBuildingCollisions(snapshot));
const motorSound=new HybridMotorSound($("viewport"));
function updateSoundButton(){const button=$("soundToggle");if(button)button.textContent=motorSound.enabled?(motorSound.isRunning()?"SOUND ON":"SOUND TAP"):"SOUND OFF";}
$("soundToggle").onclick=async()=>{if(!motorSound.enabled||!motorSound.isRunning()){motorSound.setEnabled(true);await motorSound.unlock();}else motorSound.setEnabled(false);updateSoundButton();};
document.addEventListener("pointerdown",event=>{if(event.target?.id!=="soundToggle"&&motorSound.enabled&&!motorSound.isRunning())motorSound.unlock().then(updateSoundButton);},{passive:true});
document.addEventListener("visibilitychange",()=>{motorSound.syncState();updateSoundButton();},{passive:true});
updateSoundButton();
const navigationSensors=new SimNavigationSensors();
const sbusReceiver=new SimSbusReceiver();
let latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false,headingDeg:0,headingValid:false};
const savedCameraMode=localStorage.getItem("arondight45CameraMode");
const playerCameraModePolicy=new PlayerCameraModePolicy({dronePreference:savedCameraMode,playerMode:globalThis.__arondightOnFootMode===true?"foot":"drone"});
let cameraMode=playerCameraModePolicy.effectiveMode,cameraFrameMs=performance.now();
const externalCameraRig=new StabilizedExternalCameraRig();
const externalAirframeVisualRig=new StabilizedExternalAirframeVisual(EXTERNAL_AIRFRAME_VISUAL_PROFILES),externalVisualPosition=new THREE.Vector3(),externalVisualQuaternion=new THREE.Quaternion(),externalVisualVelocity=new THREE.Vector3(),externalVisualPose={position:externalVisualPosition,quaternion:externalVisualQuaternion,velocity:externalVisualVelocity};
const cameraLookTarget=new THREE.Vector3();
let fireCameraKick=0,fireCameraPhase=0;
function addFireCameraKick(intensity=.16){fireCameraKick=Math.min(.65,fireCameraKick+clamp(Number(intensity)||0,0,.25));const viewport=$("viewport");if(viewport){viewport.dataset.fireRecoilImpulses=String((Number(viewport.dataset.fireRecoilImpulses)||0)+1);viewport.dataset.fireCameraKick=fireCameraKick.toFixed(3);}}
function applyFireCameraShake(dt){if(!(fireCameraKick>.0001))return;const step=clamp(dt,0,.1);fireCameraPhase+=step*55;camera.rotateX((-.00135+Math.sin(fireCameraPhase)*.00045)*fireCameraKick);camera.rotateY(Math.sin(fireCameraPhase*1.37)*.00055*fireCameraKick);fireCameraKick*=Math.exp(-19*step);const viewport=$("viewport");if(viewport)viewport.dataset.fireCameraKick=fireCameraKick.toFixed(3);}
let cameraSettings=loadCameraSettings();
function applyCameraSettings(next){cameraSettings=next;externalCameraRig.invalidate();externalAirframeVisualRig.invalidate();$("viewport").dataset.fpvTiltDeg=String(cameraSettings.fpvTiltDeg);$("viewport").dataset.fpvFovDeg=String(cameraSettings.fpvFovDeg);$("viewport").dataset.thirdCameraDistanceM=String(cameraSettings.thirdDistanceM);}
applyCameraSettings(cameraSettings);
function renderCameraModeUi(snapshot=playerCameraModePolicy.snapshot()){
  const soloCamera=$("soloCamera");if(soloCamera){const walk=snapshot.playerMode==="foot";soloCamera.disabled=walk;soloCamera.textContent=walk?"WALK CAM":snapshot.effectiveMode.toUpperCase();soloCamera.setAttribute("aria-label",walk?"First-person camera rotates from player eye origin":"Change drone camera");}
  for(const [id,value] of [["camFollow","follow"],["camFpv","fpv"],["camThird","third"]]){
    const button=$(id),active=snapshot.dronePreference===value;button.dataset.active=active?"1":"0";button.style.background=active?"#17694f":"rgba(17,29,43,.82)";button.style.borderColor=active?"#62d6aa":"rgba(255,255,255,.3)";
  }
}
function applyPlayerCameraMode({persistPreference=false}={}){
  const snapshot=playerCameraModePolicy.snapshot(),changed=cameraMode!==snapshot.effectiveMode;cameraMode=snapshot.effectiveMode;if(changed){externalCameraRig.invalidate();externalAirframeVisualRig.invalidate();cameraFrameMs=performance.now();}if(persistPreference)localStorage.setItem("arondight45CameraMode",snapshot.dronePreference);
  const viewport=$("viewport");viewport.dataset.cameraMode=cameraMode;viewport.dataset.droneCameraPreference=snapshot.dronePreference;viewport.dataset.playerCameraPolicy="walk-owned-eye-origin-v1";viewport.dataset.walkCameraBase=snapshot.playerMode==="foot"?"player-eye-origin-v1":"drone-preference-v1";renderCameraModeUi(snapshot);return snapshot;
}
function setCameraMode(next,{persist=true}={}){playerCameraModePolicy.setDronePreference(next);return applyPlayerCameraMode({persistPreference:persist});}
function setPlayerCameraMode(mode){playerCameraModePolicy.setPlayerMode(mode);return applyPlayerCameraMode();}
function updateCamera(pose,now=performance.now()){
  const position=pose.position,q=pose.quaternion,velocity=pose.velocity,dt=clamp((now-cameraFrameMs)/1000,0,.1);cameraFrameMs=now;
  const bodyForward=new THREE.Vector3(-1,0,0).applyQuaternion(q).normalize(),showFpvSelfCamera=cameraMode!=="fpv";
  if(physics.fpvCameraBody)physics.fpvCameraBody.visible=showFpvSelfCamera;if(physics.fpvCameraLens)physics.fpvCameraLens.visible=showFpvSelfCamera;const fpvViewport=$("viewport");if(fpvViewport)fpvViewport.dataset.fpvSelfCameraVisible=showFpvSelfCamera?"1":"0";
  if(cameraMode==="fpv"){
    externalCameraRig.invalidate();externalAirframeVisualRig.invalidate();
    const bodyUp=new THREE.Vector3(0,0,1).applyQuaternion(q).normalize();
    // FPV optics are rigidly mounted to the airframe. GAME right-stick pitch now
    // moves the physical body through the motors; there is no virtual camera axis.
    const fpvTiltRad=cameraSettings.fpvTiltDeg*Math.PI/180,c=Math.cos(fpvTiltRad),si=Math.sin(fpvTiltRad);
    const fpvForward=bodyForward.clone().multiplyScalar(c).addScaledVector(bodyUp,si).normalize();
    const fpvUp=bodyUp.clone().multiplyScalar(c).addScaledVector(bodyForward,-si).normalize();
    camera.position.copy(position).addScaledVector(bodyForward,FPV_CAMERA_FORWARD_OFFSET_M).addScaledVector(bodyUp,FPV_CAMERA_UP_OFFSET_M);
    camera.up.copy(fpvUp);camera.lookAt(cameraLookTarget.copy(camera.position).addScaledVector(fpvForward,4));
    if(camera.fov!==cameraSettings.fpvFovDeg){camera.fov=cameraSettings.fpvFovDeg;camera.updateProjectionMatrix();}
    applyFireCameraShake(dt);const viewport=$("viewport");viewport.dataset.cameraFov=String(camera.fov);viewport.dataset.cameraTiltDeg=String(cameraSettings.fpvTiltDeg);viewport.dataset.cameraDistanceM="0";viewport.dataset.cameraRigMode="rigid-airframe";viewport.dataset.cameraRigLagM="0.0000";viewport.dataset.cameraRigAnchor=[position.x,position.y,position.z].map(value=>value.toFixed(4)).join(",");viewport.dataset.fpvCameraMountForwardOffsetM=FPV_CAMERA_MOUNT_FORWARD_OFFSET_M.toFixed(3);viewport.dataset.fpvCameraForwardOffsetM=FPV_CAMERA_FORWARD_OFFSET_M.toFixed(3);viewport.dataset.fpvCameraOpticalClearanceM=FPV_CAMERA_OPTICAL_CLEARANCE_M.toFixed(3);viewport.dataset.fpvCameraUpOffsetM=FPV_CAMERA_UP_OFFSET_M.toFixed(3);
    return null;
  }
  const horizontal=bodyForward.clone();horizontal.z=0;
  if(horizontal.lengthSq()>.04)horizontal.normalize();else if(externalCameraRig.initialized)horizontal.set(...externalCameraRig.heading);else horizontal.set(-1,0,0);
  const rig=externalCameraRig.update({position:[position.x,position.y,position.z],velocity:[velocity.x,velocity.y,velocity.z],heading:[horizontal.x,horizontal.y,horizontal.z],mode:cameraMode,dt});
  const viewport=$("viewport"),lag=Math.hypot(position.x-rig.anchor[0],position.y-rig.anchor[1],position.z-rig.anchor[2]);viewport.dataset.cameraRigMode="stabilized-inertial-anchor";viewport.dataset.cameraRigLagM=lag.toFixed(4);viewport.dataset.cameraRigAnchor=rig.anchor.map(value=>value.toFixed(4)).join(",");
  if(cameraMode==="third"){
    const thirdBaseLength=Math.hypot(2.25,1.05),thirdBack=cameraSettings.thirdDistanceM*(2.25/thirdBaseLength),thirdUp=cameraSettings.thirdDistanceM*(1.05/thirdBaseLength),frame=externalCameraFrame(rig.anchor,rig.heading,{back:thirdBack,up:thirdUp,lookAhead:.55,lookUp:.18});
    camera.position.set(...frame.position);camera.up.set(0,0,1);camera.lookAt(cameraLookTarget.set(...frame.target));
    const thirdFov=clamp(62*(cameraSettings.fpvFovDeg/105),35,100);if(Math.abs(camera.fov-thirdFov)>.01){camera.fov=thirdFov;camera.updateProjectionMatrix();}
    applyFireCameraShake(dt);viewport.dataset.cameraFov=String(camera.fov);viewport.dataset.cameraTiltDeg="0";viewport.dataset.cameraDistanceM=String(camera.position.distanceTo(position));return rig;
  }
  const frame=externalCameraFrame(rig.anchor,rig.heading,{back:1.65,up:.78,lookAhead:.38,lookUp:.10});camera.position.set(...frame.position);camera.up.set(0,0,1);camera.lookAt(cameraLookTarget.set(...frame.target));
  const followFov=clamp(52*(cameraSettings.fpvFovDeg/105),30,90);if(Math.abs(camera.fov-followFov)>.01){camera.fov=followFov;camera.updateProjectionMatrix();}
  applyFireCameraShake(dt);viewport.dataset.cameraFov=String(camera.fov);return rig;
}
$("camFollow").onclick=()=>setCameraMode("follow");$("camFpv").onclick=()=>setCameraMode("fpv");$("camThird").onclick=()=>setCameraMode("third");applyPlayerCameraMode();

const soloHud=document.createElement("div");soloHud.id="soloHud";soloHud.hidden=true;
soloHud.innerHTML=`
  <div id="soloTopbar" data-toolbar-layout="actions-status-v1"><div id="soloTopbarActions" role="toolbar" aria-label="Simulator actions"><button id="soloExit" type="button">EXIT</button><button id="soloReset" type="button">RESET</button><button id="soloCamera" type="button">FOLLOW</button></div><div id="soloTopbarStatus" role="status" aria-label="Flight status"><span id="soloState">DISARMED</span><span id="soloAlt">AGL 0.0 m</span><span id="soloGamepadStatus" hidden>XBOX</span></div></div>
  <div id="soloRaceHud"><span id="soloLap">READY · 3 LAPS</span><strong id="soloRaceTime">00:00.000</strong><span id="soloGate">NEXT · START / FINISH</span><span id="soloBest">BEST —</span></div>
  <div id="soloLeft" class="solo-stick"><div class="solo-ring"></div><div class="solo-knob"></div><span>FWD / STRAFE</span></div>
  <div id="soloClearance"><small>ALT TARGET</small><strong id="soloClearanceValue">1.2 m</strong><div id="soloHeightPad" class="solo-height-pad" aria-label="Climb or descend altitude target"><span class="solo-height-up">CLIMB</span><div class="solo-height-track"></div><div id="soloHeightKnob" class="solo-height-knob"></div><span class="solo-height-hold">HOLD</span><span class="solo-height-down">DESCEND</span></div><span id="soloRangeStatus">AGL —</span></div>
  <div id="soloRight" class="solo-stick"><div class="solo-ring"></div><div class="solo-knob"></div><span>TURN / PITCH</span></div>
  <button id="soloArm" class="solo-action arm-start-cta" type="button">ARM</button>
  <button id="soloKill" class="solo-action" type="button">KILL</button>
  <div id="soloGamepadHelp" hidden>LS MOVE · RS TURN/PITCH · LT/RT ALT −/+ · LB+RS LOOK · RB FIRE · Y TARGET · A ARM · B KILL · X CAM</div>`;
$("viewport").appendChild(soloHud);
const soloStyle=document.createElement("style");soloStyle.textContent=`
  body.solo-flight{overflow:hidden!important;background:#000!important;-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important}
  body.solo-flight #viewport,body.solo-flight #viewport *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important}
  body.solo-flight dialog input,body.solo-flight dialog textarea{-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default!important}
  body.solo-flight .panel,body.solo-flight .telemetry{display:none!important}
  body.solo-flight #viewport{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;min-height:0!important;max-height:none!important;margin:0!important;z-index:50!important;overflow:hidden!important;transform:none!important;transform-origin:0 0!important;--solo-safe-top:env(safe-area-inset-top,0px);--solo-safe-right:env(safe-area-inset-right,0px);--solo-safe-bottom:env(safe-area-inset-bottom,0px);--solo-safe-left:env(safe-area-inset-left,0px)}
  html.android-stable-webgl body.solo-flight #viewport{height:100svh!important}
  body.solo-flight #cameraModes{top:max(8px,var(--solo-safe-top))!important;left:50%!important}
  #soloHud{position:absolute;inset:0;z-index:8;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;color:#fff;touch-action:none;user-select:none;-webkit-user-select:none}
  #soloHud[hidden]{display:none!important}
  #soloTopbar{position:absolute;top:max(8px,var(--solo-safe-top));left:max(8px,var(--solo-safe-left));right:max(8px,var(--solo-safe-right));display:flex;gap:8px;align-items:center;justify-content:flex-start;pointer-events:auto}
  #soloTopbar span,#soloTopbar button{border:1px solid #ffffff55;background:#112033cc;color:#fff;border-radius:9px;padding:7px 10px;font-weight:800;font-size:12px;backdrop-filter:blur(8px)}
  #soloTopbar #soloExit{background:#6b2330dd} #soloTopbar #soloReset{background:#9a5b18dd} #soloTopbar #soloCamera{margin-left:auto;background:#174f70dd}
  #soloTopbar #soloGamepadStatus{background:#17694fdd;border-color:#7ff0c5;color:#eafff7;white-space:nowrap}
  #soloRaceHud{position:absolute;top:max(52px,calc(var(--solo-safe-top) + 44px));left:50%;transform:translateX(-50%);display:grid;grid-template-columns:auto auto;gap:3px 12px;align-items:center;min-width:290px;padding:7px 12px;border:1px solid #ffffff55;border-radius:10px;background:#112033c7;backdrop-filter:blur(8px);box-shadow:0 5px 18px #0004;text-align:center;pointer-events:none}
  #soloRaceHud span{font-size:10px;font-weight:850;letter-spacing:.06em;white-space:nowrap} #soloRaceTime{font-size:19px;line-height:1;font-variant-numeric:tabular-nums;color:#fff}
  .solo-stick{position:absolute;width:min(34vw,230px);aspect-ratio:1;bottom:max(18px,var(--solo-safe-bottom));pointer-events:auto;touch-action:none;border-radius:50%}
  #soloLeft{left:max(16px,var(--solo-safe-left))} #soloRight{right:max(16px,var(--solo-safe-right))}
  .solo-ring{position:absolute;inset:0;border-radius:50%;border:2px solid #ffffff66;background:#0b18265c;box-shadow:inset 0 0 45px #0005,0 6px 22px #0005}
  .solo-knob{position:absolute;left:50%;top:50%;width:31%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:#f3f7ffcc;border:2px solid #fff;box-shadow:0 3px 14px #0008}
  .solo-stick span{position:absolute;left:50%;bottom:-18px;transform:translateX(-50%);font-size:10px;font-weight:800;letter-spacing:.08em;text-shadow:0 2px 5px #000;white-space:nowrap}
  #soloClearance{position:absolute;left:50%;bottom:max(96px,calc(var(--solo-safe-bottom) + 80px));transform:translateX(-50%);width:66px;height:176px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:8px 5px;border:1px solid #ffffff55;border-radius:13px;background:#0b1826c9;backdrop-filter:blur(8px);pointer-events:auto;box-shadow:0 6px 22px #0005}
  #soloClearance small{font-size:8px;font-weight:850;line-height:1.05;text-align:center;letter-spacing:.06em}#soloClearance strong{font:900 13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#6be4b0;white-space:nowrap}#soloClearance span{font-size:8px;font-weight:850;color:#ffd06d;white-space:nowrap}
  .solo-height-pad{position:relative;height:98px;width:50px;touch-action:none;border-radius:10px;background:linear-gradient(180deg,#174f70aa 0%,#102236bb 46%,#102236bb 54%,#70402aaa 100%);border:1px solid #ffffff33;overflow:hidden}.solo-height-track{position:absolute;left:50%;top:14px;bottom:14px;width:3px;transform:translateX(-50%);background:#ffffff35;border-radius:4px}.solo-height-knob{position:absolute;left:50%;top:50%;width:28px;height:20px;transform:translate(-50%,-50%);border-radius:999px;background:#effaff;border:2px solid #8fe8ff;box-shadow:0 2px 10px #0009;pointer-events:none}.solo-height-up,.solo-height-hold,.solo-height-down{position:absolute!important;left:50%!important;transform:translateX(-50%)!important;font:800 6px/1 system-ui,-apple-system,sans-serif!important;letter-spacing:.04em!important;color:#d9f4ff!important;pointer-events:none!important}.solo-height-up{top:4px!important}.solo-height-hold{top:50%!important;transform:translate(-50%,-50%)!important;color:#7ff0c5!important}.solo-height-down{bottom:4px!important;color:#ffc29b!important}
  .solo-action{position:absolute;bottom:max(34px,calc(var(--solo-safe-bottom) + 18px));pointer-events:auto;border-radius:999px!important;width:86px;height:52px;font-weight:900!important;color:#fff!important;border:2px solid #ffffff55!important;backdrop-filter:blur(8px)}
  body.solo-flight .solo-action:disabled{opacity:1!important;cursor:not-allowed;filter:saturate(.72)}
  @keyframes startSimPulse{0%,100%{box-shadow:0 0 0 0 #63e7b833,0 0 10px #32d89a44}50%{box-shadow:0 0 0 5px #63e7b822,0 0 26px #32d89a99}}
  @keyframes armStartPulse{0%,100%{box-shadow:0 0 0 0 #63e7b844,0 0 12px #32d89a55}50%{box-shadow:0 0 0 6px #63e7b822,0 0 30px #32d89aaa}}
  #camSolo.start-sim-cta{background:#17694f!important;border-color:#63e7b8!important;color:#fff!important;animation:startSimPulse 1.55s ease-in-out infinite;transition:filter .14s ease,background .14s ease,border-color .14s ease,box-shadow .14s ease}
  #camSolo.start-sim-cta:hover,#camSolo.start-sim-cta:focus-visible{background:#218865!important;border-color:#b2ffe3!important;filter:brightness(1.14);box-shadow:0 0 0 4px #63e7b833,0 0 32px #32d89acc!important;outline:none}
  #soloArm{left:50%;transform:translateX(-105%);background:#17694fdd!important;transition:filter .14s ease,background .14s ease,border-color .14s ease,box-shadow .14s ease}
  body.solo-flight #soloArm.arm-start-cta.attention:not(:disabled){animation:armStartPulse 1.3s ease-in-out infinite;border-color:#7ff0c5!important}
  body.solo-flight #soloArm:not(:disabled):hover,body.solo-flight #soloArm:not(:disabled):focus-visible{background:#218865!important;border-color:#c2ffea!important;filter:brightness(1.16);box-shadow:0 0 0 4px #63e7b833,0 0 32px #32d89acc!important;outline:none}
  body.solo-flight #soloArm.arming,body.solo-flight #soloArm.armed{animation:none!important}
  #soloKill{left:50%;transform:translateX(5%);background:#8b2436e6!important}
  #soloGamepadHelp{position:absolute;left:50%;bottom:max(10px,var(--solo-safe-bottom));transform:translateX(-50%);max-width:94%;padding:6px 10px;border:1px solid #70ddff66;border-radius:999px;background:#071522dd;color:#dff7ff;font:800 9px/1.1 system-ui,-apple-system,sans-serif;letter-spacing:.04em;white-space:nowrap;pointer-events:none}
  body.solo-flight #viewport[data-gamepad-enabled="1"] .solo-stick,body.solo-flight #viewport[data-gamepad-enabled="1"] #soloClearance,body.solo-flight #viewport[data-gamepad-enabled="1"] .solo-action,body.solo-flight #viewport[data-control-source="xbox"] .solo-stick,body.solo-flight #viewport[data-control-source="xbox"] #soloClearance,body.solo-flight #viewport[data-control-source="xbox"] .solo-action{display:none!important}
  /* iOS ignores Screen Orientation lock in normal browser tabs. Rotate the complete
     simulator as a deterministic fallback so the flight UI is always landscape. */
  @media(orientation:portrait){
    body.solo-flight #viewport{inset:0 auto auto 100vw!important;width:100dvh!important;height:100vw!important;transform:rotate(90deg)!important;--solo-safe-top:env(safe-area-inset-right,0px);--solo-safe-right:env(safe-area-inset-bottom,0px);--solo-safe-bottom:env(safe-area-inset-left,0px);--solo-safe-left:env(safe-area-inset-top,0px)}
    html.android-stable-webgl body.solo-flight #viewport{width:100svh!important;height:100vw!important}
    body.solo-flight dialog[open]{transform:rotate(90deg);transform-origin:50% 50%}
  }
  @media(max-height:430px){.solo-stick{width:min(30vw,180px)}.solo-action{width:76px;height:46px}}
`;
document.head.appendChild(soloStyle);

let soloMode=false,soloPreviousInputSource="remote",phoneSettings=loadPhoneControlSettings();
let soloGroundClearance=phoneSettings.defaultHoverAgl;
function neutralSoloControls(){return{...neutralControls(),gameMode:true,groundClearance:soloGroundClearance};}
let soloControls=neutralSoloControls();
const soloHeightPad=$("soloHeightPad"),soloHeightKnob=$("soloHeightKnob"),soloClearanceValue=$("soloClearanceValue"),soloRangeStatus=$("soloRangeStatus");
let soloHeightAxis=0,soloHeightPointer=null;
function renderSoloHeightControl(){
  soloHeightKnob.style.top=`${50-soloHeightAxis*38}%`;soloClearanceValue.textContent=`${soloGroundClearance.toFixed(1)} m`;
  const rate=clearanceRateMps(soloHeightAxis);soloHeightPad.dataset.rateMps=rate.toFixed(2);$("soloClearance").dataset.targetAglM=soloGroundClearance.toFixed(2);
}
function setSoloHeightAxis(value){soloHeightAxis=clamp(Number(value)||0,-1,1);renderSoloHeightControl();}
function applySoloHeightPointer(event){const r=soloHeightPad.getBoundingClientRect(),rotated=$("viewport").dataset.soloOrientation==="css-landscape";const center=rotated?r.left+r.width/2:r.top+r.height/2,span=Math.max(1,(rotated?r.width:r.height)*.40),position=rotated?event.clientX:event.clientY;setSoloHeightAxis((rotated?position-center:center-position)/span);event.preventDefault();}
soloHeightPad.addEventListener("pointerdown",event=>{if(soloHeightPointer!==null)return;soloHeightPointer=event.pointerId;soloHeightPad.setPointerCapture?.(soloHeightPointer);applySoloHeightPointer(event);});
soloHeightPad.addEventListener("pointermove",event=>{if(event.pointerId===soloHeightPointer)applySoloHeightPointer(event);});
const releaseSoloHeight=event=>{if(soloHeightPointer===null||(event?.pointerId!=null&&event.pointerId!==soloHeightPointer))return;const released=soloHeightPointer;soloHeightPointer=null;setSoloHeightAxis(0);try{soloHeightPad.releasePointerCapture?.(released);}catch{}event?.preventDefault();};
soloHeightPad.addEventListener("pointerup",releaseSoloHeight);soloHeightPad.addEventListener("pointercancel",releaseSoloHeight);soloHeightPad.addEventListener("lostpointercapture",releaseSoloHeight);
function lockSoloHeightForFoot(){if(globalThis.__arondightOnFootMode!==true)return false;if(soloHeightPointer!==null)releaseSoloHeight();else if(Math.abs(soloHeightAxis)>1e-6)setSoloHeightAxis(0);soloControls.groundClearance=soloGroundClearance;const viewport=$("viewport");if(viewport){viewport.dataset.gamepadHeightAxis="0.000";viewport.dataset.fpsAltitudeLock="eye-fixed-v1";}return true;}
setPlayerCameraMode(globalThis.__arondightOnFootMode===true?"foot":"drone");
addEventListener("arondight:player-mode",event=>{const mode=event.detail?.mode;if(mode==="foot"){lockSoloHeightForFoot();neutralizeSoloMotion();}setPlayerCameraMode(mode);});
function updateSoloSticks(){
  const left=gameKnobAxes(soloControls,"left",phoneSettings);
  const right=gameKnobAxes(soloControls,"right",phoneSettings);
  for(const [id,axes] of [["soloLeft",left],["soloRight",right]]){const knob=$(id).querySelector(".solo-knob");knob.style.left=`${knobPercent(axes.x)}%`;knob.style.top=`${knobPercent(axes.y)}%`;}
  renderSoloHeightControl();
}
function soloStick(el,kind){
  let pointer=null;
  const apply=e=>{const point=normalizedPointer(el,e);applyGameStick(soloControls,kind,point,phoneSettings);updateSoloSticks();e.preventDefault();};
  el.addEventListener("pointerdown",e=>{pointer=e.pointerId;el.setPointerCapture(pointer);apply(e);});
  el.addEventListener("pointermove",e=>{if(e.pointerId===pointer)apply(e);});
  const release=e=>{if(e.pointerId!==pointer)return;endPointerDrag(el,e.pointerId);pointer=null;if(kind==="left"){soloControls.roll=0;soloControls.pitch=0;soloControls.throttle=0;}else{soloControls.yaw=0;soloControls.bodyPitch=0;}updateSoloSticks();e.preventDefault();};
  el.addEventListener("pointerup",release);el.addEventListener("pointercancel",release);
}
soloStick($("soloLeft"),"left");soloStick($("soloRight"),"right");updateSoloSticks();
const soloSettingsMount=mountPlayerControlSettings({
  parent:$("soloTopbarActions"),
  buttonText:"SETTINGS",
  xboxControllerToggle:true,
  getActiveControlProfile:()=>globalThis.__arondightOnFootMode===true?"first-person":"drone",
  debugGrid:{get:()=>debugGridEnabled,set:setDebugGridEnabled,defaultValue:false},
  box3dColliderDebug:{get:()=>box3dColliderDebugEnabled,set:setBox3dColliderDebugEnabled,defaultValue:false},
  onChange:next=>{const xboxChanged=phoneSettings.xboxControllerEnabled!==next.xboxControllerEnabled;phoneSettings=next;const keepArm=soloControls.arm;if(!keepArm)soloGroundClearance=next.defaultHoverAgl;setSoloHeightAxis(0);soloControls=neutralSoloControls();soloControls.arm=keepArm;updateSoloSticks();arm=keepArm;throttle=0;if(xboxChanged)setXboxControlPreference(next.xboxControllerEnabled);},
});
mountCameraSettings({dialog:soloSettingsMount.dialog,onChange:applyCameraSettings});
const flightLogbook=new FlightLogbook({parent:$("soloTopbarActions")});globalThis.__arondightFlightLogbook=flightLogbook;
let latest={motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0};
const flightFireFx=installFlightFireFx({viewport:$("viewport"),scene,camera,worldBridge:globalThis.__arondightRealWorld,isEnabled:()=>soloMode&&globalThis.__arondightOnFootMode!==true,isArmed:()=>Boolean(latest.state&STATE_ARMED),isPointerEnabled:()=>$("viewport").dataset.controlSource!=="xbox",onRecoil:addFireCameraKick});
const flightSelectionBlocked=target=>target instanceof Element&&Boolean(target.closest("dialog,input,textarea,select,option"));for(const type of ["selectstart","contextmenu","dragstart"])document.addEventListener(type,event=>{if(soloMode&&event.target instanceof Element&&event.target.closest("#viewport")&&!flightSelectionBlocked(event.target))event.preventDefault();},{passive:false});
let pendingDisarmReason=null;
let xboxGamepadActive=false,xboxPrevious=null,xboxLastPollMs=performance.now(),xboxObservedGamepad=null;
function rememberXboxGamepad(gamepad){
  if(!isXboxCompatibleGamepad(gamepad))return false;
  xboxObservedGamepad=gamepad;const viewport=$("viewport");if(viewport){viewport.dataset.gamepadExposed="1";viewport.dataset.gamepadObservedId=String(gamepad.id||"Xbox controller");}return true;
}
function currentXboxGamepad(){
  let pad=null;try{pad=findXboxGamepad(navigator.getGamepads?.());}catch{}
  if(pad){rememberXboxGamepad(pad);return pad;}
  return isXboxCompatibleGamepad(xboxObservedGamepad)?xboxObservedGamepad:null;
}
function neutralizeSoloMotion(){const keepArm=soloControls.arm;soloControls=neutralSoloControls();soloControls.arm=keepArm;setSoloHeightAxis(0);updateSoloSticks();}
function toggleSoloArm(){if(soloControls.arm){soloControls.arm=false;return;}if((latest.state&STATE_NAVIGATION_VALID)&&sharedArmReady(currentFcStateText(),soloControls,true,phoneSettings))soloControls.arm=true;}
function killSolo(){pendingDisarmReason="KILL_SWITCH";setSoloHeightAxis(0);soloControls=neutralSoloControls();updateSoloSticks();arm=false;throttle=0;}
function cycleSoloCamera(){if(playerCameraModePolicy.playerMode==="foot")return;playerCameraModePolicy.cycleDronePreference();applyPlayerCameraMode({persistPreference:true});}
function deactivateXboxGamepad(keepXboxMode=false){
  const viewport=$("viewport"),source=keepXboxMode?"xbox":"touch";if(!xboxGamepadActive&&viewport.dataset.controlSource===source&&viewport.dataset.gamepadConnected==="0")return;if(xboxGamepadActive)neutralizeSoloMotion();xboxGamepadActive=false;xboxPrevious=null;flightFireFx?.setGamepadFire(false);flightFireFx?.setGamepadAim(false);globalThis.__arondightRealWorld?.setGamepadLook?.(false);viewport.dataset.controlSource=source;viewport.dataset.gamepadConnected="0";viewport.dataset.gamepadAim="0";viewport.dataset.gamepadFire="0";viewport.dataset.gamepadHeightAxis="0.000";delete viewport.dataset.gamepadId;$("soloGamepadStatus").hidden=true;$("soloGamepadHelp").hidden=true;
}
function setXboxControlPreference(enabled){
  const xboxEnabled=enabled===true,viewport=$("viewport");viewport.dataset.gamepadEnabled=xboxEnabled?"1":"0";neutralizeSoloMotion();deactivateXboxGamepad(xboxEnabled&&soloMode);if(soloMode)queueMicrotask(()=>pollXboxGamepad(performance.now()));
}
function pollXboxGamepad(now){
  const viewport=$("viewport"),enabled=phoneSettings.xboxControllerEnabled===true,status=$("soloGamepadStatus"),help=$("soloGamepadHelp");viewport.dataset.gamepadEnabled=enabled?"1":"0";
  if(!soloMode){deactivateXboxGamepad(false);return;}
  const pad=currentXboxGamepad();
  if(!enabled){deactivateXboxGamepad(false);if(pad){viewport.dataset.gamepadExposed="1";status.hidden=false;status.textContent="XBOX DETECTED · ENABLE IN SETTINGS";help.hidden=true;}return;}
  if(globalThis.__arondightOnFootMode===true){lockSoloHeightForFoot();flightFireFx?.setGamepadFire(false);flightFireFx?.setGamepadAim(false);globalThis.__arondightRealWorld?.setGamepadLook?.(false);viewport.dataset.controlSource="xbox";viewport.dataset.gamepadConnected=pad?"1":"0";viewport.dataset.gamepadAim="0";viewport.dataset.gamepadFire="0";viewport.dataset.gamepadHeightAxis="0.000";status.hidden=false;status.textContent=pad?"XBOX · WALK":"XBOX CONNECTING…";help.hidden=!pad;if(pad)help.textContent="LS MOVE · RS LOOK UP/DOWN/LEFT/RIGHT · RT FIRE · Y DRONE";xboxPrevious=null;return;}
  const sample=sampleXboxGamepad(pad);if(!sample){deactivateXboxGamepad(true);status.hidden=false;status.textContent=xboxObservedGamepad?"XBOX CONNECTING…":"XBOX ON · PRESS ANY BUTTON";help.hidden=true;return;}
  const justActivated=!xboxGamepadActive,dt=justActivated?0:clamp((now-xboxLastPollMs)/1000,0,.05);xboxLastPollMs=now;xboxGamepadActive=true;viewport.dataset.controlSource="xbox";viewport.dataset.gamepadConnected="1";viewport.dataset.gamepadExposed="1";viewport.dataset.gamepadId=sample.id;status.hidden=false;help.hidden=false;
  applyGameStick(soloControls,"left",sample.left,phoneSettings);if(sample.aim){soloControls.yaw=0;soloControls.bodyPitch=0;}else applyGameStick(soloControls,"right",sample.right,phoneSettings);soloHeightAxis=clamp(sample.heightAxis,-1,1);globalThis.__arondightRealWorld?.setGamepadLook?.(sample.aim,sample.right.x,sample.right.y,dt);
  flightFireFx?.setGamepadAim(sample.aim);flightFireFx?.setGamepadFire(sample.fire);viewport.dataset.gamepadAim=sample.aim?"1":"0";viewport.dataset.gamepadFire=sample.fire?"1":"0";viewport.dataset.gamepadHeightAxis=sample.heightAxis.toFixed(3);viewport.dataset.gamepadLeft=`${sample.left.x.toFixed(3)},${sample.left.y.toFixed(3)}`;viewport.dataset.gamepadRight=`${sample.right.x.toFixed(3)},${sample.right.y.toFixed(3)}`;const statusText=sample.aim?"XBOX · AIM":`XBOX · ALT ${soloGroundClearance.toFixed(1)} m`;if($("soloGamepadStatus").textContent!==statusText)$("soloGamepadStatus").textContent=statusText;
  if(!justActivated&&sample.arm&&!xboxPrevious?.arm)toggleSoloArm();if(!justActivated&&sample.kill&&!xboxPrevious?.kill)killSolo();if(!justActivated&&sample.camera&&!xboxPrevious?.camera)cycleSoloCamera();if(!justActivated&&sample.target&&!xboxPrevious?.target&&globalThis.__arondightRealWorld?.vsConnected){const rect=viewport.getBoundingClientRect();viewport.dispatchEvent(new CustomEvent("flightfiredoubletap",{detail:{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,pointerType:"gamepad"}}));viewport.dataset.gamepadBeaconCount=String((Number(viewport.dataset.gamepadBeaconCount)||0)+1);}xboxPrevious={arm:sample.arm,kill:sample.kill,camera:sample.camera,target:sample.target};
}
addEventListener("gamepadconnected",event=>{if(rememberXboxGamepad(event.gamepad)&&soloMode)pollXboxGamepad(performance.now());});
addEventListener("gamepaddisconnected",event=>{if(xboxObservedGamepad&&Number(xboxObservedGamepad.index)===Number(event.gamepad?.index))xboxObservedGamepad=null;if(soloMode)pollXboxGamepad(performance.now());});
addEventListener("focus",()=>{if(soloMode)pollXboxGamepad(performance.now());});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&soloMode)pollXboxGamepad(performance.now());});
globalThis.setInterval(()=>{if(soloMode)pollXboxGamepad(performance.now());},16);$("viewport").dataset.gamepadPollLoop="dedicated-60hz-v1";
async function enterSolo(){
  soloMode=true;resetPresentationTiming();soloPreviousInputSource=inputSource;phoneSettings=loadPhoneControlSettings();soloGroundClearance=phoneSettings.defaultHoverAgl;setSoloHeightAxis(0);soloControls=neutralSoloControls();updateSoloSticks();raceTrack.reset();raceTrack.setVisible(true);document.body.classList.add("solo-flight");soloHud.hidden=false;setXboxControlPreference(phoneSettings.xboxControllerEnabled);inputSource="local";ui.inputSource.value="local";localArm=false;arm=false;localThrottle=0;updateRemoteUI();resize();
  try{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:"hide"});}catch{}
  try{await screen.orientation?.lock?.("landscape");}catch{}
  resize();
  if(mode==="sim"&&backend&&!running)startRun();
}
async function exitSolo(){
  pendingDisarmReason="SOLO_EXIT";deactivateXboxGamepad();setSoloHeightAxis(0);soloControls=neutralSoloControls();updateSoloSticks();localArm=false;arm=false;localThrottle=0;inputSource=soloPreviousInputSource;ui.inputSource.value=inputSource;soloMode=false;soloHud.hidden=true;raceTrack.setVisible(false);document.body.classList.remove("solo-flight");try{screen.orientation?.unlock?.();}catch{}try{if(document.fullscreenElement)await document.exitFullscreen();}catch{}updateRemoteUI();resize();
}
$("camSolo").onclick=enterSolo;$("soloExit").onclick=exitSolo;
function resetSoloSimulation(){flightLogbook.finish("SIM_RESET");const restart=mode==="sim"&&Boolean(backend);stopRun();remoteAutoStarted=false;resetSimulation(mode==="replay"&&realLog.length?realLog[0]:null);if(restart)startRun();}
$("soloReset").onclick=resetSoloSimulation;
$("soloArm").onclick=toggleSoloArm;
$("soloKill").onclick=killSolo;
$("soloCamera").onclick=cycleSoloCamera;
document.addEventListener("fullscreenchange",()=>{if(!soloMode)return;const viewport=$("viewport");if(viewport)viewport.dataset.soloFullscreen=document.fullscreenElement?"1":"0";resize();});
let mode="sim",backend=null,running=false,runEpoch=0,sequence=1,simTime=0,resetFlag=true;
let wallStart=performance.now(),simStart=0,replayIndex=0;
const keys=new Set();let localArm=false,localThrottle=0,arm=false,throttle=0,realLog=[],sessionLog=[],physicsValidationReport=null;let inputSource="remote",effectiveInput=neutralControls(),lastRemoteTelemetry=0,remoteAutoStarted=false;const remoteLink=new ViewPeerLink();const offerScanner=new QrScanner(ui.offerVideo,ui.offerCanvas);

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
  if(typeof flightLogbook!=="undefined")flightLogbook.finish("SIM_RESET");
  phoneSettings=loadPhoneControlSettings();soloGroundClearance=phoneSettings.defaultHoverAgl;setSoloHeightAxis(0);
  externalCameraRig.invalidate();externalAirframeVisualRig.invalidate();cameraFrameMs=performance.now();physics.reset(defaultParams(),initial);navigationSensors.reset();sbusReceiver.reset();latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false,headingDeg:0,headingValid:false};raceTrack.reset();sequence=1;simTime=0;resetFlag=true;latest={motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0};soloControls=neutralSoloControls();updateSoloSticks();localThrottle=throttle=0;localArm=arm=false;effectiveInput=neutralControls();replayIndex=0;sessionLog=[];
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
  if(globalThis.__arondightOnFootMode===true)lockSoloHeightForFoot();else if(soloMode&&Math.abs(soloHeightAxis)>1e-4){const next=stepGroundClearanceTarget(soloGroundClearance,soloHeightAxis,.01);soloGroundClearance=next;soloControls.groundClearance=next;}
  const c=activeControlState(),channels=new Array(16).fill(992);
  channels[0]=Math.round(992+820*clamp(c.roll||0,-1,1));channels[1]=Math.round(992+820*clamp(c.pitch||0,-1,1));channels[3]=Math.round(992+820*clamp(c.yaw||0,-1,1));channels[4]=c.arm?1811:172;
  if(c.gameMode){channels[2]=172;const clearance=clamp(Number(c.groundClearance)||2,MIN_GAME_CLEARANCE_M,MAX_GAME_CLEARANCE_M),normalized=(clearance-MIN_GAME_CLEARANCE_M)/(MAX_GAME_CLEARANCE_M-MIN_GAME_CLEARANCE_M);channels[5]=Math.round(172+1639*normalized);channels[6]=1811;channels[7]=Math.round(992+820*clamp(c.bodyPitch||0,-1,1));}else channels[2]=Math.round(172+1639*clamp(c.throttle||0,0,1));
  return encodeSbus(channels);
}
let latestControllerRttMs=0;
function prepareControllerStep(){
  const seq=sequence++,navigationFrame=navigationSensors.sampleFrame(physics,DT),sbusFrame=sbusReceiver.sample(controls,DT);
  latestNavigation=navigationSensors.last;
  let flags=(physics.p.imuValid?FLAG_IMU_PRESENT:0)|(resetFlag?FLAG_RESET:0);if(sbusFrame)flags|=FLAG_SBUS_PRESENT;if(navigationFrame)flags|=FLAG_NAVIGATION_PRESENT;
  const packet=makeInput(seq,physics.imuRaw(DT),sbusFrame,flags,1000,navigationFrame,0);resetFlag=false;return{seq,packet};
}
function controllerStepSync(){
  const {seq,packet}=prepareControllerStep();
  if((seq%20)===0){const started=performance.now(),out=backend.exchangeSync(packet);latestControllerRttMs=performance.now()-started;return out;}
  return backend.exchangeSync(packet);
}
async function controllerStep(){
  const {seq,packet}=prepareControllerStep(),started=performance.now(),out=await backend.exchange(packet,seq);latestControllerRttMs=performance.now()-started;return out;
}
function recordSession(){
  const state=physics.state(),fault=latest.state>>8&255,armed=Boolean(latest.state&STATE_ARMED),remoteFresh=inputSource!=="remote"||Boolean(remoteLink.current());
  sessionLog.push({time_s:simTime,motor1_us:latest.motors[0],motor2_us:latest.motors[1],motor3_us:latest.motors[2],motor4_us:latest.motors[3],x:state.x,y:state.y,z:state.z,vx:state.vx,vy:state.vy,vz:state.vz,roll_deg:state.attitude[0],pitch_deg:state.attitude[1],yaw_deg:state.attitude[2],fc_roll_deg:latest.attitude[0],fc_pitch_deg:latest.attitude[1],fc_yaw_deg:latest.attitude[2],battery_v:state.battery_v,current_a:state.current_a,fc_state:latest.state,navigation_valid:latestNavigation.valid,nav_velocity_valid:latestNavigation.velocityValid,nav_agl_valid:latestNavigation.aglValid,nav_heading_valid:latestNavigation.headingValid});
  const disarmReason=pendingDisarmReason||(fault?`FC_FAULT_${fault}`:!remoteFresh?"CONTROL_LINK_LOSS":!arm?"ARM_COMMAND_LOW":"FC_DISARM");
  flightLogbook.observe({simTime,armed,disarmReason,x:state.x,y:state.y,z:state.z,vx:state.vx,vy:state.vy,vz:state.vz,yawDeg:latest.attitude[2],speed:state.speed,agl:latestNavigation.agl,aglValid:latestNavigation.aglValid,batteryV:state.battery_v,worldMode:globalThis.__arondightRealWorld?.active?"real":"training",worldOrigin:globalThis.__arondightRealWorld?.active?{latitude:globalThis.__arondightRealWorld.originLat,longitude:globalThis.__arondightRealWorld.originLon}:null});
  if(!armed)pendingDisarmReason=null;
}
let simulationBacklogMs=0;
async function loop(epoch){
  let schedulerWallMs=performance.now(),accumulatorMs=0,auxAccumulatorS=0;
  while(running&&epoch===runEpoch){
    if(mode==="replay"){simulationBacklogMs=0;await replayStep();schedulerWallMs=performance.now();continue;}
    const now=performance.now(),elapsedMs=Math.max(0,now-schedulerWallMs);schedulerWallMs=now;
    const pendingMs=accumulatorMs+elapsedMs;
    if(pendingMs>SIM_MAX_BACKLOG_MS)simulationTimingDiscontinuityMs+=pendingMs-SIM_MAX_BACKLOG_MS;
    accumulatorMs=Math.min(pendingMs,SIM_MAX_BACKLOG_MS);simulationBacklogMs=accumulatorMs;
    if(accumulatorMs<SIM_FIXED_STEP_MS){await waitForSimulationDeadline(accumulatorMs);continue;}
    const sliceStart=performance.now(),due=Math.min(Math.floor(accumulatorMs/SIM_FIXED_STEP_MS),SIM_MAX_STEPS_PER_SLICE),wasmFastPath=mode==="sim"&&backend instanceof WasmBackend;
    for(let i=0;i<due&&running&&epoch===runEpoch;i++){
      latest=wasmFastPath?controllerStepSync():await controllerStep();physics.step(latest.motors,DT);simTime+=DT;auxAccumulatorS+=DT;accumulatorMs-=SIM_FIXED_STEP_MS;
      if(auxAccumulatorS+1e-12>=SIM_AUX_INTERVAL_S){auxAccumulatorS-=SIM_AUX_INTERVAL_S;raceTrack.update(physics.position(),simTime,Boolean(latest.state&STATE_ARMED));recordSession();}
      if(performance.now()-sliceStart>=SIM_WORK_SLICE_MS)break;
    }
    const afterWork=performance.now(),workElapsedMs=Math.max(0,afterWork-schedulerWallMs);schedulerWallMs=afterWork;
    const afterWorkPendingMs=accumulatorMs+workElapsedMs;
    if(afterWorkPendingMs>SIM_MAX_BACKLOG_MS)simulationTimingDiscontinuityMs+=afterWorkPendingMs-SIM_MAX_BACKLOG_MS;
    accumulatorMs=Math.min(afterWorkPendingMs,SIM_MAX_BACKLOG_MS);simulationBacklogMs=accumulatorMs;
    if(accumulatorMs>=SIM_FIXED_STEP_MS)await yieldToBrowser();else await waitForSimulationDeadline(accumulatorMs);
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
let lastPresentationHudMs=-Infinity,lastPresentationAudioMs=-Infinity,lastPresentationDrawMs=-Infinity,lastPresentationShadowMs=-Infinity,presentationDraws=0,lastPresentationQualityWallMs=performance.now(),lastPresentationQualitySimS=simTime,presentationQualityGoodWindows=0;
let simulationTimingDiscontinuityMs=0;
const PRESENTATION_TIMING_WINDOW=180,presentationFrameIntervalsMs=new Float64Array(PRESENTATION_TIMING_WINDOW);
let presentationFrameIntervalIndex=0,presentationFrameIntervalCount=0;
function recordPresentationFrame(now){
  if(Number.isFinite(lastPresentationDrawMs)){
    presentationFrameIntervalsMs[presentationFrameIntervalIndex]=Math.max(0,now-lastPresentationDrawMs);
    presentationFrameIntervalIndex=(presentationFrameIntervalIndex+1)%PRESENTATION_TIMING_WINDOW;
    presentationFrameIntervalCount=Math.min(PRESENTATION_TIMING_WINDOW,presentationFrameIntervalCount+1);
  }
}
function presentationTimingSnapshot(){
  const values=Array.from(presentationFrameIntervalsMs.slice(0,presentationFrameIntervalCount)).sort((a,b)=>a-b);
  const percentile=p=>values.length?values[Math.min(values.length-1,Math.floor((values.length-1)*p))]:0;
  return Object.freeze({samples:values.length,p50Ms:percentile(.50),p95Ms:percentile(.95),maxMs:values.at(-1)||0});
}
function resetPresentationTiming(){presentationFrameIntervalIndex=0;presentationFrameIntervalCount=0;presentationFrameIntervalsMs.fill(0);lastPresentationDrawMs=-Infinity;}
const simulatorDiagnostics={};
Object.defineProperties(simulatorDiagnostics,{
  simTime:{get:()=>simTime,enumerable:true},
  simulationBacklogMs:{get:()=>simulationBacklogMs,enumerable:true},
  presentationDraws:{get:()=>presentationDraws,enumerable:true},
  presentationPixelRatio:{get:()=>presentationPixelRatio,enumerable:true},
  presentationSoftwareRaster:{get:()=>presentationSoftwareRaster,enumerable:true},
  presentationStableBackbuffer:{get:()=>presentationStableBackbuffer,enumerable:true},
  presentationBackbufferResizes:{get:()=>presentationBackbufferResizes,enumerable:true},
  presentationRenderPlatform:{get:()=>presentationRenderProfile.android?"android-stable":"standard",enumerable:true},
  presentationTiming:{get:()=>presentationTimingSnapshot(),enumerable:true},
  simulationTimingDiscontinuityMs:{get:()=>simulationTimingDiscontinuityMs,enumerable:true},
  physicsValidation:{get:()=>physicsValidationReport,enumerable:true},
  worldBuildingCollisionFootprints:{get:()=>physics.worldBuildingCollisionSnapshot.footprintCount,enumerable:true},
  worldBuildingCollisionPrisms:{get:()=>physics.worldBuildingCollisionState?.shapeCount||0,enumerable:true},
  worldBuildingCollisionRevision:{get:()=>physics.worldBuildingCollisionRevision,enumerable:true},
  box3dColliderDebugEnabled:{get:()=>box3dColliderDebugEnabled,enumerable:true},
  box3dColliderDebugPrisms:{get:()=>box3dColliderDebugEnabled?box3dColliderDebugDraw.activePrismCount:0,enumerable:true},
  fcState:{get:()=>latest.state,enumerable:true},
  runEpoch:{get:()=>runEpoch,enumerable:true},
});
Object.freeze(simulatorDiagnostics);
Object.defineProperty(globalThis,"__arondightDiagnostics",{value:simulatorDiagnostics,writable:false,configurable:false});
function updatePresentationQuality(now){
  const worldActive=$("viewport")?.dataset.worldMode==="real";
  if(!running||mode!=="sim"||worldActive||presentationStableBackbuffer){lastPresentationQualityWallMs=now;lastPresentationQualitySimS=simTime;presentationQualityGoodWindows=0;const viewport=$("viewport");if(viewport){viewport.dataset.presentationPixelRatio=presentationPixelRatio.toFixed(2);if(presentationStableBackbuffer)viewport.dataset.presentationQualityMode="fixed-backbuffer";}return;}
  const elapsedMs=now-lastPresentationQualityWallMs;if(elapsedMs<PRESENTATION_QUALITY_WINDOW_MS)return;
  const simElapsedS=simTime-lastPresentationQualitySimS,cadence=simElapsedS/Math.max(.001,elapsedMs/1000);
  lastPresentationQualityWallMs=now;lastPresentationQualitySimS=simTime;
  let target=presentationPixelRatio;
  if(cadence<PRESENTATION_CADENCE_CRITICAL){target=Math.min(presentationQualityCeiling,PRESENTATION_PIXEL_RATIO_MIN);presentationQualityGoodWindows=0;}
  else if(cadence<PRESENTATION_CADENCE_CONSTRAINED){target=Math.min(presentationQualityCeiling,.80);presentationQualityGoodWindows=0;}
  else if(cadence>PRESENTATION_CADENCE_RECOVER&&presentationPixelRatio<presentationQualityCeiling){
    if(++presentationQualityGoodWindows>=PRESENTATION_RECOVERY_WINDOWS){target=Math.min(presentationQualityCeiling,presentationPixelRatio+.20);presentationQualityGoodWindows=0;}
  }else presentationQualityGoodWindows=0;
  if(Math.abs(target-presentationPixelRatio)>.01){presentationPixelRatio=target;renderer.setPixelRatio(presentationPixelRatio);resize();}
  const viewport=$("viewport");if(viewport){viewport.dataset.presentationPixelRatio=presentationPixelRatio.toFixed(2);viewport.dataset.presentationCadence=cadence.toFixed(3);}
}
function render(){
  requestAnimationFrame(render);
  const renderNow=performance.now(),fcState=latest.state;updatePresentationQuality(renderNow);
  motorSound.syncFcState(fcState,arm);
  if(renderNow-lastPresentationAudioMs>=PRESENTATION_AUDIO_INTERVAL_MS){
    lastPresentationAudioMs=renderNow;
    motorSound.update(physics,camera.position);
  }
  if(renderNow-lastPresentationHudMs>=PRESENTATION_HUD_INTERVAL_MS){
    lastPresentationHudMs=renderNow;
    const state=physics.state();
  const fault=fcState>>8&255,stateText=currentFcStateText(),fireViewport=$("viewport");fireViewport.dataset.fcArmed=fcState&STATE_ARMED?"1":"0";flightFireFx?.syncLockState?.();ui.fcState.textContent=stateText;ui.fcState.className=fcState&STATE_FAULT?"bad":fcState&STATE_ARMED?"good":"warn";
  ui.simTime.textContent=simTime.toFixed(3)+" s";ui.altitude.textContent=Math.max(0,state.z).toFixed(3)+" m";ui.velocity.textContent=state.speed.toFixed(3)+" m/s";ui.attitude.textContent=latest.attitude.map(x=>x.toFixed(1)).join(" / ")+"°";ui.motors.textContent=latest.motors.map(x=>Math.round(x)).join(" ");ui.rpm.textContent=physics.motorOmega.map(w=>Math.round(w*60/(2*Math.PI))).join(" ");ui.battery.textContent=physics.batteryVoltage.toFixed(2)+" V";ui.current.textContent=physics.batteryCurrent.toFixed(1)+" A";ui.processing.textContent=latest.processingUs+" μs";ui.rtt.textContent=latestControllerRttMs.toFixed(2)+" ms";ui.armSwitch.textContent=arm?"ON":"OFF";ui.throttle.textContent=(throttle*100).toFixed(1)+"%";
  const now=renderNow;if(now-lastRemoteTelemetry>=100){lastRemoteTelemetry=now;remoteLink.sendTelemetry({fc_state:stateText,mode,sim_time:simTime,altitude:Math.max(0,state.z),agl_m:latestNavigation.agl,nav_vx_mps:latestNavigation.vx,nav_vy_mps:latestNavigation.vy,nav_vz_mps:latestNavigation.vz,roll_deg:latest.attitude[0],pitch_deg:latest.attitude[1],yaw_deg:latest.attitude[2],speed:state.speed,battery_v:physics.batteryVoltage,current_a:physics.batteryCurrent,motors:latest.motors,rpm:physics.motorOmega.map(w=>w*60/(2*Math.PI)),armed:Boolean(fcState&STATE_ARMED),fault,game_mode:Boolean(fcState&STATE_GAME_MODE),navigation_valid:Boolean(fcState&STATE_NAVIGATION_VALID),navigation_degraded:Boolean(fcState&STATE_NAVIGATION_DEGRADED),nav_velocity_valid:Boolean(latestNavigation.velocityValid),nav_agl_valid:Boolean(latestNavigation.aglValid),nav_heading_valid:Boolean(latestNavigation.headingValid),target_ground_clearance:effectiveInput?.gameMode?clamp(Number(effectiveInput.groundClearance)||2,MIN_GAME_CLEARANCE_M,MAX_GAME_CLEARANCE_M):null,body_pitch_input:effectiveInput?.gameMode?clamp(Number(effectiveInput.bodyPitch)||0,-1,1):0});}
  const wall=(now-wallStart)/1000;ui.speed.textContent=(wall>0?(simTime-simStart)/wall:0).toFixed(2)+"×";if(soloMode){const soloArm=$("soloArm");$("soloState").textContent=stateText;$("soloAlt").textContent=`AGL ${latestNavigation.aglValid?latestNavigation.agl.toFixed(1):"—"} m`;soloRangeStatus.textContent=latestNavigation.valid?`AGL ${latestNavigation.agl.toFixed(1)} m`:!latestNavigation.velocityValid?"NAV DEGRADED · VELOCITY LOST":!latestNavigation.headingValid?"NAV DEGRADED · HEADING LOST":!latestNavigation.aglValid?"NAV DEGRADED · AGL LOST":"NAV DEGRADED · SENSOR STATE";soloRangeStatus.style.color=latestNavigation.valid?"#64e0ae":"#ffd06d";$("soloCamera").textContent=cameraMode.toUpperCase();const race=raceTrack.snapshot(simTime);$("soloLap").textContent=race.finished?`FINISH · ${race.totalTimeText}`:(race.started?`LAP ${race.lap}/${race.totalLaps}`:`READY · ${race.totalLaps} LAPS`);$("soloRaceTime").textContent=race.finished?race.totalTimeText:race.currentLapText;$("soloGate").textContent=race.finished?"COURSE COMPLETE":`GATE ${race.nextGate+1}/${race.gateCount} · ${race.nextGateText}`;$("soloBest").textContent=`BEST ${race.bestLapText}`;const soloCanArm=!soloControls.arm&&Boolean(fcState&STATE_NAVIGATION_VALID)&&sharedArmReady(stateText,soloControls,true,phoneSettings);soloArm.classList.toggle("arming",soloControls.arm&&stateText!=="ARMED");soloArm.classList.toggle("armed",stateText==="ARMED");soloArm.classList.toggle("attention",soloCanArm);soloArm.disabled=!soloControls.arm&&!soloCanArm;soloArm.textContent=soloControls.arm?(stateText==="ARMED"?"ARMED ✓":"ARMING…"):(stateText==="CALIBRATING"?"CALIBRATING…":"ARM");}
  }
  const backlog=Math.max(0,simulationBacklogMs);
  const sinceDraw=renderNow-lastPresentationDrawMs;
  const minDrawInterval=backlog>=PRESENTATION_HARD_BACKLOG_MS?PRESENTATION_MAX_DRAW_GAP_MS:
    backlog>=PRESENTATION_CONSTRAINED_BACKLOG_MS?33:
    backlog>=PRESENTATION_SOFT_BACKLOG_MS?22:0;
  // Software rasterizers already run at the 0.30 backbuffer floor with shadows
  // disabled. Do not add a second, visibly jerky frame-rate cap on top of rAF.
  const softwareRasterDrawInterval=0;
  const effectiveDrawInterval=Math.max(minDrawInterval,softwareRasterDrawInterval);
  const forceDraw=sinceDraw>=PRESENTATION_MAX_DRAW_GAP_MS;
  const drawDue=forceDraw||(backlog<PRESENTATION_SKIP_DRAW_BACKLOG_MS&&sinceDraw>=effectiveDrawInterval);
  if(drawDue){
    const presentationDt=Number.isFinite(lastPresentationDrawMs)?clamp(sinceDraw/1000,0,.1):1/60,presentationAlpha=running&&mode!=="replay"?clamp(backlog/SIM_FIXED_STEP_MS,0,1):1;
    recordPresentationFrame(renderNow);
    lastPresentationDrawMs=renderNow;
    const presentationPose=physics.presentationPose(presentationAlpha);box3dColliderDebugDraw.syncAirframe(physics.motorPos,AIRFRAME_COLLISION_HALF_Z_M,physics.p.propD);box3dColliderDebugDraw.syncWorld(physics.worldBuildingCollisionState,physics.worldBuildingCollisionRevision);box3dColliderDebugDraw.updateAirframe(presentationPose);const box3dDebugViewport=$("viewport");if(box3dDebugViewport&&box3dColliderDebugEnabled)box3dDebugViewport.dataset.box3dColliderDebugPrisms=String(box3dColliderDebugDraw.activePrismCount);const externalCameraState=updateCamera(presentationPose,renderNow);let visualPose=presentationPose,visualState=null;if(externalCameraState){visualState=externalAirframeVisualRig.update({position:[presentationPose.position.x,presentationPose.position.y,presentationPose.position.z],quaternion:[presentationPose.quaternion.x,presentationPose.quaternion.y,presentationPose.quaternion.z,presentationPose.quaternion.w],cameraAnchor:externalCameraState.anchor,mode:cameraMode,dt:presentationDt});externalVisualPosition.set(...visualState.position);externalVisualQuaternion.set(...visualState.quaternion);externalVisualVelocity.copy(presentationPose.velocity);visualPose=externalVisualPose;}else externalAirframeVisualRig.invalidate();const visualViewport=$("viewport");if(visualViewport){visualViewport.dataset.visualAirframeFilter=externalCameraState?cameraMode:"off";visualViewport.dataset.visualAirframePositionErrorM=(visualState?.positionErrorM||0).toFixed(4);visualViewport.dataset.visualAirframeRotationErrorDeg=((visualState?.rotationErrorRad||0)*180/Math.PI).toFixed(3);}physics.render(presentationPose,presentationDt,visualPose);
    if(renderer.shadowMap.enabled&&renderNow-lastPresentationShadowMs>=PRESENTATION_SHADOW_INTERVAL_MS&&backlog<PRESENTATION_SHADOW_BACKLOG_MS){
      lastPresentationShadowMs=renderNow;
      renderer.shadowMap.needsUpdate=true;
    }
    presentationDraws++;
    const viewport=$("viewport");
    if(viewport){viewport.dataset.presentationDraws=String(presentationDraws);viewport.dataset.presentationBacklogMs=backlog.toFixed(2);viewport.dataset.presentationPoseInterpolation=presentationAlpha.toFixed(4);}
    const worldBridge=globalThis.__arondightRealWorld;
    if(!worldBridge?.renderFrame?.(renderer,scene,camera))renderer.render(scene,camera);
  }
}
render();

function parseCsv(text){const lines=text.trim().split(/\r?\n/).filter(Boolean);if(lines.length<2)return[];const headers=lines[0].split(",").map(x=>x.trim());return lines.slice(1).map(line=>{const cols=line.split(","),row={};headers.forEach((header,i)=>{const raw=cols[i]?.trim();if(raw===""||raw===undefined){row[header]=null;return;}const value=Number(raw);row[header]=Number.isFinite(value)?value:raw;});return row;});}
function normalizeLog(rows){
  const aliases={time:["time_s","time","t","timestamp_s"],m1:["motor1_us","m1_us","m1"],m2:["motor2_us","m2_us","m2"],m3:["motor3_us","m3_us","m3"],m4:["motor4_us","m4_us","m4"]};
  const pick=(row,keys)=>{for(const key of keys){const raw=row[key];if(raw===null||raw===undefined||String(raw).trim()==="")continue;const value=Number(raw);if(Number.isFinite(value))return value;}return NaN;};
  const optional=(row,key)=>row[key]===null||row[key]===undefined||String(row[key]).trim()===""?NaN:Number(row[key]);
  const normalized=rows.map((row,index)=>({time_s:pick(row,aliases.time),motor1_us:pick(row,aliases.m1),motor2_us:pick(row,aliases.m2),motor3_us:pick(row,aliases.m3),motor4_us:pick(row,aliases.m4),x:optional(row,"x"),y:optional(row,"y"),z:optional(row,"z"),vx:optional(row,"vx"),vy:optional(row,"vy"),vz:optional(row,"vz"),roll_deg:optional(row,"roll_deg"),pitch_deg:optional(row,"pitch_deg"),yaw_deg:optional(row,"yaw_deg"),battery_v:optional(row,"battery_v"),current_a:optional(row,"current_a"),_i:index})).filter(row=>Number.isFinite(row.time_s)&&[row.motor1_us,row.motor2_us,row.motor3_us,row.motor4_us].every(Number.isFinite)).sort((a,b)=>a.time_s-b.time_s);
  return normalized.filter((row,index)=>index===0||row.time_s>normalized[index-1].time_s);
}
const FITTED_PHYSICS_STORAGE="arondight45FittedPhysicsV3";
const LEGACY_FITTED_PHYSICS_STORAGE="arondight45FittedPhysicsV2";
const FITTED_PARAMETER_KEYS=["Ct","Cq","J","dragScale","batteryR","R"];
const PHYSICS_PARAMETER_INPUT_IDS=["span","propD","kv","resistance","motorCurrentLimitA","escCurrentLimitA","rotorJ","ct","cq","batteryCells","capacity","batteryR","batteryMaxCurrentA","rho","dragScale","groundEffect","frameMassG","motorMassG","propMassG","batteryMassG","escMassG","fcRxMassG","cameraVtxMassG","wiringHardwareMassG","batteryXmm","batteryZmm","cameraXmm","cameraZmm","windX","windY","failedMotor"];
const fittedParameters=params=>Object.fromEntries(FITTED_PARAMETER_KEYS.map(key=>[key,params[key]]));
function applyFittedParameters(parameters){
  if(!parameters||typeof parameters!=="object")return;
  if(Number.isFinite(parameters.Ct))$("ct").value=parameters.Ct;
  if(Number.isFinite(parameters.Cq))$("cq").value=parameters.Cq;
  if(Number.isFinite(parameters.J))$("rotorJ").value=parameters.J;
  if(Number.isFinite(parameters.dragScale))$("dragScale").value=parameters.dragScale;
  if(Number.isFinite(parameters.batteryR))$("batteryR").value=parameters.batteryR;
  if(Number.isFinite(parameters.R))$("resistance").value=parameters.R;
}
function setPhysicsValidation(report=null,reason="no independent real-flight holdout evidence"){
  physicsValidationReport=report?.schema===PHYSICS_VALIDATION_SCHEMA?report:null;
  if(!ui.modelValidationStatus)return;
  ui.modelValidationStatus.textContent=physicsValidationReport?validationSummary(physicsValidationReport):`UNVALIDATED · ${reason}`;
  ui.modelValidationStatus.dataset.validation=physicsValidationReport?.passed?"validated":"unvalidated";
  ui.modelValidationStatus.className=`statusline ${physicsValidationReport?.passed?"good":"bad"}`;
}
function downsampleLog(samples,maximum){
  if(samples.length<=maximum)return samples.slice();
  const stride=Math.ceil((samples.length-1)/(maximum-1)),selected=samples.filter((_,index)=>index%stride===0);
  if(selected.at(-1)!==samples.at(-1))selected.push(samples.at(-1));
  return selected;
}
async function loadLog(file){
  const text=await file.text();let rows;
  if(file.name.toLowerCase().endsWith(".json")){const parsed=JSON.parse(text);rows=Array.isArray(parsed)?parsed:(parsed.samples||parsed.data||[]);}else rows=parseCsv(text);
  realLog=normalizeLog(rows);const targetFields=["x","y","z","vx","vy","vz","roll_deg","pitch_deg","yaw_deg","battery_v","current_a"],hasTargets=realLog.some(sample=>targetFields.some(field=>Number.isFinite(sample[field])));ui.logSamples.textContent=realLog.length;ui.fit.disabled=realLog.length<4||!hasTargets;ui.fitStatus.textContent=!realLog.length?"No usable samples. Need time + 4 motor outputs.":!hasTargets?`${realLog.length} replay samples loaded · fitting disabled because measured target fields are absent.`:`${realLog.length} real samples loaded · fit 70% / holdout 30%.`;replayIndex=0;if(mode==="replay"&&realLog.length){resetSimulation(realLog[0]);ui.run.disabled=false;}
}
function downloadJson(name,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportSession(){
  if((latest.state&STATE_ARMED)&&inputSource==="remote"){
    setStatus("Disarm before exporting a full flight log during P2P control.","warn");
    return;
  }
  downloadJson(`arondight45-${mode}-${new Date().toISOString().replace(/[:.]/g,"-")}.json`,{schema:"arondight45-flight-log-v1",mode,samples:sessionLog,physics:defaultParams(),physicsValidation:physicsValidationReport,realtimeEvidence:{timingDiscontinuityMs:simulationTimingDiscontinuityMs,presentation:presentationTimingSnapshot()}});
}

function angleDiff(a,b){let difference=(a-b)%360;if(difference>180)difference-=360;if(difference<-180)difference+=360;return difference;}
function addResidual(accumulator,simulated,measured,scaleValue,weight=1){if(Number.isFinite(measured)){const e=(simulated-measured)/scaleValue;accumulator.error+=e*e*weight;accumulator.weight+=weight;}}
async function objective(testParams,samples,{collect=false}={}){
  const model=new PhysicsModel(testParams);model.reset(testParams,samples[0]);const residual={error:0,weight:0},comparisons=[];
  for(let i=1;i<samples.length;i++){
    const previous=samples[i-1],current=samples[i],duration=current.time_s-previous.time_s;if(!(duration>0))continue;
    const motors=[previous.motor1_us,previous.motor2_us,previous.motor3_us,previous.motor4_us];const state=integrateDuration(model,motors,duration);
    addResidual(residual,state.x,current.x,.5);addResidual(residual,state.y,current.y,.5);addResidual(residual,state.z,current.z,.5);
    addResidual(residual,state.vx,current.vx,2);addResidual(residual,state.vy,current.vy,2);addResidual(residual,state.vz,current.vz,2);
    if(Number.isFinite(current.roll_deg)){const e=angleDiff(state.attitude[0],current.roll_deg)/25;residual.error+=e*e;residual.weight++;}
    if(Number.isFinite(current.pitch_deg)){const e=angleDiff(state.attitude[1],current.pitch_deg)/25;residual.error+=e*e;residual.weight++;}
    if(Number.isFinite(current.yaw_deg)){const e=angleDiff(state.attitude[2],current.yaw_deg)/40;residual.error+=e*e;residual.weight++;}
    addResidual(residual,state.battery_v,current.battery_v,1.5,.5);addResidual(residual,state.current_a,current.current_a,20,.35);
    if(collect)comparisons.push({measured:current,simulated:{...state,roll_deg:state.attitude[0],pitch_deg:state.attitude[1],yaw_deg:state.attitude[2]}});
  }
  b3.b3DestroyWorld(model.world);
  return{nrmse:residual.weight?Math.sqrt(residual.error/residual.weight):Infinity,comparisons};
}
async function fitPhysics(){
  if(realLog.length<4)return;
  ui.fit.disabled=true;ui.fitStatus.textContent="Fitting on the first 70% · final 30% remains unseen for holdout validation…";
  const partition=partitionCalibrationLog(realLog),trainingSamples=downsampleLog(partition.training,560),holdoutSamples=downsampleLog(partition.holdout,320);
  let p=defaultParams(),best=(await objective(p,trainingSamples)).nrmse;
  if(!Number.isFinite(best))throw Error("Log has motor pulses but no usable measured trajectory/electrical target fields");
  const variables=[
    {k:"Ct",step:.14,min:.03,max:.25},{k:"Cq",step:.16,min:.003,max:.04},{k:"J",step:.20,min:2e-6,max:8e-5},{k:"dragScale",step:.22,min:.2,max:4},{k:"batteryR",step:.18,min:.005,max:.2},{k:"R",step:.16,min:.02,max:.3}
  ];
  const passes=6,total=passes*variables.length*2;let done=0;
  for(let pass=0;pass<passes;pass++){
    for(const variable of variables){
      for(const direction of [-1,1]){
        const candidate={...p,wind:[...p.wind]};candidate[variable.k]=clamp(p[variable.k]*(1+direction*variable.step/(1+pass*.65)),variable.min,variable.max);
        const score=(await objective(candidate,trainingSamples)).nrmse;if(score<best){best=score;p=candidate;}
        done++;ui.fitProgress.style.width=`${100*done/total}%`;ui.fitStatus.textContent=`normalized training RMSE ${best.toFixed(4)} · testing ${variable.k}`;await new Promise(requestAnimationFrame);
      }
    }
  }
  $("ct").value=p.Ct.toFixed(6);$("cq").value=p.Cq.toFixed(6);$("rotorJ").value=p.J.toFixed(8);$("dragScale").value=p.dragScale.toFixed(4);$("batteryR").value=p.batteryR.toFixed(6);$("resistance").value=p.R.toFixed(6);
  const trainingEvaluation=await objective(p,trainingSamples,{collect:true}),holdoutEvaluation=await objective(p,holdoutSamples,{collect:true});
  const report=evaluatePhysicsValidation({allSamples:realLog,trainingSamples:partition.training,holdoutSamples:partition.holdout,comparisons:holdoutEvaluation.comparisons,trainNrmse:trainingEvaluation.nrmse,holdoutNrmse:holdoutEvaluation.nrmse});
  report.split={trainingEndIndex:partition.splitIndex,holdoutStartIndex:partition.splitIndex,sharedInitialConditionOnly:true};report.parameters=fittedParameters(p);
  setPhysicsValidation(report);
  try{localStorage.setItem(FITTED_PHYSICS_STORAGE,JSON.stringify({schema:"arondight45-fitted-physics-v3",parameters:fittedParameters(p),validation:report}));}catch{}
  ui.fitStatus.textContent=report.passed?`Fit + holdout pass · training ${trainingEvaluation.nrmse.toFixed(4)} · holdout ${holdoutEvaluation.nrmse.toFixed(4)}.`:`Fit applied but UNVALIDATED · ${report.reasons[0]}`;
  ui.fit.disabled=false;resetSimulation(mode==="replay"?realLog[0]:null);
}

$("modeSim").onclick=()=>switchMode("sim");$("modeHil").onclick=()=>switchMode("hil");$("modeReplay").onclick=()=>switchMode("replay");
ui.connect.onclick=async()=>{if(mode==="sim")return switchMode("sim");if(mode!=="hil")return;try{backend=new HardwareBackend();setStatus("Connecting physical S31…");await backend.connect();ui.tController.textContent=backend.label();ui.tController.className="good";setStatus(`HIL ready: ${backend.label()}.`,"good");ui.run.disabled=false;}catch(error){backend=null;ui.tController.textContent="connection failed";ui.tController.className="bad";setStatus(error.message,"bad");}};
function startRun(){
  if(running)return true;if(mode!=="replay"&&!backend)return false;if(mode==="replay"&&!realLog.length)return false;
  running=true;simulationTimingDiscontinuityMs=0;resetPresentationTiming();const epoch=++runEpoch;ui.run.textContent="Pause";wallStart=performance.now();simStart=simTime;loop(epoch).catch(error=>{if(epoch!==runEpoch)return;running=false;ui.run.textContent="Start";setStatus(error.message,"bad");});return true;
}
function stopRun(){running=false;++runEpoch;ui.run.textContent="Start";}
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

setPhysicsValidation();
let restoredFittedPhysics=false;
try{
  const stored=localStorage.getItem(FITTED_PHYSICS_STORAGE);
  if(stored){const parsed=JSON.parse(stored);if(parsed?.schema==="arondight45-fitted-physics-v3"){applyFittedParameters(parsed.parameters);setPhysicsValidation(parsed.validation);restoredFittedPhysics=true;}}
  if(!restoredFittedPhysics){const legacy=localStorage.getItem(LEGACY_FITTED_PHYSICS_STORAGE);if(legacy){applyFittedParameters(JSON.parse(legacy));setPhysicsValidation(null,"legacy fit restored; rerun against a chronological holdout");}}
}catch{setPhysicsValidation(null,"stored fit could not be verified");}
for(const id of PHYSICS_PARAMETER_INPUT_IDS)$(id)?.addEventListener("input",()=>{setPhysicsValidation(null,"physical/environment parameter changed after validation");try{defaultParams();}catch{}});
await switchMode("sim");
