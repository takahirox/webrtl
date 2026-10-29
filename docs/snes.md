# SNES integration attempt — Issue #22

The selectable **SNES · experimental base console RTL** example integrates real
CPU, PPU, APU, DMA/HDMA and controller hardware. Its source is compiled into a new
Wasm circuit in the browser. This is an integration attempt with explicit
validation limits, not a claim of complete SNES compatibility. **Keep #22 open
until its remaining acceptance gaps below are resolved.**

## Run locally

Follow the [static site setup](../README.md#build-and-preview-the-static-site),
load SNES and Compile. The example selects Slang and the SNES output interface.
Compile first, then import a local redistributable `.sfc`/`.smc` cartridge or click
**Load original test cartridge**. Click Run. Startup includes a real SPC700
program upload and several blank/partially initialized frames before the red/blue
pattern appears. The test produces a looping BRR tone through the DSP.

Focus the canvas and hold Z (controller B) to replace the red pixels with green.
Keyboard mappings are shown next to the cartridge loader. Standard gamepads are
polled before each batch. Inputs drive an RTL parallel-to-serial controller; the
CPU reads the real controller port. Pause preserves the model and clears queued
audio. Reset performs a **power cycle**, retaining the selected ROM in browser
memory and reloading it through the RTL cartridge write port. It clears WRAM,
VRAM, ARAM and SRAM; it is not a battery-preserving console reset button.

Only static GETs download code/tooling and the optional test ROM. Local cartridge
bytes are read with `File.arrayBuffer()`, sent to the runtime worker and clocked
into the RTL ROM array. They are never sent to a server or compiled into HDL.
ROMs and sources are lost on page reload. No commercial cartridge or proprietary
boot ROM is shipped.

## Architecture and actual interfaces

```text
snes.v + snes-core.v
  -> YoWASP Yosys read_slang -j 1 -> CXXRTL -> YoWASP Clang -O2 -> new Wasm
  -> simulator worker -> C++ clock/pin adapter
       -> snes board -> SNES -> SCPU/P65C816 + SPPU + SMP/SPC700 + DSP
       -> RTL WRAM/VRAM/ARAM/SRAM + cartridge + serial controller
       <- PPU RGB and DSP PCM -> Canvas and Web Audio
```

Slang is already included in the pinned Yosys package. It supports the upstream
packages, packed structures and constant array tables without translating their
algorithms to JavaScript. `-j 1` is necessary because parser thread creation is
unavailable in the Wasm tool. The legacy Verilog frontend and examples remain
selectable. Slang does not preserve signedness in RTLIL port metadata; its
interface check validates directions/widths, and the audio ABI interprets the
16 PCM bits as two's-complement. The legacy frontend retains signedness checks.

The SNES board extends the [existing contracts](output-interfaces.md):

| Pins | Contract |
| --- | --- |
| `clk`, `reset` | Master clock, active-high reset trigger; `ready` follows the 131,072-clock RAM scrub |
| `cart_write`, `cart_address[21:0]`, `cart_data[7:0]` | One byte is written into RTL ROM on a rising edge; independent of console address reads |
| `cart_hirom`, `cart_mask[21:0]`, `cart_ram_size[3:0]` | Mapping, power-of-two ROM size minus one, SRAM header exponent (0 means absent) |
| `buttons[11:0]` | Pressed bits B,Y,Select,Start,Up,Down,Left,Right,A,X,L,R, from bit 11 down to 0 |
| `video_valid`, `video_x[8:0]`, `video_y[8:0]`, `video_rgb[23:0]` | PPU samples in a fixed 512-column raster; low-resolution pixels occupy two samples |
| `video_last`, `video_height[8:0]` | Frame completion independent of pixel validity; height 224/239 or 448/478 with interlace |
| `audio_valid`, `audio_sample[15:0]` | DSP-ready rising pulse and signed mono downmix of its stereo outputs, nominal 32,000 samples/s |
| `trace_address[23:0]`, `trace_data[7:0]`, `trace_flags[3:0]` | Board bus diagnostic: bit 3 valid, bit 0 write. PPU writes use `$002100+PA`; other addresses use the external cartridge/WRAM bus. Read data is cartridge data, not a complete internal-register trace. |

Capture buffers are bounded to 512×480 RGBA, 16,384 audio samples and 4,096 trace
entries per request. Batches contain at most 16,384 master clocks. Interlace
collects both fields before publishing a frame. Pixel coordinates and frame
height are checked before accessing buffers. The adapter clocks pins and copies
outputs; it implements no CPU, PPU, DSP, DMA, cartridge mapper or serial protocol.
Keyboard/gamepad sampling, file parsing and Web Audio scheduling remain host I/O.

Master time is 21,477,270 clocks/s, with an RTL clock-enable accumulator producing
4.096 MHz DSP enables. The CPU and APU run together in every batch. The audio
queue paces batches if simulation is fast enough; slow simulation produces short
audio bursts separated by silence rather than synthesizing replacement sound or
speeding the APU independently. The timing readout reports throughput, captured
frames/s and ratio to master-clock real time; these are active batch measurements,
excluding pauses, compilation, ROM loading and browser scheduling gaps.

## Base-console feature matrix

“Integrated” means the RTL block is present and connected, not that every behavior
has been independently validated. The integration suite runs the normal cartridge
and CPU paths; it does not replace devices with host implementations.

| Area | Integrated hardware | Automated coverage / limits |
| --- | --- | --- |
| CPU | P65C816 with 5A22 system timing, 24-bit bus, WRAM mirrors, reset/vector fetches | Original native-mode program, long reads, branches, stack/interrupts; existing CPU instruction examples retained. No exhaustive 65C816 instruction conformance suite. |
| System I/O | Multiply/divide, H/V timers, NMI/IRQ flags, refresh, CPU speed control | ROM checks `$0011`, `$7E0011`, `$800011`, multiply `$12*3=$36`, divide `$1234/3=$0611` remainder 1; NMI and horizontal IRQ service. Timing corner cases remain unverified. |
| Memory | 128 KiB WRAM, two 32 KiB VRAM lanes, 256×15-bit CGRAM, 512+32-byte OAM, 64 KiB ARAM | DMA tiles, palette/OAM writes, CPU WRAM checks and reset replay. Power-up memory is deliberately zeroed. |
| Cartridge | Runtime-loaded LoROM/HiROM, mirroring via mask, up to 4 MiB ROM and 128 KiB SRAM | Both mappings boot the fixture. Only power-of-two ROM sizes, optional 512-byte copier header, header types 0–2. SRAM persistence/export and exhaustive map boundaries remain unverified. |
| BG modes | Modes 0–7, planar 2/4/8bpp, affine Mode 7, BG layers/tilemaps/scroll/mosaic | Exact Mode 0 checker pixels; color populations for all eight modes and identity/doubled/constant-coordinate Mode 7 transforms. Other layers, offset-per-tile, affine clipping/rotation, direct color and mosaic need independent fixtures. |
| Objects | OAM/high OAM, sizes/flips, sprite fetch, priorities, sprite line buffer | Original green 8×8 object at priority 0 and 3; independent expected populations verify occlusion by BG1. Sprite limits, wrapping/flips and all sizes remain unverified. |
| PPU composition | Windows, main/subscreen, priority, color math, brightness/blanking | Single BG1 window and fixed-green addition fixtures. Comprehensive window logic, subscreen and color-math reference comparisons remain outstanding. |
| Video timing | H/V counters, blanking, two long dots, NTSC short-line exception, overscan/interlace | 224/239/448-line captures and color populations tested; 357,368/357,364 master-clock noninterlaced field periods observed natively. No PAL board clock selector. |
| DMA/HDMA | Eight channels, transfer modes, CPU stalls, direct/indirect HDMA | Alternating `$2118/$2119` DMA bytes and channel 1 HDMA writes to CGADD. Other transfer modes, reverse DMA and indirect HDMA need reference tests. |
| APU | SPC700, CPU ports, three timers, ARAM, eight-voice DSP, BRR/interpolation/envelopes/noise/echo | CPU uploads the driver, directory and BRR sample via standard IPL ports. Timer 0 must tick before video starts. Nonzero bipolar PCM, sample rate, the expected 16-sample period (2 kHz tone) and reset digest checked. Multi-voice, echo/noise/envelopes and timers 1/2 need conformance fixtures. |
| Controllers | Serial pad, CPU manual reads and system auto-joypad logic | Keyboard and standard gamepad B alter CPU-programmed palette during sound playback; a ROM variant reads automatic joypad results. One connected pad; second port disconnected. Simultaneous buttons need fixtures. |
| Runtime | Compile, ROM import, Run/Pause, bounded batches, power Reset, Canvas, Web Audio | Static browser integration and repeatable frame/PCM checks; not real-time playability. |

Optional cartridge enhancement chips (SA-1, Super FX, DSP-n, CX4, S-DD1, SPC7110,
OBC1, S-RTC, MSU1, etc.) are not imported. ExHiROM, special cartridge layouts,
multitaps, mouse/lightguns and battery-backed save management are unsupported.
These are separate from the unverified essential base-console behaviors above.

## Provenance and reproducible adaptations

Evaluated [SNES_MiSTer](https://github.com/MiSTer-devel/SNES_MiSTer/tree/bdcd33c5cab652109eeb7c695910b77b6f21df2f)
and [SNESTang](https://github.com/nand2mario/snestang/tree/5f0ef193145f67bded7f73f2c477ac8da4d85f7e).
MiSTer has the required blocks but predominantly VHDL, which this browser frontend
does not accept. SNESTang supplies a Verilog conversion of srg320/gyurco's SNES
hardware under GPL version 3, avoiding a new VHDL compiler in the static toolchain.
Its FPGA/SDRAM/HDMI/softcore and cartridge enhancements are excluded. Its P65C816
is kept with its matching SCPU interface; the existing adapted CPU examples are
unchanged. The exact source closure and hashes are in
[upstream.json](../examples/snes/upstream.json).

The upstream SMP embeds the console manufacturer's IPL. It is replaced with
StackBlender's [independently authored GPL replacement](https://github.com/StackBlender/snes-spc700-boot-rom/tree/6f3f92686b6477654fdc76289516281e91e8d509).
Its complete assembly generator, binary, listing, README and license ship in
[boot/](../examples/snes/boot/). The reset address and standard upload protocol are
preserved; software that reads original IPL bytes or enters its interior addresses
is not supported. No original manufacturer's IPL bytes are emitted by adaptation.

With checkouts at the revisions above:

```sh
python3 scripts/adapt_snes.py /path/to/snestang /path/to/snes-spc700-boot-rom
python3 scripts/generate-snes-rom.py
```

The adapter verifies every input SHA-256 before writing. It concatenates the source
closure in package order, inlines headers, selects inferred memories through the
upstream `VERILATOR` branch and removes diagnostic `$fdisplay` calls. Pure helper
functions become `automatic` to avoid Slang synthesizing shared static argument
registers. The CPU microcode's `STATE2` temporary becomes an expression, preserving
its subtract-one indexing without an incomplete asynchronous-reset temporary.
Missing HIGH_RES wiring is connected; unused debug outputs and TURBO are tied off.
The DSP clock rate is corrected from the HDMI-adjusted rate to 32 kHz PCM. The
impossible `H_CNT==323 && H_CNT==327` condition is corrected to `||`, matching the
original MiSTer VHDL long-dot condition. These transformations are explicit in
[adapt_snes.py](../scripts/adapt_snes.py); the original inputs remain unchanged.

The new board and cartridge generator are GPL-3.0-or-later; imported console code
is distributed under its upstream GPL version 3 license. License texts, notices,
corresponding source, the adaptation script and original cartridge source remain
available from this repository. The static artifact includes the core source and
licenses rather than only a compiled circuit.

## Validation and measurements

```sh
python3 -m unittest discover -s tests -v
npm run build:demo
npx playwright test --config=playwright.static.config.js
```

The integration test imports a browser-local file, checks exact stable Mode 0
pixels and DSP PCM, changes input with keyboard and gamepad adapters, checks Pause
and power Reset, then independently instantiates the newly compiled Wasm. It checks
reset-vector fetches, the ROM's self-test completion write, DMA bytes, HDMA writes,
NMI/IRQ vectors, PCM sample count/period/digest, exact reset replay and HiROM boot.
Seventeen cartridges additionally exercise eight BG modes, two object-priority
cases, overscan, interlace, a BG1 window, fixed-color math, two Mode 7 transforms
and auto-joypad input.
Mode/priority checks use expected color populations, not reference-image playback.
The test saves per-browser compile/Wasm/CXXRTL size and runtime measurements as a
Playwright attachment. Asset tests reproduce the original ROM and replacement IPL.

The 2026-10-29 macOS arm64 / Apple M4 Max results are saved in
[snes-validation.json](snes-validation.json): 10 Python tests and all 44 static
browser tests passed. The final expanded SNES suite passed all four tests across
Chromium and Firefox, including the 17 fixture variants per browser. Both browsers
produced identical frame and PCM digests, including exact power-reset replay.

| Browser | Compile | Wasm bytes | CXXRTL bytes | Master clocks/s | Captured frames/s | Real-time ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium | 68.44 s | 268,010 | 1,604,670 | 273,000 | 0.610 | 0.01271× |
| Firefox | 72.96 s | 268,010 | 1,604,670 | 218,347 | 0.488 | 0.01017× |

The runtime window contains 1,343,488 master clocks and includes startup, so its
captured-frame rate is lower than steady-state throughput. Compiler peak memory
was not measured. An earlier Node-hosted run of the Wasm compilers took 148.5 s.
ROM storage uses CXXRTL value objects, not a tightly packed 4 MiB byte
buffer; model memory also includes state and double-buffered 512×480 RGBA output.
The circuit has a 64 MiB Wasm memory ceiling. Power reset briefly allocates a new
instance while the old one awaits garbage collection. Several GiB of available
browser memory are advisable for compilation. A compiled instance's observed
linear memory is 20,578,304 bytes (19.625 MiB).

The trusted-local counter test could not pass with this host's native tools:
Verilator 5.052 and Emscripten 6.0.13 fail to link `pthread_getaffinity_np`,
`sched_getcpu` and `pthread_setaffinity_np`, the incompatibility already recorded
in the [setup guide](../README.md#local-setup). The initial default-port attempt
encountered an existing service on 8765; the independent retry used 18765. Native
`build.py` reproduced the link error without browser involvement. This check
remains failed here; the supported Ubuntu toolchain/CI result is not inferred.

The opt-in Slang source limit is 2 MiB and its compile timeout 300 seconds; legacy
projects retain 128 KiB and 120 seconds. Each simulation/ROM-write request retains
the 10-second watchdog. A larger cartridge takes more loading requests and more
wall time, without increasing any single request's bound.

## Remaining acceptance gaps and publication

The full hardware source is present, and the end-to-end fixture is executable;
the feature matrix explicitly identifies the missing independent coverage. In
particular, complete window/color-math logic, all PPU layers, affine/offset corner
cases, all DMA/HDMA forms and DSP behaviors do not yet have the
reference fixtures needed to claim complete base-console validation. Real-time
audio/video playability is also not achieved by the measured runtime. Do not turn
upstream compatibility claims into locally verified results or close #22 based
only on the checkerboard/one-voice fixture.

**Post-merge live-site verification remains pending.** After publication, run the
SNES integration test with `WEBRTL_PUBLIC_URL=https://takahirox.github.io/webrtl/`
to verify live source loading, client compilation, local ROM import, frame/audio,
controller effects and reset. Record those actual results separately. Local tests
do not establish publication success; this node does not push, publish or merge.
