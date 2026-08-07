/*
 * Arondight45 DroneFC Software-in-the-Loop WebAssembly adapter.
 *
 * ZERO-DIVERGENCE RULE:
 * This file does not reimplement any flight-control math. It directly includes
 * the HIL runtime, which directly includes Arondight45_DroneFC_S31.cpp.
 * Therefore SIL and physical S31 HIL execute the same fc:: filter, attitude,
 * arming, PID, mixer and pulse code and exchange the same HIL1/HLO1 packets.
 */

#define HIL_HOST_TEST 1
#define main arondight45_hil_embedded_selftest_unused
#include "../esp32/Arondight45_DroneFC_HIL_S31.cpp"
#undef main
#undef HIL_HOST_TEST

#include <cstdint>
#include <cstring>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define SIL_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define SIL_EXPORT
#endif

namespace {
hil::Runtime runtime;
hil::InputPacket input_packet{};
hil::OutputPacket output_packet{};
}

extern "C" {

SIL_EXPORT unsigned char* fc_input_buffer() {
    return reinterpret_cast<unsigned char*>(&input_packet);
}

SIL_EXPORT const unsigned char* fc_output_buffer() {
    return reinterpret_cast<const unsigned char*>(&output_packet);
}

SIL_EXPORT uint32_t fc_input_size() {
    return static_cast<uint32_t>(sizeof(input_packet));
}

SIL_EXPORT uint32_t fc_output_size() {
    return static_cast<uint32_t>(sizeof(output_packet));
}

SIL_EXPORT void fc_reset() {
    runtime.reset();
    std::memset(&input_packet, 0, sizeof(input_packet));
    std::memset(&output_packet, 0, sizeof(output_packet));
}

SIL_EXPORT uint32_t fc_process() {
    output_packet = runtime.process(input_packet, 0);
    return output_packet.state;
}

SIL_EXPORT uint32_t fc_protocol_version() {
    return hil::kProtocolVersion;
}

}

#ifndef __EMSCRIPTEN__
#include <array>
#include <cstdio>
#include <cstdlib>

static void check(bool condition, const char* what) {
    if (!condition) {
        std::fprintf(stderr, "SIL FAIL: %s\n", what);
        std::exit(1);
    }
}

static void encode_sbus(const std::array<uint16_t, 16>& channels, uint8_t* p) {
    std::memset(p, 0, 25);
    p[0] = 0x0F;
    p[24] = 0x00;
    for (int c = 0; c < 16; ++c) {
        for (int bit = 0; bit < 11; ++bit) {
            if ((channels[c] & (1u << bit)) != 0) {
                const int k = 8 + c * 11 + bit;
                p[k / 8] |= static_cast<uint8_t>(1u << (k % 8));
            }
        }
    }
}

int main() {
    check(fc_input_size() == 64, "input packet size");
    check(fc_output_size() == 32, "output packet size");
    check(fc_protocol_version() == 1, "protocol version");

    fc_reset();
    auto* in = reinterpret_cast<hil::InputPacket*>(fc_input_buffer());
    auto* out = reinterpret_cast<const hil::OutputPacket*>(fc_output_buffer());
    in->magic = hil::kInputMagic;
    in->dt_us = 1000;
    in->flags = hil::kFlagImuValid | hil::kFlagReset;
    in->imu_registers[6] = 0x08;

    std::array<uint16_t, 16> channels{};
    channels.fill(992);
    channels[2] = 172;
    channels[4] = 172;
    encode_sbus(channels, in->sbus);

    for (uint32_t i = 0; i < 2101; ++i) {
        in->sequence = i;
        in->flags = hil::kFlagImuValid | (i == 0 ? hil::kFlagReset : 0);
        in->crc32 = hil::crc32(in, offsetof(hil::InputPacket, crc32));
        fc_process();
        check(out->magic == hil::kOutputMagic, "output magic");
        check(out->sequence == i, "sequence echo");
        check(hil::crc32(out, offsetof(hil::OutputPacket, crc32)) == out->crc32, "output CRC");
    }
    check((out->state & hil::kStateCalibrating) == 0, "calibration completes");

    channels[4] = 1811;
    encode_sbus(channels, in->sbus);
    for (uint32_t i = 0; i < 1002; ++i) {
        ++in->sequence;
        in->crc32 = hil::crc32(in, offsetof(hil::InputPacket, crc32));
        fc_process();
    }
    check((out->state & hil::kStateArmed) != 0, "arming state machine");
    for (uint16_t pulse : out->motor_us) check(pulse == 1050, "armed idle pulse");

    channels[2] = 700;
    encode_sbus(channels, in->sbus);
    ++in->sequence;
    in->crc32 = hil::crc32(in, offsetof(hil::InputPacket, crc32));
    fc_process();
    for (uint16_t pulse : out->motor_us) check(pulse > 1050, "throttle produces thrust command");

    std::puts("All Arondight45 SIL zero-divergence tests passed.");
    return 0;
}
#endif
