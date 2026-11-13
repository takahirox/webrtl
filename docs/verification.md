# Browser verification workspace (#44)

Use **Verification → Run configuration → Load adder verification files** to load
one registered DUT, two independently authored reference programs and a clocked
SystemVerilog harness. This replaces the project after confirming unsaved edits.
The original five examples remain unchanged. Sources and artifacts stay local;
all compiler/runtime assets are distributed with the static site, without a CDN
or compile service. Trusted-local mode continues to use its existing native tools.

## Run the generic example

1. Keep top `adder`, Generic interface and Slang. Select `adder.cpp`, then
   **Verify**. Clang compiles and executes its ordinary C++17 `main` as Wasm.
2. Select `adder.py`, then **Verify**. Pyodide executes ordinary Python 3.14.2
   with its standard library. Both programs generate the same sixteen input pairs
   and independent sums; the actual DUT runs through the existing RTL simulator.
3. Edit the Python expectation to `sum([a, b]) + 1` and verify. The first sample
   fails: expected `0x100`, actual `0x0ff`, inputs `a=0`, `b=255`, cycle 1.
   Remaining samples are unexecuted, not counted as passing.
4. **Inspect failure in RTL Debug** switches the same paused RTL instance to
   Debug. Inspect `sum`, or Step forward. Run, Step, Reset, input changes and
   recompilation invalidate the live failure link; the recorded evidence remains.
   Verify again to reproduce from reset. There is no backward restore or reference
   memory/flip-flop state migration.
5. Expand **Waveforms**, select `sum` and sample 2: the actual value is `0x105`
   (17 + 244). Export the real recorded values as VCD and the complete reference
   sequence as CSV. The scrubber selects recorded samples; it does not rewind RTL.

For SV-only testing, choose top `adder_tb`, **Clocked SV harness**, failure output
`failed`, and sixteen clocks. The harness instantiates the same DUT, generates
stimuli and computes expectations in standard synthesizable SV. Change the DUT
sum to add one: `failed` becomes 1 on the first sampled clock. Inspect `actual`
and `expected` in the trace or Debug. No extra verification syntax is embedded in
SV. The harness can be used with other HDL tools as a clocked top module.

## Roles and comparison boundary

The selected standard C++ or Python program owns stimulus generation and its
reference algorithm. It writes ordinary numeric CSV to stdout, which can also be
produced outside WebRTL. The small host bridge parses CSV and transfers input
values and expected observations between separate workers; it does not interpret
a model language. The UI scoreboard owns comparisons, result inventory and traces.
No proprietary project manifest or build language is required.

CSV header names are exact Generic top-level port names. Every external input
must have a column; at least one output must have a column. Values are unsigned
decimal or `0x` integers fitting the port width. Whitespace around cells and CRLF
are accepted. Quoting is unnecessary for these numeric records. Example:

```csv
a,b,sum
0,255,255
17,244,261
```

Before each run, all external inputs are set to zero and the DUT receives its
normal one-clock active-high reset. Row 1 is then applied at low clock, followed
by one complete rising/falling clock cycle and settling. Compare at settled low
clock, label cycle 1. Every subsequent row repeats this sequence in order. Output
columns may select a subset of outputs; unlisted outputs are still traced. Signed
ports use unsigned bit patterns. Split ports, arrays, inouts, more than 64 CSV
columns or ports wider than 256 bits are rejected for comparison.

For a pipeline, FIFO or transaction design, the standard reference program must
compute expected outputs at that exact post-cycle boundary, including reset,
latency, enable, valid/ready and ordering. Initialize/queue the reference state
accordingly. Variable-length asynchronous co-simulation, automatic latency
inference, per-row don't-care masking and four-state X/Z comparisons are not
implemented. A complete row is required for every sampled cycle, including idle
cycles. Models cannot read DUT outputs to manufacture their expectations.

Trace VCD includes the real observed top-level I/O at each completed comparison
boundary, including the failure. One VCD tick is a full clock cycle, encoded as
one synthetic `1ns` unit for interchange; these timestamps are cycle indices,
not measured physical nanoseconds. No intra-cycle edges or unsampled history are
invented. The waveform bus labels and values use the same samples as the export.
Existing Debug capture/history remains separately bounded to 256 clocks/16 parts.

## Bring existing sources

Import `.v`, `.sv`, `.cpp` and `.py` files, or **Import folder** to retain relative
paths (other extensions are skipped for folder imports). Add/rename accepts
paths such as `rtl/adder.sv` and `ref/adder.py`. Absolute paths, traversal, spaces,
shell characters, duplicate paths and filenames longer than 180 characters are
rejected. Directory names use letters, digits, underscores and hyphens and cannot
start with a hyphen. Imports are atomic. Switching files/tabs and both editable
panes share the same source contents. Single editor remains selectable on narrow
screens. Reload loses the in-memory project; a before-unload prompt protects
unsaved changes. Example replacement and removal require confirmation.

Only `.v`/`.sv` sources reach Yosys/Slang; model sources never reach HDL parsing.
Select an existing RTL top with scalar `clk` and active-high `reset`, Generic
interface and the appropriate HDL frontend. The browser builds its existing Fast
scheduler/CXXRTL model and retains Fast ↔ Debug shared-state behavior. Existing
ports/media/SNES contracts remain available for ordinary simulation.

Reference programs currently run as one selected source: standard-library C++17
`main` with stdout/stderr (no native libraries, exceptions, OS files, sockets,
processes or interactive stdin), or one Python script with the bundled standard
library. Additional Python packages, local sibling-module imports, multi-file C++
linking and arbitrary existing build scripts are not supported. Such projects need
their normal native toolchain. Standalone programs already writing matching CSV
can run unchanged; the example programs also run with native Clang/Python.

## SystemVerilog and cocotb compatibility

Yosys's Verilog frontend and Slang are synthesis/elaboration frontends, followed
by two-state cycle simulation in CXXRTL/the Fast scheduler. They are **not** an
event-driven SV/UVM simulator. Verification accepts the clocked synthesizable
subset illustrated by `adder_tb.sv`: modules, vectors/logic, combinational
assignments, parameters, `always_ff @(posedge clk)`, reset and module instances.
It conservatively rejects initial/final processes, delays (including
parenthesized delays), system tasks, classes/UVM, assertions/properties,
clocking/program/interface constructs, fork/join, force/release, wait, include
and define directives. Synthesizable `$clog2`, casting and dimension-query
functions are permitted. Compiler diagnostics still apply to unsupported RTL.
This guard runs for both reference-driven and SV-harness verification; ordinary
simulation retains its existing frontend compatibility.

[cocotb's GPI](https://docs.cocotb.org/en/v2.0.0/library_reference_c.html) depends on
VPI/VHPI/FLI integration with a simulator and embedded native Python. The shipped
CXXRTL browser ABI has no such integration. Pyodide alone cannot run existing
cocotb tests unchanged. No cocotb API imitation or UVM support toggle is provided.
Use a supported native cocotb simulator for those tests. Full event-driven SV,
UVM and unmodified cocotb remain outside this increment; #44 must remain open if
those are required for the project's end-to-end acceptance.

## Resource and lifecycle limits

| Resource | Bound |
| --- | --- |
| Project | 128 files; 128 KiB UTF-8 total, 2 MiB with Slang |
| Selected reference source | 128 KiB |
| Reference stdout | 1 MiB; 1–256 rows, at most 64 columns |
| C++ reference Wasm linear memory | 64 MiB linker maximum |
| Python runtime linear memory | 512 MiB Wasm declaration maximum |
| Reference preparation (downloads/compilation) | 120 seconds |
| Reference execution | 5 seconds, then worker termination |
| RTL compile | Existing 120 seconds; 600 with Slang |
| RTL request | Existing 10 seconds |

Cancel terminates the reference/compiler worker, stops subsequent comparisons and
retains any completed RTL samples. Workers are disposed after success, failure,
timeout, cancellation and page exit. The main UI stays responsive to Cancel even
if Python/C++ loops forever. Browser timer throttling can delay watchdogs.
Compiler/JavaScript heap memory is still bounded by the browser, not an OS quota;
large/pathological inputs can exhaust a tab. Run reference code you trust: worker
isolation provides no DOM or host filesystem, but Python's JavaScript bridge has
browser-worker capabilities. This is not a hostile-code security sandbox. The
application never uploads sources or verification artifacts automatically.

[Pyodide's worker documentation](https://pyodide.org/en/stable/usage/webworker.html)
describes the separate runtime. Pinned Pyodide 314.0.7 embeds CPython 3.14.2
(MPL-2.0/PSF); it adds about 13 MiB of same-origin runtime assets, loaded only for
Python runs. The host clamps the module’s declared maximum before instantiation;
the browser enforces failed growth. C++ reuses pinned YoWASP Clang 22.0.0-git20542-10
(LLVM Apache-2.0 with exceptions). Existing Yosys/CXXRTL versions and notices,
Pyodide/CPython license texts and source links ship in
[third-party-notices.txt](../web/third-party-notices.txt). No new design system or
remote compilation dependency is introduced.

## Validation and publication

The current [development lifecycle](development-flow.md#6-perform-required-post-merge-verification)
supersedes historical instructions below to keep #44 open solely for post-merge
verification: merge and close after complete implementation and required pre-merge
acceptance, then perform the public-site checks and track actual defects in linked
Issues. Missing implementation or genuinely necessary pre-merge milestone review
still blocks closure. The recorded validation results and pending checks below
remain unchanged.

`npm run test:pr` includes three focused real-model browser checks in the bounded
generic lane. Unit checks cover path security, CSV rejection, timing rejection
and independent VCD values. Browser checks execute both languages, positive and
negative comparisons, a real SV harness, VCD values, Debug at the failure boundary,
invalid inputs and cancellation. Additional file/layout regressions use the
existing workspace/project tests; the complete suite includes Firefox.

After merge/Pages publication, run the focused public-site smoke required by #44:
load generic RTL plus a reference, verify a real comparison and trace, then compile
and Step ordinary edited RTL. Record the deployed SHA/URL and actual observations
separately. The first focused test can target the public deployment:

```sh
WEBRTL_PUBLIC_URL=https://takahirox.github.io/webrtl/ \
  npm run test:demo:built -- --project=chromium --grep 'C\+\+ and Python references'
```

This test also loads the ordinary counter, compiles it and asserts Step=1.
Public deployment verification has not been performed from this worktree.

### Local implementation evidence (2026-11-03)

- `npm run test:unit`: 10 Python and 12 Node checks passed.
- `npm run test:pr:built -- --output=.build/verification-final-pr-results`:
  all 17 bounded Chromium checks passed in 3.2 minutes, including the full-console
  SNES smoke, Fast/Debug continuity, media and three new verification checks.
  This is local evidence, not an Ubuntu Actions timing claim.
- Additional Chromium counter/project checks passed: three checks in the initial
  run, followed by the fourth targeted check after updating its expected diagnostic
  to include `.sv`. The initial fourth check failed on the outdated message only.
- `npm run test:demo:built -- --project=firefox verification.spec.js workspace.spec.js counter.spec.js --output=.build/verification-final-firefox-results`:
  all eight checks passed in 1.5 minutes, including real C++/Python execution,
  the hard Python allocation limit, cancellation, file operations and reflow.
- JavaScript syntax, relative documentation links and staged whitespace checks
  passed. The complete SNES cartridge corpus was not run for this UI increment.

The initial native browser check could not complete on this host. Port 8765 was already
occupied; an isolated run on 18765 reached compilation, where the unmodified
native builder failed to link `pthread_getaffinity_np`, `pthread_setaffinity_np`
and `sched_getcpu` with installed Verilator 5.052 / Emscripten 6.0.13. A direct
`python3 build.py examples/counter.v .build/native-verification-check` reproduced
the linker failure. `build.py`, `server.py` and `simulator.cpp` are unchanged.
The compatible-toolchain check below resolves that native validation gap; it does
not claim that the installed Verilator 5.052 combination works.

### Compatible-toolchain native validation (2026-11-03)

Tested published PR #45 head `4154bdc3d2e761682c02a366cd53a3792ea972ba`.
The assigned checkpoint `60e23dc61639883f144911a984287503d7abc5b1` had an
identical file tree, confirmed with `git diff 4154bdc HEAD --exit-code` before
recording this evidence. Application, native builder and browser test sources
were unchanged during validation.

- Environment: macOS Darwin 27.2.0 arm64, Python 3.13.13, Node 26.12.1,
  Playwright 1.64.1, Chromium 156.0.8078.4 and Emscripten 6.0.13-git.
- Verilator was built from the unmodified upstream
  [v5.020 source archive](https://codeload.github.com/verilator/verilator/tar.gz/refs/tags/v5.020)
  (SHA-256 `41ca9abfadf8d2413efbff7f8277379733d0095957fe7769dc38f8fd1bc899a6`)
  under `.build/native-toolchain/`, without replacing the installed toolchain.
  CMake 4.3.1 Release, Apple Clang 21.0.0 and upstream Flex 2.6.4 with its matching
  headers were used. The experimental CMake build reports `rev UNKNOWN.REV`
  instead of a version string; the archive identifies the tested source version.
  Initial build attempts with Apple's Flex/header combination failed before a
  usable toolchain was produced; no application test pass is attributed to them.
- With the isolated Verilator on `PATH` and `VERILATOR_ROOT` pointing to its
  installation, `python3 build.py examples/counter.v .build/native-verification-check`
  successfully produced `sim.mjs` and `sim.wasm`.
- `npx playwright test --config=.build/native-validation.config.cjs`:
  **1 passed in 14.2 seconds**, no retries. This ran the existing
  `tests/browser/counter.spec.js` against the actual trusted-local service and
  native compiler, not a mock or a static-site substitute.

The temporary config extended `playwright.config.js`, changing only path
resolution, the isolated port and reporting/output locations. Its test and server
settings can be reproduced with:

```js
// .build/native-validation.config.cjs
const path = require("node:path");
const config = require("../playwright.config.js");
module.exports = {
  ...config,
  testDir: path.resolve(__dirname, "../tests/browser"),
  use: { ...config.use, baseURL: "http://127.0.0.1:18765" },
  webServer: {
    ...config.webServer,
    cwd: path.resolve(__dirname, ".."),
    command: "python3 server.py --trusted-local --port 18765",
    url: "http://127.0.0.1:18765",
  },
};
```

The first temporary-config launch resolved `server.py` relative to `.build` and
failed before starting the test; setting the server working directory above fixed
that setup error. The successful run verified the Wasm magic bytes, initial
Reset=0, Step=1, wraparound 255→0, Run/Pause stability, Reset while running,
editing the increment to produce 3 then 6, syntax-error diagnostics and successful
recompilation/Step=1 after recovery. It observed no browser page errors. Port
8765 and its existing service were left alone; the isolated service exited after
the run.

Native validation is no longer an outstanding pre-merge requirement for this
implementation. The documented clocked SV and standalone reference subsets are
the supported scope; full UVM/cocotb, arbitrary build systems and multi-file
reference linking are not claimed. Reassess the PR's stale partial/draft wording
against the Issue's actual criteria during publication/review rather than treating
those unsupported extensions as additional requirements. Keep #44 open until
the milestone review is complete. Pages/public-site verification remains pending
after merge; this validation performed no push, deployment or Issue closure.
