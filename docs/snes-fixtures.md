# Independent SNES cartridge expectations (#22)

`scripts/generate-snes-rom.py` assembles original cartridges. Every fixture boots
through the CPU reset vector, programs the devices through CPU/DMA registers and
uploads its SPC700 driver through the IPL protocol. The browser test compiles the
RTL once per browser and power-cycles it for each cartridge. Expected pixels and
PCM are calculated in the test; they are not recordings of this core's output.
Pixel comparisons cover every RGBA sample, including its position and alpha.
The 115-cartridge sweep allows up to 30 minutes per browser, including client-side
compilation, and logs bounded fixture progress during simulation.

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
| `apu-dsp-mirror-volume/flg/kon` | Repeated writes through DSPADDR `$8c/$ec/$cc` leave mirrored readback and the normal PCM waveform intact, including KON/FLG side effects. |
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

The APU register fixtures follow the independent bsnes
[SMP I/O implementation](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/smp/io.cpp)
and [timer implementation](https://github.com/bsnes-emu/bsnes/blob/master/bsnes/sfc/smp/timing.cpp).
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
