// Board adapter only: CXXRTL evaluates every state transition and output.
#include "design.cc"
#include <stdint.h>
#include <string.h>

cxxrtl_design::p_webrtltop model;
#ifdef BOARD_SNES
#define BOARD_VIDEO
#define BOARD_AUDIO
static constexpr unsigned width = 512, height = 480;
#else
static constexpr unsigned width = 64, height = 48;
#endif
static uint8_t frame[width * height * 4], drawing[width * height * 4];
static int16_t samples[16384];
static unsigned sample_count;
static bool frame_ready;
#ifdef BOARD_SNES
static constexpr unsigned trace_capacity = 4096;
#else
static constexpr unsigned trace_capacity = 128;
#endif
static uint32_t trace[trace_capacity * 4];
static unsigned trace_count, cycle_count;

template<bool debug = false>
static void tick(bool capture = true) {
    model.p_clk.set(false);
    model.step();
    model.p_clk.set(true);
    model.step();
    // CXXRTL can report convergence before committed registers propagate to
    // combinational/flattened output aliases. Re-evaluate at the same clock
    // level before capture; this does not create another rising edge.
    model.step();
    if (capture) ++cycle_count;
#if defined(BOARD_CPU816) || defined(BOARD_SNES)
    if (debug && capture && (model.p_trace__flags.get<unsigned>() & 8) && trace_count < trace_capacity) {
        unsigned offset = trace_count++ * 4;
        trace[offset] = cycle_count;
        trace[offset + 1] = model.p_trace__address.get<unsigned>();
        trace[offset + 2] = model.p_trace__data.get<unsigned>();
        trace[offset + 3] = model.p_trace__flags.get<unsigned>();
    }
#endif
    // Capture after the rising edge has settled, before the falling edge.
#ifdef BOARD_VIDEO
    if (capture && model.p_video__valid.get<bool>()) {
        unsigned x = model.p_video__x.get<unsigned>();
        unsigned y = model.p_video__y.get<unsigned>();
        if (x >= width || y >= height) __builtin_trap();
        unsigned rgb = model.p_video__rgb.get<unsigned>();
        unsigned offset = (y * width + x) * 4;
        drawing[offset] = rgb >> 16;
        drawing[offset + 1] = rgb >> 8;
        drawing[offset + 2] = rgb;
        drawing[offset + 3] = 255;
    }
    if (capture && model.p_video__last.get<bool>()
#ifndef BOARD_SNES
        && model.p_video__valid.get<bool>()
#endif
    ) {
        memcpy(frame, drawing, sizeof(frame));
        memset(drawing, 0, sizeof(drawing));
        frame_ready = true;
    }
#endif
#ifdef BOARD_AUDIO
    if (capture && model.p_audio__valid.get<bool>())
        samples[sample_count++] = static_cast<int16_t>(model.p_audio__sample.get<unsigned>());
#endif
    model.p_clk.set(false);
    model.step();
}

extern "C" {
void sim_batch(unsigned cycles) {
    if (cycles > 16384) __builtin_trap();
    sample_count = 0;
    frame_ready = false;
    trace_count = 0;
    for (unsigned i = 0; i < cycles; i++) tick();
}

void sim_step() { sim_batch(1); }
void sim_reset() {
#ifdef BOARD_SNES
    model.p_buttons.set(0);
#endif
    model.p_reset.set(true);
    tick(false);
    model.p_reset.set(false);
    model.step();
#ifdef BOARD_SNES
    for (unsigned i = 0; i < 131073; ++i) tick(false);
#endif
    sample_count = 0;
    frame_ready = false;
    memset(frame, 0, sizeof(frame));
    memset(drawing, 0, sizeof(drawing));
    trace_count = 0;
    cycle_count = 0;
}
unsigned sim_count() {
#ifdef BOARD_COUNTER
    return model.p_count.get<unsigned>();
#elif defined(BOARD_CPU816)
    return model.p_result.get<unsigned>();
#else
    return 0;
#endif
}
uint8_t *sim_frame() { return frame; }
unsigned sim_frame_ready() { return frame_ready; }
int16_t *sim_audio() { return samples; }
unsigned sim_audio_count() { return sample_count; }
uint32_t *sim_trace() { return trace; }
unsigned sim_trace_count() { return trace_count; }
#ifdef BOARD_SNES
void sim_buttons(unsigned buttons) { model.p_buttons.set(buttons & 4095); }
void sim_cart_config(unsigned hirom, unsigned mask, unsigned ram_size) {
    model.p_cart__hirom.set(bool(hirom));
    model.p_cart__mask.set(mask);
    model.p_cart__ram__size.set(ram_size);
}
unsigned sim_video_height() { return model.p_video__height.get<unsigned>(); }
void sim_cart_byte(unsigned address, unsigned data) {
    if (address >= 4194304 || data > 255) __builtin_trap();
    model.p_cart__address.set(address);
    model.p_cart__data.set(data);
    model.p_cart__write.set(true);
    tick(false);
    model.p_cart__write.set(false);
}
#endif
}

#include "debug-runtime.cpp"
