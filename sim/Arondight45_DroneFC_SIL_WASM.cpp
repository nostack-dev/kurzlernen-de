/*
 * Arondight45 DroneFC Software-in-the-Loop WebAssembly adapter.
 *
 * No flight-control logic is reimplemented here. Production, physical-S31 HIL
 * and browser SIL all execute fc::Runtime from Arondight45_DroneFC_Core.hpp.
 * SIL and HIL additionally share the exact HIL1/HLO1 protocol adapter.
 */

#include "../esp32/Arondight45_HIL_Protocol.hpp"

#include <cstdint>
#include <cstring>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define SIL_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define SIL_EXPORT
#endif

namespace {
hil::RuntimeAdapter runtime;
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

}  // extern "C"

#ifndef __EMSCRIPTEN__
#include <array>
#include <cstdio>
#include <cstdlib>

namespace {

void check(bool condition, const char* what) {
    if (!condition) {
        std::fprintf(stderr, "SIL FAIL: %s\n", what);
        std::exit(1);
    }
}

void encode_sbus(const std::array<uint16_t, 16>& channels, uint8_t* p) {
    std::memset(p, 0, 25);
    p[0] = 0x0F;
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

}  // namespace

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

    for (uint32_t i = 0; i < fc::kCalibrationSamples + 1; ++i) {
        in->sequence = i;
        in->flags = hil::kFlagImuValid | (i == 0 ? hil::kFlagReset : 0);
        in->crc32 = hil::crc32(in, offsetof(hil::InputPacket, crc32));
        fc_process();
        check(out->magic == hil::kOutputMagic, "output magic");
        check(out->sequence == i, "sequence echo");
        check(hil::crc32(out, offsetof(hil::OutputPacket, crc32)) == out->crc32, "output CRC");
    }
    check((out->state & fc::kStateCalibrating) == 0, "calibration completes");
    check((out->state & fc::kStateFault) == 0, "calibration remains fault-free");

    channels[4] = 1811;
    encode_sbus(channels, in->sbus);
    for (uint32_t i = 0; i < 1002; ++i) {
        ++in->sequence;
        in->crc32 = hil::crc32(in, offsetof(hil::InputPacket, crc32));
        fc_process();
    }
    check((out->state & fc::kStateArmed) != 0, "arming state machine");
    for (uint16_t pulse : out->motor_us) check(pulse == fc::kEscIdleUs, "armed idle pulse");

    channels[2] = 700;
    encode_sbus(channels, in->sbus);
    ++in->sequence;
    in->crc32 = hil::crc32(in, offsetof(hil::InputPacket, crc32));
    fc_process();
    for (uint16_t pulse : out->motor_us) check(pulse > fc::kEscIdleUs, "throttle produces thrust command");

    std::puts("All Arondight45 SIL shared-runtime tests passed.");
    return 0;
}
#endif
