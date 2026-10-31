# Full regression performance (#30)

The optimization retains the complete local `npm test` coverage. It reduces
repeated compilation and identical baseline checks; no cartridge, independent
pixel/PCM expectation, simulation cycle count, or CPU/IRQ reset replay is removed.
Required pre-merge Ubuntu acceptance is **pending** until a complete successful
run of this revision is recorded. A successful local or Pages check cannot fill
that requirement.

## Existing evidence and principal costs

Both historical Actions runs were cancelled:
[41162403351](https://github.com/takahirox/webrtl/actions/runs/41162403351) and
[41143812804](https://github.com/takahirox/webrtl/actions/runs/41143812804).
The former spent 262.9 minutes in `npm test`, completing all thirteen Chromium
SNES batches and two Firefox SNES batches before cancellation during the third.
This is an incomplete full run, not a passing baseline or a full-suite duration.
The older run likewise reached Firefox only after the Chromium sweep and was
cancelled. Its logs confirm the same duplicated compilation pattern.

The reference environment in run 41162403351 was Ubuntu 24.04.5, Actions image
`ubuntu-24.04` version `20261025.353.1`, Node 22.23.4, native Verilator 5.020,
Emscripten 3.1.6, Playwright 1.64.1, Chromium 156.0.8078.4, and Firefox 157.0.
The lockfile pins browser Yosys 0.70.1258 and Clang 22.0.0-git20542-10.
Both browser projects used one worker. New CI logs `lscpu`, memory and tool versions
so runner changes remain visible; historical compiler peak memory was not measured.

Bounded log excerpts are summarized in [the measurement data](regression-measurements.json):

| Observation from cancelled reference run | Measured time |
| --- | ---: |
| Thirteen Chromium SNES batches, inferred first compile start to last completion | 199.6 min |
| Their thirteen repeated SNES compilations | 45.5 min total; 194.6–246.0 s each |
| First two Chromium batches over the same interval convention | 27.9 min |
| First two Firefox batches over the same interval convention | 31.3 min |
| Firefox SNES compilation, three observed compilations | 215.3–224.3 s each |
| One baseline 1,671,168-cycle Firefox simulation | 23.7–23.9 s |

Compile start is inferred by subtracting the reported compile duration from its
completion log timestamp, so these intervals include minor console delivery delay.
Cartridge simulation dominates the remaining time; each normal fixture runs
1,671,168 master clocks, and audio/interlace/timer cases run longer. Every old
batch additionally repeated the UI controller/audio checks and three baseline
LoROM/reset/HiROM simulations. This evidence was sufficient to choose reuse
without spending another multi-hour run on an unoptimized full baseline.

## Reuse, isolation and coverage

Each Playwright worker compiles SNES freshly in its actual browser via Slang,
then retains only the resulting immutable Wasm bytes and already-asserted baseline
evidence. Before every batch a SHA-256 fingerprint covers **every served build
file**, including source RTL, compiler JS/Wasm/resource archives, CXXRTL headers,
adapters, runtime, and `build-info.json`. Browser project/version, frontend, top
and board join that identity. A mismatch compiles again. The cache is process-local:
no previous run's binary is loaded, and a restarted/retried worker compiles freshly.
Public-URL runs disable reuse because local files cannot establish public identity.
The Node unit check rejects same-length source/runtime/toolchain/revision edits,
changed browser identity and added inputs.

Both browsers still execute all **260 named cartridge fixtures**, thirteen batches
each, plus the existing **29 CPU/IRQ reset replays** per browser. Every cartridge
power-reset instantiates the compiled WebAssembly module again; neither linear
memory nor circuit state is reused. The AUX original/repeat pair stays together.
CPU/bus/PPU/APU/DMA/HDMA/controller/timer/interrupt observations, full-raster pixels,
independent PCM oracles and the deliberate negative frame control are preserved.

| Integration boundary | Real coverage retained |
| --- | --- |
| Native compiler → Wasm → Chromium | Complete trusted-local counter test, edited HDL, compile errors and controls |
| Browser Verilog frontend/compiler/runtime | All existing counter, CPU bus/65C816, backdrop, BG1 and video/audio checks in Chromium and Firefox |
| Browser Slang frontend → full SNES Wasm | Fresh compilation once in each browser worker; generic Slang counter/layout rejection test in each browser |
| SNES UI → cartridge worker, Canvas, Web Audio, keyboard/gamepad, pause/reset | Original baseline UI checks once per browser worker |
| SNES runtime → full cartridge/device/oracle corpus | All 260 cases and CPU/IRQ replays in **each** browser, unchanged cycles and expected results |
| Cross-ROM reset, deterministic timestamps/frames/PCM, LoROM/HiROM | Fresh instances per cartridge, AUX pair, CPU/IRQ replays, plus baseline reset/HiROM comparison once per worker |

Baseline evidence reused in later batches is explicitly labelled `baselineReused`;
its original simulation duration is not new work. Every batch still saves its
Wasm and complete fixture results. `snes-measurements.json` records the fingerprint,
new compilation time (zero on reuse), setup, UI/transfer, runtime and assertion
time, and per-fixture load/reset, simulation/transfer and pixel-readback timing.
Simulation timing includes worker communication and trace/PCM collection;
pixel-readback timing includes the independent oracle and frame hash. These are
wall-clock phases, not hardware CPU counters or pure GPU timings. Each fixture
logs start/completion and a simulation heartbeat at most once per ten seconds;
compile stage changes and baseline start/completion are also visible.

## CI, local commands and budgets

CI prepares Python/Node unit checks and the static build once, uploads that exact
revision's static artifact, then downloads it into
independent Chromium and Firefox jobs. Both verify `build-info.json` against the
checkout SHA and run the full static suite with **one worker**. Artifact hashes
validate compilation reuse inside each job. This avoids compiler contention
within a runner; no increase in per-runner worker concurrency is proposed. The
Chromium job also runs trusted-local native integration, sharing its browser
installation instead of downloading Chromium again in preparation.

The browser split reduces elapsed feedback latency separately from work saved by
reuse. It does **not** itself reduce simulation work; installation/download costs
on two runners must be included in total runner time. npm's download cache is
retained, native tools are installed only in the Chromium job, the static build is not
repeated, and each static runner installs only its own browser. Superseded PR
revisions cancel the entire old full-validation group. There is no duplicate
branch-push full run. The final `Full regression suite` job fails if preparation
or either browser fails/skips/cancels. Timing/results artifacts upload on success
and failure, and JSON reports retain accurate pass/fail/skip counts.

Local commands remain compatible:

```sh
npm test                       # unit + native + build + both complete static suites
npm run test:unit              # Python plus compilation-reuse unit checks
npm run test:demo              # build + both complete static suites
npm run test:demo:built         # both complete static suites against an existing build
npm run test:demo:built -- --project=firefox
```

`WEBRTL_SNES_FIXTURES` remains an explicitly focused local selection. It is never
set in CI; focused results must not be labelled a complete suite.

The provisional reference budget is **180 minutes per browser job**, **under 190
minutes elapsed feedback** including preparation, and **under 370 total runner
minutes**, excluding queues. Preparation has a ten-minute bound; each cartridge
batch retains its existing thirty-minute bound. The old complete Chromium SNES
portion alone took 199.6 minutes, including 45.5 minutes of compilation. Removing
twelve compilations plus twelve identical UI/three-run baselines provides budget
headroom; Firefox's measured simulation is slower. This is an evidence-informed
initial ceiling, **not a measured successful Ubuntu result**. Confirm or revise
it from the complete reference run; investigate phase growth instead of increasing
timeouts. Record actual elapsed, sum of job execution times and queue times
separately. No full-suite speedup percentage is claimed from cancelled runs.

Pages retains its own ten-minute build/smoke/deploy bounds, artifact provenance,
failure propagation and non-cancelling deployment ordering. It has no dependency
on full validation. The [#26 sequencing record](pages-validation.md#sequencing-outcome-and-30-follow-up)
keeps the cancelled full result visible and records the independent successful
publication; the ordinary full-check-before-merge policy remains in force.

## Validation and remaining acceptance

The one-worker bounded comparison passed all four batches: **13.9 minutes before
versus 596.23 seconds (9.9 minutes) after**, approximately **28.5% less elapsed
runner time** on the same host/selection. The before reporter rounds to a tenth
of a minute, so the reduction is approximate. Compilations fell from four to two;
all generated Wasm bytes and the complete saved output objects for all 42 fixture
executions matched, excluding only the newly added timing fields. Chromium's
reused one-fixture batch took 9.38 seconds; Firefox's took 12.36 seconds. This
measures saved work with the same one-worker configuration, independently of the
new CI job split. The baseline run briefly overlapped the unrelated native
validation/probe; these are operational wall-time measurements, not isolated CPU
benchmarks. The complete local static result follows.

The local reference is macOS 27.2 arm64 on Apple M4 Max with 64 GiB RAM, Node 26.12.1,
Python 3.13.13, and the pinned browser toolchain. These timings are not Ubuntu CI
measurements. The bounded comparison selects the same 21 original cartridges,
split into two batches in each browser, using the same one-worker configuration:

```sh
WEBRTL_SNES_FIXTURES='^(mode-[0-7]|depth-[0-6]|sprite-(low|high)|overscan|interlace|window|math)$' \
  npm run test:demo:built -- --grep 'full SNES RTL'
```

The complete optimized static run passed **68/68 checks in 3,374.63 seconds
(56.2 minutes)** with two local workers: zero failures, skips or flaky results.
Each browser executed all 260 named fixtures and 29 CPU/IRQ reset replays, thirteen
batches, one fresh SNES compilation and twelve reuse hits. Every saved Wasm had
SHA-256 `3bd23feeae078fa811b4a9f29a7ca3e5287967851af345151a7de741b4bba060`,
matching the bounded unoptimized artifacts. All 289 complete fixture output
objects matched across browsers (excluding timing), and all 21 bounded outputs
per browser also matched their executions in the full-suite ordering.

Cumulative SNES phase wall times from that local run:

| Phase | Chromium | Firefox |
| --- | ---: | ---: |
| All thirteen fingerprints | 0.94 s | 0.95 s |
| One fresh compilation | 72.13 s | 70.03 s |
| All fixture loads/power resets | 290.28 s | 351.15 s |
| All fixture simulation/worker transfer | 1,993.04 s | 2,523.99 s |
| All fixture pixel readback/oracles | 4.29 s | 6.26 s |
| Complete thirteen SNES tests, including baseline/UI/assertions | 2,448.60 s | 3,059.51 s |

The phase rows are not all additive: the final row includes the preceding phases
and baseline/setup overhead. Two-worker elapsed time is 56.2 minutes; summing test
wall times is not CPU time or hosted runner work. No comparable unoptimized full
local run was performed, and the old four-worker desktop results use different
concurrency. Neither those results nor the cancelled Ubuntu run establish a
full-suite before/after speedup percentage.

Ten Python checks and the Node reuse-invalidation check passed. Actionlint
v1.7.12 passed both workflows; structural assertions and all sixteen combinations
of aggregate success/failure/cancellation/skip produced the required pass/fail
outcomes. Relative documentation links, static artifact hidden-file inventory
(none), and staged/unstaged whitespace checks passed. The separate Pages smoke
passed both checks against this build.

The standard native command could not start because port 8765 was occupied.
An isolated-port run reached compilation and failed its one integration test;
a direct native probe reproduced undefined `pthread_getaffinity_np`,
`pthread_setaffinity_np` and `sched_getcpu` symbols with local Verilator 5.052 /
Emscripten 6.0.13. This is the previously recorded host-toolchain incompatibility;
no native workaround or skipped native requirement was introduced. **The full
`npm test` result is not a pass.** Unit and complete static passes do not replace
the missing native/Ubuntu acceptance.

Mandatory remaining evidence: run the entire optimized workflow on Ubuntu for
the exact implementation revision; record its URL, result, browser/job durations,
total runner work, queue time and actual environment. Require both complete
browser suites and native/unit checks to pass before closing #30 or merging.
This node is prohibited from pushing changes, so its unpublished revision cannot
be tested by Actions from this local checkout.

After merge, the Issue separately requires the next applicable CI URL/result,
tested SHA and timings. That verification remains pending until it actually runs;
Pages deployment-only evidence cannot replace pre-merge full-suite acceptance.
