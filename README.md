# webrtl

WebRTL runs an 8-bit Verilog counter as a WebAssembly circuit in your browser.
The static demo uses a precompiled model; local development also supports editing
and compiling trusted HDL with Verilator and Emscripten.

## Public counter demo

Demo URL: **https://takahirox.github.io/webrtl/** (published after the Pages workflow
successfully deploys `main`). No installation or backend is needed. The page loads
the precompiled counter automatically. Use **Run / Pause / Step / Reset** to inspect
the circuit: Step advances one full clock cycle, count wraps modulo 256, and Reset
pauses and returns to zero.

The demo shows the compiled RTL as read-only and has no Compile action. Arbitrary
RTL editing/recompilation and browser-side HDL compilation are not available on
GitHub Pages yet. Use [local development](#local-setup) for edit-and-compile work.
The demo reuses the existing RTL, C++ simulator, and Verilator/Emscripten pipeline;
JavaScript displays the actual Wasm model output.

### Build and preview the static site

Install the same Python, Verilator, and Emscripten tools described below, then run:

```sh
python3 build_site.py
python3 -m http.server 8000 --bind 127.0.0.1 --directory .build/pages
```

Open **http://127.0.0.1:8000/webrtl/**, including the trailing slash. This is a plain
static file server; do not start `server.py` for this preview. Relative asset URLs
keep the UI, example RTL, ES module, and sibling Wasm file under `/webrtl/`.

The build replaces `.build/pages/webrtl/` with the six runtime files: `index.html`,
`app.js`, `style.css`, `example.v`, `sim.mjs`, and `sim.wasm`. Native compilation runs
only at build time through [build.py](build.py). Compiler intermediates are not
published, and generated files are ignored by Git. Rebuild after changing the RTL,
simulator, or UI. Node.js is needed only for automated browser tests, not this build.
Use the Ubuntu 24.04 packages as the deployment reference toolchain. The newer
Verilator 5.052 / Emscripten 6.0.13 combination currently fails to link CPU-affinity
symbols in the existing pipeline; use the Ubuntu packages for static builds if
you encounter that error.

### GitHub Pages deployment

One time, in the repository's **Settings → Pages → Build and deployment**, select
**GitHub Actions** as the source. If the `github-pages` environment has deployment
branch restrictions, allow `main`.

[The Pages workflow](.github/workflows/pages.yml) runs on pull requests to `main`,
pushes to `main`, and manual dispatch. It installs the toolchain on Ubuntu 24.04,
runs the Python and real-circuit browser checks for both modes, then uploads the
tested `.build/pages/webrtl/` contents as a Pages artifact. Only runs on `main`
deploy, using the `github-pages` environment and scoped `pages: write` and
`id-token: write` permissions. Manual dispatch on `main` can retry a deployment.
The artifact's contents become the project site's root; do not upload the parent
`.build/pages/` directory or the URL would have an extra `webrtl/` segment.

Required post-merge verification for #6 remains separate from pre-merge checks:
after the workflow deploys, open **https://takahirox.github.io/webrtl/** publicly,
confirm the Wasm initializes at zero, Step to one, Run then Pause and confirm the
value stops changing, and Reset to zero. Record any deployment/settings problems
separately. Local checks do not establish that the live deployment succeeded.

## Local setup

Use Python 3.10+, Verilator 5+, and Emscripten 3.1.6+ with `verilator` and `em++`
on `PATH`. No Python packages or frontend dependencies are needed to run the app.
On Ubuntu 24.04:

```sh
sudo apt-get update
sudo apt-get install python3 verilator emscripten
```

On macOS with Homebrew:

```sh
brew install python verilator emscripten
```

Alternatively install the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
and activate its environment in the same terminal as the service. Verify the
toolchain, then start the service from the repository root:

```sh
verilator --version
em++ --version
python3 server.py --trusted-local
```

Open **http://127.0.0.1:8000** in a modern desktop browser. The page loads
[examples/counter.v](examples/counter.v). Edit it if desired, then click **Compile**.
The first compilation may take longer while Emscripten initializes its cache.
Build errors appear below the editor; fix the source or toolchain and retry.

- **Step** evaluates low → high → low on `clk`: one complete clock cycle.
- **Run** advances that same model at approximately 10 cycles per second.
- **Pause** stops advancement, preserving circuit state.
- **Reset** pauses, clocks with `reset` asserted, then deasserts it. The provided
  counter returns to zero; its next Step produces one. It wraps from 255 to zero.

Editing or recompiling stops and discards the previous simulator. Each successful
compile starts a fresh circuit and resets it. Reset also works while running.
Use `--port 8001` if the default port is occupied. Stop with Ctrl-C; temporary
build artifacts are removed on normal shutdown.

## Build and simulation boundaries

```text
Editor → POST /api/build {"source": "…"}
       → Verilator C++ model → Emscripten → sim.mjs + sim.wasm
       ← {"moduleUrl": "/builds/<unique-id>/sim.mjs"}
Browser imports the module and executes the WebAssembly model locally.
```

[build.py](build.py) accepts one source string and an output directory. It uses
[Verilator's C++ generation](https://verilator.org/guide/latest/verilating.html),
then compiles the generated model, Verilator runtime, and
[simulator.cpp](simulator.cpp) with Emscripten. Emscripten's
[modularized ES module output](https://emscripten.org/docs/compiling/Modularized-Output.html)
exports an asynchronous factory. The resulting instance exposes `_sim_init()`,
`_sim_step()`, `_sim_reset()`, `_sim_count()`, and `_sim_destroy()`.
Initialization creates and resets the model; destruction finalizes and frees it.
Initialize before any step/reset/read, and do not use an instance after destruction.
The browser reads `count` through `_sim_count()` directly from the circuit model.
JavaScript schedules clock steps and displays values; it does not implement the
counter. Each half-cycle advances the model's time by one tick.

[server.py](server.py) serves a fixed set of UI files and generated artifacts,
and adapts that build function to HTTP. Build failures return a non-2xx JSON
`{"error": "…"}` response with tool diagnostics (the final 16 KB). Successful
modules and their sibling Wasm files have unique URLs and the appropriate MIME
types. This HTTP response and the small simulation API are the integration
boundaries for replacing the backend later. The service never runs the simulator.

To build the same example independently of the web service:

```sh
python3 build.py examples/counter.v .build/counter
```

This produces `.build/counter/sim.mjs` and `.build/counter/sim.wasm` along with
intermediate sources and diagnostics. Load the module over HTTP rather than
opening it with `file://`.

## Supported input and limitations

- A single source file with top module **`counter`**, scalar inputs **`clk`** and
  **`reset`**, and unsigned 8-bit output **`count`**. Preserve this interface when
  editing. Missing ports produce C++ wrapper compilation errors. Reset is
  active high; the supplied design uses a rising-edge synchronous reset.
- Clock-driven, synthesizable Verilog supported by Verilator. This is not a full
  SystemVerilog environment. Timing controls/delays, multi-file projects, external
  includes, DPI, file I/O, and user C++ are unsupported. Verilator warnings fail
  the build; fix the reported issue instead of suppressing warnings globally.
- Edited circuits follow their own RTL semantics. The provided example defines
  the increment-by-one and reset-to-zero behavior; the wrapper does not impose it.
- Single-threaded simulation on the browser's main thread, with no waveforms or
  arbitrary signal explorer. Run speed follows browser timer scheduling and may
  slow in background tabs. A pathological model can hang a tab.
- At most 64 KiB of HDL, one compilation at a time, and a 120-second total build
  timeout. Compiled modules may grow Wasm memory to 64 MiB. Successful build
  directories remain until service shutdown; restart to reclaim disk space.

## Trust boundary

**This is a development-only build service for trusted local HDL.** Starting it
requires `--trusted-local`, and it binds exclusively to `127.0.0.1`. Host checks
reject DNS rebinding; compilation requires a same-origin JSON request from the
local UI. There is no CORS opt-in. Only the fixed UI files and named build
artifacts are served, not the repository or intermediate tool output.

These checks are not a compiler sandbox or authentication. Native toolchains
process your HDL with the permissions of the service account; HDL directives or
toolchain vulnerabilities can access local resources. Only compile designs you
trust, including when using `build.py` directly. Do not expose the service through
a proxy, tunnel, public port, or shared host. Other local processes are trusted.

Public or multi-user hosting requires a separate isolated build worker with no
secrets or host filesystem access, restricted networking, and enforced CPU,
memory, process, disk, and execution-time limits, plus authentication and request
controls. The MVP's size check, timeout, and serialized builds do not provide
that isolation. Do not accept untrusted HDL on this service.

## Validation

The local browser integration test compiles real HDL with the installed native tools
and loads the resulting Wasm in Chromium. It checks reset, individual cycles,
255 → 0 wraparound, Run/Pause, Reset during Run, and recompilation after errors.
It also compiles a counter that increments by three and checks 3 then 6, proving
the displayed result follows the submitted circuit. Python tests cover request
validation, build error reporting, artifact access, and local-origin checks.

With the runtime toolchain installed, use Node.js 22+ for the test dependencies:

```sh
npm ci
npx playwright install --with-deps chromium
npm test
```

The local browser test starts and stops its own trusted local service on port 8765.
The static tests build the demo, serve only `.build/pages/` on port 8766, and load
`/webrtl/` in Chromium. They check real Wasm bytes and output, wraparound,
Run/Pause/Step/Reset, reload, read-only demo mode, missing-asset errors, and that
requests stay under the project subpath without calling a build API. These checks
run before merge without a live Pages deployment. To run either mode separately:

```sh
npm run test:local
npm run test:demo
```

Python checks can also run alone without the compiler or Node:

```sh
python3 -m unittest discover -s tests -v
```

For a manual check, compile the unmodified example, Step to 1, Run then Pause,
verify the value stops changing, Reset to 0, and Step to 1 again. Edit the
increment to `8'd3`, compile, and verify each Step advances by three. Introduce
a syntax error and confirm the UI shows the tool diagnostic and disables simulation.
Testing additional desktop browsers and measuring speed are optional.

## Contributing

- [Development flow and English collaboration convention](docs/development-flow.md)
- [AI review and merge guidelines](docs/review-guidelines.md)
- [Issue template](.github/ISSUE_TEMPLATE/issue.md)
- [Pull request template](.github/pull_request_template.md)
- [AI agent entry point](AGENTS.md)
