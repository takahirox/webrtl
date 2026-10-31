# Full regression performance (#30)

The optimization retains the complete local `npm test` coverage. It reduces
repeated compilation and identical baseline checks; no cartridge, independent
pixel/PCM expectation, simulation cycle count, or CPU/IRQ reset replay is removed.
Required pre-merge Ubuntu acceptance **passed** in
[run 41193356269](https://github.com/takahirox/webrtl/actions/runs/41193356269)
for PR head `13fd24c08ff367ad55f5c5093247a41faffc2b36` (tested merge commit
`3e21426b95bb3cead39d3758d1d9aa7136ecb0b4`, identical source tree). The completed
Ubuntu evidence below is separate from the local and Pages results.

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

The reference budget is **180 minutes per browser job**, **under 190
minutes elapsed feedback** including preparation, and **under 370 total runner
minutes**, excluding queues. Preparation has a ten-minute bound; each cartridge
batch retains its existing thirty-minute bound. The old complete Chromium SNES
portion alone took 199.6 minutes, including 45.5 minutes of compilation. Removing
twelve compilations plus twelve identical UI/three-run baselines provides budget
headroom; Firefox's measured simulation is slower. This is an evidence-informed
initial ceiling, now supported by the complete Ubuntu run below: browser jobs
took 143.0 and 160.8 minutes, elapsed feedback was 161.2 minutes including queues,
and total runner work was 304.1 minutes. Retain these ceilings to allow for runner
variation; one passing run does not establish a latency distribution. Investigate
phase growth instead of increasing timeouts. Record actual elapsed, sum of job
execution times and queue times separately. No full-suite speedup percentage is
claimed from cancelled runs.

Pages retains its own ten-minute build/smoke/deploy bounds, artifact provenance,
failure propagation and non-cancelling deployment ordering. It has no dependency
on full validation. The [#26 sequencing record](pages-validation.md#sequencing-outcome-and-30-follow-up)
keeps the cancelled full result visible and records the independent successful
publication; the ordinary full-check-before-merge policy remains in force.

## Local validation

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
`npm test` result is not a pass.** This local failure remains recorded; the
reference Ubuntu native integration subsequently passed as detailed below.

## Completed Ubuntu acceptance (2026-10-31)

[Full validation run 41193356269](https://github.com/takahirox/webrtl/actions/runs/41193356269)
completed successfully on its first attempt. It tested merge commit
`3e21426b95bb3cead39d3758d1d9aa7136ecb0b4`, whose tree
`df5d2de81e14c618d3ab5872a5680f733772b794` equals PR head
`13fd24c08ff367ad55f5c5093247a41faffc2b36`. This evidence update changes
documentation, measurement data and workflow summary wording only; test commands,
coverage, RTL/runtime/compiler inputs, job scheduling and timeouts are unchanged.

Both browser runners used Ubuntu 24.04.5, Actions image `ubuntu-24.04`
`20261025.353.1`, four logical CPUs on AMD EPYC 7763, 15,983 MiB RAM, Node 22.23.4,
Python 3.12.3 and Playwright 1.64.1. Chromium was 156.0.8078.4 (revision 1248),
Firefox 157.0 (revision 1555), native Verilator 5.020 and Emscripten 3.1.6.
Browser Yosys 0.70.1258 and Clang 22.0.0-git20542-10 remain lockfile-pinned.
Each browser used one worker. The image and relevant tool versions match the
cancelled reference run; its unrecorded CPU/memory prevents claiming an isolated
hardware-controlled benchmark.

| Completed component | Result | Job execution time |
| --- | --- | ---: |
| Unit checks and static build | 10 Python + 1 Node check passed; build/upload passed | 12 s |
| Chromium | 34/34 static checks; 1/1 native integration check passed (34.4 s) | 8,580 s (143.0 min) |
| Firefox | 34/34 static checks passed | 9,650 s (160.8 min) |
| Full regression suite | Aggregate passed | 4 s |

The browser reports have zero failures, skips or flaky results. Conditional
workflow steps for the other browser are skipped by design; no required suite
was skipped. Run creation was `10:35:10Z`, preparation started `10:35:13Z`, both
browser jobs started `10:35:27Z`, and the aggregate completed `13:16:23Z`.
Creation-to-aggregate feedback was **9,673 seconds (161.2 minutes)** including
queues; execution on the critical path was **9,666 seconds (161.1 minutes)**.
Queue/dependency-ready wait on that path was **7 seconds**: initial 3 s, browser
start after preparation 2 s, aggregate start after Firefox 2 s. Each browser had
the same 2 s ready wait; summing those waits would count concurrent waits twice.
Sum of all four job execution intervals was **18,246 seconds (304.1 runner
minutes)**, including setup, artifact transfers and cleanup. These are elapsed
runner intervals, not CPU time or billed minutes. All stated budgets were met.

The complete Chromium SNES interval fell from **199.6 to 131.2 minutes
(34.3% less)**, using the same inferred-compile-start to last-batch-completion
convention and the same thirteen batches. The first two batches fell from
27.9 to 22.4 minutes in Chromium and 31.3 to 24.8 minutes in Firefox. These
observations show less work within each one-worker browser, separately from the
elapsed-latency benefit of splitting browsers onto runners. They are operational
comparisons, with minor console delivery delay and uncontrolled runner variation.
The historical full suite was cancelled after 262.9 minutes inside `npm test`;
there is no successful full-suite baseline or full-suite speedup percentage.

Both uploaded browser artifacts were downloaded and their ZIP SHA-256 digests
verified against Actions metadata. Each contains all **260 fixture names plus
29 CPU/IRQ replays**, thirteen measurement files, one fresh compilation and
twelve reuse hits. Every replay matches its original output, including the AUX
pair. All 26 saved Wasm files have SHA-256
`3bd23feeae078fa811b4a9f29a7ca3e5287967851af345151a7de741b4bba060`, matching
the bounded unoptimized build. Canonical complete output SHA-256 is
`03a41737483bd7523e3b64741a4418a9e5802810170e8f681639b8c4951ca30c` in both
browsers, matching the complete local results (sort fixture names and JSON keys,
omit timing fields). Independent pixel/PCM/control assertions all passed,
including the expected negative frame control.

| Cumulative SNES wall-clock phase | Chromium | Firefox |
| --- | ---: | ---: |
| All thirteen fingerprints | 1.80 s | 1.80 s |
| One fresh compilation | 197.66 s | 223.65 s |
| All fixture loads/power resets | 918.75 s | 1,058.25 s |
| All fixture simulation/worker transfer | 6,482.39 s | 7,336.74 s |
| All fixture pixel readback/oracles | 8.50 s | 11.86 s |
| Complete thirteen SNES tests, including baseline/UI/assertions | 7,871.16 s | 8,928.43 s |

The final row includes the earlier phases and baseline/setup overhead; rows are
not all additive. The other static tests and runner setup explain the difference
from complete browser/job elapsed times. Simulation remains the principal cost;
fingerprinting and readback are small. Full timestamps, report counts, phase
totals, artifact digests and comparison conventions are retained in
[the measurement data](regression-measurements.json).

Independent [Pages PR run 41193356215](https://github.com/takahirox/webrtl/actions/runs/41193356215)
also passed its build/smoke job in 33 seconds; deployment was skipped for the PR.
That bounded result is separate from full regression acceptance and from the
already recorded #26 main publication verification.

The evidence update passed actionlint v1.7.12 for both workflows, 44 relative
Markdown link/anchor checks, JSON/timing and tested-source hash checks, and
staged/unstaged whitespace checks. The workflow diff changes only its budget
summary text; execution and coverage match the tested implementation.

After merge, the Issue separately requires the next applicable CI URL/result,
tested SHA and timings. That verification remains pending until it actually runs;
Pages deployment-only evidence cannot replace pre-merge full-suite acceptance.
