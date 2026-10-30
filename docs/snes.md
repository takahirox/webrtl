# SNES integration attempt — Issue #22

The selectable **SNES · experimental base console RTL** example integrates real
CPU, PPU, APU, DMA/HDMA and controller hardware. Its source is compiled into a new
Wasm circuit in the browser. This is an integration attempt with explicit
validation limits, not a claim of complete SNES compatibility. The supported feature
matrix, validation evidence and limitations are recorded below.

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
| System I/O | Multiply/divide, H/V timers, NMI/IRQ flags, refresh, CPU speed control | ROM checks `$0011`, `$7E0011`, `$800011`, multiply `$12*3=$36`, divide `$1234/3=$0611` remainder 1, RDIO driven/released levels; NMI and horizontal IRQ service. Timing corner cases remain unverified. |
| Memory | 128 KiB WRAM, two 32 KiB VRAM lanes, 256×15-bit CGRAM, 512+32-byte OAM, 64 KiB ARAM | DMA tiles, palette/OAM writes, CPU CGRAM readback with PPU1/PPU2 latch isolation, CPU WRAM checks and reset replay. Power-up memory is deliberately zeroed. |
| Cartridge | Runtime-loaded LoROM/HiROM, mirroring via mask, up to 4 MiB ROM and 128 KiB SRAM | Both mappings boot the fixture; CPU checks cover unmapped reads, ROM aliases, and 2 KiB SRAM bank/size mirrors. Only power-of-two ROM sizes, optional 512-byte copier header, header types 0–2. SRAM persistence/export and exhaustive map boundaries remain unverified. |
| BG modes | Modes 0–7, planar 2/4/8bpp, affine Mode 7, BG layers/tilemaps/scroll/mosaic | Exact pixels in all eight modes, higher bitplanes, BG2/3/4, 16×16 quadrants and internal/map flips on all four size bits, 2/4/8bpp and high-resolution large-tile layouts, both high-resolution stripe phases and BG1/BG2 priorities, scroll/mosaic, offset-per-tile in modes 2/4/6, direct color in modes 3/4/7, and identity/doubled/constant/rotated/flipped Mode 7 with fractional scaling. Screen-over modes 2/3 and signed origin clipping have bounded fixtures. Exhaustive affine boundary cases remain unverified. |
| Objects | OAM/high OAM, sizes/flips, sprite fetch, priorities, sprite line buffer | Exact pixels for an original green 8×8 object at priority 0 and 3, BG occlusion, asymmetric horizontal/vertical flips, 16×16 left/right edge clipping and both interlaced fields with distinct source rows. Boundary fixtures additionally check 32/33-object range overflow, 34/35-tile time overflow with partial OBJ culling and CPU-visible STAT77 flags; small rectangular objects in size modes 6/7 are checked with interlace and vertical flip. Other sizes remain unverified. |
| PPU composition | Windows, main/subscreen, priority, color math, brightness/blanking | Exact pixels for all four two-window Boolean operators, BG1/BG2 priorities, Mode 1 BG3 priority promotion, pseudo-hires main/subscreen alternation in both screen assignments, Mode 7 EXTBG seven-bit color/transparency and priority against BG1 and all four OBJ priorities, subscreen addition, fixed-color addition/subtraction and halving, and all sixteen CGWSEL color-window clipping/math-gating combinations. Exhaustive layer/window combinations remain unverified. |
| Video timing | H/V counters, blanking, two long dots, NTSC short-line exception, overscan/interlace | 224/239/448-line captures and exact pixel positions tested; 357,368/357,364 master-clock noninterlaced field periods observed natively. No PAL board clock selector. |
| DMA/HDMA | Eight channels, transfer modes, CPU stalls, direct/indirect HDMA | All eight DMA B-bus transfer patterns, reverse VRAM-to-WRAM DMA with CPU readback, and indirect HDMA data and 127-line timing; direct HDMA retained. Multi-channel checks cover DMA priority, direct/indirect HDMA ordering and HDMA interrupting/resuming active DMA. Exhaustive channel interaction and interrupt-boundary timing remain unverified. |
| APU | SPC700, CPU ports, three timers, ARAM, eight-voice DSP, BRR/interpolation/envelopes/noise/echo | CPU uploads the driver, directory and BRR sample via standard IPL ports. All three timers, including target zero, must tick before video starts. AUX readback/reset, TEST P gating, RAM protection/disable with I/O access, internal/external wait selections with independent timers/DSP, DIV results/flags and read-only DSP mirrors are checked. Independently calculated PCM covers BRR filters/range handling/Gaussian wrap, gain, pitch, negative pitch modulation, eight-voice mixing, ADSR, gain attack, KOFF, mute, noise and delayed FIR echo; sample rate and reset digest checked. Bounded fixtures additionally check nonzero echo feedback and exact ADSR decay, sustain and release PCM. Other pitch modulation cases, arbitrary FIR/feedback configurations and exhaustive envelope rates remain unverified. |
| Controllers | Serial pad, CPU manual reads and system auto-joypad logic | Keyboard and standard gamepad B alter CPU-programmed palette during sound playback; a ROM variant reads automatic joypad results. A mixed twelve-button mask checks the complete 24-read serial sequence, signature and connection detection; second port is checked disconnected. |
| Runtime | Compile, ROM import, Run/Pause, bounded batches, power Reset, Canvas, Web Audio | Static browser integration and repeatable frame/PCM checks; not real-time playability. |

Optional cartridge enhancement chips (SA-1, Super FX, DSP-n, CX4, S-DD1, SPC7110,
OBC1, S-RTC, MSU1, etc.) are not imported. ExHiROM, special cartridge layouts,
multitaps, mouse/lightguns and battery-backed save management are unsupported.
These exclusions are separate from the unverified base-console boundary cases
and combinations above.

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
original MiSTer VHDL long-dot condition. RDIO reflects released/driven WRIO levels;
H-512 captures place subscreen/main samples in even/odd columns and test each
sample's own transparency bits for BG1/BG2 at both priorities. Mode 7 advances
its source coordinate after the synchronous VRAM sample, and color addition is
halved before saturation. Sprite fetching distinguishes wrapped negative X from
the visible right edge. Interlaced sprite range evaluation uses half height while
tile addressing retains the source-height mask. Small rectangular objects in
size modes 6/7 use the hardware's 16-row interlace source-height exception. Vertical flip includes the
interlace field bit and flips rectangular objects within each width-sized square.
CGRAM reads update PPU2 MDR;
OAM reads update only PPU1 MDR; WBGLOG (`$212a`) reads return that latch.
SLHV (`$2137`) captures counters only while WRIO bit 7 is high; the falling edge
of that pin still captures independently. Flipped Mode 7 coordinates are zero-extended before
signed matrix multiplication; negative DSP pitch modulators use an arithmetic
shift. DSP echo accesses
use one latched stereo address, BRR filters preserve signed rounding, out-of-range
BRR shifts follow the DSP rule, and Gaussian interpolation wraps the first three
terms before adding the fourth. BRR end events pass through the latch consumed
by ENDX, and the final echo FIR product wraps to signed 16 bits before saturation.
SMP timer comparisons wrap at eight bits so
target zero represents 256 ticks; AUX reads return the stored registers.
TEST writes require the SPC700 P flag to be clear, including absolute `$00f0`
writes. Bits 7:6 select waits for idle, I/O and enabled IPL accesses; bits 5:4
select waits for external ARAM accesses. The CPU advances once per 1/2/5/10
normal SMP slots, while timers advance nominal 1/2/4/8 increments for the completed
access. An idle flag accompanies the microcode, derived from its bus-access
annotations with the reference's dummy PC reads explicitly preserved. The two
slowest selections use the deterministic reference model; real silicon can stall
unpredictably in those modes. DSP timing stays independent, and waiting CPU
writes reach the DSP/ARAM interface only in the completing slot.
TEST bit 1 gates SMP ARAM writes and bit 2 disables SMP ARAM reads/writes;
disabled reads return `$5a` after I/O and IPL overlay selection. A separate
write strobe carries those permissions into the DSP's SMP memory slot, leaving
DSP register writes and its sample/echo memory slots independent. Permitted
SMP writes also update backing ARAM beneath `$00f0`–`$00ff`, while I/O reads
continue through the register mux. TEST protection suppresses those backing writes
without suppressing I/O side effects.
DSPADDR bit 7 gates register RAM writes and special write side effects while
preserving mirrored reads. SPC700 DIV retains its nine shift/subtract steps,
selecting the documented overflow arithmetic (including X=0) and deriving flags
from the original operands and corrected quotient.
Independent fixtures exposed these differences. These transformations are explicit in
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

The static test server uses a 128-connection backlog on loopback. Python 3.13's
five-connection default stalled parallel Chromium downloads of the 13-file CPU
examples before compilation. [serve_static.py](../tests/serve_static.py) retains
the same static directory and port, and the tests retain their original assertion
timeouts.

The integration test imports a browser-local file, checks exact stable Mode 0
pixels and DSP PCM, changes input with keyboard and gamepad adapters, checks Pause
and power Reset, then independently instantiates the newly compiled Wasm. It checks
reset-vector fetches, the ROM's self-test completion write, DMA bytes, HDMA writes,
NMI/IRQ vectors, PCM sample count/period/digest, exact reset replay and HiROM boot.
Additional original cartridges exercise every BG mode with exact pixel positions,
higher bitplanes and BG layers/priority/composition, DMA modes and reverse/indirect
transfers, and independently calculated DSP waveforms. A negative control must
reject Mode 0 output against the Mode 5 expectation. The complete fixture inputs,
expected outcomes and independent references are in [snes-fixtures.md](snes-fixtures.md).
The test saves per-browser compile/Wasm/CXXRTL size and runtime measurements as a
Playwright attachment. Asset tests reproduce the original ROM and replacement IPL.

Initial implementation results, before the review fixes, on macOS arm64 / Apple M4 Max are saved in
[snes-validation.json](snes-validation.json): 10 Python tests and all 44 static
browser tests passed. The initial expanded SNES suite passed all four tests across
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

The review-fix run on 2026-10-29 passed all 10 Python tests, 42 browser regression
checks and four SNES browser checks. Each browser ran 76 cartridge variants:
75 exact pixel expectations, one Mode 5 substitution negative control (57,344
rejected pixels), and 256 independently calculated PCM samples per variant.
The full suite also checked input, HiROM, interrupt vectors, DMA/HDMA and exact
reset replay. Chromium and Firefox produced identical frame and PCM digests.
The final run used two Playwright workers and port 18768 for isolation; its actual
measurements are recorded under `reviewFixValidation` in
[snes-validation.json](snes-validation.json). The updated circuit is 268,174 Wasm
bytes with 1,607,174 CXXRTL bytes. The measurement window is 1,671,168 master
clocks; the extended interlace fixture waits for a complete initialized field pair.

The subsequent arithmetic revision passed 10 Python tests and all four SNES
browser tests with 84 cartridge variants per browser. Seven new Mode 7
flip/scaling cases matched every pixel, and the negative-modulator fixture
matched all 256 independently calculated PCM samples. The pre-fix RTL was
separately rejected by both fractional flip cases and the negative-modulator PCM
comparison. The corrected Wasm is 268,139 bytes; hashes and scoped results are
recorded under `arithmeticReviewFixValidation` in the validation JSON above.

The transparency/cartridge revision passed 10 Python tests and all 44 static
browser tests on 2026-10-30. Each browser ran 100 cartridge variants, including
12 high-resolution stripe fixtures covering both priorities for BG1 in Modes 5/6
and BG2 in Mode 5, and four CPU bus fixtures covering LoROM/HiROM with and without
SRAM. All new fixtures matched their pixel and PCM expectations; CPU stores
matched the expected unmapped reads, ROM aliases and SRAM mirrors. The pre-fix
RTL failed all six reversed-stripe cases (57,344 pixels each) and all four bus
cases. Both browsers generated identical 268,287-byte Wasm. Results and source
hashes are recorded under `transparencyAndBusReviewFixValidation` above.

The APU revision passed 10 Python tests and all 44 static browser checks. Each
browser ran 115 cartridge variants, including 15 new APU fixtures with matching
pixels and PCM. Native MulDiv validation also checked all 16,777,216 YA/X inputs
and N/V/H/Z flags. The corrected Wasm is 268,719 bytes; pinned-input regeneration
is byte-identical. Results, source hashes, measurements and a separate exploratory
ENDX loop-end observation are recorded under `apuReviewFixValidation` above.

The sprite-flip/sweep revision passed 10 Python checks and all 123 cartridges in
both Chromium and Firefox, including both interlace fields and the rectangular
flip/control pair. All 120 original cartridges remain byte-identical. Splitting
the sweep into seven batches per browser preserves every fixture and the AUX
reset comparison; the longest local batch took 334 seconds against its
1,800-second deadline. All 14 compilations produced identical 268,568-byte Wasm.
The complete static attempt passed 50 checks and hit six Chromium backdrop/BG1
source-loading timeouts; those six passed unchanged in an isolated one-worker
rerun. The trusted-local suite and direct native compile reproduced the linker
failure below. Results, batch timings and source hashes are recorded under
`spriteFlipAndSweepReviewFixValidation` above. Ubuntu CI was not rerun here.

Earlier trusted-local runs failed with Verilator 5.052 and Emscripten 6.0.13:
`pthread_getaffinity_np`, `sched_getcpu` and `pthread_setaffinity_np` did not link,
as recorded in the [setup guide](../README.md#local-setup). The base-feature
review revision passed the complete trusted-local Chromium test in 15.1 seconds using the
reference Verilator 5.020 version, built unmodified on this macOS arm64 host,
with Emscripten 6.0.13. Its scoped PATH and VERILATOR_ROOT selected that build;
port 18765 avoided the existing service on 8765. This supersedes the earlier
native failure; no Ubuntu or GitHub CI result is inferred.

The base-feature review revision passed all 10 Python checks and all 58 browser
checks across the complete sweep and two corrected-assertion rechecks. The sweep
initially passed 56 checks; both echo batches failed because a newly enlarged
capture buffer was incorrectly required to contain 2,048 post-onset samples,
although its delay oracle needs only 768. Both complete 20-ROM batches passed
with the corrected minimum. Six final focused cases also passed in both browsers,
including distinct pixels for tile-35 culling and nonempty ADSR transition captures.
Each browser exercised 156 cartridges: 155 exact frame expectations and the retained
negative control. All 123 prior cartridges remain byte-identical, and pinned-input
regeneration reproduces the corrected core. Source hashes, the initial sweep and
successful rechecks, fixture counts/flags/digests, and revised measurement ranges
are recorded under `baseFeatureReviewFixValidation` in
[snes-validation.json](snes-validation.json).

| Browser | Compile range | Wasm bytes | Master clocks/s | Captured frames/s | Real-time ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 67.33–73.90 s | 268,665 | 261,198–265,568 | 0.625–0.636 | 0.01216–0.01237× |
| Firefox | 67.91–76.61 s | 268,665 | 210,926–219,400 | 0.505–0.525 | 0.00982–0.01022× |

These ranges cover the eight standard cartridge batches per browser, including
startup. All compilations produced 1,618,010 CXXRTL bytes; observed model linear
memory remained 20,578,304 bytes. Compiler peak memory was not measured.

The SLHV/WBGLOG correction on 2026-10-30 passed all 10 Python checks and both
focused SNES browser tests (Chromium/Firefox). Each browser compiled the corrected
RTL and ran the two new cartridges plus the original CGRAM control, with exact
frame/PCM checks and baseline input, LoROM/HiROM and deterministic reset checks.
The new cartridges first reproduced both defects against the previous RTL.
All 156 existing cartridge variants remain byte-identical; the full sweep and
the unrelated static browser regressions were not repeated for this correction.
Pinned-input regeneration reproduces the corrected core exactly.

The TEST memory-control correction passed all 10 Python checks, the static build,
and 48 unique static browser checks. Each browser ran all 42 APU/audio cartridges,
including six new RAM permission/disable cases, with exact frame and PCM checks.
The new cases first rejected the previous RTL's protected writes, disabled reads
and disabled writes; their enabled-write and I/O controls passed. All 158 prior
cartridges remain byte-identical, and pinned-input regeneration reproduces the
corrected core. Six alternate-port origin assertion failures passed unchanged
on the required port 8766. Source hashes, per-browser results and measurements
for the identical 269,147-byte Wasm builds are recorded under
`testMemoryControlsReviewFixValidation` in the validation JSON above. The full
164-cartridge sweep was not rerun. Trusted-local validation failed with the
installed Verilator 5.052 / Emscripten 6.0.13 linker incompatibility; this run
does not infer a result from the earlier Verilator 5.020 validation.

The final implementation review ran the unfiltered 60-check static suite in
Chromium and Firefox. It passed 59 checks; Firefox's first SNES batch exceeded
the existing five-second ROM-loaded status wait before its fixture loop. That
unchanged 20-cartridge batch passed in an isolated recheck, completing all 60
unique checks. Each browser exercised all 164 cartridges, including 163 exact
positive frames, the retained negative control, and 256 independently checked
PCM samples per cartridge. All original fixtures and assertions remain unchanged.
The 18 passing SNES batches produced identical 269,147-byte Wasm artifacts.

The same revision passed the direct native counter build and `npm run test:local`
using unmodified reference Verilator 5.020 and Emscripten 6.0.13. The browser
regression took 23.6 seconds. Its isolated service used port 18765 because 8765
was occupied, with the original test and assertions unchanged. Source selection,
build prerequisites, full-run and recheck results, current performance ranges,
and source/artifact hashes are recorded under `finalImplementationValidation`
in [snes-validation.json](snes-validation.json) for that revision.

The opt-in Slang source limit is 2 MiB and its compile timeout 300 seconds; legacy
projects retain 128 KiB and 120 seconds. Each simulation/ROM-write request retains
the 10-second watchdog. A larger cartridge takes more loading requests and more
wall time, without increasing any single request's bound.

The TEST P-flag/access-timing correction passed all 10 Python checks, Verilator
lint (no errors; existing DSP/DIV width warnings), and 48 browser checks: 40
application regressions plus eight SNES/Slang checks. Each browser exercised
54 APU/audio fixtures, including all 42 retained cases and 12 new P-flag/clock
cases. CPU-observed timing matched the independent reference within 84 master
clocks, and timer counts, exact frames/PCM and independent DSP sample counts
passed. Fresh browser compilation of the reviewed head reproduced both defects
before correction. All 164 retained cartridges remain byte-identical, and pinned
adaptation reproduces the corrected core. The unrelated UI/UX policy and review
requirement were restored exactly from the default branch's policy commit.

The six corrected browser builds produced identical 270,483-byte Wasm artifacts
(1,336 bytes larger than the reviewed head) and 1,630,315 CXXRTL bytes. Chromium
compiled in 69.01–88.16 seconds and simulated 257,773–260,526 master clocks/s;
Firefox compiled in 70.68–92.67 seconds and simulated 208,038–213,431 clocks/s.
Captured video throughput was 0.617–0.624 frames/s in Chromium and 0.498–0.511
frames/s in Firefox; master-clock real-time ratios were 0.01200–0.01213× and
0.00969–0.00994× respectively.
Model linear memory remained 20,578,304 bytes. These measurements include
contention from two concurrent browser workers; compiler peak memory was not
measured. Results, fixture/source hashes and timing observations are recorded
under `smpTestAccessReviewFixValidation` in the validation JSON. At that revision, the full
176-fixture sweep and trusted-local suite had not been rerun.

The ARAM/I/O review correction passed all 10 Python checks, the static build,
RTL lint (no errors; existing width warnings), and the complete unfiltered
60-check static suite on 2026-10-30. No rechecks, fixture filters, assertion
changes or timeout changes were needed. Each browser ran all 179 cartridges:
176 retained cartridges remain byte-identical, and three new cases check a
DSP directory beneath SMP I/O, TEST-protected backing writes with AUX side
effects, and an ordinary-ARAM control. Both new I/O-directory cases reject the
reviewed Wasm's PCM; the ordinary-ARAM control passes. The corrected circuit
matches all 256 independently calculated PCM samples per cartridge, all 178
positive frame expectations, and the retained negative control's 57,344 rejected
pixels. Frame and PCM digests agree across Chromium and Firefox.

The full run took 54.4 minutes. All 18 SNES browser compilations produced the same
270,506-byte Wasm and 1,630,383-byte CXXRTL source. Results, source/cartridge hashes,
per-batch measurements and the regression's negative controls are recorded under
`aramIoReviewFixValidation` in [snes-validation.json](snes-validation.json), the
validation entry for that revision. This supersedes the earlier outstanding full-sweep and
trusted-local checks.

| Browser | Compile range | Master clocks/s | Captured frames/s | Real-time ratio |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 66.10–84.31 s | 236,007–263,496 | 0.565–0.631 | 0.01099–0.01227× |
| Firefox | 70.45–93.04 s | 208,687–217,063 | 0.500–0.520 | 0.00972–0.01011× |

Observed model linear memory remains 20,578,304 bytes; compiler peak memory was
not measured. The same corrected source passed the direct native counter build
and the unchanged trusted-local browser regression in 16.6 seconds using
unmodified reference Verilator 5.020 (commit
`5c5314b39cd888f427807d626e1502cbf222c292`) and Emscripten 6.0.13. The tools were
built locally with GNU M4 1.4.19, Autoconf 2.72 and GNU Flex 2.6.4 plus its matching
headers, and selected through scoped PATH/VERILATOR_ROOT settings. The isolated
service used port 18765 with the original test/assertions unchanged.

The corrected source therefore passes the locally executable pre-merge paths
listed in Issue #22, including client compilation/local ROM loading, integrated
hardware, independent frame/audio expectations, input and deterministic reset,
regressions, provenance and performance reporting. Coverage remains bounded as
specified in the feature matrix; exhaustive compatibility and real-time
playability are not established. No Issue state is changed here. The separate
required live-site verification remains pending after publication.

## Large tiles, pseudo-hires and EXTBG review validation

The PPU coverage revision adds twenty original cartridges: nine large-tile cases
cover all four BGMODE size bits, quadrant selection, flips, both map priorities,
2/4/8bpp and high-resolution layouts; two pseudo-hires cases distinguish both
main/subscreen assignments; nine Mode 7 cases check EXTBG enable, seven-bit
color/transparency, BG1 and all four OBJ priorities. Their independent exact-pixel
specifications and references are in [snes-fixtures.md](snes-fixtures.md).

All twenty pass in both Chromium and Firefox, with zero mismatches across
2,293,760 compared pixels per browser and matching frame/PCM digests. Each batch
also passes the retained keyboard/gamepad, audio, LoROM/HiROM, DMA/HDMA, interrupt
and deterministic-reset checks. Ten Python checks and the static build pass.
No RTL defects were exposed: both browsers generate the same previously validated
270,506-byte Wasm. Compilation took 68.08 s in Chromium and 71.91 s in Firefox;
model memory remains 20,578,304 bytes. Compiler peak memory was not measured.

The 179 retained cartridges remain byte-identical. Of fifty previously recorded
source/tool inputs, only the ROM generator and SNES test changed. This focused
run does not repeat the full sweep or unrelated application/native regressions;
the earlier results above remain separate. Actual results, source/cartridge
hashes, measurements and reproduction details are recorded under
`ppuPathReviewFixValidation` in [snes-validation.json](snes-validation.json), now
the latest validation entry. The default suite contains 199 cartridges in ten
batches per browser.

## Validation limits and publication

The integrated hardware and executable fixtures now cover the mandatory paths
identified in review, including Mode 7 clipping/screen-over, color-window gating,
OBJ limits/interlace, DMA/HDMA arbitration and DSP feedback/envelope transitions.
These are bounded checks rather than exhaustive conformance tests: the matrix
retains specific unverified corners, combinations and DSP configurations.
Real-time audio/video playability is not established by the measured runtime.
Upstream compatibility claims are not substituted for locally verified results.

**Post-merge live-site verification remains pending.** After publication, run the
SNES integration test with `WEBRTL_PUBLIC_URL=https://takahirox.github.io/webrtl/`
to verify live source loading, client compilation, local ROM import, frame/audio,
controller effects and reset. Record those actual results separately. Local tests
do not establish publication success; this node does not push, publish or merge.
