// Board adapter only: CXXRTL evaluates every state transition and output.
#include "design.cc"

cxxrtl_design::p_webrtltop model;

extern "C" {
void sim_step() {
    model.p_clk.set(false);
    model.step();
    model.p_clk.set(true);
    model.step();
    model.p_clk.set(false);
    model.step();
}

void sim_reset() {
    model.p_reset.set(true);
    sim_step();
    model.p_reset.set(false);
    model.step();
}

unsigned sim_count() {
    return model.p_count.get<unsigned>();
}
}
