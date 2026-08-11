from pathlib import Path


def replace_one(path, old, new):
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{path}: expected one match, got {n}: {old[:120]!r}")
    p.write_text(s.replace(old, new))


# 1) Navigation state + StateController: body-relative world velocity requires
# an absolute heading reference. Fall back to IMU yaw only when NAV heading is absent.
state = "esp32/Arondight45_StateControl.hpp"
replace_one(state,
'''struct NavigationState {
    V3 velocity_world_mps{};
    float agl_m{};
    bool valid{};
    bool velocity_valid{};
    bool agl_valid{};
};

inline bool navigation_velocity_valid(const NavigationState& n) {
    return (n.velocity_valid || n.valid) && finite(n.velocity_world_mps);
}
inline bool navigation_agl_valid(const NavigationState& n) {
    return (n.agl_valid || n.valid) && std::isfinite(n.agl_m) && n.agl_m >= 0.0f && n.agl_m < 1000.0f;
}
inline bool finite(const NavigationState& n) {
    return navigation_velocity_valid(n) && navigation_agl_valid(n);
}''',
'''struct NavigationState {
    V3 velocity_world_mps{};
    float agl_m{};
    bool valid{};
    bool velocity_valid{};
    bool agl_valid{};
    float heading_deg{};
    bool heading_valid{};
};

inline bool navigation_velocity_valid(const NavigationState& n) {
    return (n.velocity_valid || n.valid) && finite(n.velocity_world_mps);
}
inline bool navigation_agl_valid(const NavigationState& n) {
    return (n.agl_valid || n.valid) && std::isfinite(n.agl_m) && n.agl_m >= 0.0f && n.agl_m < 1000.0f;
}
inline bool navigation_heading_valid(const NavigationState& n) {
    return n.heading_valid && std::isfinite(n.heading_deg) && n.heading_deg >= -180.0f && n.heading_deg <= 180.0f;
}
inline bool finite(const NavigationState& n) {
    return navigation_velocity_valid(n) && navigation_agl_valid(n);
}''')
replace_one(state,
'''    void reset() {
        active_ = false;
        target_yaw_deg_ = 0.0f;
        hover_trim_ = kInitialHoverThrottle;
        reset_horizontal_state();
        debug_ = {};
    }

    void leave_mode() {
        active_ = false;
        reset_horizontal_state();
        debug_ = {};
    }''',
'''    void reset() {
        active_ = false;
        heading_source_valid_ = false;
        target_yaw_deg_ = 0.0f;
        hover_trim_ = kInitialHoverThrottle;
        reset_horizontal_state();
        debug_ = {};
    }

    void leave_mode() {
        active_ = false;
        heading_source_valid_ = false;
        reset_horizontal_state();
        debug_ = {};
    }''')
replace_one(state,
'''        const StateIntent intent = state_intent(receiver);
        if (!active_) {
            target_yaw_deg_ = wrap_degrees(yaw_deg);
            active_ = true;
        }

        dt = clamp(dt, 0.0002f, 0.02f);
        target_yaw_deg_ = wrap_degrees(target_yaw_deg_ + intent.yaw_rate_dps * dt);

        const float yaw_rad = yaw_deg * kPi / 180.0f;''',
'''        const StateIntent intent = state_intent(receiver);
        const bool absolute_heading_valid = navigation_heading_valid(nav);
        const float measured_yaw_deg = wrap_degrees(absolute_heading_valid ? nav.heading_deg : yaw_deg);
        // World-frame navigation velocity cannot be projected into body forward/right
        // indefinitely from a 6-DoF gyro yaw: yaw has no absolute observable and drifts.
        // NAV heading closes that missing degree of freedom. On source transitions we
        // rebase the target to the current physical heading and clear frame-dependent
        // horizontal estimator/integral state, avoiding a discontinuous yaw command.
        if (!active_ || heading_source_valid_ != absolute_heading_valid) {
            target_yaw_deg_ = measured_yaw_deg;
            heading_source_valid_ = absolute_heading_valid;
            reset_horizontal_state();
            active_ = true;
        }

        dt = clamp(dt, 0.0002f, 0.02f);
        target_yaw_deg_ = wrap_degrees(target_yaw_deg_ + intent.yaw_rate_dps * dt);

        const float yaw_rad = measured_yaw_deg * kPi / 180.0f;''')
replace_one(state,
'''        if (!inner_armed) {
            reset_horizontal_state();
            target_yaw_deg_ = wrap_degrees(yaw_deg);
            debug_ = {intent.forward_mps, measured_forward,
                      intent.right_mps, measured_right,
                      target_yaw_deg_, yaw_deg,''',
'''        if (!inner_armed) {
            reset_horizontal_state();
            target_yaw_deg_ = measured_yaw_deg;
            heading_source_valid_ = absolute_heading_valid;
            debug_ = {intent.forward_mps, measured_forward,
                      intent.right_mps, measured_right,
                      target_yaw_deg_, measured_yaw_deg,''')
replace_one(state,
'''        const float yaw_error = wrap_degrees(target_yaw_deg_ - yaw_deg);
        const float desired_yaw_rate = clamp(intent.yaw_rate_dps + kHeadingKp * yaw_error,''',
'''        const float yaw_error = wrap_degrees(target_yaw_deg_ - measured_yaw_deg);
        const float desired_yaw_rate = clamp(intent.yaw_rate_dps + kHeadingKp * yaw_error,''')
replace_one(state,
'''                  intent.right_mps, measured_right,
                  target_yaw_deg_, yaw_deg,
                  intent.clearance_m, nav.agl_m,''',
'''                  intent.right_mps, measured_right,
                  target_yaw_deg_, measured_yaw_deg,
                  intent.clearance_m, nav.agl_m,''')
replace_one(state,
'''    bool active_{};
    bool acceleration_estimator_valid_{};''',
'''    bool active_{};
    bool heading_source_valid_{};
    bool acceleration_estimator_valid_{};''')
replace_one(state,
'''        const bool velocity_valid = navigation_velocity_valid(input.navigation);
        const bool agl_valid = navigation_agl_valid(input.navigation);
        const bool full_navigation = velocity_valid && agl_valid;

        if (!runtime_.armed() && !full_navigation) {''',
'''        const bool velocity_valid = navigation_velocity_valid(input.navigation);
        const bool agl_valid = navigation_agl_valid(input.navigation);
        const bool heading_valid = navigation_heading_valid(input.navigation);
        const bool horizontal_navigation = velocity_valid && heading_valid;
        const bool full_navigation = horizontal_navigation && agl_valid;

        if (!runtime_.armed() && !full_navigation) {''')
replace_one(state,
'''        if (velocity_valid) {
            physical_command = state_controller_.run(
                input.flight.rc, input.navigation, last_yaw_deg_, runtime_.armed(), dt, agl_valid);''',
'''        if (horizontal_navigation) {
            physical_command = state_controller_.run(
                input.flight.rc, input.navigation, last_yaw_deg_, runtime_.armed(), dt, agl_valid);''')

# 2) Pack optional absolute heading into unused NAV1 flag bits. Frame stays 20 bytes
# and old NAV1 producers remain decodable (heading simply invalid).
hw = "esp32/Arondight45_HardwareSensors.hpp"
replace_one(hw,
'''constexpr uint16_t kNavigationVelocityValid = 1u << 0;
constexpr uint16_t kNavigationAglValid = 1u << 1;
constexpr uint16_t kNavigationSplitValidity = 1u << 15;''',
'''constexpr uint16_t kNavigationVelocityValid = 1u << 0;
constexpr uint16_t kNavigationAglValid = 1u << 1;
constexpr uint16_t kNavigationHeadingValid = 1u << 2;
constexpr uint16_t kNavigationHeadingShift = 3;
constexpr uint16_t kNavigationHeadingMask = 0x7ff8u;  // 12 bits, 0.1 degree/code.
constexpr uint16_t kNavigationSplitValidity = 1u << 15;''')
replace_one(hw,
'''    out.valid = out.velocity_valid && out.agl_valid;
    return (!out.velocity_valid || fc::finite(out.velocity_world_mps)) &&
           (!out.agl_valid || (std::isfinite(out.agl_m) && out.agl_m >= 0.0f));
}''',
'''    out.heading_valid = split && (frame.flags & kNavigationHeadingValid) != 0;
    out.heading_deg = 0.0f;
    if (out.heading_valid) {
        const uint16_t code = static_cast<uint16_t>((frame.flags & kNavigationHeadingMask) >> kNavigationHeadingShift);
        if (code >= 3600u) return false;
        out.heading_deg = static_cast<float>(code) * 0.1f;
        if (out.heading_deg >= 180.0f) out.heading_deg -= 360.0f;
    }
    out.valid = out.velocity_valid && out.agl_valid;
    return (!out.velocity_valid || fc::finite(out.velocity_world_mps)) &&
           (!out.agl_valid || (std::isfinite(out.agl_m) && out.agl_m >= 0.0f)) &&
           (!out.heading_valid || fc::navigation_heading_valid(out));
}''')
replace_one(hw,
'''inline NavigationWireFrame encode_navigation_wire(uint16_t sequence,
                                                  float vx_mps, float vy_mps, float vz_mps,
                                                  float agl_m, bool velocity_valid, bool agl_valid) {''',
'''inline NavigationWireFrame encode_navigation_wire(uint16_t sequence,
                                                  float vx_mps, float vy_mps, float vz_mps,
                                                  float agl_m, bool velocity_valid, bool agl_valid,
                                                  float heading_deg = 0.0f, bool heading_valid = false) {''')
replace_one(hw,
'''    frame.flags = kNavigationSplitValidity |
        (velocity_valid ? kNavigationVelocityValid : 0u) |
        (agl_valid ? kNavigationAglValid : 0u);
    frame.crc16 = crc16_ccitt(&frame, offsetof(NavigationWireFrame, crc16));''',
'''    frame.flags = kNavigationSplitValidity |
        (velocity_valid ? kNavigationVelocityValid : 0u) |
        (agl_valid ? kNavigationAglValid : 0u);
    if (heading_valid && std::isfinite(heading_deg)) {
        float wrapped = std::fmod(heading_deg, 360.0f);
        if (wrapped < 0.0f) wrapped += 360.0f;
        long code = std::lround(wrapped * 10.0f);
        if (code >= 3600l) code -= 3600l;
        frame.flags |= kNavigationHeadingValid |
            static_cast<uint16_t>((static_cast<uint16_t>(code) << kNavigationHeadingShift) & kNavigationHeadingMask);
    }
    frame.crc16 = crc16_ccitt(&frame, offsetof(NavigationWireFrame, crc16));''')

# 3) Browser sensor model emits a noisy absolute heading measurement over the
# same 20-byte NAV1 frame; no simulator truth enters the FC except through wire bytes.
sim = "sim/simulator.mjs"
replace_one(sim,
'''const NAV_VELOCITY_VALID = 1 << 0;
const NAV_AGL_VALID = 1 << 1;
const NAV_SPLIT_VALIDITY = 1 << 15;''',
'''const NAV_VELOCITY_VALID = 1 << 0;
const NAV_AGL_VALID = 1 << 1;
const NAV_HEADING_VALID = 1 << 2;
const NAV_HEADING_SHIFT = 3;
const NAV_SPLIT_VALIDITY = 1 << 15;''')
replace_one(sim,
'''  const flags=NAV_SPLIT_VALIDITY|(measurement.velocityValid?NAV_VELOCITY_VALID:0)|(measurement.aglValid?NAV_AGL_VALID:0);
  view.setUint16(14,clamp(Math.round(Math.max(0,measurement.agl)*1000),0,65535),true);view.setUint16(16,flags,true);''',
'''  let flags=NAV_SPLIT_VALIDITY|(measurement.velocityValid?NAV_VELOCITY_VALID:0)|(measurement.aglValid?NAV_AGL_VALID:0);
  if(measurement.headingValid&&Number.isFinite(measurement.headingDeg)){
    const wrapped=((measurement.headingDeg%360)+360)%360,code=Math.round(wrapped*10)%3600;
    flags|=NAV_HEADING_VALID|(code<<NAV_HEADING_SHIFT);
  }
  view.setUint16(14,clamp(Math.round(Math.max(0,measurement.agl)*1000),0,65535),true);view.setUint16(16,flags,true);''')
replace_one(sim,
'''class SimNavigationSensors {
  constructor(){this.reset();}
  reset(){this.noise=new Noise(0x7193ab21);this.elapsed=.01;this.filtered=[0,0,0];this.sequence=1;this.last={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false};}
  sampleFrame(model,dt=DT){
    this.elapsed+=dt;if(this.elapsed<.01)return null;this.elapsed-=.01;
    const truth=model.linear(),alpha=.42;
    for(let i=0;i<3;i++){const measured=truth[i]+this.noise.gaussian()*.025;this.filtered[i]+=alpha*(measured-this.filtered[i]);}
    const velocityValid=this.filtered.every(Number.isFinite),range=model.groundRange(NAV_AGL_RAY_MAX_M),aglValid=range.valid;let agl=0;
    if(aglValid){const measuredSlant=Math.max(0,range.slant+this.noise.gaussian()*.004);agl=measuredSlant*range.verticalProjection;}
    this.last={vx:this.filtered[0],vy:this.filtered[1],vz:this.filtered[2],agl,valid:velocityValid&&aglValid,velocityValid,aglValid};
    return encodeNavigationWire(this.sequence++,this.last);
  }
}''',
'''class SimNavigationSensors {
  constructor(){this.reset();}
  reset(){this.noise=new Noise(0x7193ab21);this.headingNoise=new Noise(0x45a1d1a5);this.elapsed=.01;this.filtered=[0,0,0];this.sequence=1;this.last={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false,headingDeg:0,headingValid:false};}
  sampleFrame(model,dt=DT){
    this.elapsed+=dt;if(this.elapsed<.01)return null;this.elapsed-=.01;
    const truth=model.linear(),alpha=.42;
    for(let i=0;i<3;i++){const measured=truth[i]+this.noise.gaussian()*.025;this.filtered[i]+=alpha*(measured-this.filtered[i]);}
    const velocityValid=this.filtered.every(Number.isFinite),range=model.groundRange(NAV_AGL_RAY_MAX_M),aglValid=range.valid;let agl=0;
    if(aglValid){const measuredSlant=Math.max(0,range.slant+this.noise.gaussian()*.004);agl=measuredSlant*range.verticalProjection;}
    const truthHeading=quatToEuler(model.rotation())[2],headingDeg=(((truthHeading+this.headingNoise.gaussian()*.12+180)%360)+360)%360-180,headingValid=Number.isFinite(headingDeg);
    this.last={vx:this.filtered[0],vy:this.filtered[1],vz:this.filtered[2],agl,valid:velocityValid&&aglValid,velocityValid,aglValid,headingDeg,headingValid};
    return encodeNavigationWire(this.sequence++,this.last);
  }
}''')
replace_one(sim,
'''latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false};''',
'''latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false,headingDeg:0,headingValid:false};''')

# 4) Direct and wire-boundary tests prove compatibility and heading behavior.
hiltest = "tests/drone_hil_protocol_test.cpp"
replace_one(hiltest,
'''    const auto frame = hwcontract::encode_navigation_wire(nav_sequence, vx, vy, vz, agl, valid);''',
'''    const auto frame = hwcontract::encode_navigation_wire(nav_sequence, vx, vy, vz, agl, valid, valid, 0.0f, valid);''')
replace_one(hiltest,
'''        CHECK(!fc::navigation_agl_valid(decoded));

        auto legacy = split;''',
'''        CHECK(!fc::navigation_agl_valid(decoded));
        CHECK(!fc::navigation_heading_valid(decoded));

        auto legacy = split;''')
replace_one(hiltest,
'''        CHECK(decoded.valid && decoded.velocity_valid && decoded.agl_valid);
    }
    CHECK(sizeof(hil::InputPacket) == 80);''',
'''        CHECK(decoded.valid && decoded.velocity_valid && decoded.agl_valid);
        CHECK(!decoded.heading_valid);

        const auto with_heading = hwcontract::encode_navigation_wire(8, 1.0f, -2.0f, 0.3f, 2.0f, true, true, -123.4f, true);
        decoded = {};
        CHECK(hwcontract::decode_navigation_wire(with_heading, decoded));
        CHECK(decoded.heading_valid);
        CHECK(std::fabs(decoded.heading_deg + 123.4f) < 0.11f);
    }
    CHECK(sizeof(hil::InputPacket) == 80);''')

statetest = "tests/state_control_test.cpp"
p = Path(statetest); s = p.read_text()
s = s.replace('in.navigation = {{0.0f, 0.0f, 0.0f}, 2.0f, true, true, true};', 'in.navigation = {{0.0f, 0.0f, 0.0f}, 2.0f, true, true, true, 0.0f, true};')
s = s.replace('in.navigation = {{0.0f, 0.0f, 0.35f}, 0.0f, false, true, false};', 'in.navigation = {{0.0f, 0.0f, 0.35f}, 0.0f, false, true, false, 0.0f, true};')
anchor = '''    controller.reset();
    rc = base_rc(true);
    nav = {{0.0f, 0.0f, 0.0f}, 2.0f, true};
    rc.ch[FC_SBUS_YAW] = centered_raw(1.0f);'''
insert = '''    // Absolute NAV heading, when present, is the physical world/body frame
    // reference. A drifting 6-DoF IMU yaw must not rotate velocity axes.
    controller.reset();
    rc = base_rc(true);
    rc.ch[FC_SBUS_PITCH] = centered_raw(1.0f);
    nav = {{0.0f, -10.0f, 0.0f}, 2.0f, true, true, true, 90.0f, true};
    cmd = controller.run(rc, nav, 12.0f, true, 0.001f);
    CHECK(std::fabs(controller.debug().measured_yaw_deg - 90.0f) < 0.001f);
    CHECK(controller.debug().measured_forward_mps > 9.99f);
    CHECK(std::fabs(controller.debug().measured_right_mps) < 0.01f);

    controller.reset();
    rc = base_rc(true);
    nav = {{0.0f, 0.0f, 0.0f}, 2.0f, true};
    rc.ch[FC_SBUS_YAW] = centered_raw(1.0f);'''
if s.count(anchor) != 1:
    raise SystemExit('state heading test anchor mismatch')
s = s.replace(anchor, insert)
p.write_text(s)

# 5) Architecture guards: heading is an optional NAV1 sensor field in the same
# 20-byte raw frame and is required for horizontal state-vector navigation.
arch = "tests/architecture_invariants.mjs"
p = Path(arch); s = p.read_text()
anchor = 'requireText("esp32/Arondight45_HardwareSensors.hpp","crc16_ccitt");'
addition = '''requireText("esp32/Arondight45_HardwareSensors.hpp","crc16_ccitt");
requireText("esp32/Arondight45_HardwareSensors.hpp","kNavigationHeadingValid = 1u << 2");
requireText("esp32/Arondight45_HardwareSensors.hpp","kNavigationHeadingMask = 0x7ff8u");
requireText("esp32/Arondight45_StateControl.hpp","navigation_heading_valid");
requireText("esp32/Arondight45_StateControl.hpp","horizontal_navigation = velocity_valid && heading_valid");
requireText("esp32/Arondight45_StateControl.hpp","absolute_heading_valid ? nav.heading_deg : yaw_deg");
requireText("sim/simulator.mjs","NAV_HEADING_VALID = 1 << 2");
requireText("sim/simulator.mjs","headingNoise=new Noise");'''
if s.count(anchor) != 1:
    raise SystemExit('architecture NAV anchor mismatch')
s = s.replace(anchor, addition)
p.write_text(s)
