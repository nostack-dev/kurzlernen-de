#include "../esp32/Arondight45_HIL_Protocol.hpp"

#include <array>
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
    p[24] = 0x00;
    for (int channel = 0; channel < 16; ++channel) {
        for (int bit = 0; bit < 11; ++bit) {
            if ((channels[channel] & (1u << bit)) != 0) {
                const int k = 8 + channel * 11 + bit;
                p[k / 8] |= static_cast<uint8_t>(1u << (k % 8));
            }
        }
    }
}

hil::InputPacket make_packet(uint32_t sequence, bool reset = false) {
    hil::InputPacket input{};
    input.magic = hil::kInputMagic;
    input.sequence = sequence;
    input.dt_us = 1000;
    input.flags = hil::kFlagImuValid | (reset ? hil::kFlagReset : 0);
    input.imu_registers[6] = 0x08;  // +1 g Z at 2048 LSB/g.
    std::array<uint16_t, 16> channels{};
    channels.fill(992);
    channels[2] = 172;
    channels[4] = 172;
    encode_sbus(channels, input.sbus);
    input.crc32 = hil::crc32(&input, offsetof(hil::InputPacket, crc32));
    return input;
}

void set_navigation(hil::InputPacket& input, float vx, float vy, float vz, float agl) {
    input.flags |= hil::kFlagNavigationValid;
    input.nav_vx_cms = static_cast<int16_t>(std::lround(vx * 100.0f));
    input.nav_vy_cms = static_cast<int16_t>(std::lround(vy * 100.0f));
    input.nav_vz_cms = static_cast<int16_t>(std::lround(vz * 100.0f));
    input.nav_agl_mm = static_cast<uint16_t>(std::lround(agl * 1000.0f));
    input.crc32 = hil::crc32(&input, offsetof(hil::InputPacket, crc32));
}

}  // namespace

int main() {
    CHECK(sizeof(hil::InputPacket) == 64);
    CHECK(sizeof(hil::OutputPacket) == 32);
    CHECK(hil::kProtocolVersion == 2);
    CHECK(hil::crc32("123456789", 9) == 0xCBF43926u);

    auto nav_packet = make_packet(3);
    set_navigation(nav_packet, 1.25f, -2.5f, 0.4f, 2.35f);
    const auto nav = hil::decode_navigation(nav_packet);
    CHECK(nav.valid);
    CHECK(std::fabs(nav.velocity_world_mps.x - 1.25f) < 0.011f);
    CHECK(std::fabs(nav.velocity_world_mps.y + 2.50f) < 0.011f);
    CHECK(std::fabs(nav.velocity_world_mps.z - 0.40f) < 0.011f);
    CHECK(std::fabs(nav.agl_m - 2.35f) < 0.002f);

    hil::PacketParser parser;
    hil::InputPacket parsed{};
    const auto parser_packet = make_packet(7, true);
    const uint8_t garbage[] = {0x44, 0x00, 'H', 'I', 0x22, 'H'};
    for (uint8_t byte : garbage) CHECK(!parser.feed(byte, parsed));
    bool complete = false;
    const auto* packet_bytes = reinterpret_cast<const uint8_t*>(&parser_packet);
    for (size_t i = 0; i < sizeof(parser_packet); ++i) complete = parser.feed(packet_bytes[i], parsed);
    CHECK(complete);
    CHECK(parsed.sequence == 7);

    hil::RuntimeAdapter runtime;
    auto bad = make_packet(1, true);
    bad.crc32 ^= 0x12345678u;
    const auto bad_out = runtime.process(bad);
    CHECK((bad_out.state & fc::kStateFault) != 0);
    CHECK(((bad_out.state >> 8) & 0xffu) == fc::kFaultProtocol);
    CHECK(hil::crc32(&bad_out, offsetof(hil::OutputPacket, crc32)) == bad_out.crc32);

    hil::OutputPacket out{};
    for (uint32_t i = 0; i < fc::kCalibrationSamples + 1; ++i) {
        auto input = make_packet(i, i == 0);
        out = runtime.process(input);
        CHECK(out.magic == hil::kOutputMagic);
        CHECK(out.sequence == i);
        CHECK(hil::crc32(&out, offsetof(hil::OutputPacket, crc32)) == out.crc32);
        for (auto pulse : out.motor_us) CHECK(pulse == fc::kEscMinUs);
    }
    CHECK((out.state & fc::kStateCalibrating) == 0);
    CHECK((out.state & fc::kStateFault) == 0);

    auto low = make_packet(3000);
    low.sequence = 3000;
    low.crc32 = hil::crc32(&low, offsetof(hil::InputPacket, crc32));
    out = runtime.process(low);
    CHECK((out.state & fc::kStateArmed) == 0);

    std::array<uint16_t, 16> channels{};
    channels.fill(992);
    channels[2] = 172;
    channels[4] = 1811;
    for (uint32_t i = 0; i < 1002; ++i) {
        auto input = make_packet(3001 + i);
        encode_sbus(channels, input.sbus);
        input.crc32 = hil::crc32(&input, offsetof(hil::InputPacket, crc32));
        out = runtime.process(input);
    }
    CHECK((out.state & fc::kStateArmed) != 0);
    for (auto pulse : out.motor_us) CHECK(pulse == fc::kEscIdleUs);

    channels[2] = 700;
    auto throttle = make_packet(5000);
    encode_sbus(channels, throttle.sbus);
    throttle.crc32 = hil::crc32(&throttle, offsetof(hil::InputPacket, crc32));
    out = runtime.process(throttle);
    CHECK((out.state & fc::kStateArmed) != 0);
    for (auto pulse : out.motor_us) CHECK(pulse > fc::kEscIdleUs);

    // GAME mode is impossible to arm without actual navigation measurements.
    auto reset = make_packet(6000, true);
    out = runtime.process(reset);
    CHECK((out.state & fc::kStateCalibrating) != 0);
    CHECK((out.state & fc::kStateArmed) == 0);
    channels.fill(992);channels[2]=172;channels[4]=172;channels[5]=718;channels[6]=1811;
    for(uint32_t i=0;i<fc::kCalibrationSamples+1;i++){
        auto input=make_packet(6001+i,i==0);encode_sbus(channels,input.sbus);set_navigation(input,0,0,0,.02f);out=runtime.process(input);
    }
    auto no_nav=make_packet(9000);encode_sbus(channels,no_nav.sbus);no_nav.crc32=hil::crc32(&no_nav,offsetof(hil::InputPacket,crc32));out=runtime.process(no_nav);
    CHECK((out.state & fc::kStateGameMode)!=0);
    CHECK((out.state & fc::kStateNavigationValid)==0);
    CHECK((out.state & fc::kStateArmed)==0);

    // Restore valid navigation, arm, then the clearance loop must generate thrust.
    auto arm_low=make_packet(9001);encode_sbus(channels,arm_low.sbus);set_navigation(arm_low,0,0,0,.02f);out=runtime.process(arm_low);
    channels[4]=1811;
    for(uint32_t i=0;i<1002;i++){
        auto input=make_packet(9002+i);encode_sbus(channels,input.sbus);set_navigation(input,0,0,0,.02f);out=runtime.process(input);
    }
    CHECK((out.state & fc::kStateGameMode)!=0);
    CHECK((out.state & fc::kStateNavigationValid)!=0);
    CHECK((out.state & fc::kStateArmed)!=0);
    auto climb=make_packet(11010);encode_sbus(channels,climb.sbus);set_navigation(climb,0,0,0,.02f);out=runtime.process(climb);
    bool thrust=false;for(auto pulse:out.motor_us)thrust|=pulse>fc::kEscIdleUs;CHECK(thrust);

    std::puts("All shared HIL protocol + state navigation tests passed.");
    return 0;
}
