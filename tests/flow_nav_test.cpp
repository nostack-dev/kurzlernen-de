// Host tests for the on-board NAV1 producer (esp32/Arondight45_FlowNav.hpp):
// MSP v2 framing, flow-matrix calibration (scale + rotation + mirror), derotated flow velocity,
// lidar AGL with tilt, compass calibration + tilt-compensated heading, compass/gyro sense check,
// and the NAV1 frame that FirmwareRuntime/StateController consume (round-trip of the projection).
#include "Arondight45_FlowNav.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <random>
#include <vector>

using namespace flownav;

static int failures = 0;
#define CHECK(cond, msg) do { if (!(cond)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, msg); ++failures; } } while (0)
static bool near(float a, float b, float tol) { return std::fabs(a - b) <= tol; }

static void feed_bytes(MspV2Parser& p, const uint8_t* b, size_t n, std::vector<MspFrame>& out) {
    MspFrame f{};
    for (size_t i = 0; i < n; ++i) if (p.feed(b[i], f)) out.push_back(f);
}
static size_t flow_frame(uint8_t q, int32_t dx, int32_t dy, uint8_t* out) {
    uint8_t pl[9] = {q};
    std::memcpy(pl + 1, &dx, 4); std::memcpy(pl + 5, &dy, 4);
    return encode_msp_v2(kMspOpticFlow, pl, 9, out, 32);
}
static size_t range_frame(uint8_t q, int32_t mm, uint8_t* out) {
    uint8_t pl[5] = {q};
    std::memcpy(pl + 1, &mm, 4);
    return encode_msp_v2(kMspRangefinder, pl, 5, out, 32);
}

static void test_msp() {
    MspV2Parser p;
    std::vector<MspFrame> got;
    uint8_t buf[64];
    const uint8_t noise[] = {'$', 'M', '<', 0x13, '$', 'X', 0x00, 'N', 'A', 'V'};
    feed_bytes(p, noise, sizeof(noise), got);
    size_t n = flow_frame(200, -1234, 567, buf);
    feed_bytes(p, buf, n, got);
    n = range_frame(255, 1500, buf);
    feed_bytes(p, buf, n, got);
    CHECK(got.size() == 2, "two MSP frames");
    FlowSample f{}; RangeSample r{};
    CHECK(decode_flow(got[0], 10, f) && f.quality == 200 && f.dx == -1234 && f.dy == 567, "flow payload");
    CHECK(decode_range(got[1], 10, r) && r.mm == 1500 && r.quality == 255, "range payload");
    n = range_frame(255, 900, buf);
    buf[n - 1] ^= 0x5a;  // corrupt crc
    feed_bytes(p, buf, n, got);
    CHECK(got.size() == 2 && p.errors() >= 1, "bad crc rejected");
}

// counts per radian of the simulated module (unknown to the firmware: the calibration learns it)
constexpr float kCpr = 4000.0f;
// a simulated sensor: flow (rad/s) = Ktrue · ω, plus translation ω_equiv = (right/h, forward/h)
struct Sim {
    float k00, k01, k10, k11;
    FlowNav nav;
    uint64_t t = 1000000;
    float h = 1.0f;
    float acc_x = 0.0f, acc_y = 0.0f;
    void step_ms(int ms, float wx, float wy, float right, float forward, bool disarmed, uint8_t q = 220) {
        // 1 kHz gyro, 100 Hz flow + range
        for (int i = 0; i < ms; ++i) {
            nav.add_gyro(wx / kDeg, wy / kDeg, 0.001f, 0.0f, 0.0f, 0.0f);
            t += 1000;
            if (t % 10000 == 0) {
                const float ex = wx + right / h, ey = wy + forward / h;
                const float fx = k00 * ex + k01 * ey, fy = k10 * ex + k11 * ey;
                // the module's counts: integrated image motion over the 10 ms, kCpr counts per radian
                // (a real integrating sensor carries the sub-count rest into the next report)
                acc_x += fx * kCpr * 0.01f; acc_y += fy * kCpr * 0.01f;
                const int32_t dx = static_cast<int32_t>(acc_x), dy = static_cast<int32_t>(acc_y);
                acc_x -= static_cast<float>(dx); acc_y -= static_cast<float>(dy);
                nav.add_range(RangeSample{255, static_cast<int32_t>(h * 1000.0f), t});
                nav.add_flow(FlowSample{q, dx, dy, t}, disarmed);
            }
        }
    }
};

static void test_flow_calibration_and_velocity() {
    // sensor mounted turned 90° and mirrored, 0.9× scale error
    Sim s{0.0f, -0.9f, -0.9f, 0.0f, {}, 1000000, 1.0f};
    s.h = 0.5f;
    std::mt19937 rng(7);
    std::uniform_real_distribution<float> u(-2.5f, 2.5f);
    for (int k = 0; k < 600; ++k) s.step_ms(20, u(rng), u(rng), 0.0f, 0.0f, true);
    // the counts are rounded integers: use a large scale through the ×1000 trick above
    const bool ok = s.nav.try_flow_calibration();
    CHECK(ok, "flow matrix solved from hand rocking");
    const FlowCalibration& k = s.nav.flow_calibration();
    std::printf("K = [%.3f %.3f; %.3f %.3f]\n", k.k00, k.k01, k.k10, k.k11);
    const float g = kCpr / FC_FLOW_SCALE;   // what the nominal scale leaves for the calibration
    CHECK(near(k.k00 / g, 0.0f, 0.05f) && near(k.k01 / g, -0.9f, 0.05f) && near(k.k10 / g, -0.9f, 0.05f) && near(k.k11 / g, 0.0f, 0.05f), "flow matrix matches mounting");

    // fly: 1.2 m/s forward, 0.4 m/s right at 1.5 m while wobbling — derotation leaves the motion
    s.h = 1.5f;
    for (int k = 0; k < 60; ++k) s.step_ms(10, 0.8f * std::sin(k * 0.7f), -0.6f * std::cos(k * 0.5f), 0.4f, 1.2f, false);
    // no compass yet: build() still reports AGL, velocity only with heading
    hwcontract::NavigationWireFrame frame{};
    s.nav.build(s.t, frame);
    const FlowNavStatus& st = s.nav.status();
    std::printf("forward %.3f right %.3f agl %.3f\n", st.forward_mps, st.right_mps, st.agl_m);
    CHECK(near(st.forward_mps, 1.2f, 0.15f) && near(st.right_mps, 0.4f, 0.15f), "derotated flow velocity");
    CHECK(near(st.agl_m, 1.5f, 0.01f) && st.agl_valid, "lidar agl");
    CHECK(!st.velocity_valid && !st.heading_valid, "no heading: velocity not valid (fail-closed)");
    fc::NavigationState n{};
    CHECK(hwcontract::decode_navigation_wire(frame, n), "NAV1 frame decodes");
    CHECK(n.agl_valid && !n.velocity_valid && !n.heading_valid, "NAV1 split validity without compass");

    // poor texture: velocity not trusted
    for (int k = 0; k < 10; ++k) s.step_ms(10, 0.0f, 0.0f, 0.4f, 1.2f, false, 20);
    s.nav.build(s.t, frame);
    CHECK(!s.nav.status().velocity_valid, "low flow quality invalid");
}

static V3f mag_body(float heading_deg, float roll, float pitch, float H, float V) {
    const V3f u = body_up(roll, pitch);
    const V3f x{1, 0, 0};
    V3f fh = sub(x, scale(u, dot(x, u)));
    fh = scale(fh, 1.0f / norm(fh));
    const V3f w = cross(u, fh);
    const float p = heading_deg * kDeg;
    const V3f n{std::cos(p) * fh.x + std::sin(p) * w.x, std::cos(p) * fh.y + std::sin(p) * w.y, std::cos(p) * fh.z + std::sin(p) * w.z};
    return sub(scale(n, H), scale(u, V));
}

static void test_heading() {
    for (float hd : {-170.0f, -90.0f, 0.0f, 37.0f, 120.0f}) for (float r : {0.0f, 15.0f, -25.0f}) for (float p : {0.0f, 10.0f, -20.0f}) {
        float out = 0.0f;
        CHECK(tilt_compensated_heading(mag_body(hd, r, p, 200.0f, 420.0f), r, p, out), "heading computed");
        CHECK(near(wrap180(out - hd), 0.0f, 0.2f), "tilt compensated heading");
    }
    HeadingSenseCheck c;
    for (int i = 0; i < 200; ++i) c.add(-2.0f, 2.0f);
    CHECK(c.sense() == -1, "compass turning against gyro yaw → sense −1");
    HeadingSenseCheck d;
    for (int i = 0; i < 200; ++i) d.add(1.0f, 2.0f);
    CHECK(d.sense() == 0, "compass at half the gyro rate is never trusted");
}

static void test_full_chain() {
    Sim s{1.0f, 0.0f, 0.0f, 1.0f, {}, 1000000, 1.0f};
    FlowCalibration k{}; k.k00 = k.k11 = kCpr / FC_FLOW_SCALE; k.ready = true; s.nav.set_flow_calibration(k);
    // compass calibration: turn the drone around every axis (hard iron offset 80/−40/25, soft iron 1.2× on y)
    std::mt19937 rng(3);
    std::uniform_real_distribution<float> a(-180.0f, 180.0f), t(-80.0f, 80.0f);
    for (int i = 0; i < 1500; ++i) {
        const V3f m = mag_body(a(rng), t(rng), t(rng) * 0.9f, 200.0f, 420.0f);
        s.nav.add_gyro(0, 0, 0.01f, 0.0f, 0.0f, 0.0f);
        s.nav.add_mag(V3f{m.x + 80.0f, m.y * 1.2f - 40.0f, m.z + 25.0f}, s.t, true);
    }
    CHECK(s.nav.mag_calibration().ready, "compass calibration covered all axes");
    // turn flat: gyro yaw goes up while the compass heading goes down (CCW yaw vs CW heading)
    float yaw = 0.0f, hd = 10.0f;
    for (int i = 0; i < 200; ++i) {
        yaw = wrap180(yaw + 2.5f); hd = wrap180(hd - 2.5f);
        s.nav.add_gyro(0, 0, 0.01f, 0.0f, 0.0f, yaw);
        const V3f m = mag_body(hd - FC_MAG_DECLINATION_CDEG * 0.01f, 0.0f, 0.0f, 200.0f, 420.0f);
        s.nav.add_mag(V3f{m.x + 80.0f, m.y * 1.2f - 40.0f, m.z + 25.0f}, s.t, true);
    }
    CHECK(s.nav.heading_sense() == -1, "sense learned from turning");
    // hover-flight 0.7 m/s forward, 0.2 m/s right at 2 m, heading fixed
    s.h = 2.0f;
    for (int i = 0; i < 50; ++i) {
        s.step_ms(10, 0.0f, 0.0f, 0.2f, 0.7f, false);
        const V3f m = mag_body(hd - FC_MAG_DECLINATION_CDEG * 0.01f, 0.0f, 0.0f, 200.0f, 420.0f);
        s.nav.add_mag(V3f{m.x + 80.0f, m.y * 1.2f - 40.0f, m.z + 25.0f}, s.t, false);
    }
    hwcontract::NavigationWireFrame frame{};
    s.nav.build(s.t, frame);
    fc::NavigationState n{};
    CHECK(hwcontract::decode_navigation_wire(frame, n), "NAV1 decodes");
    CHECK(n.velocity_valid && n.agl_valid && n.heading_valid && n.valid, "full NAV solution");
    // StateController's own projection must give back what the flow measured
    const float yr = n.heading_deg * kDeg, c = std::cos(yr), sn = std::sin(yr);
    const float fwd = -c * n.velocity_world_mps.x - sn * n.velocity_world_mps.y;
    const float right = -sn * n.velocity_world_mps.x + c * n.velocity_world_mps.y;
    std::printf("heading %.1f (cw %.1f) fwd %.3f right %.3f\n", n.heading_deg, hd, fwd, right);
    CHECK(near(wrap180(n.heading_deg - wrap180(-hd)), 0.0f, 2.0f), "heading in the FC yaw sense (min/max soft-iron fit: ≤ 2°)");
    CHECK(near(fwd, 0.7f, 0.06f) && near(right, 0.2f, 0.06f), "projection round trip");
    CHECK(near(n.agl_m, 2.0f, 0.01f), "agl in frame");
    // landed: no sideways motion is reported even if the flow is garbage
    s.h = 0.06f;
    for (int i = 0; i < 20; ++i) s.step_ms(10, 0.0f, 0.0f, 0.0f, 0.0f, true, 0);
    s.nav.build(s.t, frame);
    CHECK(hwcontract::decode_navigation_wire(frame, n) && n.velocity_valid && near(n.velocity_world_mps.x, 0.0f, 1e-3f), "landed: zero velocity, valid");
}

int main() {
    test_msp();
    test_flow_calibration_and_velocity();
    test_heading();
    test_full_chain();
    if (failures) { std::printf("%d FlowNav checks failed\n", failures); return 1; }
    std::printf("FlowNav tests passed: MSP v2, flow matrix calibration, derotated velocity, lidar AGL, compass calibration + tilt heading, sense check, NAV1 round trip\n");
    return 0;
}
