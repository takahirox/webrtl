#include "Vcounter.h"
#include "verilated.h"
#include <memory>

namespace {
std::unique_ptr<VerilatedContext> context;
std::unique_ptr<Vcounter> model;

void cycle() {
    model->clk = 0;
    model->eval();
    context->timeInc(1);
    model->clk = 1;
    model->eval();
    context->timeInc(1);
    model->clk = 0;
    model->eval();
}
}

extern "C" {
void sim_destroy() {
    if (model) model->final();
    model.reset();
    context.reset();
}

void sim_reset() {
    model->reset = 1;
    cycle();
    model->reset = 0;
    model->eval();
}

void sim_init() {
    sim_destroy();
    context = std::make_unique<VerilatedContext>();
    context->threads(1);
    model = std::make_unique<Vcounter>(context.get());
    sim_reset();
}

void sim_step() { cycle(); }
unsigned int sim_count() { return model->count; }
}
