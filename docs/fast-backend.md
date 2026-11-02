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
Independent asynchronous loads settle after each edge. Asynchronous control/data
paths depending on any asynchronously loaded register (including acyclic
cascades), combinational feedback, `clk` or memory reads reject scheduling.
In-place settling of a cascade can hide intermediate reset pulses observed by
the reference evaluator's evaluation/commit rounds, so these circuits use CXXRTL.

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
feedback, interdependent asynchronous loads, clocked/enabled/transparent memory
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
The fallback checks reject generated clocks and interdependent asynchronous
loads without resetting. The transient-reset regression compares Automatic Fast
against an independent CXXRTL instance, requires `s = 0xaa` after two clocks,
replays reset, steps Debug, and verifies state/cycle retention in both handoff
directions and after a rejected forced-schedule transition.
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

These initial measurements precede the compilation-cost follow-up below.

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

### Compilation-cost follow-up

The [first Ubuntu PR run](https://github.com/takahirox/webrtl/actions/runs/41390949403)
failed: browser Clang had not finished compiling both evaluators when the SNES
smoke reached its 500-second limit. Slang elaboration now runs `opt -noff` instead
of just `opt_clean` before generating either evaluator. This folds constants,
merges redundant combinational logic and simplifies muxes once, reducing work for
both generated kernels. `-noff` disables flip-flop optimization so the scheduled
generator retains its supported sequential cell types. The default Verilog
frontend retains its existing pipeline and inspectable unused state.

For the complete SNES design, scheduled source shrinks from 1,624,441 to 920,329
bytes and reference source from 2,482,985 to 1,826,386 bytes; all 594 register cells
and 29 memories remain. Clang still uses `-O2`. No PR assertion, fixture selection,
timeout or aggregate budget changes.

The [refreshed benchmark record](fast-backend-compilation-benchmark.json) uses the
same harness, toolchain, machine and workloads described above. SNES compilation
now takes 145.20 s versus the earlier dual-kernel 197.45 s; Wasm shrinks from
771,040 to 718,955 bytes. Medians from three warmed trials are:

| Workload | Old Fast (million clocks/s) | Current reference | Compiled schedule |
| --- | ---: | ---: | ---: |
| counter | 602.414 | 598.118 | 1029.277 |
| ram-accumulator | 7.313 | 7.377 | 114.286 |
| snes | 0.292 | 0.278 | 0.815 |

The scheduled SNES result is 0.0380× real time, still about 26.3 times below the
stretch target. The reference is about 5% slower than the old backend in this run;
the scheduled result improves on the earlier 0.722 million clocks/s measurement.

Local validation passed 10 Python and 7 Node checks, all 13 generic PR browser
checks, and the SNES PR smoke with this Slang pipeline (148 exact media intervals
plus state/handoff checks). The focused six-cartridge command above also passed
on the final compiler: `mode-7`, `bus-sram-hirom`, `dma-1`, `audio-gain`, `irq-h-80`
and `cpu-binary`, including the two CPU/IRQ reset repeats. All eight executions
passed scheduled/reference equivalence over 164 exact intervals each. This
focused browser run took 257.32 s, including 132.53 s of compilation.

These are local measurements, not an Ubuntu gate pass. The final-revision Ubuntu
Fast PR run remains required after publication; this fix node does not push.

### Dual-evaluator template inlining

The [second Ubuntu PR run](https://github.com/takahirox/webrtl/actions/runs/41394236296)
also timed out in browser Clang before runtime assertions. For supported scheduled
designs, the compiler now changes the pinned virtual CXXRTL header's
`CXXRTL_ALWAYS_INLINE` definition to ordinary `inline`. Clang can simplify each
bit-vector template before deciding whether to expand it into the two large
evaluators. This avoids repeatedly optimizing the same template loops after
forced early expansion. `-O2` remains enabled. Reference-only fallback builds keep
the original header and inlining policy.

Final local validation passed `npm run test:pr`: 10 Python tests, 7 Node tests and
all 14 Chromium PR checks in 146.03 seconds of browser testing. The complete SNES
smoke compiled in 70.76 seconds and executed its original assertions in 24.35
seconds, including 148 exact media deliveries, state/handoff comparisons and the
fresh-power-reset CPU replay. The PR selection, assertions and timing budgets
are preserved.

The [inlining benchmark record](fast-backend-inlining-benchmark.json) uses the
same production-browser harness, pinned toolchain and Apple M4 Max environment
as the earlier measurements. Three warmed trials per engine give these medians
in millions of complete clocks/s:

| Workload | Old Fast | Current reference | Compiled schedule | Current compile seconds | Current Wasm bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| counter | 586.616 | 627.186 | 1111.074 | 2.15 | 126,232 |
| ram-accumulator | 7.316 | 7.414 | 115.228 | 2.66 | 145,004 |
| snes | 0.281 | 0.143 | 0.822 | 71.27 | 909,782 |

SNES compilation falls from the previous dual-evaluator measurement of 145.20 s
to 71.27 s, about 51% less. Wasm grows from 718,955 to
909,782 bytes (about 27%). Scheduled throughput stays near the previous
0.815 million clocks/s, reaching 0.0383× real time. The generic RAM schedule
retains its material improvement over the old Fast engine. Full compilation,
CPU, sampled browser RSS and Wasm memory costs are in the record.

There is a deliberate tradeoff: the reference evaluator in the dual-evaluator
SNES module drops from the previous 0.278 to approximately 0.143 million clocks/s.
Ordinary inlining leaves more helper calls in that evaluator. Debug stepping and
explicit reference runs therefore cost more, while the scheduled Fast path keeps
its throughput and starts sooner. Unsupported designs keep the original
reference-only compilation policy. Correctness and state continuity are covered
by the existing equivalence assertions, rather than inferred from performance.

These are local results. A successful final-revision Ubuntu **Fast PR checks**
run under 600 seconds remains required after publication; no hosted pass is
claimed here.
