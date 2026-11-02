# Compiled scheduled RTL backend (#42)

Fast now has a distinct circuit evaluator in [fast-backend.js](../web/fast-backend.js).
The static-site compiler elaborates the user's Verilog/SystemVerilog with the
existing pinned Yosys/Slang, runs `proc`, flattens, collects memory ports and emits
RTLIL JSON and the reference CXXRTL model. A JavaScript code generator consumes
that elaborated dependency graph and emits separate C++ kernels, compiled to Wasm
by the existing browser Clang/LLD. There is no native/server compiler dependency,
source upload, SNES emulation, skipped clock or approximate mode.

## Work performed per clock

The reference evaluator computes/commits until convergence at each clock level.
It queues memory writes and traverses commit logic, including unchanged state.
The new generator cuts the graph at flip-flops, RAM and inputs; topologically
orders only the combinational cones needed by each edge's next state; samples all
D values and memory addresses/data/masks before any state changes; then commits
directly. RAM writes use the reference's deterministic port order and masked
updates without queue allocation. Rising and falling schedules are separate;
the falling-edge combinational schedule is empty for a circuit without
falling-edge state.
An acyclic asynchronous-load graph has its own finite settling order after each
edge. Asynchronous control/data paths containing combinational feedback, `clk`
or memory reads reject scheduling rather than guessing delta-cycle behavior.

Only required video/audio cones are evaluated after rising-edge commits, at the
same point used by the reference adapter. The existing bounds-checked media
collector is shared. Cold internal combinational/debug values are refreshed once
at the settled-low batch boundary, rather than on every edge. The reference
clock and its edge detectors remain low throughout scheduled execution, so this
refresh generates no phantom edge. Both register buffers are updated together.

Clang folds constants, clock-level tests, unused media paths and dependency
expressions at compile time. Register/RAM state remains observable, including
otherwise idle private state. Static scheduling avoids an event queue and runtime
fan-out bookkeeping; the reference iterative evaluator remains selectable for
comparison. Work still scales with the active edge's compiled combinational cone;
a circuit with little activity does not automatically gain from sparse events.
The measured comparisons below quantify the result, rather than claiming that
static scheduling wins on every circuit. Event-driven scheduling is not implemented.

## Selection and compatibility

Every successful compile starts in Fast with Automatic backend selection.
**Simulation settings → Fast backend** can select Compiled schedule or CXXRTL
reference while paused. The status identifies the actual evaluator, diagnostics
give a fallback reason, and compilation metrics record supported status,
register/memory cell counts and generated source/Wasm bytes. Forcing an unavailable
scheduled backend rejects and retains the paused state. Debug uses CXXRTL even
when the Fast backend preference is scheduled. Reset retains that preference.

The generator supports `$dff`, `$adff`, `$aldff`, both edges of the scalar top-level
`clk`, arbitrary-width bit vectors and acyclic arithmetic/logical/mux dependencies
(including signed operations and indexed/parallel/bitwise muxes). RAM/ROM supports
asynchronous unconditional reads and clocked masked writes, zero-based addressing
up to 32 bits, multiple ports and CXXRTL's two-state initialization/conflict choices.
The complete unmodified SNES top currently schedules 594 register cells and 29
memories, including ROM, SRAM, WRAM, VRAM, ARAM, CPU, PPU, APU and DMA state.
The two-file RAM accumulator includes 65-bit state and falling-edge registers.

Unsupported cells (including latches), generated/independent clocks, combinational
feedback, cyclic asynchronous dependencies, clocked/enabled/transparent memory
reads, nonzero RAM offsets and wide-continuation memory ports select the reference.
Bindings are checked against the pinned CXXRTL declarations; an incompatible
register/memory layout also falls back. This ABI is tied to this compiler build,
not a portable promise about future Yosys layouts. Existing two-state synthesis
semantics and frontend restrictions still apply. CXXRTL remains available in Fast
for all circuits previously accepted by that backend.

## State ABI and handoff

The [version 2 live-state envelope](simulation-modes.md#version-2-live-snapshot--handoff-contract)
identifies `backend: shared-rtl-state-v1` and the current `engine`. Scheduled and
reference evaluators share actual register/RAM storage in one Wasm instance,
including packed and private state. This is a compatible storage strategy across
distinct evaluator implementations, not two modes of the same eval loop.
No RAM is copied on a switch and no hidden state is reconstructed from debug
signals. The worker retains inputs, cartridge mapping/identity/bytes, clock phase,
cycle count, board drawing/frame buffers, PCM phase and bounded debugger state.

Every worker response is at a complete settled-low boundary. Pause acknowledges
the current batch, validates a session/build/generation-bound capability and
switches evaluators without a clock or reset. Wrong/expired/other-instance or
version 1 capabilities reject. Snapshots do not serialize a heap, survive reload,
rewind, or migrate to another module/build or Verilator. Web Audio playback is
cleared at pause/mode/backend changes while RTL/sample/frame state is retained.

Requests remain bounded at 16,384 clocks, with one UI batch in flight and yields,
input sampling and media backpressure between requests. Pause finishes the
current invocation. Reset and cartridge loading use the established reference
reset/power-cycle protocol; they are excluded from warmed throughput measurements.

## Automated validation

```sh
npm ci
npx playwright install chromium firefox
npm run test:pr
npm run test:demo:built -- --project=firefox tests/static/modes-fast.spec.js tests/static/modes.spec.js tests/static/modes-regressions.spec.js tests/static/outputs.spec.js
WEBRTL_SNES_FAST_EQUIVALENCE=1 \
WEBRTL_SNES_FIXTURES='^(cpu-binary|irq-h-80|dma-1|mode-7|audio-gain|bus-sram-hirom)$' \
  npm run test:demo:built -- --project=chromium --grep 'SNES RTL batch'
```

The generic equivalence check requires the new backend explicitly, applies 64
input patterns and variable batch lengths, checks every discoverable value and
RAM row against an independent CXXRTL instance, and steps Debug between scheduled
batches. Existing independent RAM/accumulator/clock-edge expectations, conditions,
unsigned wide inspection and asynchronous cascade regressions remain intact.
The fallback check rejects a generated-clock transition without resetting.
The SNES PR smoke compiles once, preserves its independent CPU bus, all-pixel,
DSP arithmetic, controller, IRQ/NMI, HDMA and fresh-power-reset checks, then replays
148 video/audio intervals through scheduled execution with exact per-delivery
pixel/PCM/cycle comparisons, Debug Step handoffs and selected state/RAM checks.
These checks run in the existing bounded PR lanes; no deployed Pages check is a
pre-merge dependency. Additional affected SNES cartridge coverage is selected
under the existing [validation policy](pr-validation.md). The opt-in
`WEBRTL_SNES_FAST_EQUIVALENCE=1` replays each selected corpus fixture through the
scheduled evaluator, comparing all media intervals, sampled state from every
memory and the WRAM locations written by CPU/IRQ observation programs. It adds
this check without removing any reference fixture assertion or multiplying the
nightly corpus unconditionally.

## Reproducible performance measurements

```sh
npm run build:demo
node scripts/benchmark-fast.cjs 45fc501100aaed73145b9056c95e5446a6271a92 --snes
```

The harness starts a local server, compiles the old revision and current compiler
independently in Chromium, and compares the old Fast engine with current reference
and scheduled evaluators. Current variants reuse one module. Three warmed trials
per variant use identical 16,384-clock requests, RTL, cartridge and deterministic
inputs. RAM/accumulator runs continuously, rather than benchmarking a halted bus
master. SNES warms through 1,638,400 clocks of the original cartridge before
measuring 524,288 active clocks per trial, with serial B input halfway through.
Wall time includes worker/media transfer and generic I/O readout, excludes reset,
cartridge load, warmup and UI/Web Audio pacing. It reports compile wall time,
Wasm/source bytes, clocks/s, real-time ratio, browser process CPU time, sampled
aggregate browser RSS and Wasm linear memory. RSS is not a peak measurement and
can double-count shared pages. A 1 MHz declared target contextualizes the generic
RAM fixture; it is not a hardware frequency claim. SNES uses 21,477,270 Hz.
Results are saved to `.build/fast-benchmark.json`; failures and fallbacks are
errors, never counted as speedups. Rebuild the site after benchmarking to remove
staged baseline assets before running other suites or publishing.

### Recorded results (2026-11-02)

Apple M4 Max, 64 GiB, macOS arm64, Chromium 156.0.8078.4, Node 26.12.1,
Playwright 1.64.1 and the pinned toolchain. Baseline is `45fc501`; current sources
are identified by the report's SHA-256 `sourceFingerprint` (a checked dirty
worktree before its checkpoint commit). Three sequential warmed trials; medians
below are millions of complete clocks/s. Current reference and scheduled trials
reuse one module, so their difference isolates evaluator selection.

| Workload | Old Fast | Current reference | Compiled schedule | Schedule / old |
| --- | ---: | ---: | ---: | ---: |
| counter | 664.444 | 637.917 | 1133.596 | 1.71× |
| ram-accumulator | 7.213 | 6.974 | 111.402 | 15.44× |
| snes | 0.288 | 0.289 | 0.722 | 2.51× |

SNES reaches **0.0336× real time**, versus 0.0134× before; it remains about
29.7 times below the 21,477,270 Hz stretch target. The result demonstrates a
material evaluator improvement, not real-time console play. The counter's short
trials are dominated by fixed worker/request costs and compiler loop folding;
the RAM workload remains active throughout. Small current-reference variations
(counter −4%, RAM −3%, SNES +0.4%) also show why a same-module comparison matters.
No representative scheduled workload regressed in this measurement.

| Workload | Old / current compile seconds | Old / current Wasm bytes | Old / scheduled browser CPU seconds per trial |
| --- | ---: | ---: | ---: |
| counter | 2.20 / 2.22 | 125,892 / 126,220 | 0.0516 / 0.0311 |
| ram-accumulator | 2.59 / 2.66 | 143,436 / 144,992 | 1.1636 / 0.0775 |
| snes | 91.11 / 197.45 | 591,753 / 771,040 | 1.8520 / 0.7557 |

Compiling both kernels roughly doubles SNES compile time and adds 30% Wasm size.
This cost is paid before execution. Runtime Wasm linear memory is 192 KiB for
counter/RAM and 19.69 MiB for SNES (old SNES: 19.75 MiB); there is no second model
heap. Browser RSS includes compiler/JIT/cache allocations retained after worker
termination and varies by trial; it must not be interpreted as circuit RAM or
peak usage. Full trials, compilation CPU/mount cost, sampled RSS, exact inputs,
source fingerprint and environment are in
[the benchmark record](fast-backend-benchmark.json).

### Validation record and limits

The local standard PR command passed **13 browser checks**, ten Python tests and
six Node checks; its browser phase took 266.61 s. The additional Chromium selection
passed **24/24 in 510.93 s**, including six SNES cartridge variants plus CPU/IRQ
reset repeats with exact scheduled/reference comparisons. Firefox passed all
**11 focused mode/media checks in 54.10 s**, including the backend selector and
state-retaining rejection UI. The final input-layout guard emits byte-identical
SNES kernel code to that tested implementation; the final benchmark also compiles
and runs the guarded compiler. See [the validation record](fast-backend-validation.json)
for commands, source identity, failures and limits.

The native trusted-local check is blocked by the installed Verilator 5.052 /
Emscripten 6.0.13 setup; this is recorded as a failure, not a browser-backend pass.
Hosted Ubuntu PR timing and the exhaustive nightly cartridge suite have not been
run from this node. The existing automated PR budget and full-suite requirements
remain unchanged. No live Pages smoke is a pre-merge dependency for this change.
