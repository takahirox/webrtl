// Board adapter only: CXXRTL evaluates every state transition and output.
#include "design.cc"
#include <stdint.h>
#include <string.h>

cxxrtl_design::p_webrtltop model;
static uint8_t frame[64 * 48 * 4], drawing[64 * 48 * 4];
static int16_t samples[16384];
static unsigned sample_count;
static bool frame_ready;

extern "C" {
static void tick(bool capture = true) {
    model.p_clk.set(false);
    model.step();
    model.p_clk.set(true);
    model.step();
    // Capture after the rising edge has settled, before the falling edge.
#ifdef BOARD_VIDEO
    if (capture && model.p_video__valid.get<bool>()) {
        unsigned x = model.p_video__x.get<unsigned>();
        unsigned y = model.p_video__y.get<unsigned>();
        if (x >= 64 || y >= 48) __builtin_trap();
        unsigned rgb = model.p_video__rgb.get<unsigned>();
        unsigned offset = (y * 64 + x) * 4;
        drawing[offset] = rgb >> 16;
        drawing[offset + 1] = rgb >> 8;
        drawing[offset + 2] = rgb;
        drawing[offset + 3] = 255;
        if (model.p_video__last.get<bool>()) {
            memcpy(frame, drawing, sizeof(frame));
            memset(drawing, 0, sizeof(drawing));
            frame_ready = true;
        }
    }
#endif
#ifdef BOARD_AUDIO
    if (capture && model.p_audio__valid.get<bool>())
        samples[sample_count++] = static_cast<int16_t>(model.p_audio__sample.get<unsigned>());
#endif
    model.p_clk.set(false);
    model.step();
}

void sim_batch(unsigned cycles) {
    if (cycles > 16384) __builtin_trap();
    sample_count = 0;
    frame_ready = false;
    for (unsigned i = 0; i < cycles; i++) tick();
}

void sim_step() { sim_batch(1); }
void sim_reset() {
    model.p_reset.set(true);
    tick(false);
    model.p_reset.set(false);
    model.step();
    sample_count = 0;
    frame_ready = false;
    memset(frame, 0, sizeof(frame));
    memset(drawing, 0, sizeof(drawing));
}
unsigned sim_count() {
#ifdef BOARD_COUNTER
    return model.p_count.get<unsigned>();
#else
    return 0;
#endif
}
uint8_t *sim_frame() { return frame; }
unsigned sim_frame_ready() { return frame_ready; }
int16_t *sim_audio() { return samples; }
unsigned sim_audio_count() { return sample_count; }
}
