#include "../esp32/Arondight45_HIL_Protocol.hpp"

#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace {

#define CHECK(expr) do { \
    if (!(expr)) { \
        std::fprintf(stderr, "HIL TEST FAIL line %d: %s\n", __LINE__, #expr); \
        std::exit(1); \
    } \
} while (0)

void encode_sbus(const std::array<uint16_t, 16>& channels, uint8_t* p) {
    std::memset(p, 0, 25);
    p[0] = 0x0f;
    p[24] = 0;
    for (int channel = 0; channel < 16; ++channel) {
        for (int bit = 0; bit < 11; ++bit) {
            if (channels[channel] & (1u << bit)) {
                const int k = 8 + channel * 11 + bit;
                p[k / 8] |= static_cast<uint8_t>(1u << (k % 8));
            }
        }
    }
}

void finalize(hil::InputPacket& input) {
    input.crc32 = hil::crc32(&input, offsetof(hil::InputPacket, crc32));
}

hil::InputPacket make_packet(uint32_t sequence, bool reset = false) {
    hil::InputPacket input{};
    input.magic = hil::kInputMagic;
    input.sequence = sequence;
    input.dt_us = 1000;
    input.flags = hil::kFlagImuPresent | (reset ? hil::kFlagReset : 0);
    input.imu_registers[6] = 0x08;
    finalize(input);
    return input;
}

void set_sbus(hil::InputPacket& input, const std::array<uint16_t, 16>& channels) {
    encode_sbus(channels, input.sbus);
    input.flags |= hil::kFlagSbusPresent;
    finalize(input);
}

void set_navigation(hil::InputPacket& input, uint16_t nav_sequence,
                    float vx, float vy, float vz, float agl, bool valid = true) {
    const auto frame = hwcontract::encode_navigation_wire(nav_sequence, vx, vy, vz, agl, valid);
    std::memcpy(input.navigation_frame, &frame, sizeof(frame));
    input.flags |= hil::kFlagNavigationPresent;
    finalize(input);
}

}  // namespace

int main() {
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
    CHECK(sizeof(hil::InputPacket) == 80);
    CHECK(sizeof(hil::OutputPacket) == 32);
    CHECK(hil::kProtocolVersion == 3);
    CHECK(hil::crc32("123456789", 9) == 0xCBF43926u);
    CHECK(hwcontract::crc16_ccitt("123456789", 9) == 0x29B1u);

    const auto wire = hwcontract::encode_navigation_wire(77, 1.25f, -2.5f, 0.4f, 2.35f, true);
    fc::NavigationState nav{};
    CHECK(hwcontract::decode_navigation_wire(wire, nav));
    CHECK(nav.valid);
    CHECK(std::fabs(nav.velocity_world_mps.x - 1.25f) < 0.011f);
    CHECK(std::fabs(nav.velocity_world_mps.y + 2.5f) < 0.011f);
    CHECK(std::fabs(nav.velocity_world_mps.z - 0.4f) < 0.011f);
    CHECK(std::fabs(nav.agl_m - 2.35f) < 0.002f);
    const auto high_wire = hwcontract::encode_navigation_wire(78, 0, 0, 0, 50.0f, true);
    CHECK(hwcontract::decode_navigation_wire(high_wire, nav));
    CHECK(nav.valid);
    CHECK(std::fabs(nav.agl_m - 50.0f) < 0.002f);
    auto corrupt = wire;
    ++corrupt.vx_cms;
    CHECK(!hwcontract::decode_navigation_wire(corrupt, nav));

    hwcontract::NavigationWireParser nav_parser;
    hwcontract::NavigationWireFrame parsed_nav{};
    bool nav_complete = false;
    const uint8_t garbage_nav[] = {0x00, 'N', 'A', 0xff, 'N'};
    for (uint8_t byte : garbage_nav) {
        CHECK(!nav_parser.feed(byte, parsed_nav));
    }
    const auto* nav_bytes = reinterpret_cast<const uint8_t*>(&wire);
    for (size_t i = 0; i < sizeof(wire); ++i) {
        nav_complete = nav_parser.feed(nav_bytes[i], parsed_nav);
    }
    CHECK(nav_complete);
    CHECK(parsed_nav.sequence == 77);

    hil::PacketParser parser;
    hil::InputPacket parsed{};
    const auto parser_packet = make_packet(7, true);
    const uint8_t garbage[] = {0x44, 0, 'H', 'I', 0x22, 'H'};
    for (uint8_t byte : garbage) {
        CHECK(!parser.feed(byte, parsed));
    }
    bool complete = false;
    const auto* packet_bytes = reinterpret_cast<const uint8_t*>(&parser_packet);
    for (size_t i = 0; i < sizeof(parser_packet); ++i) {
        complete = parser.feed(packet_bytes[i], parsed);
    }
    CHECK(complete);
    CHECK(parsed.sequence == 7);

    hil::RuntimeAdapter bad_runtime;
    auto bad = make_packet(1, true);
    bad.crc32 ^= 0x12345678u;
    const auto bad_out = bad_runtime.process(bad);
    CHECK((bad_out.state & fc::kStateFault) != 0);
    CHECK(((bad_out.state >> 8) & 0xffu) == fc::kFaultProtocol);

    std::array<uint16_t, 16> channels{};
    channels.fill(992);
    channels[2] = 172;
    channels[4] = 172;
    hil::RuntimeAdapter runtime;
    hil::OutputPacket out{};
    for (uint32_t i = 0; i < fc::kCalibrationSamples + 1; ++i) {
        auto input = make_packet(i, i == 0);
        if (i % 10 == 0) set_sbus(input, channels);
        out = runtime.process(input);
    }
    CHECK((out.state & fc::kStateCalibrating) == 0);
    CHECK((out.state & fc::kStateFault) == 0);

    // Receiver is an asynchronous 100 Hz wire source, not a 1 kHz fabricated RC state.
    channels[4] = 1811;
    for (uint32_t i = 0; i < 1002; ++i) {
        auto input = make_packet(3000 + i);
        if (i % 10 == 0) set_sbus(input, channels);
        out = runtime.process(input);
    }
    CHECK((out.state & fc::kStateArmed) != 0);
    for (auto pulse : out.motor_us) {
        CHECK(pulse == fc::kEscIdleUs);
    }

    channels[2] = 700;
    auto throttle = make_packet(5005);
    set_sbus(throttle, channels);
    out = runtime.process(throttle);
    for (auto pulse : out.motor_us) {
        CHECK(pulse > fc::kEscIdleUs);
    }

    // If receiver wire traffic stops, cached state expires instead of being refreshed by HIL ticks.
    for (uint32_t i = 0; i < fc::kRcTimeoutUs / 1000 + 3; ++i) {
        auto input = make_packet(5100 + i);
        out = runtime.process(input);
    }
    CHECK((out.state & fc::kStateArmed) == 0);
    CHECK((out.state & fc::kStateRcValid) == 0);

    // GAME gets only NAV1 hardware-module frames. No fresh NAV1 => fail closed.
    runtime.reset();
    channels.fill(992);
    channels[2] = 172;
    channels[4] = 172;
    channels[5] = 718;
    channels[6] = 1811;
    uint16_t nav_seq = 1;
    for (uint32_t i = 0; i < fc::kCalibrationSamples + 1; ++i) {
        auto input = make_packet(7000 + i, i == 0);
        if (i % 10 == 0) {
            set_sbus(input, channels);
            set_navigation(input, nav_seq++, 0, 0, 0, 0.02f);
        }
        out = runtime.process(input);
    }
    CHECK((out.state & fc::kStateNavigationValid) != 0);

    // Duplicate NAV1 sequence must not refresh freshness.
    auto duplicate = make_packet(9000);
    set_sbus(duplicate, channels);
    set_navigation(duplicate, static_cast<uint16_t>(nav_seq - 1), 0, 0, 0, 0.02f);
    out = runtime.process(duplicate);
    for (uint32_t i = 0; i < hwcontract::kNavigationTimeoutUs / 1000 + 3; ++i) {
        auto input = make_packet(9001 + i);
        if (i % 10 == 0) set_sbus(input, channels);
        out = runtime.process(input);
    }
    CHECK((out.state & fc::kStateGameMode) != 0);
    CHECK((out.state & fc::kStateNavigationValid) == 0);
    CHECK((out.state & fc::kStateArmed) == 0);

    // Fresh NAV1 + fresh SBUS at 100 Hz can arm while the inner firmware remains 1 kHz.
    channels[4] = 172;
    auto low = make_packet(10000);
    set_sbus(low, channels);
    set_navigation(low, nav_seq++, 0, 0, 0, 0.02f);
    out = runtime.process(low);
    channels[4] = 1811;
    for (uint32_t i = 0; i < 1002; ++i) {
        auto input = make_packet(10001 + i);
        if (i % 10 == 0) {
            set_sbus(input, channels);
            set_navigation(input, nav_seq++, 0, 0, 0, 0.02f);
        }
        out = runtime.process(input);
    }
    CHECK((out.state & fc::kStateGameMode) != 0);
    CHECK((out.state & fc::kStateNavigationValid) != 0);
    CHECK((out.state & fc::kStateArmed) != 0);
    bool thrust = false;
    for (auto pulse : out.motor_us) {
        thrust |= pulse > fc::kEscIdleUs;
    }
    CHECK(thrust);

    std::puts("All raw-hardware HIL / firmware-boundary tests passed.");
    return 0;
}
