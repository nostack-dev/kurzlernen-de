import {existsSync,readFileSync,readdirSync,statSync} from "node:fs";
import {join} from "node:path";
import {phoneAxis} from "../sim/control_semantics.mjs";

const read=path=>readFileSync(path,"utf8");
const fail=message=>{throw new Error(`ARCHITECTURE INVARIANT FAILED: ${message}`);};
const requireText=(path,text,message=`${path} must contain ${JSON.stringify(text)}`)=>{if(!read(path).includes(text))fail(message);};
const forbidText=(path,text,message=`${path} must not contain ${JSON.stringify(text)}`)=>{if(read(path).includes(text))fail(message);};
const walk=(root,accept)=>{const out=[];for(const name of readdirSync(root)){const path=join(root,name),stat=statSync(path);if(stat.isDirectory())out.push(...walk(path,accept));else if(accept(path))out.push(path);}return out;};

// C++ is shared normally: no source-file inclusion, main rewriting or hidden weak overrides.
for(const path of [...walk("esp32",p=>/\.(?:cpp|hpp)$/.test(p)),...walk("sim",p=>/\.(?:cpp|hpp)$/.test(p))]){
  const source=read(path);
  if(/#[ \t]*include[ \t]+["<][^">]*\.cpp[">]/.test(source))fail(`${path} includes a .cpp translation unit`);
  if(/#[ \t]*define[ \t]+main\b/.test(source))fail(`${path} rewrites main with the preprocessor`);
  if(source.includes("__attribute__((weak))"))fail(`${path} contains a weak-symbol dependency override`);
}

// Receiver/SBUS ends at the input adapter. Outer state control passes one physical
// Command directly to the same inner runtime that Production, HIL and SIL execute.
requireText("esp32/Arondight45_DroneFC_Core.hpp","RuntimeOutput step_command");
requireText("esp32/Arondight45_DroneFC_Core.hpp","return step_command(input, command(rc), rc.valid)");
requireText("esp32/Arondight45_DroneFC_Core.hpp","class Runtime");
requireText("esp32/Arondight45_StateControl.hpp","Command run(");
requireText("esp32/Arondight45_StateControl.hpp","runtime_.step_command");
requireText("esp32/Arondight45_StateControl.hpp","return sanitize(Command{");
for(const dirty of ["inverse_shape","shaped_raw","centered_raw","throttle_raw","StateController::transform"])
  forbidText("esp32/Arondight45_StateControl.hpp",dirty,`synthetic receiver adapter returned: ${dirty}`);

// State-vector control is plant-agnostic. Simulator APIs/truth may never enter C++.
for(const marker of ["Box3D","THREE","PhysicsModel","b3Body","setLinearVelocity","setPosition"])
  forbidText("esp32/Arondight45_StateControl.hpp",marker,`state controller depends on simulator API: ${marker}`);
requireText("esp32/Arondight45_StateControl.hpp","kHorizontalVelocityGain * (intent.forward_mps - measured_forward)");
requireText("esp32/Arondight45_StateControl.hpp","kHorizontalVelocityGain * (intent.right_mps - measured_right)");
requireText("esp32/Arondight45_StateControl.hpp","update_acceleration_estimator(nav.velocity_world_mps, dt)");
requireText("esp32/Arondight45_StateControl.hpp","required_specific_force");
requireText("esp32/Arondight45_StateControl.hpp","std::sqrt(thrust_ratio)");
requireText("esp32/Arondight45_StateControl.hpp","std::atan2");
requireText("esp32/Arondight45_StateControl.hpp","kStateMaxYawRateDps = 140.0f");
requireText("esp32/Arondight45_DroneFC_Core.hpp","const float roll_rate = s.g.x + sin_phi * tan_theta * s.g.y");
requireText("esp32/Arondight45_DroneFC_Core.hpp","2.0f * kPi * 0.02f");

// Production, physical S31 HIL and browser SIL meet at one raw hardware boundary.
// There is no linked cooked NavigationState callback and no second production IMU decoder.
requireText("esp32/Arondight45_DroneFC_S31.cpp","Arondight45_FirmwareRuntime.hpp");
requireText("esp32/Arondight45_DroneFC_S31.cpp","fc::FirmwareRuntime runtime");
requireText("esp32/Arondight45_DroneFC_S31.cpp","sample_imu_registers");
requireText("esp32/Arondight45_DroneFC_S31.cpp","navigation_init");
requireText("esp32/Arondight45_DroneFC_S31.cpp","NavigationWireParser");
for(const dirty of ["Arondight45_Navigation.hpp","navigation::sample(","arondight45_navigation_sample","sample_imu(fc::Imu"])
  forbidText("esp32/Arondight45_DroneFC_S31.cpp",dirty,`production contains a cooked sensor bypass: ${dirty}`);
if(existsSync("esp32/Arondight45_Navigation.hpp")||existsSync("esp32/Arondight45_Navigation_Unavailable.cpp"))
  fail("obsolete cooked navigation adapter survived the raw NAV1 migration");

// Hardware safety/peripheral architecture must survive higher-level work.
for(const marker of ["uart_set_line_inverse","kIntSource","esp_task_wdt","fc::FirmwareRuntime runtime"])
  requireText("esp32/Arondight45_DroneFC_S31.cpp",marker);
requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","usb_serial_jtag");

// One shared firmware boundary owns all hardware decoding and freshness behavior.
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_icm42688_registers");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_navigation_wire");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_sbus");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","kNavigationTimeoutUs");
requireText("esp32/Arondight45_HardwareSensors.hpp","NavigationWireFrame");
requireText("esp32/Arondight45_HardwareSensors.hpp","crc16_ccitt");

// HIL v3 transports literal target-hardware frames, never decoded vx/vy/vz/AGL state.
requireText("esp32/Arondight45_HIL_Protocol.hpp","kProtocolVersion = 3");
requireText("esp32/Arondight45_HIL_Protocol.hpp","fc::FirmwareRuntime runtime_");
requireText("esp32/Arondight45_HIL_Protocol.hpp","navigation_frame[hwcontract::kNavigationFrameBytes]");
requireText("esp32/Arondight45_HIL_Protocol.hpp","sizeof(InputPacket) == 80");
for(const cooked of ["nav_vx_cms","nav_vy_cms","nav_vz_cms","nav_agl_mm"])
  forbidText("esp32/Arondight45_HIL_Protocol.hpp",cooked,`cooked navigation field crossed HIL boundary: ${cooked}`);
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","Arondight45_HIL_Protocol.hpp");
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","hil::RuntimeAdapter runtime");

// Simulator truth terminates at virtual sensor hardware. ICM bytes arrive at the
// DRDY loop; SBUS and NAV1 arrive asynchronously. Only returned PWM drives the plant.
for(const marker of ["class SimNavigationSensors","class SimSbusReceiver","encodeNavigationWire","b3World_CastRayClosest","COLLISION_TERRAIN = 1n","COLLISION_AIRFRAME = 2n","QUERY_RANGEFINDER = 4n","groundRange(12)","FLAG_NAVIGATION_PRESENT","FLAG_SBUS_PRESENT","backend.exchange(packet","physics.step(latest.motors"])
  requireText("sim/simulator.mjs",marker);
requireText("sim/simulator.mjs","view.setUint32(76,crc32(bytes,76)");
requireText("sim/simulator.mjs","raw sensor wire → shared fc::FirmwareRuntime → shared fc::StateRuntime → fc::Runtime / WASM");
requireText("sim/simulator.mjs","filter.maskBits=COLLISION_TERRAIN");
for(const dirty of ["FLAG_NAVIGATION_VALID","stateControllerMotor"])
  forbidText("sim/simulator.mjs",dirty,`simulator contains decoded/control shortcut: ${dirty}`);

// Camera look is presentation only and cannot leak into the encoded FC channels.
requireText("sim/simulator.mjs","dataset.gameLookPitch");
requireText("sim/simulator.mjs","FPV_CAMERA_UPTILT_RAD+viewPitch");
const simulatorSource=read("sim/simulator.mjs"),controlsStart=simulatorSource.indexOf("function controls(){"),controlsEnd=simulatorSource.indexOf("async function controllerStep()",controlsStart);
if(controlsStart<0||controlsEnd<=controlsStart)fail("cannot isolate simulator controls() boundary");
if(simulatorSource.slice(controlsStart,controlsEnd).includes("lookPitch"))fail("camera free-look leaked into flight-control channel encoding");

// Phone UI is an input device and telemetry display, never a controller clone.
for(const dirty of ["quantizedCentered","stateShape","desiredGameState","stateVectorDebug","data-vector-soll","data-vector-ist"])
  forbidText("sim/controller.mjs",dirty,`browser controller duplicated flight-state logic/UI: ${dirty}`);
requireText("sim/controller.mjs","measuredGameState");
requireText("sim/controller.mjs","dataset.navForwardMps");
requireText("sim/controller.mjs","controls.yaw=phoneAxis(-point.x");
requireText("sim/controller.mjs",'previousFcState==="ARMED"&&message.fc_state!=="ARMED"&&controls.arm');
requireText("drone_controller.html",'id="gameModeButton"');
requireText("drone_controller.html",'id="gameClearanceSlider" type="range"');
requireText("drone_controller.html",'id="leftTopLabel"');
requireText("drone_controller.html",'<script type="module" src="./sim/controller.mjs"></script>');
requireText("drone_simulator.html",'<script type="module" src="./sim/simulator.mjs"></script>');

// Normal two-phone SIM is direct browser-to-browser WebRTC with freshness safety.
requireText("sim/p2p_link.mjs","P2P_PROTOCOL = 4");
requireText("sim/p2p_link.mjs","new RTCPeerConnection");
requireText("sim/p2p_link.mjs","iceServers:[]");
requireText("sim/p2p_link.mjs","CONTROL_STALE_MS = 350");
requireText("sim/p2p_link.mjs","SESSION_GRACE_MS = 5 * 60 * 1000");
requireText("sim/p2p_link.mjs","telemetrySequence:(this.telemetrySequence++>>>0)");
requireText("sim/p2p_link.mjs","newerSequence(sequence,this.lastTelemetrySequence)");
for(const path of ["sim/p2p_link.mjs","sim/controller.mjs"]){for(const dirty of ["WebSocket",'/control"',"/control'"])forbidText(path,dirty,`${path} contains relay transport ${dirty}`);}
requireText("sim/simulator.mjs","new ViewPeerLink()");
requireText("sim/controller.mjs","ControllerPeerLink");
requireText("sim/simulator.mjs","new QrScanner");
requireText("sim/controller.mjs","new QrScanner");

// The optional local process is HIL transport only. It must never become a normal
// controller relay/server again.
requireText("tools/s31_hil_bridge.mjs",'pathname!=="/hil"');
requireText("tools/s31_hil_bridge.mjs","HIL packets only");
for(const dirty of ["CONTROL_PROTOCOL","controlSockets","rooms =","rooms=new Map","--sim-only",'pathname==="/control"',"Control relay"])
  forbidText("tools/s31_hil_bridge.mjs",dirty,`HIL bridge contains normal-control relay code: ${dirty}`);

// Phone fineness changes curve shape only, never full-stick authority.
for(const path of ["sim/control_semantics.mjs","sim/control_settings.mjs"]){forbidText(path,"MIN_PHONE_GAIN");forbidText(path,"MAX_PHONE_GAIN");}
for(const fineness of [1,7,10]){
  if(phoneAxis(1,fineness)!==1||phoneAxis(-1,fineness)!==-1)fail(`phone expo at fineness ${fineness} changes full-stick authority`);
  if(phoneAxis(0,fineness)!==0)fail(`phone expo at fineness ${fineness} moves neutral`);
}

// Keep strict physical browser gates; never replace dynamics checks with UI-only checks.
requireText("tests/dual_phone_smoke.mjs","moving.forward>.30");
requireText("tests/dual_phone_smoke.mjs","rcx+rr*.65");
requireText("tests/dual_phone_smoke.mjs","turnStart+.22");
requireText("tests/dual_phone_smoke.mjs",'await view.click("#reset")');
requireText("tests/dual_phone_smoke.mjs",'waitText(controller,"#fcState","DISARMED",15000)');
requireText("tests/browser_sim_smoke.mjs","right.cx+right.r*.65,right.cy");
requireText("tests/browser_sim_smoke.mjs","turnStart+.22");

// Historical self-mutating migration workflows are not production architecture.
for(const path of [".github/workflows/one-shot-shared-controls.yml",".github/workflows/oneoff-complete-game-spec.yml",".github/workflows/oneoff-complete-game-spec-v2.yml","tools/patch_shared_control_semantics.py"])
  if(existsSync(path))fail(`historical migration scaffold still exists: ${path}`);

console.log("Architecture invariants passed: one raw hardware boundary, one C++ motor authority, direct physical commands, async ICM/SBUS/NAV1 sensor wires, direct WebRTC control and HIL-only bridge.");
