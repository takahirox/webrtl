# Independent SNES cartridge expectations (#22)

`scripts/generate-snes-rom.py` assembles original cartridges. Every fixture boots
through the CPU reset vector, programs the devices through CPU/DMA registers and
uploads its SPC700 driver through the IPL protocol. The browser test compiles the
RTL once per batch and power-cycles it for each cartridge. Expected pixels and
PCM are calculated in the test; they are not recordings of this core's output.
Pixel comparisons cover every RGBA sample, including its position and alpha.
The 164-cartridge sweep runs in nine batches per browser, each with at most
20 cartridges plus the AUX reset repeat. Each batch retains the baseline
input/audio, LoROM/HiROM and deterministic-reset checks, compiles client-side,
and has a 30-minute deadline. This replaces the single 120-cartridge test that
timed out on the Ubuntu CI runner before reaching its assertions. No fixtures
are omitted; the AUX pair stays in one batch for its cross-cartridge comparison.
Each batch saves its own Wasm, fixture results and measurements.
For a focused DSP rerun (including baseline input/reset and LoROM/HiROM checks):

```sh
npm run build:demo
WEBRTL_SNES_FIXTURES='^(apu-endx|audio-echo-wrap)$' npx playwright test --config=playwright.static.config.js --grep 'full SNES RTL'
```

The register, bitplane, priority, window, transfer and controller expectations
follow the [SNES development manual](https://floating.muncher.se/bot/manual/book1_text.pdf):
chapters 2–8, 12–13, 17, 19 and register appendices in section 2; timers and DSP
registers in section 3. In particular, H-512 alternates subscreen/main pixels,
with both enabled in the cartridge. Mode 7 coordinates use scanlines 1–224 while
the capture buffer starts at row 0.

| Fixtures | Independently specified observation |
| --- | --- |
| `mode-0`…`mode-7` | Blue transparent dots and red opaque dots; modes 5/6 have one sample per dot, other modes have two. |
| `reject-mode5-as0` | Deliberately boots Mode 0, compares against Mode 5, and must reject over 50,000 pixels. This detects the mode substitution missed by color totals. |
| `depth-0`…`depth-6` | Planes `$55/$33/$0f/$ff` produce indices 0–3, 0–7 or 16–23 according to 2/4/8bpp. Each nonzero index has an explicitly calculated distinct palette color. |
| `hires-5/6-bg1-low/high-normal/reverse`, `hires-5-bg2-low/high-normal/reverse` | Both map priorities render plane-zero `$55` and `$aa` stripes at every 512-wide sample. BG1 uses 4bpp; Mode 5 BG2 uses 2bpp. Each sample's own index controls transparency. |
| `bus-no-sram-lorom/hirom`, `bus-sram-lorom/hirom` | CPU reads unmapped `$006000/$005000/$806000`, valid ROM aliases, and present SRAM aliases/mirrors, storing results in `$7e3100` onward before checking them. Absent LoROM SRAM at `$706000/$f06000` also retains open bus. |
| `bg2`, `bg3`, `bg4`, `layers` | Separate Mode 0 palettes; BG2 offset by one dot interleaves green with BG1 red. |
| `priority-low`, `priority-high`, `bg3-priority-low/high` | Coincident BG1/BG2 stripes distinguish map priority; Mode 1 BG3 high-priority stripes distinguish its priority-promotion bit. |
| `sprite-low`, `sprite-high` | Green object occupies dots 16–23, rows 16–23. Low priority is hidden at opaque BG dots; high priority covers them. |
| `sprite-hflip`, `sprite-vflip` | An asymmetric eight-row object distinguishes horizontal and vertical OAM flips. |
| `sprite-edges` | OBSEL=`$61` selects 16×16 objects at X=0, 248, 252, −4, −8, −12, on separate rows. Left-edge objects wrap at 512 and display 12, 8, 4 dots; right-edge objects display 8 or 4 dots. The on-screen control displays all 16 dots. |
| `sprite-interlace` | SETINI=`$03`, OBSEL=`$61`, object at (16,16): upper source tile rows alternate green/white and lower tiles are transparent. Both fields must produce exactly capture rows 32–39, green on even rows and white on odd rows. Rows 40–47 must show the background. |
| `sprite-interlace-vflip` | Same cartridge with OAM vertical flip set: colored rows move to capture rows 40–47, white on even rows and green on odd rows. Rows 32–39 must show the background. This checks the flipped field bit in both fields. |
| `sprite-rect`, `sprite-rect-vflip` | OBSEL=`$c1` selects a 16×32 object at (16,16). Only the first eight source rows have alternating green/white pixels. Unflipped output occupies rows 16–23; vertical flip occupies rows 24–31, white on even rows and green on odd rows. Rows 32–47 remain background: each 16-row section flips independently. |
| `cgram-latch` | CPU reads entries `$40`–`$42` and stores `$00,$00,$80,$92,$5a,$23` in WRAM. Interposed OAM reads with opposite bit 7 update PPU1 open bus while leaving the CGRAM high byte's PPU2 bit 7 intact, in both directions. |
| `wbglog-open-bus` | Separate cartridge repeats the CGRAM/OAM latch-isolation checks using `$212a` for PPU1 open bus. CPU stores at `$7e3208/$7e320c` must be `$80/$00`, retaining the last OAM read even after other CPU and PPU2 accesses. |
| `slhv-latch` | Six CPU snapshots at `$7e3400`–`$7e3417` contain all nine bits of H/V. With 128 NOPs between captures, enabled `$2137` reads advance V; WRIO.7's falling edge captures again; a disabled `$2137` read and the rising edge retain that snapshot; re-enabled `$2137` captures again. |
| `scroll`, `mosaic` | One-dot scroll reverses the stripes; four-dot mosaic samples transparent dot 0 and makes all pixels blue. |
| `offset-2/4/6` | Alternating solid/transparent tile rows. BG3 offset data enables a one-line vertical offset after the first eight screen dots; mode 4 uses the combined offset selector. |
| `direct-3/4/7` | Nontransparent index 1 gives direct-color red value 4/31, expanded to 33/255, independently of CGRAM. |
| `zoom`, `constant`, `rotate` | Mode 7 doubled X selects transparent pixels, constant X selects red, and a quarter-turn converts vertical stripes to horizontal stripes. |
| `hflip`, `vflip`, `hvflip`, `hflip-fraction/scale`, `vflip-fraction/scale` | Mode 7 flips use unsigned `255-X/Y` before the matrix. Identity and cross-axis matrices check stripe direction; coefficients `$0001` and `$0081` expose incorrect sign extension during scaling. Vertical cases feed flipped Y through M7B to the striped X axis. |
| `window`, `window-or/and/xor/xnor` | Inclusive bounds [64,127] and [96,159], combined with the specified Boolean operator, mask BG1 at exact dot positions. |
| `math`, `subtract`, `half`, `subscreen` | Fixed-green addition, fixed-red subtraction and halved addition, and BG1 red + BG2 green on the subscreen; results follow five-bit component arithmetic. |
| `overscan`, `interlace` | The expected stripe image covers 239 or 448 rows, respectively. |
| `dma-0`…`dma-7` | Eight distinct source bytes must reach the documented B-bus offset sequence for each transfer mode. |
| `reverse` | Mode 1 copies 16 VRAM bytes from `$2139/$213a` to `$7e3000`; both CPU readback and destination bus writes must match the cartridge's plane data. |
| `indirect` | HDMA follows pointers in its table to alternating bytes `$10/$20`. Writes must occur 127 scanlines (127 × 1364 master clocks) apart, allowing 16 clocks for CPU/DMA arbitration phase. |
| `serial`, `auto` | CPU records and checks all twelve buttons, four zero signature bits, eight one connection-detection bits and disconnected port 2; automatic reads separately affect the palette. |
| `apu-timer-zero-0/1/2` | Each timer independently uses target zero (256 ticks); all three timer output ports must report ticks before the CPU enables display. |
| `apu-aux`, `apu-aux-repeat` | Both AUX registers initially read zero, then independently retain `$5a/$a5` and `$c3/$3c`. Repeating after power reset reproduces the frame and PCM. |
| `apu-ram-write-enable/protect` | Initialize ARAM `$0800=$5a`, set TEST to `$0a/$08`, attempt `$a5`, and require `$a5/$5a` respectively. Protection stays active through DSP register setup, BRR playback and timer/port I/O, which must still produce the normal exact frame and PCM. |
| `apu-ram-disable-read/write` | An I/O-resident SPC700 routine sets TEST=`$0e` (writes enabled, RAM disabled). Reading initialized `$80=$a5` must return `$5a`; attempting to overwrite `$80=$5a` with `$a5` must leave `$5a` after restoring RAM access. |
| `apu-ram-disable-dsp/aux` | The same disabled-RAM routine reads DSPDATA or AUX through `(X)` and must retain the programmed `$7f/$22` value rather than the disabled-RAM value. All disabled-RAM cases return to ARAM code, restore TEST=`$0a`, and require normal frame/PCM output. |
| `apu-dsp-mirror-volume/flg/kon` | Repeated writes through DSPADDR `$8c/$ec/$cc` leave mirrored readback and the normal PCM waveform intact, including KON/FLG side effects. |
| `apu-endx` | A non-looping BRR sample sets ENDX bit 0 before APU readiness. The bit stays set across reads and read-only mirror writes; normal writes of `$00` and `$ff` each clear it after separate key-ons. |
| `audio-echo-wrap` | Both echo channels read `$8000`, tap 7 is `$80`, all other taps and main volumes are zero, echo volumes are `$7f`, and echo writes are disabled. Every settled PCM sample must equal −32512. |
| `apu-div-normal/overflow/zero-divisor/nine-bit/boundary/zero-result/half-clear` | SPC700 machine code checks A, Y and N/V/H/Z after DIV, with carry both clear and set; carry must be preserved. |

Every cartridge checks RDIO after WRIO writes `$ff/$00/$40/$80/$ff`. With standard
pads, the programmable pins are undriven and pulled high when released, so these
levels read back directly. Failure branches prevent the cartridge from enabling
display/audio; the serial case also exposes each result through WRAM writes.

The H-512 fixtures follow the independent
[bsnes background renderer](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/ppu-fast/background.cpp):
each high-resolution sample tests its own color index for transparency. Reversed
stripes must retain 57,344 red pixels at even X positions, while normal stripes
place them at odd X positions. Both priority settings and Mode 5 BG2 are checked.

Cartridge bus expectations follow the documented
[SNES memory map](https://wiki.superfamicom.org/memory-mapping).
Absolute unmapped loads retain the last operand byte (`$60/$50`); long loads
retain the bank operand (`$80`, or `$70/$f0` for absent LoROM SRAM). ROM marker
`$a6` at CPU `$009070` is read through banks `$00/$80/$40/$c0`, including LoROM
lower-half aliases `$401070/$c01070`. With 2 KiB SRAM present, `$5a/$3c` writes
are read through bank aliases and size mirrors. The assertions inspect CPU
stores into WRAM, so cartridge trace data alone cannot satisfy them.

HDMA write timestamps include CPU completion and DMA alignment, as modeled by
the independent [bsnes timing implementation](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/cpu/timing.cpp#L148).
This fixture polls WRAM/ROM with six/eight-clock CPU cycles; its 16-clock bound
covers CPU completion plus the eight-clock DMA divider while rejecting a write
on an adjacent scanline. The test checks every captured `$10`/`$20` pair.

Mode 7 flip/scaling expectations follow the independent
[bsnes implementation](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/ppu-fast/mode7.cpp):
screen coordinates remain in [0,255] after flipping, the matrix is signed 8.8,
and vertical products discard six low bits before adding the horizontal product.
With M7SEL=1, M7A=`$0001`, M7D=`$0100` and zero offsets, every X coordinate
selects transparent texel 0 and the entire frame must be blue. The analogous
vertical fixture uses M7SEL=2, M7A=0 and M7B=`$0001`. The `$0081` variants check
nonconstant results across the coordinate sign boundary, sample by sample.

The DSP expectations use the independently developed
[snes_spc DSP reference](https://github.com/snes9xgit/snes9x/blob/8028d3b6ca994f21fdff220d513a08382e37afc3/apu/bapu/dsp/SPC_DSP.cpp)
for numerical BRR, Gaussian, envelope, signed volume, noise and echo rules.
Only eight Gaussian coefficients are required for the fixtures' integer and
half-sample pitch phases. The test calculates the waveform from the original BRR
nibbles, applies truncation at each stage, and compares 256 consecutive samples.
It allows a cyclic phase shift because cartridge upload duration varies.

The normal filter-0 waveform has eight +7 and eight −7 nibbles, range 11,
pitch `$1000`, direct gain `$7f`, and voice/master volumes `$7f`. Variants check
gain `$40`, half pitch, all eight voices mixed at volume `$10`, ADSR, linear gain
increase, KOFF release, mute, noise at rate 31, and BRR filters 1–3 at range 4.
Filter feedback rounding can produce a period longer than the BRR block: the
oracle detects the repeated decoder state rather than assuming a 16-sample loop.
Separate range-13 and constant −32768 fixtures check special range decoding and
the signed overflow of the first three Gaussian terms. The gain ramp is checked
during attack as well as at full level; KOFF must sound before reaching silence.
The noise oracle follows the 15-bit LFSR independently of the RTL's state.
The echo fixture uses EDL=1 (512 stereo samples), no feedback, FIR tap 0=`$40`
and echo volume `$40`; its expected delayed waveform includes FIR history and
integer rounding, and the initial 512-sample dry interval. Timer targets 1/2/3 must all report ticks through APU ports
before the CPU enables display. Default playback also checks sample rate and
exact frame/PCM replay after power reset.

The echo-wrap fixture follows the reference's `echo_25` rule: the final tap's
shifted product is `(−32768 / 2 × −128) >> 6 = 32768`, which wraps to signed
16-bit −32768 before addition and saturation. Echo volume `$7f` then yields
`(−32768 × 127) >> 7 = −32512` in both channels and the mono downmix.
Saturating the unwrapped product instead yields the incorrect positive 32510.
The ENDX fixture checks the reference's `voice_V4`–`voice_V7` end-event latch
and clear-on-write behavior with original SPC700 instructions; display remains
disabled until both end/set/clear sequences pass. The one-shot voice must first
produce non-silent PCM and then settle to silence.

The APU register fixtures follow the independent bsnes
[SMP I/O implementation](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/smp/io.cpp)
and [timer implementation](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/smp/timing.cpp).
The TEST memory expectations follow its
[SMP memory implementation](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/smp/memory.cpp):
bit 1 permits SMP RAM writes, bit 2 disables SMP RAM reads/writes, disabled reads
return `$5a`, and I/O and the enabled IPL overlay take precedence. DSP ARAM
access remains independent. To avoid fetching instructions from disabled RAM,
the disable probes execute `MOV $f0,#$0e; MOV A,(X)` (or `MOV (X),A`) from CPU
input ports `$f4`–`$f7`, followed by `SET1 $f0.1` from AUX `$f8/$f9`. That
read-modify-write restores TEST=`$02` without altering A. Inactive timer reads
at `$fa`–`$ff` supply NOPs before a RAM trampoline at `$0100` returns to the
driver. APU comparisons gate readiness and the CPU keeps checking readiness
during playback, so a failed memory check cannot leave a passing frame behind.
The zero-target fixtures clear all three proof ports and poll each timer
independently: sampling a faster timer only every 256 slow ticks can repeatedly
observe zero after its four-bit output wraps.
DSPADDR bit 7 selects read-only mirrors; it does not inhibit mirrored reads.
The KON fixture repeatedly writes `$cc=1` during playback, which
must not retrigger the voice. The CPU rechecks the APU's ready port each frame;
an SPC700 self-check failure reports `$ff` and blanks video.

DIV expectations follow the independent
[SPC700 instruction implementation](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/processor/spc700/instructions.cpp).
For Y < 2X, A and Y receive the low quotient byte and remainder of YA/X.
Otherwise A = 255 − (YA − 512X)/(256 − X) and
Y = X + (YA − 512X) mod (256 − X). V tests the original Y >= X,
H tests the original low nibbles, and N/Z test the resulting A. In particular,
`$ff00/$10` produces A=`$12`, Y=`$e0`; `$1234/0` produces A=`$ed`, Y=`$34`.
The remaining fixtures exercise ordinary division, a nine-bit quotient, the
Y=2X boundary, zero quotient and clear H. These checks run before the APU reports
ready, so a wrong result or flag prevents the expected frame from appearing.

The `audio-negative-modulator` cartridge keys on two voices. Voice 0 loops
constant range-11 −7 BRR nibbles at pitch `$1000` with zero stereo volume;
its post-envelope output still modulates voice 1 through PMON bit 1. The
reference's Gaussian and envelope arithmetic gives −14344 and then −14232.
The signed pitch rule gives `$0e27 + ((-445 * $0e27) >> 10) = $0800` for
voice 1, which plays the normal square-wave BRR at half pitch. All 256 captured
PCM samples must match the independently calculated 32-sample waveform, allowing
only a cyclic phase shift. A logical shift instead produces pitch 9294, so it
cannot pass this comparison. The half-pitch choice permits the same eight
independent Gaussian coefficients used by the existing pitch fixture.

These are deterministic feature fixtures, not exhaustive instruction, register,
timing or commercial-game conformance. Remaining limits are recorded in the
[feature matrix](snes.md#base-console-feature-matrix). Test evidence includes
per-fixture mismatch counts and bounded PCM excerpts rather than entire frames,
keeping the Playwright transport and report memory bounded.

The sprite-edge and interlace expectations follow the independent
[bsnes object renderer](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/ppu-fast/object.cpp):
object X and each tile X wrap to nine bits, and interlace halves range height
while source Y advances by two plus the field bit. The interlace fixture uses
different colors per field so a duplicated field cannot satisfy its image check.
Vertical flip reverses the source row including the field bit. Rectangular
objects flip within width-sized squares, preserving the square's position.
CGRAM readback follows the independent
[bsnes PPU register implementation](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/ppu-fast/io.cpp):
`$213b` updates PPU2 MDR, high-byte reads retain bit 7 from that latch, and
`$2138` updates only PPU1 MDR. The cartridge verifies each CPU load before
enabling display, and the browser separately verifies its stores at `$7e3200`–`$7e320d`.
For a focused rerun of these PPU regressions:

```sh
npm run build:demo
WEBRTL_SNES_FIXTURES='^(sprite-edges|sprite-interlace(-vflip)?|sprite-rect(-vflip)?|cgram-latch)$' npx playwright test --config=playwright.static.config.js --grep 'full SNES RTL'
```

The SLHV and WBGLOG expectations also follow the independent PPU register
implementation linked above: WRIO bit 7 gates software counter capture, and
`$212a` returns PPU1 MDR. The additional cartridges preserve all existing fixture
bytes. Run them together with the original CGRAM control:

```sh
npm run build:demo
WEBRTL_SNES_FIXTURES='^(slhv-latch|wbglog-open-bus|cgram-latch)$' npx playwright test --config=playwright.static.config.js --grep 'full SNES RTL'
```


## Base-feature review fixtures

The additional cartridges leave every prior cartridge byte-identical.
Expectations come from the independent bsnes implementations of
[objects](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/ppu-fast/object.cpp),
[Mode 7](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/ppu-fast/mode7.cpp),
[color windows](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/ppu-fast/window.cpp),
[DMA](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/cpu/dma.cpp), and
[DSP envelopes/echo](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/dsp/SPC_DSP.cpp).
The browser checks newly compiled RTL using generated cartridges, without running
an emulator or taking expected values from RTL output.

| Cartridge | Independent expectation |
| --- | --- |
| `sprite-small-interlace-{6,7}[-vflip]` | OBSEL `$c1`/`$e1`, small OBJ, SETINI `$03`. Interlace uses a 16-row source height before halving the visible range, including the size-mode 6/7 hardware exception. Both fields are checked: green/white rows at capture 32–39, or white/green at 40–47 when flipped. Colored source rows 16–23 must never appear. |
| `m7-over2`, `m7-over3` | Identity matrix, horizontal offset 1016, nonzero map tile 1 (solid green). Dots 0–7 remain green; outside the 1024-dot map, screen-over 2 is transparent (blue backdrop), while screen-over 3 fetches striped tile 0. |
| `m7-origin-positive`, `m7-origin-negative` | A=`$0081`, B=`$0060`, D=`$0100`, center=(3,5); offset-center deltas are (+1025,−1025) or (−1025,+1025). Clip deltas to signed ten bits before multiplying, truncate each origin product's six low bits, and compare an asymmetric eight-dot palette sequence at every pixel. |
| `color-window-{clip}-{prevent}` | All sixteen CGWSEL clipping/math-gating combinations, using color window 1 at inclusive dots 64–127 and fixed green addition on BG1/backdrop. Independently check never/outside/inside/always conditions, clipping to black before allowed math, and all boundary pixels. |
| `obj-limit-32`, `obj-limit-33` | 32 small objects fit; the 33rd is rejected and sets STAT77 bit 6. A distinct final object at X=80 detects admission/rejection; overlapping earlier objects remain visible at X=16. The CPU stores masked VBlank STAT77 at `$7e3300`, checked separately from the frame. |
| `obj-limit-34tiles`, `obj-limit-35tiles` | Seventeen large 16×16 objects consume 34 tiles without time overflow. An extra small object consumes tile 35, sets STAT77 bit 7, and exercises reverse object-fetch order. The first object is fetched last at X=112: the 34-tile control shows both tiles, while the 35-tile case must cull its right tile on rows 16–23, where the extra small object consumes the budget; rows 24–31 show both tiles. Check exact frame pixels and CPU flag observations. |
| `multi` | DMA channels 2/5 must emit `$21`–`$28` in priority order. Direct HDMA channel 2 and indirect channel 5 write `$31,$51` then `$32,$52` on their shared scanlines. Long DMA on channels 0/7 starts at VBlank's end: HBlank HDMA interrupts channel 0, runs in priority order, and the DMA byte stream resumes before channel 7. |
| `audio-feedback` | EFB=`$40`, EDL=1, FIR tap 0=`$40`, EVOL=`$40`, and EON=1. An independent integer echo-ring recurrence includes 512-sample memory delay, seven-sample FIR history, signed feedback, truncation and saturation; compare the settled PCM period after a bounded longer run. |
| `audio-decay-sustain`, `audio-sustain`, `audio-adsr-release` | Original constant BRR source makes the envelope directly observable. Compare exact PCM through rate-30 exponential decay and rate-0 hold or rate-31 sustain. Allow the two legitimate global-counter phases; KON does not reset that counter. The release cartridge also checks the complete KOFF ramp (subtract eight envelope units per sample) through silence. |

These checks sample distinct hardware paths rather than claiming exhaustive
conformance. Focused reruns still retain the baseline cartridge's input, audio,
LoROM/HiROM and deterministic reset checks:

```sh
npm run build:demo
WEBRTL_SNES_FIXTURES='^(sprite-small-interlace-|m7-|color-window-|obj-limit-|multi$|audio-(feedback|decay-sustain|sustain|adsr-release))' npx playwright test --config=playwright.static.config.js --grep 'full SNES RTL'
```
