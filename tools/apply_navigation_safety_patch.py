from pathlib import Path
import re


def replace_once(path, old, new):
    p=Path(path); s=p.read_text(); n=s.count(old)
    assert n==1, f"{path}: expected 1 occurrence, got {n}: {old[:120]!r}"
    p.write_text(s.replace(old,new,1))

# ---- State-vector contract: split velocity and AGL validity without widening NAV1. ----
p=Path('esp32/Arondight45_StateControl.hpp'); s=p.read_text()
s=s.replace('constexpr uint16_t kStateGameMode = 1u << 6;\n', 'constexpr uint16_t kStateGameMode = 1u << 6;\nconstexpr uint16_t kStateNavigationDegraded = 1u << 7;\n', 1)
old='''struct NavigationState {\n    V3 velocity_world_mps{};\n    float agl_m{};\n    bool valid{};\n};\n\ninline bool finite(const NavigationState& n) {\n    return n.valid && finite(n.velocity_world_mps) && std::isfinite(n.agl_m) &&\n           n.agl_m >= 0.0f && n.agl_m < 1000.0f;\n}\n'''
new='''struct NavigationState {\n    V3 velocity_world_mps{};\n    float agl_m{};\n    // valid remains the aggregate/full-NAV indicator for source compatibility.\n    // Split fields let a real rangefinder disappear without throwing away an\n    // otherwise healthy velocity solution.\n    bool valid{};\n    bool velocity_valid{};\n    bool agl_valid{};\n};\n\ninline bool navigation_velocity_valid(const NavigationState& n) {\n    return (n.velocity_valid || n.valid) && finite(n.velocity_world_mps);\n}\n\ninline bool navigation_agl_valid(const NavigationState& n) {\n    return (n.agl_valid || n.valid) && std::isfinite(n.agl_m) &&\n           n.agl_m >= 0.0f && n.agl_m < 1000.0f;\n}\n\ninline bool finite(const NavigationState& n) {\n    return navigation_velocity_valid(n) && navigation_agl_valid(n);\n}\n'''
assert old in s; s=s.replace(old,new,1)
# StateController gets explicit AGL validity and a real degraded attitude command.
s=s.replace('''    Command run(const RC& receiver, const NavigationState& nav, float yaw_deg,\n                bool inner_armed, float dt) {''','''    Command run(const RC& receiver, const NavigationState& nav, float yaw_deg,\n                bool inner_armed, float dt, bool agl_valid = true) {''',1)
s=s.replace('''        const float agl_error = intent.clearance_m - nav.agl_m;\n        const float target_vz = clamp(kAglToVerticalSpeed * agl_error,\n                                      -kMaxVerticalSpeedMps, kMaxVerticalSpeedMps);\n''','''        // AGL is a degradable aid, not an arming kill-switch. If the range source\n        // is unavailable in flight, command zero vertical speed from the still\n        // valid velocity solution. Never fabricate a ground distance.\n        const float agl_error = agl_valid ? intent.clearance_m - nav.agl_m : 0.0f;\n        const float target_vz = agl_valid\n            ? clamp(kAglToVerticalSpeed * agl_error, -kMaxVerticalSpeedMps, kMaxVerticalSpeedMps)\n            : 0.0f;\n''',1)
# Do not adapt hover trim from an absent AGL loop; learned trim is preserved.
s=s.replace('''        hover_trim_ = clamp(hover_trim_ + kHoverAdapt * vz_error * dt,\n                            kMinHoverTrim, kMaxHoverTrim);''','''        if (agl_valid) {\n            hover_trim_ = clamp(hover_trim_ + kHoverAdapt * vz_error * dt,\n                                kMinHoverTrim, kMaxHoverTrim);\n        }''',1)
needle='''    const StateControllerDebug& debug() const { return debug_; }\n    float hover_trim() const { return hover_trim_; }\n\nprivate:\n'''
insert='''    // Full navigation can disappear while IMU and pilot control remain healthy.\n    // This fallback deliberately uses no invented position/velocity/height: it\n    // maps GAME sticks to bounded attitude/rate commands and the learned physical\n    // hover trim, leaving the shared inner FC as the sole motor authority.\n    Command degraded_attitude_command(const RC& receiver) const {\n        const StateIntent intent = state_intent(receiver);\n        const float right_unit = clamp(intent.right_mps / kStateMaxHorizontalSpeedMps, -1.0f, 1.0f);\n        const float forward_unit = clamp(intent.forward_mps / kStateMaxHorizontalSpeedMps, -1.0f, 1.0f);\n        const float roll_target_deg = -right_unit * kDegradedMaxTiltDeg;\n        const float pitch_target_deg = clamp(-forward_unit * kDegradedMaxTiltDeg +\n                                             intent.body_pitch_deg * kDegradedBodyPitchScale,\n                                             -kDegradedMaxTiltDeg, kDegradedMaxTiltDeg);\n        const float roll_command = clamp(roll_target_deg / kInnerAttitudeRangeDeg,\n                                         -kMaxAttitudeCommand, kMaxAttitudeCommand);\n        const float pitch_command = clamp(pitch_target_deg / kInnerAttitudeRangeDeg,\n                                          -kMaxAttitudeCommand, kMaxAttitudeCommand);\n        const float vertical_fraction = std::max(0.50f,\n            std::cos(roll_target_deg * kPi / 180.0f) *\n            std::cos(pitch_target_deg * kPi / 180.0f));\n        const float hover_motor_command = kEscCommandOffset + kEscCommandScale * hover_trim_;\n        const float required_motor_command = hover_motor_command / std::sqrt(vertical_fraction);\n        const float throttle_command = clamp(\n            (required_motor_command - kEscCommandOffset) / kEscCommandScale,\n            kMinFlightThrottle, kMaxFlightThrottle);\n        return sanitize(Command{roll_command, pitch_command, throttle_command,\n                                intent.yaw_rate_dps / 180.0f, intent.arm});\n    }\n\n    const StateControllerDebug& debug() const { return debug_; }\n    float hover_trim() const { return hover_trim_; }\n\nprivate:\n'''
assert needle in s; s=s.replace(needle,insert,1)
s=s.replace('''    static constexpr float kMaxAttitudeCommand = kMaxTiltDeg / kInnerAttitudeRangeDeg;\n''','''    static constexpr float kMaxAttitudeCommand = kMaxTiltDeg / kInnerAttitudeRangeDeg;\n    static constexpr float kDegradedMaxTiltDeg = 12.0f;\n    static constexpr float kDegradedBodyPitchScale = 0.35f;\n''',1)
# Replace StateRuntime step body, preserving hard RC/IMU/timing semantics.
pattern=r'''    RuntimeOutput step\(StateRuntimeInput input\) \{.*?\n    \}\n\n    Runtime& inner\(\)'''
m=re.search(pattern,s,re.S); assert m, 'StateRuntime step block not found'
replacement='''    RuntimeOutput step(StateRuntimeInput input) {\n        const StateIntent intent = state_intent(input.flight.rc);\n        if (!intent.game_mode) {\n            if (game_active_) state_controller_.leave_mode();\n            game_active_ = false;\n            RuntimeOutput out = runtime_.step(input.flight);\n            update_attitude(out);\n            return out;\n        }\n\n        game_active_ = true;\n        const bool receiver_valid = input.flight.rc.valid && input.flight.rc_fresh;\n        if (!receiver_valid) {\n            // Real control-link loss remains a hard fail-safe. Navigation loss is\n            // handled separately below and must never masquerade as RC loss.\n            state_controller_.leave_mode();\n            RuntimeOutput out = runtime_.step_command(input.flight, Command{}, false);\n            out.state |= kStateGameMode;\n            update_attitude(out);\n            return out;\n        }\n\n        const bool velocity_valid = navigation_velocity_valid(input.navigation);\n        const bool agl_valid = navigation_agl_valid(input.navigation);\n        const bool full_navigation = velocity_valid && agl_valid;\n\n        if (!runtime_.armed() && !full_navigation) {\n            // Arming still requires the complete navigation contract. command_valid\n            // stays false so an ARM-high request cannot satisfy the low-before-arm\n            // latch while sensors are degraded.\n            state_controller_.leave_mode();\n            RuntimeOutput out = runtime_.step_command(input.flight, Command{}, false);\n            out.state |= kStateGameMode | kStateNavigationDegraded;\n            update_attitude(out);\n            return out;\n        }\n\n        const float dt = (input.flight.dt_us > 0 && input.flight.dt_us < 100000)\n                             ? static_cast<float>(input.flight.dt_us) * 1.0e-6f\n                             : 0.001f;\n        Command physical_command{};\n        if (velocity_valid) {\n            physical_command = state_controller_.run(\n                input.flight.rc, input.navigation, last_yaw_deg_, runtime_.armed(), dt, agl_valid);\n        } else {\n            // Complete nav loss while already flying degrades to bounded IMU\n            // attitude/rate control plus learned hover trim. No position, velocity\n            // or terrain value is invented.\n            state_controller_.leave_mode();\n            physical_command = state_controller_.degraded_attitude_command(input.flight.rc);\n        }\n\n        RuntimeOutput out = runtime_.step_command(input.flight, physical_command, true);\n        out.state |= kStateGameMode;\n        if (full_navigation) out.state |= kStateNavigationValid;\n        else out.state |= kStateNavigationDegraded;\n        update_attitude(out);\n        return out;\n    }\n\n    Runtime& inner()'''
s=s[:m.start()]+replacement+s[m.end():]
p.write_text(s)

# ---- Wire contract: keep 20-byte NAV1 and v1 compatibility while splitting flags. ----
p=Path('esp32/Arondight45_HardwareSensors.hpp'); s=p.read_text()
s=s.replace('''constexpr uint16_t kNavigationValid = 1u << 0;\n''','''constexpr uint16_t kNavigationVelocityValid = 1u << 0;\nconstexpr uint16_t kNavigationAglValid = 1u << 1;\nconstexpr uint16_t kNavigationSplitValidity = 1u << 15;\n// Legacy v1 senders used bit 0 to mean the whole NAV solution was valid.\nconstexpr uint16_t kNavigationValid = kNavigationVelocityValid;\n''',1)
old='''    out.velocity_world_mps = {frame.vx_cms * 0.01f,\n                              frame.vy_cms * 0.01f,\n                              frame.vz_cms * 0.01f};\n    out.agl_m = frame.agl_mm * 0.001f;\n    out.valid = (frame.flags & kNavigationValid) != 0;\n    return !out.valid || fc::finite(out);\n}\n\ninline NavigationWireFrame encode_navigation_wire(uint16_t sequence,\n                                                  float vx_mps, float vy_mps, float vz_mps,\n                                                  float agl_m, bool valid) {\n'''
new='''    out.velocity_world_mps = {frame.vx_cms * 0.01f,\n                              frame.vy_cms * 0.01f,\n                              frame.vz_cms * 0.01f};\n    out.agl_m = frame.agl_mm * 0.001f;\n    const bool split = (frame.flags & kNavigationSplitValidity) != 0;\n    if (split) {\n        out.velocity_valid = (frame.flags & kNavigationVelocityValid) != 0;\n        out.agl_valid = (frame.flags & kNavigationAglValid) != 0;\n    } else {\n        const bool legacy_valid = (frame.flags & kNavigationValid) != 0;\n        out.velocity_valid = legacy_valid;\n        out.agl_valid = legacy_valid;\n    }\n    out.valid = out.velocity_valid && out.agl_valid;\n    return (!out.velocity_valid || fc::finite(out.velocity_world_mps)) &&\n           (!out.agl_valid || (std::isfinite(out.agl_m) && out.agl_m >= 0.0f));\n}\n\ninline NavigationWireFrame encode_navigation_wire(uint16_t sequence,\n                                                  float vx_mps, float vy_mps, float vz_mps,\n                                                  float agl_m, bool velocity_valid, bool agl_valid) {\n'''
assert old in s; s=s.replace(old,new,1)
s=s.replace('''    frame.flags = valid ? kNavigationValid : 0u;\n    frame.crc16 = crc16_ccitt(&frame, offsetof(NavigationWireFrame, crc16));\n    return frame;\n}\n\nclass NavigationWireParser''','''    frame.flags = kNavigationSplitValidity |\n        (velocity_valid ? kNavigationVelocityValid : 0u) |\n        (agl_valid ? kNavigationAglValid : 0u);\n    frame.crc16 = crc16_ccitt(&frame, offsetof(NavigationWireFrame, crc16));\n    return frame;\n}\n\ninline NavigationWireFrame encode_navigation_wire(uint16_t sequence,\n                                                  float vx_mps, float vy_mps, float vz_mps,\n                                                  float agl_m, bool valid) {\n    return encode_navigation_wire(sequence, vx_mps, vy_mps, vz_mps, agl_m, valid, valid);\n}\n\nclass NavigationWireParser''',1)
p.write_text(s)

# Firmware freshness clears both split domains; no stale sub-signal can stay valid.
p=Path('esp32/Arondight45_FirmwareRuntime.hpp'); s=p.read_text()
s=s.replace('''            hardware.now_us - navigation_us_ > hwcontract::kNavigationTimeoutUs) {\n            navigation.valid = false;\n        }''','''            hardware.now_us - navigation_us_ > hwcontract::kNavigationTimeoutUs) {\n            navigation.valid = false;\n            navigation.velocity_valid = false;\n            navigation.agl_valid = false;\n        }''',1)
p.write_text(s)

# ---- Browser sensor twin emits split validity from real simulated sensor domains. ----
p=Path('sim/simulator.mjs'); s=p.read_text()
s=s.replace('''const STATE_GAME_MODE = 1 << 6;\n''','''const STATE_GAME_MODE = 1 << 6;\nconst STATE_NAVIGATION_DEGRADED = 1 << 7;\nconst NAV_VELOCITY_VALID = 1 << 0;\nconst NAV_AGL_VALID = 1 << 1;\nconst NAV_SPLIT_VALIDITY = 1 << 15;\n''',1)
s=s.replace('''  view.setInt16(8,s16(measurement.vx),true);view.setInt16(10,s16(measurement.vy),true);view.setInt16(12,s16(measurement.vz),true);\n  view.setUint16(14,clamp(Math.round(Math.max(0,measurement.agl)*1000),0,65535),true);view.setUint16(16,measurement.valid?1:0,true);\n''','''  view.setInt16(8,s16(measurement.vx),true);view.setInt16(10,s16(measurement.vy),true);view.setInt16(12,s16(measurement.vz),true);\n  const flags=NAV_SPLIT_VALIDITY|(measurement.velocityValid?NAV_VELOCITY_VALID:0)|(measurement.aglValid?NAV_AGL_VALID:0);\n  view.setUint16(14,clamp(Math.round(Math.max(0,measurement.agl)*1000),0,65535),true);view.setUint16(16,flags,true);\n''',1)
s=s.replace('''  reset(){this.noise=new Noise(0x7193ab21);this.elapsed=.01;this.filtered=[0,0,0];this.sequence=1;this.last={vx:0,vy:0,vz:0,agl:0,valid:false};}\n''','''  reset(){this.noise=new Noise(0x7193ab21);this.elapsed=.01;this.filtered=[0,0,0];this.sequence=1;this.last={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false};}\n''',1)
s=s.replace('''    const range=model.groundRange(NAV_AGL_RAY_MAX_M);let valid=range.valid,agl=0;\n    if(valid){const measuredSlant=Math.max(0,range.slant+this.noise.gaussian()*.004);agl=measuredSlant*range.verticalProjection;}\n    this.last={vx:this.filtered[0],vy:this.filtered[1],vz:this.filtered[2],agl,valid};\n''','''    const velocityValid=this.filtered.every(Number.isFinite),range=model.groundRange(NAV_AGL_RAY_MAX_M),aglValid=range.valid;let agl=0;\n    if(aglValid){const measuredSlant=Math.max(0,range.slant+this.noise.gaussian()*.004);agl=measuredSlant*range.verticalProjection;}\n    this.last={vx:this.filtered[0],vy:this.filtered[1],vz:this.filtered[2],agl,valid:velocityValid&&aglValid,velocityValid,aglValid};\n''',1)
s=s.replace('''latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false};''','''latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false};''')
s=s.replace('''navigation_valid:Boolean(fcState&STATE_NAVIGATION_VALID),target_ground_clearance''','''navigation_valid:Boolean(fcState&STATE_NAVIGATION_VALID),navigation_degraded:Boolean(fcState&STATE_NAVIGATION_DEGRADED),nav_velocity_valid:Boolean(latestNavigation.velocityValid),nav_agl_valid:Boolean(latestNavigation.aglValid),target_ground_clearance''',1)
s=s.replace('''$("soloAlt").textContent=`AGL ${latestNavigation.valid?latestNavigation.agl.toFixed(1):"—"} m`;soloRangeStatus.textContent=latestNavigation.valid?`AGL ${latestNavigation.agl.toFixed(1)} m`:"NAV INVALID";soloRangeStatus.style.color=latestNavigation.valid?"#64e0ae":"#ffd06d";''','''$("soloAlt").textContent=`AGL ${latestNavigation.aglValid?latestNavigation.agl.toFixed(1):"—"} m`;soloRangeStatus.textContent=latestNavigation.valid?`AGL ${latestNavigation.agl.toFixed(1)} m`:latestNavigation.velocityValid?"NAV DEGRADED · AGL LOST":"NAV DEGRADED · ATTITUDE HOLD";soloRangeStatus.style.color=latestNavigation.valid?"#64e0ae":"#ffd06d";''',1)
p.write_text(s)

# Controller: distinguish degraded NAV in UI and retain ARM latch across transient
# WebRTC state flaps; true freshness loss still disarms on the view/FC side.
p=Path('sim/controller.mjs'); s=p.read_text()
s=s.replace('''  const vx=Number(lastTelemetry.nav_vx_mps),vy=Number(lastTelemetry.nav_vy_mps),vz=Number(lastTelemetry.nav_vz_mps),yaw=Number(lastTelemetry.yaw_deg),agl=Number(lastTelemetry.agl_m);\n  if(lastTelemetry.navigation_valid!==true||![vx,vy,vz,yaw,agl].every(Number.isFinite))return{valid:false};\n  const radians=yaw*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);\n  return{valid:true,forward:-c*vx-s*vy,right:-s*vx+c*vy,vertical:vz,agl,yaw};\n''','''  const vx=Number(lastTelemetry.nav_vx_mps),vy=Number(lastTelemetry.nav_vy_mps),vz=Number(lastTelemetry.nav_vz_mps),yaw=Number(lastTelemetry.yaw_deg),agl=Number(lastTelemetry.agl_m);\n  const velocityValid=lastTelemetry.nav_velocity_valid===true||lastTelemetry.navigation_valid===true;\n  const aglValid=lastTelemetry.nav_agl_valid===true||lastTelemetry.navigation_valid===true;\n  if(!velocityValid||![vx,vy,vz,yaw].every(Number.isFinite))return{valid:false,velocityValid:false,aglValid:false};\n  const radians=yaw*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);\n  return{valid:velocityValid&&aglValid,velocityValid,aglValid,forward:-c*vx-s*vy,right:-s*vx+c*vy,vertical:vz,agl:aglValid&&Number.isFinite(agl)?agl:null,yaw};\n''',1)
s=s.replace('''  if(!nav.valid){\n    ui.gameSensorStatus.textContent=lastTelemetry.game_mode?"NAV INVALID":"STATE READY";\n    ui.gameSensorStatus.style.color="#ffd06d";\n    ui.gameNav.textContent="F — · R —";\n    for(const key of ["navForwardMps","navRightMps","navVerticalMps","aglM","yawDeg"])delete ui.gameClearance.dataset[key];\n    return;\n  }\n  ui.gameSensorStatus.textContent=`AGL ${nav.agl.toFixed(1)} m`;\n''','''  if(!nav.velocityValid){\n    ui.gameSensorStatus.textContent=lastTelemetry.game_mode?"NAV DEGRADED · ATTITUDE HOLD":"STATE READY";\n    ui.gameSensorStatus.style.color="#ffd06d";\n    ui.gameNav.textContent="F — · R —";\n    for(const key of ["navForwardMps","navRightMps","navVerticalMps","aglM","yawDeg"])delete ui.gameClearance.dataset[key];\n    return;\n  }\n  ui.gameSensorStatus.textContent=nav.aglValid?`AGL ${nav.agl.toFixed(1)} m`:"NAV DEGRADED · AGL LOST";\n''',1)
s=s.replace('''  ui.gameClearance.dataset.aglM=String(nav.agl);\n''','''  if(nav.aglValid)ui.gameClearance.dataset.aglM=String(nav.agl);else delete ui.gameClearance.dataset.aglM;\n''',1)
s=s.replace('''function safetyNeutral(send=true){stopHeightUp();stopHeightDown();setHeightAxis(0);controls=neutralForMode();updateSticks();if(send)publish();}\n''','''function safetyNeutral(send=true,{preserveArm=false}={}){const keepArm=preserveArm&&controls.arm;stopHeightUp();stopHeightDown();setHeightAxis(0);controls=neutralForMode();controls.arm=keepArm;updateSticks();if(send)publish();}\n''',1)
s=s.replace('''peer.onState=()=>{updateConnection();if(!peer.linked)safetyNeutral(false);};''','''peer.onState=()=>{updateConnection();if(!peer.linked)safetyNeutral(false,{preserveArm:Boolean(peer.pc&&peer.recentlyLinked)});};''',1)
p.write_text(s)

# ---- Direct safety regressions. ----
p=Path('tests/state_control_test.cpp'); s=p.read_text()
marker='''    const fc::Imu still{{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}};\n'''
addition=r'''    // In-flight AGL loss must degrade, never cut motors. Velocity remains real,
    // so vertical control switches to vz=0 while horizontal state control remains active.
    {
        fc::StateRuntime state_runtime;
        uint64_t t = 0;
        fc::StateRuntimeInput in{};
        for (uint32_t i = 0; i < fc::kCalibrationSamples + 10; ++i) {
            in.flight = stationary_input(t += 1000);
            in.flight.rc = base_rc(false);
            in.navigation = {{0.0f, 0.0f, 0.0f}, 2.0f, true, true, true};
            state_runtime.step(in);
        }
        for (int i = 0; i < 1100; ++i) {
            in.flight = stationary_input(t += 1000);
            in.flight.rc = base_rc(true);
            in.navigation = {{0.0f, 0.0f, 0.0f}, 2.0f, true, true, true};
            state_runtime.step(in);
        }
        CHECK(state_runtime.inner().armed());
        in.flight = stationary_input(t += 1000);
        in.flight.rc = base_rc(true);
        in.navigation = {{0.0f, 0.0f, 0.35f}, 0.0f, false, true, false};
        auto degraded = state_runtime.step(in);
        CHECK(degraded.armed);
        CHECK((degraded.state & fc::kStateNavigationDegraded) != 0);
        CHECK((degraded.state & fc::kStateNavigationValid) == 0);
        CHECK(state_runtime.state_controller().debug().target_vz_mps == 0.0f);
        CHECK(degraded.motor_us[0] > fc::kEscMinUs);

        // If all NAV is lost, an already-airborne craft falls back to bounded
        // IMU attitude/hover control. It still obeys a real ARM-low immediately.
        in.flight = stationary_input(t += 1000);
        in.flight.rc = base_rc(true);
        in.navigation = {{}, 0.0f, false, false, false};
        degraded = state_runtime.step(in);
        CHECK(degraded.armed);
        CHECK((degraded.state & fc::kStateNavigationDegraded) != 0);
        CHECK(degraded.motor_us[0] > fc::kEscMinUs);
        in.flight.rc = base_rc(false);
        degraded = state_runtime.step(in);
        CHECK(!degraded.armed);
        for (auto pulse : degraded.motor_us) CHECK(pulse == fc::kEscMinUs);
    }

'''
assert marker in s; s=s.replace(marker,addition+marker,1); p.write_text(s)

p=Path('tests/drone_hil_protocol_test.cpp'); s=p.read_text()
# Add compact wire split/legacy checks near main start.
needle='''int main() {\n'''
addition=r'''int main() {
    {
        const auto split = hwcontract::encode_navigation_wire(7, 1.0f, -2.0f, 0.3f, 0.0f, true, false);
        fc::NavigationState decoded{};
        CHECK(hwcontract::decode_navigation_wire(split, decoded));
        CHECK(decoded.velocity_valid);
        CHECK(!decoded.agl_valid);
        CHECK(!decoded.valid);
        CHECK(fc::navigation_velocity_valid(decoded));
        CHECK(!fc::navigation_agl_valid(decoded));

        auto legacy = split;
        legacy.flags = hwcontract::kNavigationValid;
        legacy.agl_mm = 2300;
        legacy.crc16 = hwcontract::crc16_ccitt(&legacy, offsetof(hwcontract::NavigationWireFrame, crc16));
        decoded = {};
        CHECK(hwcontract::decode_navigation_wire(legacy, decoded));
        CHECK(decoded.valid && decoded.velocity_valid && decoded.agl_valid);
    }
'''
assert s.count(needle)==1; s=s.replace(needle,addition,1); p.write_text(s)
