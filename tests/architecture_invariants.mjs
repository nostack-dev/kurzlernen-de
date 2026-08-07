import {existsSync,readFileSync,readdirSync,statSync} from "node:fs";
import {join} from "node:path";
import {phoneAxis} from "../sim/control_semantics.mjs";

const read=path=>readFileSync(path,"utf8");
const fail=message=>{throw new Error(`ARCHITECTURE INVARIANT FAILED: ${message}`);};
const requireText=(path,text,message=`${path} must contain ${JSON.stringify(text)}`)=>{
  if(!read(path).includes(text))fail(message);
};
const forbidText=(path,text,message=`${path} must not contain ${JSON.stringify(text)}`)=>{
  if(read(path).includes(text))fail(message);
};
const walk=(root,accept)=>{
  const out=[];
  for(const name of readdirSync(root)){
    const path=join(root,name),stat=statSync(path);
    if(stat.isDirectory())out.push(...walk(path,accept));
    else if(accept(path))out.push(path);
  }
  return out;
};

// No source-inclusion/preprocessor shortcuts: Production, HIL and SIL consume
// ordinary shared C++ headers / translation units.
for(const path of [...walk("esp32",p=>/\.(?:cpp|hpp)$/.test(p)),...walk("sim",p=>/\.(?:cpp|hpp)$/.test(p))]){
  const source=read(path);
  if(/#[ \t]*include[ \t]+["<][^">]*\.cpp[">]/.test(source))fail(`${path} includes a .cpp translation unit`);
  if(/#[ \t]*define[ \t]+main\b/.test(source))fail(`${path} rewrites main with the preprocessor`);
}
requireText("esp32/Arondight45_DroneFC_S31.cpp","Arondight45_StateControl.hpp");
requireText("esp32/Arondight45_DroneFC_S31.cpp","fc::StateRuntime runtime");
requireText("esp32/Arondight45_DroneFC_S31.cpp","arondight45_navigation_sample");
requireText("esp32/Arondight45_HIL_Protocol.hpp","Arondight45_StateControl.hpp");
requireText("esp32/Arondight45_HIL_Protocol.hpp","fc::StateRuntime runtime_");
requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","Arondight45_HIL_Protocol.hpp");
requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","hil::RuntimeAdapter runtime");
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","Arondight45_HIL_Protocol.hpp");

// GAME/STATE is an outer feedback loop only. It may convert measured state error
// to normal RC-like attitude/thrust requests, but it must not know Box3D, Three.js
// or any simulator rigid-body API. The inner fc::Runtime remains motor authority.
requireText("esp32/Arondight45_StateControl.hpp","class StateController");
requireText("esp32/Arondight45_StateControl.hpp","class StateRuntime");
requireText("esp32/Arondight45_StateControl.hpp","NavigationState");
requireText("esp32/Arondight45_StateControl.hpp","runtime_.step");
for(const marker of ["Box3D","THREE","PhysicsModel","b3Body","setLinearVelocity","setPosition"])
  forbidText("esp32/Arondight45_StateControl.hpp",marker,`state controller must not depend on simulator physics API: ${marker}`);

// Translation is one desired-minus-measured state-vector law. Vector length is
// speed; diagonal stick input must not gain sqrt(2) authority. Direction-specific
// braking hacks and measured-attitude lead shortcuts are not allowed back in.
requireText("esp32/Arondight45_StateControl.hpp","const float magnitude = std::sqrt(forward * forward + right * right)");
requireText("esp32/Arondight45_StateControl.hpp","forward /= magnitude");
requireText("esp32/Arondight45_StateControl.hpp","right /= magnitude");
requireText("esp32/Arondight45_StateControl.hpp","kHorizontalVelocityGain * (intent.forward_mps - measured_forward)");
requireText("esp32/Arondight45_StateControl.hpp","kHorizontalVelocityGain * (intent.right_mps - measured_right)");
requireText("esp32/Arondight45_StateControl.hpp","vertical_accel");
requireText("esp32/Arondight45_StateControl.hpp","required_specific_force");
requireText("esp32/Arondight45_StateControl.hpp","std::sqrt(thrust_ratio)",
            "thrust magnitude must map through rotor-speed physics instead of linearly to throttle");
requireText("esp32/Arondight45_StateControl.hpp","kEscCommandOffset");
requireText("esp32/Arondight45_StateControl.hpp","kEscCommandScale");
requireText("esp32/Arondight45_StateControl.hpp","std::atan2");
forbidText("esp32/Arondight45_StateControl.hpp","kAttitudeLead",
           "direction-specific measured-attitude lead shortcut returned");

// HIL v2 keeps the packet physically identical in size and uses the eight former
// reserved bytes for measured navigation state; no hidden side transport.
requireText("esp32/Arondight45_HIL_Protocol.hpp","kProtocolVersion = 2");
requireText("esp32/Arondight45_HIL_Protocol.hpp","nav_vx_cms");
requireText("esp32/Arondight45_HIL_Protocol.hpp","nav_agl_mm");
requireText("esp32/Arondight45_HIL_Protocol.hpp","sizeof(InputPacket) == 64");

// Production hardware safety/peripheral invariants must survive higher-level
// control work.
for(const marker of ["uart_set_line_inverse","kIntSource","esp_task_wdt"])
  requireText("esp32/Arondight45_DroneFC_S31.cpp",marker);
requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","usb_serial_jtag");

// SIM navigation is a sensor adapter, not a truth-to-motor shortcut. Its output
// is serialized through the same HIL packet consumed by the C++ StateRuntime.
requireText("sim/simulator.mjs","class SimNavigationSensors");
requireText("sim/simulator.mjs","b3World_CastRayClosest");
requireText("sim/simulator.mjs","groundRange(12)");
requireText("sim/simulator.mjs","neutralSoloControls");
requireText("sim/simulator.mjs","soloClearanceSlider");
requireText("sim/simulator.mjs","FLAG_NAVIGATION_VALID");
requireText("sim/simulator.mjs","view.setInt16(52");
requireText("sim/simulator.mjs","backend.exchange(packet");
requireText("sim/simulator.mjs","physics.step(latest.motors");
forbidText("sim/simulator.mjs","stateControllerMotor");

// GAME camera look is deliberately outside flight-control execution. The right
// stick Y value may affect FOLLOW / THIRD / FPV camera geometry, but must never be
// encoded into the SBUS-like channels consumed by StateRuntime / fc::Runtime.
requireText("sim/simulator.mjs","dataset.gameLookPitch");
requireText("sim/simulator.mjs","dataset.cameraLookDeg");
requireText("sim/simulator.mjs","FPV_CAMERA_UPTILT_RAD+viewPitch");
requireText("sim/control_settings.mjs","LOCK RIGHT STICK VERTICAL AXIS");
const simulatorSource=read("sim/simulator.mjs");
const controlsStart=simulatorSource.indexOf("function controls(){");
const controlsEnd=simulatorSource.indexOf("async function controllerStep()",controlsStart);
if(controlsStart<0||controlsEnd<=controlsStart)fail("cannot isolate simulator controls() boundary");
const controlsSource=simulatorSource.slice(controlsStart,controlsEnd);
if(controlsSource.includes("lookPitch"))fail("camera free-look leaked into flight-control channel encoding");

// GitHub Pages source pages remain ordinary entry points; deploy.yml builds the
// two self-contained single-file pages.
requireText("drone_simulator.html",'<script type="module" src="./sim/simulator.mjs"></script>');
requireText("drone_controller.html",'<script type="module" src="./sim/controller.mjs"></script>');

// Normal two-phone SIM is direct browser-to-browser WebRTC.
requireText("sim/p2p_link.mjs","P2P_PROTOCOL = 4");
requireText("sim/p2p_link.mjs","new RTCPeerConnection");
requireText("sim/p2p_link.mjs","iceServers:[]");
requireText("sim/p2p_link.mjs","CONTROL_STALE_MS = 350");
requireText("sim/p2p_link.mjs","SESSION_GRACE_MS = 5 * 60 * 1000");
for(const path of ["sim/p2p_link.mjs","sim/controller.mjs"]){
  forbidText(path,"WebSocket",`${path} must not contain a relay transport`);
  forbidText(path,'/control"',`${path} must not contain a controller relay route`);
  forbidText(path,"/control'",`${path} must not contain a controller relay route`);
}
requireText("sim/simulator.mjs","new ViewPeerLink()");
requireText("sim/controller.mjs","ControllerPeerLink");
requireText("sim/controller.mjs","gameMode");
requireText("sim/controller.mjs","gameClearanceSlider");
forbidText("sim/simulator.mjs","RemoteControlLink");
requireText("sim/simulator.mjs","control_semantics.mjs");
requireText("sim/controller.mjs","control_semantics.mjs");
requireText("sim/simulator.mjs","new QrScanner");
requireText("sim/controller.mjs","new QrScanner");

// Phone settings are an input-device adapter only. Legacy gain shortcuts that
// changed command authority are not permitted back in.
for(const path of ["sim/control_semantics.mjs","sim/control_settings.mjs"]){
  forbidText(path,"MIN_PHONE_GAIN");
  forbidText(path,"MAX_PHONE_GAIN");
}
for(const fineness of [1,7,10]){
  if(phoneAxis(1,fineness)!==1||phoneAxis(-1,fineness)!==-1)
    fail(`phone expo at fineness ${fineness} changes full-stick authority`);
  if(phoneAxis(0,fineness)!==0)fail(`phone expo at fineness ${fineness} moves neutral`);
}

// The physical GAME E2E gate is intentionally strict. Do not trade a controller
// regression for a weaker test threshold.
requireText("tests/dual_phone_smoke.mjs","moving.forward>.30&&moving.pitch<-6.0",
            "dual-phone GAME E2E forward-response gate was weakened");

// Historical/self-mutating migration scaffolding must stay absent from production.
for(const path of [
  ".github/workflows/one-shot-shared-controls.yml",
  ".github/workflows/oneoff-complete-game-spec.yml",
  ".github/workflows/oneoff-complete-game-spec-v2.yml",
  ".github/workflows/oneoff-restore-strict-game-e2e.yml",
  ".github/workflows/oneoff-align-state-vector-tests.yml",
  ".github/workflows/oneoff-game-response-window.yml",
  ".github/workflows/oneoff-fix-thrust-vector-map.yml",
  ".github/workflows/oneoff-agl-trace.yml",
]) if(existsSync(path))fail(`temporary control workflow returned: ${path}`);
if(existsSync("tools/patch_shared_control_semantics.py"))fail("one-shot source patcher returned");

console.log("Architecture invariants passed: desired-state vector -> measured-state error -> physical acceleration/thrust geometry -> shared fc::Runtime -> motor physics, with raycast AGL, camera-only free-look and direct static WebRTC.");
