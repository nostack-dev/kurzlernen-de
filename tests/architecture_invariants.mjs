import {existsSync,readFileSync,readdirSync,statSync} from "node:fs";
import {join} from "node:path";
import {phoneAxis,MAX_GAME_CLEARANCE_M,MAX_GAME_TILT_DEG,GAME_AGL_SENSOR_RANGE_MARGIN_M,MIN_GAME_AGL_SENSOR_SLANT_RANGE_M} from "../sim/control_semantics.mjs";
import {fpvTargetDistanceMeters,forwardTarget} from "../sim/world_camera_math.mjs";

const read=path=>readFileSync(path,"utf8");
const fail=message=>{throw new Error(`ARCHITECTURE INVARIANT FAILED: ${message}`);};
const requireText=(path,text,message=`${path} must contain ${JSON.stringify(text)}`)=>{if(!read(path).includes(text))fail(message);};
const forbidText=(path,text,message=`${path} must not contain ${JSON.stringify(text)}`)=>{if(read(path).includes(text))fail(message);};
const walk=(root,accept)=>{const out=[];for(const name of readdirSync(root)){const path=join(root,name),stat=statSync(path);if(stat.isDirectory())out.push(...walk(path,accept));else if(accept(path))out.push(path);}return out;};
const fpvDistance=fpvTargetDistanceMeters(47,844,50,20);
if(!(fpvDistance>20&&fpvDistance<200))fail(`WORLD FPV target distance out of physical viewport scale: ${fpvDistance}`);
const fpvA=forwardTarget({x:0,y:0,z:5},{x:Math.sqrt(1-.019**2),y:0,z:-.019},fpvDistance),fpvB=forwardTarget({x:0,y:0,z:5},{x:Math.sqrt(1-.021**2),y:0,z:-.021},fpvDistance);
if(Math.hypot(fpvA.x-fpvB.x,fpvA.y-fpvB.y,fpvA.z-fpvB.z)>1)fail("WORLD FPV target geometry reintroduced near-horizon singularity");

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
requireText("esp32/Arondight45_StateControl.hpp","kStateMaxHorizontalSpeedMps = 25.0f");
requireText("esp32/Arondight45_DroneFC_Core.hpp","kManualMaxAttitudeDeg = 32.0f");
requireText("esp32/Arondight45_DroneFC_Core.hpp","kInnerMaxAttitudeDeg = 40.0f");
requireText("esp32/Arondight45_DroneFC_Core.hpp","kManualAttitudeCommandScale = kManualMaxAttitudeDeg / kInnerMaxAttitudeDeg");
requireText("esp32/Arondight45_StateControl.hpp","kInnerAttitudeRangeDeg = kInnerMaxAttitudeDeg");
requireText("esp32/Arondight45_StateControl.hpp","kMaxTiltDeg = 40.0f");
const stateControlSource=read("esp32/Arondight45_StateControl.hpp"),tiltMatch=stateControlSource.match(/kMaxTiltDeg = ([0-9.]+)f/);
if(!tiltMatch||Math.abs(Number(tiltMatch[1])-MAX_GAME_TILT_DEG)>1e-9)fail(`JS/C++ GAME tilt envelope diverged: JS ${MAX_GAME_TILT_DEG}, C++ ${tiltMatch?.[1]}`);
const requiredAglSlant=MAX_GAME_CLEARANCE_M/Math.pow(Math.cos(MAX_GAME_TILT_DEG*Math.PI/180),2);
if(MIN_GAME_AGL_SENSOR_SLANT_RANGE_M<requiredAglSlant+GAME_AGL_SENSOR_RANGE_MARGIN_M)fail(`AGL slant range ${MIN_GAME_AGL_SENSOR_SLANT_RANGE_M} m cannot cover ${MAX_GAME_CLEARANCE_M} m at ${MAX_GAME_TILT_DEG} deg plus margin`);
requireText("esp32/Arondight45_StateControl.hpp","kMaxHorizontalAccelerationMps2 = 7.5f");
requireText("esp32/Arondight45_StateControl.hpp","kHorizontalIntegralLimitMps2 = 7.0f");
forbidText("esp32/Arondight45_DroneFC_Core.hpp","cmd.roll * 32.0f", "inner attitude range must not silently cap GAME at the MANUAL 32-degree envelope");
requireText("esp32/Arondight45_StateControl.hpp","shaped_magnitude = shape(magnitude, 0.035f, 0.25f)");
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
requireText("esp32/Arondight45_HardwareSensors.hpp","kNavigationHeadingValid = 1u << 2");
requireText("esp32/Arondight45_HardwareSensors.hpp","kNavigationHeadingMask = 0x7ff8u");
requireText("esp32/Arondight45_StateControl.hpp","navigation_heading_valid");
requireText("esp32/Arondight45_StateControl.hpp","horizontal_navigation = velocity_valid && heading_valid");
requireText("esp32/Arondight45_StateControl.hpp","absolute_heading_valid ? nav.heading_deg : yaw_deg");
requireText("sim/simulator.mjs","NAV_HEADING_VALID = 1 << 2");
requireText("sim/simulator.mjs","headingNoise=new Noise");

requireText("esp32/Arondight45_HIL_Protocol.hpp","kProtocolVersion = 3");
requireText("esp32/Arondight45_HIL_Protocol.hpp","fc::FirmwareRuntime runtime_");
requireText("esp32/Arondight45_HIL_Protocol.hpp","navigation_frame[hwcontract::kNavigationFrameBytes]");
requireText("esp32/Arondight45_HIL_Protocol.hpp","sizeof(InputPacket) == 80");
for(const cooked of ["nav_vx_cms","nav_vy_cms","nav_vz_cms","nav_agl_mm"])
  forbidText("esp32/Arondight45_HIL_Protocol.hpp",cooked,`cooked navigation field crossed HIL boundary: ${cooked}`);
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","Arondight45_HIL_Protocol.hpp");
requireText("sim/Arondight45_DroneFC_SIL_WASM.cpp","hil::RuntimeAdapter runtime");

for(const marker of ["class SimNavigationSensors","class SimSbusReceiver","encodeNavigationWire","b3World_CastRayClosest","COLLISION_TERRAIN = 1n","COLLISION_AIRFRAME = 2n","QUERY_RANGEFINDER = 4n","NAV_AGL_RAY_MAX_M = MIN_GAME_AGL_SENSOR_SLANT_RANGE_M","groundRange(NAV_AGL_RAY_MAX_M)",".05,NAV_AGL_RAY_MAX_M","FLAG_NAVIGATION_PRESENT","FLAG_SBUS_PRESENT","backend.exchange(packet","physics.step(latest.motors"])
  requireText("sim/simulator.mjs",marker);
requireText("sim/simulator.mjs","view.setUint32(76,crc32(bytes,76)");
requireText("sim/simulator.mjs","raw sensor wire → shared fc::FirmwareRuntime → shared fc::StateRuntime → fc::Runtime / WASM");
requireText("sim/simulator.mjs","filter.maskBits=COLLISION_TERRAIN");
for(const dirty of ["FLAG_NAVIGATION_VALID","stateControllerMotor"])
  forbidText("sim/simulator.mjs",dirty,`simulator contains decoded/control shortcut: ${dirty}`);
requireText("sim/simulator.mjs","SIM_FIXED_STEP_MS = DT * 1000");
requireText("sim/simulator.mjs","SIM_MAX_BACKLOG_MS = 250");
requireText("sim/simulator.mjs","SIM_MAX_STEPS_PER_SLICE = Math.ceil(SIM_MAX_CATCHUP_MS / SIM_FIXED_STEP_MS)");
requireText("sim/simulator.mjs","accumulatorMs=Math.min(accumulatorMs+elapsedMs,SIM_MAX_BACKLOG_MS)");
requireText("sim/simulator.mjs","Math.floor(accumulatorMs/SIM_FIXED_STEP_MS)");
requireText("sim/simulator.mjs","SIM_WORK_SLICE_MS = 6");
requireText("sim/simulator.mjs","SIM_MAX_STEPS_PER_SLICE");
requireText("sim/simulator.mjs","yieldToBrowser()");
requireText("sim/simulator.mjs","workElapsedMs=clamp(afterWork-schedulerWallMs,0,SIM_MAX_BACKLOG_MS)");
forbidText("sim/simulator.mjs","accumulatorMs=Math.min(accumulatorMs+elapsedMs,SIM_MAX_CATCHUP_MS)","scheduler must not discard wall time at the per-slice work cap");
requireText("sim/simulator.mjs","if(accumulatorMs>=SIM_FIXED_STEP_MS)await yieldToBrowser();else await new Promise(requestAnimationFrame)");
requireText("sim/simulator.mjs","exchangeSync(packet)");
requireText("sim/simulator.mjs","backend instanceof WasmBackend");
requireText("sim/simulator.mjs","physics.p.imuValid");
requireText("sim/simulator.mjs","PRESENTATION_HUD_INTERVAL_MS = 75");
requireText("sim/simulator.mjs","PRESENTATION_AUDIO_INTERVAL_MS = 50");
requireText("sim/simulator.mjs","PRESENTATION_MAX_DRAW_GAP_MS = 50");
requireText("sim/simulator.mjs","simulationBacklogMs=accumulatorMs");
requireText("sim/simulator.mjs","renderer.shadowMap.autoUpdate=false");
requireText("sim/simulator.mjs","PRESENTATION_SHADOW_INTERVAL_MS = 250");
requireText("sim/simulator.mjs","renderer.shadowMap.type=THREE.BasicShadowMap");
requireText("sim/simulator.mjs","PRESENTATION_PIXEL_RATIO_MIN = .60");
requireText("sim/simulator.mjs","PRESENTATION_PIXEL_RATIO_MAX = 1.25");
requireText("sim/simulator.mjs",'presentationGl.getExtension("WEBGL_debug_renderer_info")');
requireText("sim/simulator.mjs","presentationSoftwareRaster");
requireText("sim/simulator.mjs","presentationQualityCeiling=presentationSoftwareRaster?Math.min(presentationNativePixelRatio,PRESENTATION_PIXEL_RATIO_MIN):presentationNativePixelRatio");
requireText("sim/simulator.mjs","presentationPixelRatio<presentationQualityCeiling");
requireText("sim/simulator.mjs","softwareRasterDrawInterval=presentationSoftwareRaster?60:0");
requireText("sim/simulator.mjs","effectiveDrawInterval=Math.max(minDrawInterval,softwareRasterDrawInterval)");
requireText("sim/simulator.mjs","swiftshader|llvmpipe|software raster|software renderer");
requireText("sim/simulator.mjs","updatePresentationQuality(renderNow)");
requireText("sim/simulator.mjs","loop(epoch)");
requireText("sim/simulator.mjs","while(running&&epoch===runEpoch)");
requireText("sim/simulator.mjs","i<due&&running&&epoch===runEpoch");
requireText("sim/simulator.mjs","function stopRun(){running=false;++runEpoch");
requireText("sim/real_world_bootstrap.mjs",'mode==="critical"?Math.min(ceiling,.75)');
requireText("sim/simulator.mjs",'DEBUG_GRID_STORAGE = "arondight45DebugGridlinesV1"');
requireText("sim/simulator.mjs","debugGrid:{get:()=>debugGridEnabled,set:setDebugGridEnabled,defaultValue:false}");
requireText("sim/control_settings.mjs","DEBUG GRIDLINES");
requireText("sim/real_world_bootstrap.mjs","if(child.isGridHelper){child.visible=this.gridEnabled;continue;}");
forbidText("sim/simulator.mjs",'fullscreenchange",()=>{if(soloMode&&!document.fullscreenElement&&document.fullscreenEnabled)exitSolo()');
requireText("sim/simulator.mjs","viewport.dataset.presentationDraws");
requireText("sim/simulator.mjs",'Object.defineProperty(globalThis,"__arondightDiagnostics"');
requireText("sim/simulator.mjs","simTime:{get:()=>simTime");
requireText("sim/simulator.mjs","b3.b3World_Step(this.world,dt,4)");
requireText("sim/simulator.mjs","cdA=[.035,.035,.07].map(x=>x*p.dragScale)");
requireText("sim/simulator.mjs","angularDrag=omega.map(v=>-.0012*v*Math.abs(v))");
forbidText("sim/simulator.mjs","angularDrag=omega.map(v=>-.0012*p.dragScale", "linear drag fit must not mutate angular damping");
requireText("sim/simulator.mjs",'localStorage.getItem("arondight45FittedPhysicsV2")');
requireText("sim/simulator.mjs",'localStorage.setItem("arondight45FittedPhysicsV2"');
forbidText("sim/simulator.mjs",'localStorage.getItem("arondight45FittedPhysics")', "stale fitted-physics model key can silently override current baseline");
requireText("sim/simulator.mjs","SIM_AUX_INTERVAL_S = .01");
requireText("sim/simulator.mjs","auxAccumulatorS+=DT");
requireText("sim/simulator.mjs","(seq%20)===0");
forbidText("sim/simulator.mjs","(sequence&7)===0", "simulator fixed-step cadence must not be display-Hz divided");

// REAL WORLD is a geospatial/render adapter only. Browser GPS establishes the
// WGS84 horizontal origin; local x/y/z remain east/north/up SI metres.
// OpenFreeMap/OpenStreetMap are visual context only and never gain motor,
// controller or rigid-body authority.
for(const marker of ["navigator.geolocation.getCurrentPosition","enableHighAccuracy:true","tiles.openfreemap.org/styles/liberty","new MapLibreMap","metersToLngLat","source-layer\":\"building","render_height","render_min_height",'await import("./simulator.mjs")'])
  requireText("sim/real_world_bootstrap.mjs",marker);
for(const dirty of ["Box3DFactory","PhysicsModel","applyForces(","motorOmega","motorTorque","propTorque","fc::Runtime","StateController","b3Body_ApplyForce","b3World_Step","new MapLibreMap({container:this.minimap"])
  forbidText("sim/real_world_bootstrap.mjs",dirty,`real-world render adapter duplicated flight physics/control: ${dirty}`);
for(const path of ["sim/real_world_bootstrap.mjs","sim/control_settings.mjs","tests/real_world_ui_smoke.mjs","REAL_WORLD_DIGITAL_TWIN.md"])
  for(const dirty of ["Google"+" Maps","google"+"apis.com","Google"+"Tiles","Ces"+"ium","AI"+"za"])
    forbidText(path,dirty,`${path} still contains removed map-provider dependency: ${dirty}`);
requireText("sim/control_settings.mjs","openfreemap-osm-3d");
requireText("sim/control_settings.mjs","No account, API key, billing setup, backend or proxy is required.");
requireText("sim/control_settings.mjs","WORLD GRID");
requireText("sim/control_settings.mjs","KEEP 360° LOOK ORIENTATION");
forbidText("sim/control_settings.mjs","MINIMAP FOLLOWS 360° CAMERA","minimap must stay north-up in every camera mode");
for(const marker of ["MINIMAP · N↑","worldMinimapMode=\"north\"","calculateCameraOptionsFromTo","worldMapEyeElevation","setCameraFovDeg","toggleMinimapExpanded"])requireText("sim/real_world_bootstrap.mjs",marker);

for(const path of ["sim/simulator.mjs","sim/controller.mjs","sim/p2p_link.mjs"])
  forbidText(path,"lookPitch",`${path} still contains the removed virtual camera-look control`);
requireText("sim/simulator.mjs","channels[7]=Math.round(992+820*clamp(c.bodyPitch||0,-1,1))");
requireText("sim/simulator.mjs","FPV optics are rigidly mounted to the airframe");
for(const marker of ["class HybridMotorSound","model.motorOmega","model.motorTorque","model.propTorque","motorAudioPowerW","escWindingTone","armToneSequence","motorAudioArmEvent","motorAudioEscToneCount","playbackRate.setTargetAtTime"])requireText("sim/motor_sound.mjs",marker);
requireText("sim/simulator.mjs",'import {HybridMotorSound} from "./motor_sound.mjs";');
requireText("sim/simulator.mjs",'import {FlightLogbook} from "./flight_logbook.mjs";');
requireText("sim/simulator.mjs",'import {installFlightFireFx} from "./flight_fire_fx.mjs";');
for(const marker of ["FLIGHT_LOGBOOK_KEY","EXPORT JSON","maxForwardMps","maxRightMps"])requireText("sim/flight_logbook.mjs",marker);
for(const marker of ["installFlightFireFx","THREE.Raycaster","addVisualShotImpact","SHOT_INTERVAL_MS","DECAL_POOL_SIZE=32","touch-action:none"])requireText("sim/flight_fire_fx.mjs",marker);
for(const dirty of ["applyForces(","b3Body_ApplyForce","motorOmega","fc::Runtime","StateController"])forbidText("sim/flight_fire_fx.mjs",dirty,`presentation-only fire FX gained flight authority: ${dirty}`);
for(const marker of ["kStateNavigationDegraded","navigation_velocity_valid","navigation_agl_valid","degraded_attitude_command"])requireText("esp32/Arondight45_StateControl.hpp",marker);
for(const marker of ["kNavigationVelocityValid","kNavigationAglValid","kNavigationSplitValidity"])requireText("esp32/Arondight45_HardwareSensors.hpp",marker);
requireText("sim/simulator.mjs",'const motorSound=new HybridMotorSound($("viewport"));');
for(const marker of ["loadCameraSettings","mountCameraSettings","cameraSettings.fpvTiltDeg","cameraSettings.fpvFovDeg","cameraSettings.thirdDistanceM","camera.position.distanceTo(position)"])requireText("sim/simulator.mjs",marker);
for(const marker of ["FPV VERTICAL TILT","VIEW FOV","THIRD PERSON DISTANCE","arondight45CameraSettingsV1"])requireText("sim/camera_settings.mjs",marker);
requireText("sim/motor_sound.mjs",'this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque+tipSpeed:hybridBladeMotor"');
for(const marker of ["bladeSource","motorSource","washNoise","tipSpeed","playbackRate.setTargetAtTime"])requireText("sim/motor_sound.mjs",marker);
requireText("sim/control_semantics.mjs","export function applyGameStick");
requireText("sim/control_semantics.mjs","controls.bodyPitch=cfg.lockRightHorizontal?0:phoneAxis(-y");
requireText("sim/control_semantics.mjs","cfg.invertLeftHorizontal?-p.x:p.x");
requireText("sim/control_semantics.mjs","inverseGameStateStickMagnitude(desiredVelocityFraction)");
requireText("sim/control_semantics.mjs","controls.roll=x*factor;controls.pitch=forward*factor");
requireText("sim/control_semantics.mjs","gameHorizontalSpeedScale(cfg.maxHorizontalSpeedKmh)");
requireText("sim/control_settings.mjs","MAX HORIZONTAL SPEED");
requireText("sim/control_settings.mjs","maxHorizontalSpeedKmh:Number(speed.value)");
requireText("sim/controller.mjs","applyGameStick(controls,kind,point,phoneSettings)");
requireText("sim/controller.mjs","const keepArm=gameMode&&controls.arm");
requireText("sim/simulator.mjs","const keepArm=soloControls.arm");
requireText("sim/simulator.mjs","applyGameStick(soloControls,kind,point,phoneSettings)");
requireText("sim/p2p_link.mjs","bodyPitch:clamp(numeric[4],-1,1)");
const simulatorSource=read("sim/simulator.mjs"),controlsStart=simulatorSource.indexOf("function controls(){"),controlsEnd=simulatorSource.indexOf("async function controllerStep()",controlsStart);
if(controlsStart<0||controlsEnd<=controlsStart)fail("cannot isolate simulator controls() boundary");
if(!simulatorSource.slice(controlsStart,controlsEnd).includes("bodyPitch"))fail("GAME body pitch does not cross the real SBUS boundary");
const controllerHotStart=simulatorSource.indexOf("function prepareControllerStep(){"),controllerHotEnd=simulatorSource.indexOf("function recordSession(){",controllerHotStart);
if(controllerHotStart<0||controllerHotEnd<=controllerHotStart)fail("cannot isolate simulator controller-step boundary");
const controllerHotSource=simulatorSource.slice(controllerHotStart,controllerHotEnd);
if(controllerHotSource.includes("defaultParams()"))fail("1 kHz controller step re-reads DOM-backed physical parameters");
if(controllerHotSource.includes("ui.rtt.textContent"))fail("1 kHz controller step mutates RTT DOM");

for(const dirty of ["quantizedCentered","stateShape","desiredGameState","stateVectorDebug","data-vector-soll","data-vector-ist"])
  forbidText("sim/controller.mjs",dirty,`browser controller duplicated flight-state logic/UI: ${dirty}`);
requireText("sim/controller.mjs","measuredGameState");
requireText("sim/controller.mjs","dataset.navForwardMps");
requireText("sim/controller.mjs","W · FORWARD");
requireText("sim/controller.mjs","NOSE UP");
requireText("sim/controller.mjs","bindHeightKey(ui.gameUp,+1)");
requireText("sim/controller.mjs","bindHeightKey(ui.gameDown,-1)");
requireText("sim/controller.mjs","stepGroundClearanceTarget(groundClearance,heightAxis,SEND_INTERVAL_MS/1000)");
requireText("sim/controller.mjs","setInterval(publishControlTick,SEND_INTERVAL_MS)");
requireText("sim/simulator.mjs","stepGroundClearanceTarget(soloGroundClearance,soloHeightAxis,.01)");
requireText("sim/controller.mjs",'previousFcState==="ARMED"&&message.fc_state!=="ARMED"&&controls.arm');
requireText("sim/control_settings.mjs","DEFAULT HOVER ABOVE GROUND");
requireText("sim/control_semantics.mjs","defaultHoverAgl:1.2");
requireText("sim/control_semantics.mjs","maxHorizontalSpeedKmh:DEFAULT_GAME_HORIZONTAL_SPEED_KMH");
requireText("sim/control_semantics.mjs","MAX_GAME_HORIZONTAL_SPEED_KMH=90");
requireText("sim/control_semantics.mjs","MAX_GAME_CLEARANCE_M=50.0");
requireText("sim/control_semantics.mjs","MAX_GAME_CLEARANCE_RATE_MPS=5.0");
requireText("sim/control_semantics.mjs","stepGroundClearanceTarget");
requireText("esp32/Arondight45_StateControl.hpp","kStateMaxClearanceM = 50.00f");
for(const marker of ["WORLD_MAP_FRAME_MS=1000/30","WORLD_MAP_FRAME_MS_CONSTRAINED=1000/20","WORLD_MAP_FRAME_MS_CRITICAL=1000/15","WORLD_MAP_PIXEL_RATIO=1.0","WORLD_FLIGHT_PIXEL_RATIO=1.25","maxTileCacheZoomLevels:2","refreshExpiredTiles:false","validateStyle:false","crossSourceCollisions:false","trackResize:false","setSky({\"sky-color\":\"#071b2e\"","WORLD_MAP_MAX_PITCH=120","fpvTargetDistanceMeters(this.originLat,height,verticalFov,WORLD_MAP_MAX_ZOOM)","setVerticalFieldOfView(verticalFov)","worldMapEyeElevation","worldMapUpdates","worldFlightFps","setPerfMode(mode)","applyFlightPalette()","crossSourceCollisions:false","angularDistanceDeg","WORLD_GRID_STORAGE","WORLD_KEEP_LOOK_STORAGE","WORLD_MINIMAP_QUERY_MS=1000","queryRenderedFeatures(undefined,{layers:this.minimapLayerIds})","world-mini-canvas","worldMinimapMode","installLookHud()","installFreeLookSurface()","applyLookCamera(scene,camera)","camera.position.copy(basePosition)","this.airframe=null;scene.traverse","if(child.isGridHelper){child.visible=this.gridEnabled;continue;}"])requireText("sim/real_world_bootstrap.mjs",marker);
for(const marker of ["TorusGeometry(.15","worldHaloBack","worldHeadingCue","showWorldMarker=worldActive&&cameraMode!==\"fpv\""])requireText("sim/simulator.mjs",marker);
for(const marker of ['if(mode==="fpv"){const dir=','camera.lookAt(camera.position.clone().addScaledVector(dir,4));return;'])requireText("sim/real_world_bootstrap.mjs",marker);
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

requireText("sim/real_world_bootstrap.mjs","const airframe=this.airframeFor(this.threeScene)","VS pose sync must resolve the shared THREE airframe in every view/world mode");
requireText("sim/lan_vs.mjs","poseAction.onMessage=", "VS transport must use Trystero 0.25 action API");
requireText("sim/lan_vs.mjs","room.onPeerJoin=", "VS transport must use Trystero 0.25 peer callback property API");
forbidText("sim/lan_vs.mjs","const [sendPose,getPose]", "legacy Trystero tuple action API must not return");
forbidText("sim/real_world_bootstrap.mjs","queueMicrotask(()=>this.startVs())","VS signaling must never auto-start with the flight simulator");
requireText("sim/real_world_bootstrap.mjs","FIND MATE","VS must be an explicit in-game action");
forbidText("sim/real_world_bootstrap.mjs","PAIR CODE","VS discovery must stay automatic without pair-code UX");
forbidText("sim/lan_vs.mjs","manualRoomKey","manual room-code matching must not return");
requireText("sim/lan_vs.mjs","stun:stun.cloudflare.com:3478","same-network discovery must try WebRTC/STUN NAT identity before HTTP heuristics");
requireText("sim/lan_vs.mjs","@trystero-p2p/mqtt","VS must have a second serverless signaling strategy when Nostr is unavailable");
requireText("sim/lan_vs.mjs","room.makeAction(\"origin\")","VS must exchange shared origin independently from pose");
requireText("sim/lan_vs.mjs","setOrigin(origin)","VS must expose optional geodetic origin publication");
requireText("sim/real_world_bootstrap.mjs","this.vsSharedOrigin","GPS-less peers must accept a mate-provided world origin");
requireText("sim/real_world_bootstrap.mjs","this.vsSession.setOrigin({lon:this.originLon,lat:this.originLat,alt:0})","GPS-capable peers must publish their world origin");
requireText("sim/real_world_bootstrap.mjs","ensureVsSharedWorld(status=null)","GPS-less VS peer must adopt mate origin as the actual WORLD frame");
requireText("sim/real_world_bootstrap.mjs","vsSharedOrigin=null;this.vsSharedWorldAttempted=false;this.vsWorldFromMate=false;this.clearVsPeerPresentation()","peer leave must clear stale VS origin and presentation state");
requireText("sim/real_world_bootstrap.mjs","now-this.vsPeerLastPoseMs>1000","stale peer poses must disappear instead of freezing forever");
requireText("sim/real_world_bootstrap.mjs","this.vsPeerRenderPosition.lerp","peer pose smoothing must stay presentation-only");
forbidText("tests/lan_vs_smoke.mjs","p:[4,5,6],q:[0,0,.1,.99],g:","GPS-less regression peer must not carry geolocation");
requireText("sim/real_world_bootstrap.mjs","if(fromMate){this.originLon=null;this.originLat=null;this.vsWorldFromMate=false;}","failed mate-WORLD activation must roll back borrowed geospatial origin");
console.log("Architecture invariants passed: raw hardware boundary, one C++ motor authority, radial configurable GAME velocity envelope, geospatial WGS84/ENU render adapter only, direct WebRTC control and HIL-only bridge.");
forbidText("sim/controller.mjs","requestAnimationFrame(stepHeightTarget)","height target semantics must not depend on visual FPS");
forbidText("sim/simulator.mjs","stepSoloHeightTarget(renderNow)","solo height target semantics must not depend on visual FPS");
requireText("tests/browser_sim_smoke.mjs","fixed-step simulation is not tracking wall time");
requireText("tests/real_world_ui_smoke.mjs","WORLD GRID off did not persist");
requireText("tests/real_world_ui_smoke.mjs","WORLD semantic palette/legend marker missing");