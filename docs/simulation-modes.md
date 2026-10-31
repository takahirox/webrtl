# Fast and Debug simulation

The public browser compiler starts every successful compilation in **Fast**.
Pause, choose **Debug**, inspect or capture selected signals, Step or Run to a
condition, then Pause and choose **Fast** to continue. Changing mode never clocks,
resets, recompiles or replaces the circuit. Editing RTL/interface/frontend/top
or recompiling discards the previous circuit. Reset pauses and applies the
selected board's existing RTL reset protocol (SNES uses its existing power reset
and cartridge reload). The trusted-local Verilator counter remains a separate
legacy interface without these browser debugger controls.

For a project without a predefined media adapter, choose **Generic**. It requires
scalar unsigned `clk` and active-high `reset` inputs; other ports may be arbitrary
input/output bit vectors. Inouts and additional independently scheduled clocks
are unsupported. Clocking, reset and two-state synthesis limitations are the same
as the existing CXXRTL runtime. Use **Generic RAM pipeline · Fast/Debug** for a
two-file example with a 16-byte writable RAM, an accumulator, a 65-bit register,
and falling-edge state. In Debug, set `enable` to `0x1` and `stimulus` to `0x13`,
select `address`, set Equals to 3, Apply, and Run. Execution stops at cycle 3.
Select `storage.memory` and a row offset to inspect a RAM word.

## Execution configuration

Both modes use the same RTL-derived Yosys CXXRTL (`-O6 -g4`) model compiled with
the pinned browser Clang at `-O2`. Debug metadata is cold and initialized lazily;
CXXRTL computes optimized-out public combinational wires only on inspection.
No extra compiler, server, emulator, input upload or cartridge upload is involved.
Live build/session identity uses Web Crypto on HTTPS or loopback origins.
Verilator is not added as a browser backend: this increment uses the established
entirely in-browser toolchain.

The Wasm **Fast loop** specializes `tick<false>`: CPU/SNES bus trace collection
is compiled out, and signal lookup, outline evaluation, history and conditions
are absent. Fast never exports internal signal values per clock. It still clocks
and settles every transition and preserves video/audio/external I/O handling,
including bounds checks. Debug uses a separate `tick<true>` loop with bounded
bus tracing and optional selected-signal sampling/conditions. Keeping cold debug
metadata in the shared binary costs code size and compilation time; this is the
initial shared-backend milestone, not separately compiled model migration.

A request executes at most 16,384 complete clocks inside Wasm. The UI maintains
one batch in flight and yields between requests. Fast uses 16,383 clocks on
non-audio boards (avoiding a fixed power-of-two sampling alias on small counters),
and each audio board's existing bounded batch with Web Audio backpressure. It
requests the next batch promptly; audio pacing still prevents unbounded queued
sound. Debug uses the board's smaller/paced batches (256 clocks, unpaced, for
Generic). Pause finishes the in-flight batch; it cannot interrupt a synchronous
Wasm invocation midway. The acknowledged cycle and displayed state include that
batch. No edges are omitted or aggregated into a guessed output. Slow RTL can
still reach the existing ten-second worker watchdog.

The timing readout reports actual completed clocks divided by wall time since
Run, including scheduling/pacing and worker transfers, or request wall time for
an individual Step. A declared clock rate adds simulated seconds and a real-time
ratio. Generic defaults to unspecified (0): no real-time ratio is shown until a
rate is entered. Counter/CPU/media defaults retain their existing declared rates.
Performance varies by circuit, host and browser; matching hardware clock speed
is not guaranteed.

## Signal and condition semantics

The explorer uses CXXRTL public debug items, including hierarchical flattened
names, register values, constants/aliases, and writable memory words. It reports
part widths, bit offsets and memory depths. Multipart signals appear as separate
parts; the label `[lsb +: width]` identifies each part. The worker discovery API
also reports CXXRTL flags/type and memory `zero` index. Numeric `id` values are
local to the current build. A stable logical element identity is
`(build, hierarchical name, lsb, width, memory zero + row offset)`; never persist
an `id` across compilation. Compiler optimization may remove unobservable/private
signals; the catalog is not a claim to expose every source-level expression.

Inspection reads unsigned hexadecimal two-state values of arbitrary width.
Memory reads use a zero-based row offset into that item (add its `zero` index for
the HDL index). Up to 256 parts/rows may be read per worker request. No unknown,
high-impedance, arbitrary event-driven or four-state breakpoint semantics are
provided. Inspection does not force internal registers or memory writes.

Capture samples up to **16 selected parts/rows**, each at most **32 bits**, after
each full low → high → low clock has settled, including falling-edge state.
The Wasm ring and worker history retain at most **256** rows; only selected
values are retained, not all signals. The timeline displays cycle numbers and
hexadecimal values in selection order. Applying a new selection/condition clears history. Reset clears capture/condition
configuration and history; the UI selection can be applied again. Fast adds no history; returning to Debug retains the
previous bounded history with an explicit cycle gap for time spent in Fast.

One condition can watch the first selected part/row: unsigned equality, any
change, zero → nonzero, or nonzero → zero. Conditions are tested after each
complete clock and stop the Wasm loop at that boundary, including within a batch.
An edge compares the pre-clock value to the post-clock value; sub-cycle glitches
are not observed. Equality tests the post-clock value (it does not stop before
executing the first requested clock). Unsupported widths/rows/values reject
before changing the configuration. Bus traces remain bounded by the existing
128/4096-entry board limits and are active only in Debug.

External input controls accept unsigned `0x` hexadecimal for a single-part,
zero-indexed input vector, then settle the model at low clock without adding a
clock. `clk`/`reset` are managed by the runtime. Inputs persist across mode changes
and ordinary RTL reset; SNES's existing controller/reset semantics still apply.
Keyboard/gamepad buttons continue to update at Run batch boundaries. Memory
contents change through RTL, including its reset logic, rather than host emulation.

## Version 1 live snapshot / handoff contract

This compatible mode pair uses **explicit shared-live-model state retention**.
`pause` / `_sim_pause()` returns a versioned envelope:

```json
{
  "format": "webrtl-live-state", "version": 1, "backend": "cxxrtl",
  "build": "SHA-256 of the compiled Wasm", "session": "unique live instance",
  "generation": 1, "cycles": 7, "phase": "settled-low", "initialized": true,
  "retention": "shared-live-model", "inputs": {"stimulus": "0x13"},
  "cartridge": null, "media": "pending-playback-cleared",
  "trace": "bounded-forward-history", "token": "unique pause capability"
}
```

All sequential state, including FSMs, RAM, initialized/unexposed registers,
CXXRTL edge-detector state and board adapter buffers, remains in the **same live
instance**. The envelope references that complete retained state; it is not a
portable serialization of the catalog. It records logical timing, injected
input configuration and loaded cartridge SHA-256 (when present); the live board
also retains cartridge bytes/mapping and external control state. The public
catalog supplies element identities/widths for inspection; it is deliberately
not used to reconstruct hidden simulator state.

`mode` / `_sim_mode(mode, snapshot)` validates the envelope against the current
pause before changing mode. Wrong version/backend/build/session/generation,
modified envelopes, and expired tokens reject with an incompatibility error.
Advancement, input injection, reset, cartridge changes and recompile invalidate
a pause capability. A new pause supersedes the previous one. A mode change
returns a new envelope without advancing a clock. Passing no envelope switches
only the current live model; it never restores or resets another instance.

No raw Wasm memory dump is exported or treated as portable. **Reload, rewind,
serialized snapshot restore, distinct build/instance restore, and CXXRTL ↔
Verilator migration are unsupported.** Even recompilation of identical source
creates a different live session. Future serialized implementations need a new
retention kind with a validated logical state-element payload and proven
continuation equivalence; a raw heap copy must not implement that contract.

Pause/mode switch clears scheduled Web Audio playback but preserves RTL audio
phase, drawing/frame buffers and subsequent PCM. Pending batch output is consumed
once; control/inspection replies do not redeliver stale frames/audio/traces.
Reset/recompile retain their existing media-clearing lifecycle. A paused image
can remain visible; waveform history is forward-only and bounded, not rewind.

## Validation and measurements

`tests/static/modes.spec.js` compiles the non-SNES two-file Generic fixture and
compares every discoverable value and all RAM rows after uninterrupted and
Fast → Pause → Debug → Step/Run → Fast execution under identical deterministic
input changes. Independent early accumulator/RAM/falling-edge checks prevent
an equal-but-wrong continuation from passing. It also exercises equality/change/
zero edges, history overflow, invalid/expired/other-instance envelopes, input and
width rejection, Pause while a worker batch is pending, reset and edited-source
recompilation. Existing browser tests preserve independent counter, CPU bus,
video pixel and PCM assertions; tests requiring bus traces explicitly use Debug.

Run focused checks after `npm run build:demo`:

```sh
npx playwright test --config=playwright.static.config.js tests/static/modes.spec.js
```

For an optional before/after throughput comparison, serve `.build/pages` with
`python3 tests/serve_static.py` and in another terminal run:

```sh
node scripts/benchmark-modes.cjs 2915de63848a30d42f194f47adfb715782604bea --snes
```

Rebuild the site before publishing after this manual benchmark: its staged
baseline assets are for local comparison only.

The script compiles the baseline Git revision and current compiler independently
in Chromium, reuses each compiled model, and records three warmed sequential
trials with identical batch counts in `.build/mode-benchmark.json`. These are
unpaced worker-capacity measurements: wall time includes worker/media copies,
but excludes the UI scheduler and audio playback pacing. Debug has no selected history/condition, so it
measures bus diagnostics rather than the cost of a chosen waveform workload.
Compilation, reset/cartridge loading and warmup are excluded from throughput.
CPU-bus RAM self-test halts its bus master at PASS; that benchmark includes idle
RTL clocks and is not sustained active-CPU throughput. SNES uses the original
cartridge and a bounded active video/audio workload. See the recorded results
below for actual measurements and validation limits.

Required post-merge public Pages smoke for #32: **pending deployment**. Compile
an edited generic project on the public site, run Fast, Pause, enter Debug,
inspect/step, return to Fast and verify continued execution without reset. Record
the deployed SHA, URL and actual result separately; local checks do not establish
publication and deployment is not a pre-merge gate.

### Recorded local results (2026-10-31)

Chromium 156.0.8078.4 on macOS arm64, baseline `2915de6` versus this implementation,
three warmed direct-worker trials per mode. Median clocks/s:

| RTL workload | Before | Fast | Debug, no selected history |
| --- | ---: | ---: | ---: |
| Counter | 131,689,294 | 134,217,728 | 125,955,075 |
| Five-file CPU-bus/RAM self-test, including halted clocks | 19,204,689 | 19,065,018 | 18,196,547 |
| SNES original cartridge, 524,288 measured clocks/trial | 272,669 | 268,962 | 271,581 |

Fast worker capacity remains close to the existing backend, with no demonstrated
SNES speedup in these short trials; even the Fast/Debug ordering can vary with
noise and compiled-code layout. SNES Fast is about **0.0125×** its declared master
clock. Circuit evaluation dominates this workload. The new Fast scheduler removes
the counter/video's old target pacing, and the Fast loop removes diagnostic work,
but neither guarantees a generally faster RTL evaluator or real-time SNES play.

The shared debug-capable binary is larger and takes longer to compile. Counter Wasm
increased from 29,304 to 126,435 bytes (compile 1.38 → 2.06 s); CPU-bus/RAM from
43,544 to 146,439 bytes (1.65 → 2.38 s); SNES from 270,944 to 593,097 bytes
(66.01 → 81.28 s). These local compile times exclude network variance on a public
host. They make the first milestone's metadata/visibility tradeoff explicit.
The complete trials and scoped validation record are in
[simulation-modes-validation.json](simulation-modes-validation.json).

Python's 10 tests passed. Chromium's 23 non-SNES tests passed; a subsequent
11-test run covered counter, generic modes, media and the focused SNES cartridge.
Firefox covered the same non-SNES paths and focused SNES cartridge. Its initial
run caught two omitted-board protocol regressions; after fixing them, the final
10-test generic-mode/video/audio run passed in both Chromium and Firefox (52.6 s).
The last inspector rerun passed all four tests across both browsers (20.1 s), and
the static Pages asset/edited-counter smoke passed both tests (3.2 s).
The focused SNES runs preserve independent pixel, PCM, input, LoROM/HiROM and
repeat-reset assertions; the exhaustive cartridge sweep was not repeated.

The trusted-local browser check is **blocked by the installed native toolchain**:
Verilator 5.052 plus Emscripten 6.0.13 fails linking the existing CPU-affinity
symbols, independently reproduced with `build.py`. This is the known setup limit
in the README; the compatible Verilator 5.020 reference check remains necessary
in CI. It is not reported as a passing native regression or a browser compiler
failure. Public-site verification remains pending as described above.
