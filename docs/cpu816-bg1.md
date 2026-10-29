# CPU-programmed BG1 Mode 0 tiles

Issue [#20](https://github.com/takahirox/webrtl/issues/20) adds a focused,
SNES-inspired 8×8, 2bpp BG1 path. Load **65C816 CPU → BG1 tiles · 64 × 48** in
the static app, Compile, then Run. The 64×48 Canvas shows a four-color repeating
checkerboard and a single magenta/cyan striped tile at screen coordinates
x=8..15, y=0..7. CPU instructions write the pixels' source memories through PPU
registers; JavaScript only transfers the existing RTL Video output to Canvas.

## Sources, license and compiler

The selector loads 13 files with top module `cpu816_bg1`, using the existing Video
interface. The nine unchanged [P65C816 sources](../examples/cpu816/README.md)
retain their pinned provenance, GPL-3.0-or-later license and existing browser
compatibility adaptations. The four [BG1 files](../examples/cpu816-bg1/README.md)
provide the board, original inline ROM, PPU and scanout. The board reuses the
backdrop example's CPU bus integration: `CE=RDY=1`, interrupts inactive,
asynchronous ROM reads at bank $00:$8000..$FFFF, data $FF elsewhere, and qualified
writes when `(VPA || VDA) && !WE`. Only bank $00 PPU registers decode; there are
no console mirrors, RAM, stack storage or device reads. Reset-vector CPU bus
activity includes the core's dummy stack writes; the board discards them.

The new RTL, original program and ROM generator are GPL-3.0-or-later. See the
[core license](../examples/cpu816/LICENSE) and
[provenance](../examples/cpu816/UPSTREAM.md); preserve notices and corresponding
source when distributing combined/generated designs. No game ROM is used.

Compilation remains entirely in the browser: pinned Yosys → CXXRTL → Clang/LLD →
new Wasm, under `/webrtl/`, with static same-origin GET downloads. No build API,
precompiled circuit, JavaScript CPU, tile interpreter or prerecorded frame is
added. Existing source, compilation, worker and transfer bounds are unchanged.

## Write-only PPU register subset

Writes commit on the shared rising edge; reset wins over a simultaneous write.
Unlisted registers and writes in other banks are ignored. Unlike real hardware,
writes are accepted during display as well as forced blank; no access arbitration
or readback latches are modeled.

| Bank-$00 register | Supported behavior | Omitted/ignored behavior |
| --- | --- | --- |
| `$2100` INIDISP | Bit 7 forces black; bits 3:0 brightness 0..15; reset `$80` | Bits 6:4 ignored |
| `$2105` BGMODE | Bits 2:0 must be 0; bit 4 must be 0 for BG1 8×8; otherwise display CGRAM[0] | Other BG sizes, priority controls, all other modes/layers |
| `$2107` BG1SC | Bits 7:2 select map base, `value[7:2] * $0400` **words**; 32-column addressing | Bits 1:0 ignored; always a 32×32 map |
| `$210B` BG12NBA | Bits 3:0 select character base, `value[3:0] * $1000` words | BG2 nibble ignored |
| `$2115` VMAIN | Bit 7: increment after high (1) or low (0) write; bits 1:0: increments 1, 32, 128, 128 words | Address remapping bits 3:2 and unused bits ignored |
| `$2116/$2117` VMADDL/H | Set low/high byte of full 16-bit **word** address independently | Read prefetch/buffering |
| `$2118/$2119` VMDATAL/H | Immediately write low/high byte at current word; then increment on selected port, wrapping at 16 bits | No low/high pair latch; out-of-storage writes discarded but still increment |
| `$2121` CGADD | Full 8-bit color-word address; restarts pair and clears low latch | Readback |
| `$2122` CGDATA | Low byte latches; high byte commits `{high[6:0], low}`, advances address modulo 256, restarts low phase | Only entries 0..31 stored; higher entries discard commits but still advance |

BG1 is implicitly enabled. There is no `$212C` layer-enable register. At reset all
other registers, address/pair state, VRAM and CGRAM are zero. Other than INIDISP,
BGMODE preserves the written byte but only its documented mode/size bits affect
output. Unsupported modes/sizes deliberately show the current backdrop.
Brightness uses the backdrop example's digital approximation: replicate each
5-bit channel to 8 bits, then floor(channel × brightness / 15). This is not an
analog SNES DAC model.

## Sparse VRAM, tilemap and planar interpretation

VRAM is **18 RTL words (36 bytes)**, with full address comparison rather than
low-bit aliasing:

| Word address | Stored contents |
| --- | --- |
| `$0000..$0007` | Character 0: eight rows of 2bpp bytes |
| `$0008..$000F` | Character 1: eight rows of 2bpp bytes |
| `$0400..$0401` | First two entries of the first map row |
| Everything else | Reads zero, writes discarded |

These are windows in one logical VRAM address space, so either kind of lookup
can read either stored window. This is deliberately smaller than a full SNES
VRAM/map. A zero map entry still selects character 0, so unstored map entries
repeat the checkerboard without the CPU filling a full map. Unstored character
words produce transparent pixels. There is no scrolling or map wrapping beyond
the visible eight columns and six rows.

At `(x,y)`, read map word `map_base + (y/8)*32 + x/8`. Entry bits 9:0 select the
character, bits 12:10 select one of eight 2bpp palettes, bit 14 flips horizontally,
and bit 15 flips vertically; priority bit 13 is ignored. Read character word
`character_base + tile_number*8 + tile_row`. Its low byte is plane 0; high byte
is plane 1. Bit 7 is the leftmost pixel, bit 0 the rightmost. The color number is
`plane0_bit + 2*plane1_bit`. Zero always selects backdrop CGRAM[0], independent
of tile palette. Nonzero selects `CGRAM[palette*4 + color_number]`.

All **32 BG1 color words** are RTL-owned and resettable. The ROM initializes
entries 0..7; entries 8..31 remain zero unless CPU-programmed. CGRAM colors use
SNES-style BGR555 storage (red bits 4:0, green 9:5, blue 14:10).

## Original ROM, expected pixels and edits

The 317-byte program at `$8000..$813C` uses only `CLD` (`D8`), 8-bit immediate
`LDA` (`A9 nn`), absolute `STA` (`8D ll hh`), and `STP` (`DB`). Reset vector
`$FFFC/$FFFD = 00 80`. In reset emulation mode A/X/Y are 8 bits. Each store is
five bytes (`LDA #value; STA $register`); the generated Verilog shares case arms
for repeated opcodes/address bytes to stay below the source limit. Immediate
bytes retain individual address labels and comments for browser editing.

The CPU performs 63 PPU writes, beginning at clock 15 and separated by six
clocks: force blank, set CGADD, initialize eight palette words, set mode/map/
character bases and VMAIN, set VMADD, write 16 character words, set map address,
write two entries, then unblank at clock 387 and stop. Scanout continues.
Reproduce or verify the checked-in bytes without an assembler:

```sh
python3 scripts/generate-bg1-rom.py
python3 scripts/generate-bg1-rom.py --check
```

Character 0's low plane is `$55` on every row; high plane alternates `$00/$FF`.
Thus even rows alternate blue/red, odd rows green/white. Map word `$0400` is
`$0000`; word `$0401` is `$0401` (character 1, palette 1). Character 1 alternates
low plane `$FF/$00`, with high plane always `$FF`: even rows magenta, odd rows
cyan. All other map lookups return zero and select character 0.

| CGRAM entry | Word | RGB at brightness 15 |
| --- | --- | --- |
| 0 | `$7C00` | (0, 0, 255), also transparent-pixel backdrop |
| 1 | `$001F` | (255, 0, 0) |
| 2 | `$03E0` | (0, 255, 0) |
| 3 | `$7FFF` | (255, 255, 255) |
| 4 | `$0000` | (0, 0, 0), unused palette-1 zero slot |
| 5 | `$03FF` | (255, 255, 0) |
| 6 | `$7FE0` | (0, 255, 255) |
| 7 | `$7C1F` | (255, 0, 255) |

Select `bg1-rom.v` and change these commented immediate bytes, then Compile/Run:

| Edit | Expected change |
| --- | --- |
| `$807A`, `tile 0 row 0 plane 0`: `$55 → $FF` | Character-0 first rows become all red, including transparent pixels becoming index 1 |
| `$812E`, `map entry 1 low`: `$01 → $00` | The striped tile becomes a checkerboard using palette 1: blue/yellow then cyan/magenta |
| `$8016/$801B`, `palette 1 low/high`: `$1F/00 → $E0/03` | Red checker pixels turn green |
| `$8133`, `map entry 1 high; palette 1`: `$04 → $C4` | Both flips set; stripe rows reverse cyan/magenta |
| `$8138`, `display on, full brightness`: `$0F → $8F` | Configured frame stays forced black |
| `$805C`, `Mode 0, BG1 8x8`: `$00 → $01` | Unsupported mode displays solid blue CGRAM[0] |

## Clocks, frame boundaries and lifecycle

One rising edge clocks the real CPU, PPU register writes, and one scanout pixel.
Coordinates count x=0..63 then y=0..47; a frame takes exactly **3072 clocks**.
The existing Video contract registers valid/x/y/RGB/last after each edge. The
unchanged adapter settles CXXRTL before capture and the worker publishes only
completed frames. The UI targets 60 frames/s through bounded batches, not real
NTSC timing or a console CPU frequency. Step advances exactly one clock;
Run batches clocks; Pause preserves the last complete image.

Scanout samples forced blank at the first pixel of a frame. A frame starting
blank stays black even if the CPU unblanks midway, so initialization cannot leak
a partly programmed image. First frame after reset is opaque black; second and
later frames show the deterministic pattern. Live PPU blank still forces black
immediately. Other registers/memories are read live for each pixel: writes during
an enabled frame can affect later pixels, and same-edge writes affect subsequent
pixels. There is no full memory snapshot or emulated vblank access scheduling.
The supplied ROM finishes initialization while the first frame is blank.

Reset wins over writes, clears both VRAM windows and all 32 colors, registers,
CPU, coordinates and output flags. The adapter/worker/UI clear partial and
completed frames to transparent Canvas and pause. Reset during initialization,
a half-written palette pair, or a partial/completed frame repeats deterministically.
Editing and recompiling discard the previous worker/model and clear the Canvas;
a fresh successful compile resets a fresh circuit. No JS writes to VRAM occur.

## Validation, bounds and performance

```sh
npm ci
npm run build:demo
npx playwright test --config=playwright.static.config.js tests/static/bg1.spec.js
npm run test:demo
python3 -m unittest discover -s tests -v
```

[bg1.spec.js](../tests/static/bg1.spec.js) compiles actual browser Yosys/Clang in
Chromium/Firefox, checks reset-vector and instruction fetches and the complete
63-write CPU trace, and independently specifies every RGBA pixel of completed
frames. Each tile/map/palette/flip/blank/mode edit recompiles the ROM and repeats
Canvas/reset checks. Additional device stimuli verify both increment ports,
1/32/128 strides, address wrap, sparse writes without aliasing, bank qualification,
inactive writes, base/size selection, CGRAM pair restart/commit/wrap and reset
precedence. Test-only observation ports/sequencers do not ship in the example.
Prior counter, CPU bus, 65C816, backdrop, video and audio tests remain enabled.

The project is 129,830 UTF-8 source bytes including the reused CPU, below the
existing 131,072-byte limit. Its packed case arms avoid raising that limit.
The 120-second compile deadline, 10-second simulation watchdog and existing
frame/batch bounds remain unchanged. This is a small two-state synthesizable
model, not a full PPU: no other BGs, scrolling, sprites, windows, color math,
DMA/HDMA, interrupts, raster scheduling, cartridge loading, or real-time game
performance guarantee. Compiler peak memory is unmeasured.

Measurements on 2026-10-29, macOS 26.6.2 arm64, Playwright 1.64.1, static
loopback HTTP under `/webrtl/`, fresh browser contexts (system/process caches may
be warm):

| Browser | Compile including local downloads | Wasm bytes | Active initialization clocks/s | Post-STP clocks/s | Post-STP frames/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium 156 | 6.349 s | 91,943 | 1.11 million | 1.24 million | 402 |
| Firefox 157 | 7.376 s | 91,943 | 1.03 million | 1.13 million | 369 |

Compile timing includes tool startup, local downloads, Yosys/Clang and model
initialization; it is not an Internet download estimate. Compiler assets are
unchanged (approximately 185 MB). Active throughput measures 1,000 reset-and-run
prefixes of 250 clocks while the CPU is executing initialization, including reset
overhead. Post-STP throughput measures 100 complete 3072-clock frames in generated
Wasm after initialization, including pixel capture and the adapter's settle
evaluation. Both exclude worker/UI messaging and scheduling. The UI still targets
60 frames/s. These are local measurements, not cross-device performance guarantees.

Validation recorded on 2026-10-29: **40 static browser tests passed** (20 each
in Chromium and Firefox, including all existing counter, CPU bus, 65C816,
backdrop, video and audio regressions), and **8 Python service tests passed**.
The ROM generator's `--check`, documentation relative links and Git whitespace
checks passed. The separate native trusted-local suite was not run; validation
used the client-side compiler and runtime affected by this change.

## Required post-merge public-site verification — pending deployment

After merge and Pages deployment, run the same automated smoke test against the
public site and record its actual result separately:

```sh
WEBRTL_PUBLIC_URL=https://takahirox.github.io/webrtl/ \
  npx playwright test --config=playwright.static.config.js tests/static/bg1.spec.js \
  --grep 'CPU BG1 compiles, renders, edits ROM tile/map/palette and resets'
```

Build the local artifact first for the test server. The public smoke test compiles
the example, verifies the expected tile frame, edits the ROM tile/map/palette and
recompiles, resets and repeats, while checking static same-origin GET-only access.
Local pre-merge validation does not establish publication or deployed results.
Deployment/public-site validation is required after merge, not a pre-merge gate.
