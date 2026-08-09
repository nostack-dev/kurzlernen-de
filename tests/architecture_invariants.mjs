import {existsSync,readFileSync,readdirSync,statSync} from "node:fs";
import {join} from "node:path";
import {phoneAxis} from "../sim/control_semantics.mjs";

const read=path=>readFileSync(path,"utf8");
const fail=message=>{throw new Error(`ARCHITECTURE INVARIANT FAILED: ${message}`);};
const requireText=(path,text,message=`${path} must contain ${JSON.stringify(text)}`)=>{if(!read(path).includes(text))fail(message);};
const forbidText=(path,text,message=`${path} must not contain ${JSON.stringify(text)}`)=>{if(read(path).includes(text))fail(message);};
const walk=(root,accept)=>{const out=[];for(const name of readdirSync(root)){const path=join(root,name),stat=statSync(path);if(stat.isDirectory())out.push(...walk(path,accept));else if(accept(path))out.push(path);}return out;};

for(const path of [...walk("esp32",p=>/\.(?:cpp|hpp)$/.test(p)),...walk("sim",p=>/\.(?:cpp|hpp)$/.test(p))]){
  const source=read(path);
  if(/#[ \t]*include[ \t]+["<][^">]*\.cpp[">]/.test(source))fail(`${path} includes a .cpp translation unit`);
  if(/#[ \t]*define[ \t]+main\b/.test(source))fail(`${path} rewrites main with the preprocessor`);
  if(source.includes("__attribute__((weak))"))fail(`${path} contains a weak-symbol dependency override`);
}

requireText("esp32/Arondight45_DroneFC_Core.hpp","RuntimeOutput step_command");
requireText("esp32/Arondight45_DroneFC_Core.hpp","return step_command(input, command(rc), rc.valid)");
requireText("esp32/Arondight45_DroneFC_Core.hpp","class Runtime");
requireText("esp32/Arondight45_StateControl.hpp","Command run(");
requireText("esp32/Arondight45_StateControl.hpp","runtime_.step_command");
requireText("esp32/Arondight45_StateControl.hpp","return sanitize(Command{");
for(const dirty of ["inverse_shape","shaped_raw","centered_raw","throttle_raw","StateController::transform"])
  forbidText("esp32/Arondight45_StateControl.hpp",dirty,`synthetic receiver adapter returned: ${dirty}`);

for(const marker of ["Box3D","THREE","PhysicsModel","b3Body","setLinearVelocity","setPosition"])
  forbidText("esp32/Arondight45_StateControl.hpp",marker,`state controller depends on simulator API: ${marker}`);
requireText("esp32/Arondight45_StateControl.hpp","kHorizontalVelocityGain * (intent.forward_mps - measured_forward)");
requireText("esp32/Arondight45_StateControl.hpp","kHorizontalVelocityGain * (intent.right_mps - measured_right)");
requireText("esp32/Arondight45_StateControl.hpp","update_acceleration_estimator(nav.velocity_world_mps, dt)");
requireText("esp32/Arondight45_StateControl.hpp","kStateBodyPitchChannel = 7");
requireText("esp32/Arondight45_StateControl.hpp","Positive input is");
requireText("esp32/Arondight45_StateControl.hpp","physical nose-up pitch");
requireText("esp32/Arondight45_StateControl.hpp","auto_pitch_target_deg + intent.body_pitch_deg");
requireText("esp32/Arondight45_StateControl.hpp","vertical_thrust_fraction");
requireText("esp32/Arondight45_StateControl.hpp","std::sqrt(thrust_ratio)");
requireText("esp32/Arondight45_StateControl.hpp","std::atan2");
requireText("esp32/Arondight45_StateControl.hpp","kStateMaxYawRateDps = 140.0f");
requireText("esp32/Arondight45_StateControl.hpp","kStateMaxHorizontalSpeedMps = 5.0f");
requireText("esp32/Arondight45_DroneFC_Core.hpp","const float roll_rate = s.g.x + sin_phi * tan_theta * s.g.y");
requireText("esp32/Arondight45_DroneFC_Core.hpp","2.0f * kPi * 0.02f");

requireText("esp32/Arondight45_DroneFC_S31.cpp","Arondight45_FirmwareRuntime.hpp");
requireText("esp32/Arondight45_DroneFC_S31.cpp","fc::FirmwareRuntime runtime");
requireText("esp32/Arondight45_DroneFC_S31.cpp","sample_imu_registers");
requireText("esp32/Arondight45_DroneFC_S31.cpp","navigation_init");
requireText("esp32/Arondight45_DroneFC_S31.cpp","NavigationWireParser");
for(const dirty of ["Arondight45_Navigation.hpp","navigation::sample(","arondight45_navigation_sample","sample_imu(fc::Imu"])
  forbidText("esp32/Arondight45_DroneFC_S31.cpp",dirty,`production contains a cooked sensor bypass: ${dirty}`);
if(existsSync("esp32/Arondight45_Navigation.hpp")||existsSync("esp32/Arondight45_Navigation_Unavailable.cpp"))
  fail("obsolete cooked navigation adapter survived the raw NAV1 migration");

for(const marker of ["uart_set_line_inverse","kIntSource","esp_task_wdt","fc::FirmwareRuntime runtime"])
  requireText("esp32/Arondight45_DroneFC_S31.cpp",marker);
requireText("esp32/Arondight45_DroneFC_HIL_S31.cpp","usb_serial_jtag");

requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_icm42688_registers");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_navigation_wire");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","decode_sbus");
requireText("esp32/Arondight45_FirmwareRuntime.hpp","kNavigationTimeoutUs");
requireText("esp32/Arondight45_HardwareSensors.hpp","NavigationWireFrame");
requireText("esp32/Arondight45_HardwareSensors.hpp","crc16_ccitt");

requireText("esp32/Arondight45_HIL_Protocol.hpp","kProtocolVersion = 3");
requireText("esp32/Arondight45_HIL_Protocol.hpp","fc::FirmwareRuntime runtime_");
requireText("esp32/Arondight45_HIL_Protocol.hpp","navigation_frame[hwcontract::kNavigationFrameBytes]");
requireText("esp32/Arondight45_HIL_Protocol.hpp","sizeof(InputPacket) == 80");
for(const cooked of ["nav_vx_cms","nav_vy_cms","nav_vz_cms","nav_agl_mm"])
  forbidText("esp32/Arondight45_HIL_Protocol.hpp",cooked,`cooked navigation field crossed HIL boundary: ${cooked}`);
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","Arondight45_HIL_Protocol.hpp");
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","hil::RuntimeAdapter runtime");

for(const marker of ["class SimNavigationSensors","class SimSbusReceiver","encodeNavigationWire","b3World_CastRayClosest","COLLISION_TERRAIN = 1n","COLLISION_AIRFRAME = 2n","QUERY_RANGEFINDER = 4n","NAV_AGL_RAY_MAX_M = 60","groundRange(NAV_AGL_RAY_MAX_M)",".05,NAV_AGL_RAY_MAX_M","FLAG_NAVIGATION_PRESENT","FLAG_SBUS_PRESENT","backend.exchange(packet","physics.step(latest.motors"])
  requireText("sim/simulator.mjs",marker);
requireText("sim/simulator.mjs","view.setUint32(76,crc32(bytes,76)");
requireText("sim/simulator.mjs","raw sensor wire → shared fc::FirmwareRuntime → shared fc::StateRuntime → fc::Runtime / WASM");
requireText("sim/simulator.mjs","filter.maskBits=COLLISION_TERRAIN");
for(const dirty of ["FLAG_NAVIGATION_VALID","stateControllerMotor"])
  forbidText("sim/simulator.mjs",dirty,`simulator contains decoded/control shortcut: ${dirty}`);
requireText("sim/simulator.mjs","SIM_FIXED_STEP_MS = DT * 1000");
requireText("sim/simulator.mjs","accumulatorMs=Math.min(accumulatorMs+elapsedMs,SIM_MAX_CATCHUP_MS)");
requireText("sim/simulator.mjs","Math.floor(accumulatorMs/SIM_FIXED_STEP_MS)");
forbidText("sim/simulator.mjs","(sequence&7)===0", "simulator fixed-step cadence must not be display-Hz divided");

// REAL WORLD is a geospatial/render adapter only. Browser GPS establishes the
// WGS84 horizontal origin; local x/y/z remain east/north/up SI metres.
// OpenFreeMap/OpenStreetMap are visual context only and never gain motor,
// controller or rigid-body authority.
for(const marker of ["navigator.geolocation.getCurrentPosition","enableHighAccuracy:true","tiles.openfreemap.org/styles/liberty","new MapLibreMap","metersToLngLat","source-layer\":\"building","render_height","render_min_height",'await import("./simulator.mjs")'])
  requireText("sim/real_world_bootstrap.mjs",marker);
for(const dirty of ["Box3DFactory","PhysicsModel","applyForces(","motorOmega","motorTorque","propTorque","fc::Runtime","StateController","b3Body_ApplyForce","b3World_Step"])
  forbidText("sim/real_world_bootstrap.mjs",dirty,`real-world render adapter duplicated flight physics/control: ${dirty}`);
for(const path of ["sim/real_world_bootstrap.mjs","sim/control_settings.mjs","tests/real_world_ui_smoke.mjs","REAL_WORLD_DIGITAL_TWIN.md"])
  for(const dirty of ["Google"+" Maps","google"+"apis.com","Google"+"Tiles","Ces"+"ium","AI"+"za"])
    forbidText(path,dirty,`${path} still contains removed map-provider dependency: ${dirty}`);
requireText("sim/control_settings.mjs","openfreemap-osm-3d");
requireText("sim/control_settings.mjs","No account, API key, billing setup, backend or proxy is required.");
requireText("sim/control_settings.mjs","WORLD GRID");
requireText("sim/control_settings.mjs","KEEP 360° LOOK ORIENTATION");

for(const path of ["sim/simulator.mjs","sim/controller.mjs","sim/p2p_link.mjs"])
  forbidText(path,"lookPitch",`${path} still contains the removed virtual camera-look control`);
requireText("sim/simulator.mjs","channels[7]=Math.round(992+820*clamp(c.bodyPitch||0,-1,1))");
requireText("sim/simulator.mjs","FPV optics are rigidly mounted to the airframe");
for(const marker of ["class HybridMotorSound","model.motorOmega","model.motorTorque","model.propTorque","motorAudioPowerW","escWindingTone","armToneSequence","motorAudioArmEvent","motorAudioEscToneCount","playbackRate.setTargetAtTime"])requireText("sim/motor_sound.mjs",marker);
requireText("sim/simulator.mjs",'import {HybridMotorSound} from "./motor_sound.mjs";');
requireText("sim/simulator.mjs",'const motorSound=new HybridMotorSound($("viewport"));');
for(const marker of ["loadCameraSettings","mountCameraSettings","cameraSettings.fpvTiltDeg","cameraSettings.fpvFovDeg","cameraSettings.thirdDistanceM","camera.position.distanceTo(position)"])requireText("sim/simulator.mjs",marker);
for(const marker of ["FPV VERTICAL TILT","FPV FOV","THIRD PERSON DISTANCE","arondight45CameraSettingsV1"])requireText("sim/camera_settings.mjs",marker);
requireText("sim/motor_sound.mjs",'this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque+tipSpeed:hybridBladeMotor"');
for(const marker of ["bladeSource","motorSource","washNoise","tipSpeed","playbackRate.setTargetAtTime"])requireText("sim/motor_sound.mjs",marker);
requireText("sim/control_semantics.mjs","export function applyGameStick");
requireText("sim/control_semantics.mjs","controls.bodyPitch=cfg.lockRightHorizontal?0:phoneAxis(-y");
requireText("sim/control_semantics.mjs","cfg.invertLeftHorizontal?-point.x:point.x");
requireText("sim/control_semantics.mjs","controls.roll=cfg.lockLeftHorizontal?0:phoneAxis(x,cfg.leftFineness)");
requireText("sim/controller.mjs","applyGameStick(controls,kind,point,phoneSettings)");
requireText("sim/controller.mjs","const keepArm=gameMode&&controls.arm");
requireText("sim/simulator.mjs","const keepArm=soloControls.arm");
requireText("sim/simulator.mjs","applyGameStick(soloControls,kind,point,phoneSettings)");
requireText("sim/p2p_link.mjs","bodyPitch:clamp(numeric[4],-1,1)");
const simulatorSource=read("sim/simulator.mjs"),controlsStart=simulatorSource.indexOf("function controls(){"),controlsEnd=simulatorSource.indexOf("async function controllerStep()",controlsStart);
if(controlsStart<0||controlsEnd<=controlsStart)fail("cannot isolate simulator controls() boundary");
if(!simulatorSource.slice(controlsStart,controlsEnd).includes("bodyPitch"))fail("GAME body pitch does not cross the real SBUS boundary");

for(const dirty of ["quantizedCentered","stateShape","desiredGameState","stateVectorDebug","data-vector-soll","data-vector-ist"])
  forbidText("sim/controller.mjs",dirty,`browser controller duplicated flight-state logic/UI: ${dirty}`);
requireText("sim/controller.mjs","measuredGameState");
requireText("sim/controller.mjs","dataset.navForwardMps");
requireText("sim/controller.mjs","W · FORWARD");
requireText("sim/controller.mjs","NOSE UP");
requireText("sim/controller.mjs","bindHeightKey(ui.gameUp,+1)");
requireText("sim/controller.mjs","stepGroundClearanceTarget(groundClearance,heightAxis,dt)");
requireText("sim/simulator.mjs","stepGroundClearanceTarget(soloGroundClearance,soloHeightAxis,dt)");
requireText("sim/controller.mjs","bindHeightKey(ui.gameDown,-1)");
requireText("sim/controller.mjs",'previousFcState==="ARMED"&&message.fc_state!=="ARMED"&&controls.arm');
requireText("sim/control_settings.mjs","DEFAULT HOVER ABOVE GROUND");
requireText("sim/control_semantics.mjs","defaultHoverAgl:1.2");
requireText("sim/control_semantics.mjs","MAX_GAME_CLEARANCE_M=50.0");
requireText("sim/control_semantics.mjs","MAX_GAME_CLEARANCE_RATE_MPS=5.0");
requireText("sim/control_semantics.mjs","stepGroundClearanceTarget");
requireText("esp32/Arondight45_StateControl.hpp","kStateMaxClearanceM = 50.00f");
for(const marker of ["WORLD_MAP_FRAME_MS=1000/30","WORLD_MAP_FRAME_MS_CONSTRAINED=1000/20","WORLD_MAP_FRAME_MS_CRITICAL=1000/15","WORLD_MAP_PIXEL_RATIO=1.0","WORLD_FLIGHT_PIXEL_RATIO=1.25","maxTileCacheZoomLevels:2","refreshExpiredTiles:false","validateStyle:false","crossSourceCollisions:false","trackResize:false","setSky({\"sky-color\":\"#0a2845\"","worldMapUpdates","worldFlightFps","setPerfMode(mode)","applyFlightPalette()","crossSourceCollisions:false","angularDistanceDeg","WORLD_GRID_STORAGE","WORLD_KEEP_LOOK_STORAGE","installLookHud()","applyLookCamera(scene,camera)","camera.position.copy(basePosition)","this.airframe=null;scene.traverse","child.isGridHelper&&this.gridEnabled"])requireText("sim/real_world_bootstrap.mjs",marker);
for(const marker of ["TorusGeometry(.15","worldHalo.visible=worldActive&&cameraMode!==\"fpv\""])requireText("sim/simulator.mjs",marker);
requireText("sim/controller.mjs","let groundClearance=phoneSettings.defaultHoverAgl");
requireText("sim/simulator.mjs","let soloGroundClearance=phoneSettings.defaultHoverAgl");
requireText("sim/control_settings.mjs","INVERT LEFT STICK HORIZONTAL (L/R)");
requireText("sim/control_settings.mjs","INVERT RIGHT STICK HORIZONTAL (L/R)");
requireText("sim/control_settings.mjs","INVERT RIGHT STICK VERTICAL (UP/DOWN)");
requireText("drone_controller.html",'id="gameModeButton"');
requireText("drone_controller.html",'id="gameHeightPad"');
requireText("drone_controller.html",'id="gameUp"');
requireText("drone_controller.html",'id="gameDown"');
requireText("drone_controller.html",'id="leftTopLabel"');
requireText("drone_controller.html",'<script type="module" src="./sim/controller.mjs"></script>');
requireText("drone_simulator.html",'<script type="module" src="./sim/real_world_bootstrap.mjs"></script>');

requireText("sim/p2p_link.mjs","P2P_PROTOCOL = 5");
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

requireText("tools/s31_hil_bridge.mjs",'pathname!=="/hil"');
requireText("tools/s31_hil_bridge.mjs","HIL packets only");
for(const dirty of ["CONTROL_PROTOCOL","controlSockets","rooms =","rooms=new Map","--sim-only",'pathname==="/control"',"Control relay"])
  forbidText("tools/s31_hil_bridge.mjs",dirty,`HIL bridge contains normal-control relay code: ${dirty}`);

for(const path of ["sim/control_semantics.mjs","sim/control_settings.mjs"]){forbidText(path,"MIN_PHONE_GAIN");forbidText(path,"MAX_PHONE_GAIN");}
for(const fineness of [1,7,10]){
  if(phoneAxis(1,fineness)!==1||phoneAxis(-1,fineness)!==-1)fail(`phone expo at fineness ${fineness} changes full-stick authority`);
  if(phoneAxis(0,fineness)!==0)fail(`phone expo at fineness ${fineness} moves neutral`);
}

requireText("tests/dual_phone_smoke.mjs","moving.forward>.30");
requireText("tests/dual_phone_smoke.mjs","body-pitch command did not rotate aircraft nose-up");
requireText("tests/dual_phone_smoke.mjs","#gameUp");
requireText("tests/dual_phone_smoke.mjs","#gameDown");
requireText("tests/dual_phone_smoke.mjs","rcx+rr*.65");
requireText("tests/dual_phone_smoke.mjs","turnStart+.30");
requireText("tests/dual_phone_smoke.mjs",'await view.click("#reset")');
requireText("tests/dual_phone_smoke.mjs",'waitText(controller,"#fcState","DISARMED",15000)');
requireText("tests/browser_sim_smoke.mjs","body-pitch command did not rotate aircraft nose-up");
requireText("tests/browser_sim_smoke.mjs","right.cx+right.r*.65,right.cy");
requireText("tests/browser_sim_smoke.mjs","turnStart+.30");

for(const path of [".github/workflows/one-shot-shared-controls.yml",".github/workflows/oneoff-complete-game-spec.yml",".github/workflows/oneoff-complete-game-spec-v2.yml","tools/patch_shared_control_semantics.py"])
  if(existsSync(path))fail(`historical migration scaffold still exists: ${path}`);

console.log("Architecture invariants passed: raw hardware boundary, one C++ motor authority, geospatial WGS84/ENU render adapter only, one shared 1-PHONE/2-PHONE GAME mapping, direct WebRTC control and HIL-only bridge.");