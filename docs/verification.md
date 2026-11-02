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

The native browser check could not complete on this host. Port 8765 was already
occupied; an isolated run on 18765 reached compilation, where the unmodified
native builder failed to link `pthread_getaffinity_np`, `pthread_setaffinity_np`
and `sched_getcpu` with installed Verilator 5.052 / Emscripten 6.0.13. A direct
`python3 build.py examples/counter.v .build/native-verification-check` reproduced
the linker failure. `build.py`, `server.py` and `simulator.cpp` are unchanged.
Native verification on the repository's compatible toolchain remains necessary.
Publication/public-site smoke remains pending; no push, deployment or Issue
closure was performed. Keep #44 open while reviewing this clocked increment's
explicit standards/runtime limits against the complete milestone.
