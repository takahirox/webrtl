# 65C816 CPU to PPU backdrop

Load **65C816 CPU → PPU backdrop · 64 × 48**, then **Compile** and **Run**.
The real P65C816 executes an original program, writes PPU registers, and produces
a red Canvas frame. Select `backdrop-rom.v`, change the color bytes at `$800C`
and `$8011` from `1F / 00` to `E0 / 03`, and compile/run again: the frame becomes
green. No JavaScript CPU, palette script, prerecorded image, native compiler or
compilation server participates. The browser compiles all thirteen sources into
new Wasm using the existing static Yosys/CXXRTL/Clang toolchain under `/webrtl/`.

## Sources and redistribution

The nine CPU sources are reused directly from [cpu816](../examples/cpu816/),
without copies or further changes. The integration, pinned upstream revision
`9adbba8622f378253765b7d438b6cbcc4d03fc57`, original authors (srg320 and
Alan Steremberg), and reproducible Yosys compatibility adaptations remain in
[the CPU guide](cpu816.md#core-license-and-hdl-adaptations) and
[upstream notices](../examples/cpu816/UPSTREAM.md).

Four new, original synthesizable sources live in
[examples/cpu816-backdrop](../examples/cpu816-backdrop/):

| File | Role |
| --- | --- |
| `cpu816-backdrop.v` | Top `cpu816_backdrop`: CPU, qualified ROM bus and PPU/scanout wiring |
| `backdrop-rom.v` | Original inline program and reset vector |
| `backdrop-ppu.v` | Three write-only registers and RGB conversion |
| `backdrop-scanout.v` | Deterministic frame snapshot and 64 × 48 raster |

All four new RTL sources, including the ROM program, are freely redistributable
under **GPL-3.0-or-later**, consistent with the inherited CPU license. Preserve
the CPU copyright/provenance notices and provide corresponding source under the
GPL when distributing the combined design or generated simulator. The full
[license](../examples/cpu816/LICENSE) and all example sources ship in the static
artifact. No commercial game, firmware, SDK code or external binary ROM is used.

## Bus and reset

CPU, PPU and scanout share one rising-edge `clk`. CPU `CE` and `RDY_IN` are
always high; IRQ/NMI/ABORT inputs are inactive. A bus cycle is valid when
`VPA || VDA`, and a write is `valid && !WE` (upstream `WE` is active low).
Each PPU transaction consumes the address and byte present **before that edge**,
just like the #16 harness. Full 24-bit comparisons decode only bank `$00`.
Other banks, including the real SNES's register mirrors, are not mapped.

| Address | Reads | Writes |
| --- | --- | --- |
| `$00:8000–FFFF` | Asynchronous inline ROM, qualified by valid read | Ignored |
| `$00:2100`, `$00:2121`, `$00:2122` | `FF` (readback unsupported) | PPU subset below |
| Everything else | `FF` | Ignored |

There is no RAM or mailbox: this ROM uses no stack, subroutine or RAM access.
Reset's inherited dummy stack writes are ignored. Reset vector reads occur at
clocks 6/7, fetching `00 / 80`; the first instruction is fetched at clock 8.
The program ends in STP; the CPU's own stop logic halts instruction execution,
while scanout continues. Unlike the standalone CPU self-test, this board has no
PASS/FAIL register or CPU execution watchdog. Arbitrary edited programs may loop;
Pause and Reset remain available at bounded worker-request boundaries.

Active-high board `reset` synchronously initializes PPU and scanout and drives
the CPU's asynchronous active-low `RST_N`. The adapter clocks one reset cycle,
discards its output, then deasserts reset. CPU reset starts in emulation mode
with 8-bit accumulator/index registers. PPU resets to INIDISP=`80`, CGADD=`00`,
empty low/high latch, and backdrop=`0000`. Scan coordinates, frame color and
video outputs reset to zero, with valid/last low. Reset also clears both adapter
frame buffers, Canvas and simulated time. Step advances one clock; Run batches
3072 clocks; Pause preserves state. Editing/recompilation discards the previous
model and frames. These are the existing [Video lifecycle rules](output-interfaces.md#playback-controls-permissions-and-lifecycle).

## Register subset and color conversion

The register identities, forced-blank bit, brightness range, CGRAM word addressing
and low/high 15-bit color format follow the
[SNES Development Manual, Book I](https://floating.muncher.se/bot/manual/book1_text.pdf),
sections 2-27-1, 2-27-11 and A-17. The pair-latch behavior can also be compared with the original
[bsnes PPU register implementation](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/ppu/io.cpp)
(`CGADD`/`CGDATA` cases).
This model deliberately implements only the following subset:

| Register | Implemented write behavior |
| --- | --- |
| `$2100` INIDISP | Store bit 7 (forced blank) and bits 3:0 (brightness); ignore bits 6:4. Forced blank produces black, retaining CGRAM and latch state. |
| `$2121` CGADD | Set 8-bit **word** address; restart the next CGDATA write as the low byte, discarding any incomplete pair. This model also clears its low-byte latch for deterministic diagnostics. |
| `$2122` CGDATA | First write latches the low byte without changing the palette/address. Second write combines `high[6:0]` with that low byte, discards high bit 7, commits only if CGADD=0, advances CGADD modulo 256 and returns to low-byte phase. |

Only **CGRAM word 0** is stored. Pairs for words 1–255 are discarded but retain
the same latch and address-advance behavior, so they cannot overwrite the
backdrop. CGADD can wrap from 255 to 0. Unrelated writes do not disturb an
incomplete pair. Reset takes precedence over writes. The PPU accepts writes at
any clock, without the hardware's active-display CGRAM access restrictions.
There are no register reads, open-bus emulation or CGDATA read latch.

The stored 15-bit word is BGR555 (`0BBBBBGGGGGRRRRR`), with red in bits 4:0,
green in 9:5 and blue in 14:10. For each five-bit channel `c`, conversion is:

```text
expanded = (c << 3) | (c >> 2)         // bit replication, 0..255
channel8 = floor(expanded * brightness / 15)
RGB888   = (red8 << 16) | (green8 << 8) | blue8
```

Brightness 0 is black; 15 preserves the expanded value. Forced blank overrides
all three channels to zero. This is an explicit **linear digital approximation**,
not an accurate SNES DAC/voltage/gamma model. For example `001F` at brightness 15
is RGB `(255,0,0)`; `03E0` is `(0,255,0)`; `65B2` at brightness 7 is `(69,49,96)`.

## Original ROM and observed bus writes

The complete ROM byte map is in [backdrop-rom.v](../examples/cpu816-backdrop/backdrop-rom.v).
Unlisted bytes return `DB` (STP). Bytes are hexadecimal; no assembler or ROM
loader is required.

| Address | Bytes | Instruction/purpose |
| --- | --- | --- |
| `8000` | `D8` | CLD |
| `8001` | `A9 80` | LDA #$80 |
| `8003` | `8D 00 21` | STA $2100, forced blank |
| `8006` | `A9 00` | LDA #0 |
| `8008` | `8D 21 21` | STA $2121, select word 0 |
| `800B` | `A9 1F` | LDA #$1F (color low byte at `800C`) |
| `800D` | `8D 22 21` | STA $2122, latch low |
| `8010` | `A9 00` | LDA #0 (color high byte at `8011`) |
| `8012` | `8D 22 21` | STA $2122, commit red `001F` |
| `8015` | `A9 0F` | LDA #$0F (display byte at `8016`) |
| `8017` | `8D 00 21` | STA $2100, enable full brightness |
| `801A` | `DB` | STP |
| `FFFC` | `00 80` | Emulation reset vector to `$00:8000` |

Actual CPU writes occur at clocks **15** (`2100=80`), **21** (`2121=00`),
**27** (`2122=1F`), **33** (`2122=00`) and **39** (`2100=0F`). The first CGDATA
write leaves word 0 unchanged and high pending; the second commits `001F` and
advances CGADD to 1. No JavaScript code inserts these transactions.

## Scanout and browser timing

The existing Video contract runs at **184320 simulated clocks/s**. CPU and
scanout share this artificial rate; it is unrelated to real SNES CPU/video
frequencies or NTSC/PAL timing. Every non-reset edge emits one valid pixel,
raster order x=0..63, y=0..47. The final pixel sets `video_last`; a frame takes
**3072 clocks**, or 60 frames per simulated second.

Scanout snapshots the current PPU RGB at the first pixel and retains it through
the frame. A PPU write on that same edge affects the next frame. Thus even
mid-frame initialization cannot produce a partly colored completed frame.
The first complete frame (clock 3072) is black from reset forced blank; the
second (clock 6144) is red from the CPU program. Later writes become visible
at the next frame boundary, adding up to one frame of latency.

The C++ adapter now re-evaluates CXXRTL at the same high clock level after the
register commit, before capturing outputs. CXXRTL's `step()` can report
convergence before a committed register propagates through combinational output
aliases; this extra evaluation settles registered submodule Video outputs and
PPU diagnostic expressions without another clock edge. The exact-edge tests
would otherwise see a one-clock delay. Counter/CPU/video/audio regressions cover
this shared adapter change.

The existing two frame buffers, bounded simulator worker and Canvas renderer are
used unchanged: at most one 12288-byte completed RGBA frame per reply, no per-pixel
messages, and at most 16384 clocks per request. Only complete frames are drawn.
No second graphics pipeline or combined AV interface is added.

## Limits, measurements and validation

The thirteen-file example totals **123,258 UTF-8 source bytes**, below the existing
128 KiB limit; **no limits are raised**. The 120-second compile deadline,
10-second simulation watchdog, 64 MiB simulator memory cap and other browser
[HDL/source limits](../README.md#browser-support-and-limits) still apply.

This is a CPU-to-register-to-video demonstration, not a SNES emulator. It omits
VRAM, tiles, sprites, palettes beyond word 0, DMA/HDMA, raster effects, interrupts,
APU, controller/cartridge loading, console address mirrors and exact video timing.
No real-time SNES performance is promised.

From the repository root:

```sh
npm ci
npm run build:demo
npx playwright test --config=playwright.static.config.js tests/static/backdrop.spec.js
npm run test:demo
python3 -m unittest discover -s tests -v
```

[backdrop.spec.js](../tests/static/backdrop.spec.js) runs real browser compilation
and simulation in Chromium and Firefox. It checks actual reset-vector fetches
and CPU bus writes, PPU low/high state transitions, bank decoding, latch restart,
nonzero-entry discard, wraparound, inactive writes and reset precedence. It
compares every Canvas pixel with the completed RTL frame, edits/recompiles the
ROM for red/green, forced blank, brightness zero and a mixed color at partial
brightness, and verifies Step/Run/Pause/reset/recompile without stale frames.
Independent device tests use a test-only RTL sequencer; CPU bus observations use
the production board logic with only its Video ports swapped for the existing
trace contract. Neither is a substitute CPU or device in the shipped example.
The full static suite retains all earlier demos.

Measurements on 2026-10-29, macOS 26.6.2 arm64, Playwright 1.64.1 browsers,
static HTTP loopback under `/webrtl/`, fresh browser contexts (process/system
caches may be warm):

| Browser | Compile including local downloads | Model clocks/s | Model frames/s | Wasm bytes |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 4.879 s | 3.58 million | 1165 | 75,897 |
| Firefox | 4.842 s | 3.23 million | 1053 | 75,897 |

The smoke test prints and attaches these measurements. Compile time includes
browser tool startup, local downloads, Yosys/Clang and initialization; it is not
an Internet download estimate. Throughput measures 100 complete scanout frames
in generated Wasm after the ROM reaches STP, including pixel capture and the
adapter's extra settle evaluation. It excludes worker/UI messaging and timer
scheduling, and does not measure active CPU instruction throughput. The UI still
targets 60 frames/s. Peak compiler memory is unmeasured; these figures are not
cross-device or real-time guarantees.

Validation recorded on 2026-10-29: **34 static browser tests passed** (17 each
in Chromium/Firefox, including all previous counter, bus, 65C816, video and audio
regressions), and **8 Python service tests passed**. Documentation relative
links/anchors and Git whitespace checks passed. The separate trusted-local
regression was attempted on port 8875 because 8765 was occupied; its initial
counter build failed. A direct native counter build confirmed the README's
existing Verilator 5.052 / Emscripten 6.0.13 incompatibility: undefined
`pthread_getaffinity_np`, `sched_getcpu` and `pthread_setaffinity_np` at link time.
That native check did **not** pass. It does not use the browser toolchain tested
above; no native toolchain or trusted-local implementation is changed here.

## Required post-merge verification — pending deployment

After deployment, run this same automated color-edit/reset smoke test against
the public site, and record the deployed result separately:

```sh
WEBRTL_PUBLIC_URL=https://takahirox.github.io/webrtl/ \
  npx playwright test --config=playwright.static.config.js tests/static/backdrop.spec.js \
  --grep 'CPU backdrop compiles, renders, edits ROM color and resets'
```

Build the local artifact first for the test server. The smoke check verifies
static GET-only requests under `/webrtl/`, new browser-generated Wasm, executed
CPU color changes, forced blank and reset/repeat through the deployed Canvas.
Local pre-merge success does not establish deployment success. Publishing and
live-site verification are not pre-merge approval conditions.
