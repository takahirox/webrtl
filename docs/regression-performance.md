# Regression performance (#30 and #34)

## Fast PR policy (#34)

The [fast/full policy](pr-validation.md) supersedes the historical requirement
below to run comprehensive validation on every PR. The optimized full corpus and
#30 measurements remain intact; full CI now runs nightly/manual. The PR gate runs
sixteen generic/Pages/verification checks and one dedicated single-cartridge SNES smoke in
independent Chromium jobs, sharing one static build. The smoke compiles the
complete console and checks independent pixels/PCM, serial input, HDMA/interrupt
activity and CPU startup reset replay. Comprehensive fixture loops and the
LoROM/reset/HiROM UI baselines remain in the full suite.
The dedicated PR config prevents the full corpus from entering the fast lane.

Budget: preparation 2 minutes, each browser job 9 minutes, each Playwright lane
510 seconds, aggregate 1 minute. #48 supersedes the former 590-second
creation-to-check failure guard: **<600 seconds is the work/dependency feedback
performance goal**, with runner allocation and end-to-end attempt wall time
reported separately. Timing overruns warn; actual component failure, timeout,
cancellation, missing/skipped lanes or invalid provenance still fail. Full
budgets below are unchanged. See the [timing policy](pr-validation.md#budgets-provenance-and-acceptance).

**Ubuntu final-revision PR acceptance for #34/#48: pending.** This GitWeave node
may commit locally but must not push or create a PR. No successful hosted timing
is claimed from local validation. An authorized downstream PR run must record
final source/merge SHA/tree, URL, attempt-specific wall time, allocation/dependency
waits, execution/dispatch critical path, runner work, phase timings and outcomes.
Branch protection configuration and human-only approval are not prerequisites.
The measurements below preserve failed historical runs as failed evidence.

The issue's latest full reference is
[41257353210](https://github.com/takahirox/webrtl/actions/runs/41257353210):
152m53s end to end, Chromium about 118m01s and Firefox 150m54s. The independent
[Pages publication 41267991542](https://github.com/takahirox/webrtl/actions/runs/41267991542)
took about 64 seconds. Those are historical comprehensive/publication evidence,
not fast-PR acceptance.

### Queue-aware timing and compilation reuse (#48)

[Machine-readable measurements](pr-ci-measurements.json) retain source/job URLs,
SHAs, service/step intervals, local test outcomes, phase totals and source hashes.
The hosted baseline is PR #47,
[run 43529597889](https://github.com/takahirox/webrtl/actions/runs/43529597889),
source `ec6deab792d232e0a747b7a4a7c49ee5db6608ba`, merge checkout
`fb2d3c2681429da202c5a119a7888e9634749157`.
Generic/SNES jobs took **432s / 417s**; browser install took **23s / 35s**,
artifact download **6s / 2s**, and browser test execution **389s / 364s**.
SNES compilation consumed **302.94s** (about 102.39s frontend/backend and
200.57s Clang/setup), followed by **53.55s simulation**. The actual browser work,
rather than installation alone, dominated both lanes.

Attempt 2's run start is `00:01:18Z`; its API returns successful component
intervals from before that start, relabelled with `run_attempt=2` and new job
creation timestamps. They are carried dependencies, not 7-minute work in the
rerun. The new summary identifies this and counts only current-attempt work.
The original run's initial wait was about 343s; dependency-ready waits were
41s generic, 30s SNES and 50s aggregate across the underlying execution.
Those waits must not be added together across parallel branches. The old
aggregate's failure remains recorded; it is not rewritten as a successful run.

Comparable local Chromium 156 / Playwright 1.64.1 measurements use one worker
on the same Darwin arm64 Mac16,5 (16 physical cores, 64 GiB), Node 26.12.1 and
pinned toolchain. These are separate sequential lane invocations, not hosted CI
feedback measurements. The recorded dirty-worktree source hashes identify the
implementation measured; the base commit alone does not identify those edits.
The JSON distinguishes comparison hashes from final hashes after default-board
normalization was hardened; further cold/reused and focused checks cover that
final boundary fix.

| Local observation | Before | After cold | After reuse |
| --- | ---: | ---: | ---: |
| Generic lane, all 16 checks | 119.49s | 92.33s | same page-local verification reuse applies on every run |
| Generic fresh RTL compilations | 36 | 25 | — |
| Generic completed compilation total | 79.65s | 54.84s | — |
| Generic Yosys / Clang invocation totals | 7.12s / 72.15s | 4.79s / 49.76s | — |
| Generic completed reference work | 11.44s | 10.91s | — |
| SNES lane, full smoke assertions | 89.64s | 91.91s | 27.63s |
| SNES current compilation | 63.23s | 65.99s | 0.0005s browser byte reconstruction; cache validation is in test overhead |
| SNES simulation | 23.34s | 23.76s | 23.86s |

Generic wall time fell **22.7%** by removing duplicate DUT compilation during
reference edits, while explicit Compile and changed HDL still compile freshly.
The new runtime-worker instrumentation measured **0.85s** of generic worker
round trips; that category was unavailable in the older baseline. Test wall
time also includes UI/assertion work, intentional timeout/cancellation checks,
server/browser startup and delivery overhead. Worker intervals may overlap and
are not a substitute for wall time.

SNES reuse reduces lane time **69.9%** relative to the new cold path. Cold
compilation is not faster; unchanged complete-console binaries are reused only
when every compilation input and actual browser identity matches. Cache entries
live under their input fingerprint, so normal local source changes select a cold
entry; corruption or foreign provenance inside the selected entry fails.
GitHub cache visibility rules still apply: an initial PR can be cold, while
updates/reruns of that PR can reuse its successful cache. No cross-PR cache hit
or hosted critical-path improvement is claimed here. Each path runs unchanged
pixels/PCM, serial input, interrupts/HDMA, reset replay and scheduled/reference
comparisons with fresh runtime instances. A tested `-O1` experiment increased
compilation to 227.30s and was interrupted during simulation; it was rejected,
and production remains `-O2`.

All **10 Python + 24 Node** checks, **16 generic**, cold and reused **SNES smoke**,
and **4 additional Chromium counter** regressions passed. The full discovery
checks still retain 94 static tests, both browsers and all cartridge inventories.
Actionlint 1.7.12 passed all three workflows. No complete nightly/Firefox run was
performed for this scoped change. The final hosted PR workflow run is still
**pending**, as required by the current policy; local results do not close that
acceptance gap and introduce no human-only approval step.

### Review fixes and failed hosted evidence

[Ubuntu run 41288950303](https://github.com/takahirox/webrtl/actions/runs/41288950303)
**failed/cancelled**: compilation took 387.64s and the former SNES harness timed
out at 440s during baseline reset, before reaching its four selected cartridges.
The dedicated smoke now avoids the comprehensive harness's repeated
UI/baseline/fixture simulations;
it compiles the same full console and observes one boot cartridge instead.
At that revision, browser jobs allowed nine minutes (Playwright 510s; SNES test
500s), within the then-enforced <600s creation-to-result acceptance and 590s
aggregate guard. #48 replaces that elapsed-time gate as described above. The improvement comes from removing repeated simulations;
no timeout-only success is claimed.
The [selection policy](pr-validation.md) records its exact limits and the extra
CPU/PPU/DMA/APU/cartridge evidence required for affected changes.

That run also exposed an Actions/runner clock mismatch. Actions recorded aggregate
start `09:36:02Z`, while the first runner step began at `08:36:03Z`. Subtracting
uncalibrated runner time produced the invalid −3087.565s summary. The revised
calculation anchors the local interval to the Actions job start, producing a
511.435s live estimate for that observation. The actual completed Actions interval
is `09:27:34Z` → `09:36:09Z` = **515s**, with **2s initial queue**, 2s dependency
wait per browser/aggregate and **607s summed runner work**. This is timing evidence
for a failed run, not successful fast-gate acceptance. Regression tests use these
actual timestamps, test positive/negative skew and fail on missing calibration.
The completed-run calculation uses Actions completion directly; the live estimate
reserves ten seconds for initial setup, precision and cleanup.

A successful hosted run of the revised final tree remains required before #34
closes.

The revised smoke passed locally on the same macOS/M4 Max toolchain described
below: **1/1 in 94.09s**, including **81.66s compilation** and **10.81s runtime**.
The initial 52-batch boot probe failed its independent pixel expectation before
the real SPC700 upload completed; the passing smoke allows 100 boot batches.
The generic lane passed **8/8 in 27.44s**. Python **10/10** and Node **4/4** passed,
including the skew regression and exact full fixture discovery. Actionlint 1.7.12
passed all three workflows, and 44 relative documentation links/anchors passed.
Repeating the deliberate built-worker count mutation rejected `0` instead of `3`;
restoring the original bytes made the counter smoke pass again in 3.1s.
These local results do not establish Ubuntu final-revision acceptance. The
comprehensive runtime suite was not rerun; its fixtures, loops and assertions
are unchanged.

### Superseded four-cartridge implementation verification

On 2026-11-01 the implementation worktree passed 10 Python and 3 Node checks.
The generic Chromium lane passed 8/8 in **27.33 seconds**; the focused SNES lane
passed 1/1 in **169.45 seconds**, with fresh full-console browser compilation
(**86.99 seconds**), all four cartridges, the CPU replay and original baseline
checks. Both reports had zero unexpected, skipped or flaky tests. These lanes
ran sequentially on macOS 27.2 arm64 / Apple M4 Max, Node 26.12.1, Python 3.13.13
and pinned Playwright 1.64.1; they do not measure Ubuntu setup, scheduling or
creation-to-aggregate latency.

A deliberate mutation of the **built artifact only** forced the real simulator
worker's returned counter value to zero. The selected existing edited-counter
smoke failed at Step with expected `3`, received `0`. Restoring the original
worker bytes made the same smoke pass (3.2 seconds). No defect or mocked runtime
was retained in source or the build.

Actionlint 1.7.12 passed all three workflows. Parsed workflow assertions checked
PR/main and nightly/manual triggers, independent concurrency, always-run aggregate
dependencies, both full browsers, deployment dependency/main restriction, timeouts
and absence of failure suppression. Unit checks cover all sixteen component
result combinations, boundary/invalid timing failures, queue/runner calculations,
exact discovery counts and forbidden PR cartridge overrides. Relative documentation
links/anchors and staged/unstaged whitespace checks passed.

The multi-hour complete runtime suite and native suite were **not rerun** for this
CI redistribution: no comprehensive circuit loop, fixture, expected value or
native command changed. Their runtime acceptance here is not claimed. Hosted
workflow behavior, artifact transfer and <600s final-revision PR timing still
require the actual Ubuntu run above. The local macOS host is not a standard
GitHub Actions Ubuntu runner. The complete discovery
inventory is now **80 static tests** (40 per browser), including the six generic
mode tests added in #32 after #30's 68-test measurement. Each browser still has
13 SNES batches, 260 named fixtures and 29 CPU/IRQ replays. Fixture annotations
make the inventory visible in discovery/reports; no original oracle is removed.

## Historical full regression performance (#30)

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
repeated, and each static runner installs only its own browser. Historically, superseded PR
revisions cancelled the old full-validation group; #34 moves PR cancellation to
the fast group and retains nightly/manual full runs. There is no duplicate
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
set in comprehensive CI; the dedicated PR config uses its own fixed selection.
Focused results must not be labelled a complete suite.

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
publication. The full-check-before-merge policy described here is historical
and is superseded by #34's fast gate plus affected-area review evidence.

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
  npm run test:demo:built -- --grep 'focused SNES RTL'
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
