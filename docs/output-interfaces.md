# Browser RTL video and audio

The static browser compiler supports Counter, Video, Audio, a focused
[65C816 result/bus-trace interface](cpu816.md#adapter-bounds-and-performance),
and an experimental [SNES board contract](snes.md#architecture-and-actual-interfaces).
Select an example above the editor, click **Load example
(replaces project)**, **Compile**, then **Run**. Loading an example replaces all
project files and selects its top module and output interface. The project stays
in memory until reload; switching source files preserves edits. The
trusted-local Verilator service continues to support the counter only.

These are reusable RTL contracts, not JavaScript generators. Write any
synthesizable design with the selected interface's exact ports below, using one
or more source files and any valid **Top module** name. **Output interface** can
be changed independently of the example and top; changing it discards the old
simulation but preserves all project sources. The compiler checks port
names, directions and widths before compiling the C++ adapter, plus signedness
with the legacy Verilog frontend (Slang omits that port metadata).
Video and Audio remain separate selectable interfaces. The SNES board adds a fixed
combined video/audio, cartridge and controller contract; arbitrary pin mapping
and configurable resolutions/rates remain outside this small board API.

## Clock and reset shared by all boards

Each top has unsigned scalar inputs `clk` and `reset`. One Step evaluates low →
high → low, settling the CXXRTL model at each transition. Outputs are captured
**after the rising edge settles**, before the falling edge. Use synthesizable
rising-edge logic. Reset asserts active-high `reset` for one complete cycle and
then deasserts/settles it. That reset cycle is not included in the displayed
simulation time and its output is discarded. Initialize all state in RTL; the
adapter does not generate pixels or PCM or impose your circuit's reset values.
The SNES board additionally clocks a RAM scrub and supports a power-cycle Reset
that reloads the cartridge; see its separate contract.

| Interface / example top | Simulated clock | Run request size | Output |
| --- | ---: | ---: | --- |
| Counter / `counter` | 10 Hz | 1 cycle | unsigned `count[7:0]` |
| 65C816 / `cpu816_test` | 10000 Hz | 256 cycles | RTL result and bounded bus trace; see [CPU guide](cpu816.md) |
| Video / `video` | 184320 Hz | 3072 cycles (1/60 simulated second) | 64 × 48 RGB888 frames |
| Audio / `audio` | 48000 Hz | 3072 cycles (64 simulated ms) | mono signed PCM16 at 8000 samples/s |
| SNES / `snes` | 21477270 Hz | 16384 cycles | up to 512 × 478 RGB frames, 32000 samples/s PCM, inputs and cartridge; see [SNES guide](snes.md) |

The Counter interface can also display an 8-bit RTL result register. The
[CPU bus self-test](cpu-bus.md) uses it to show ROM/RAM transaction bytes,
then 1 for PASS or 255 for FAIL, without adding another output adapter.

These clock rates define simulation time (`completed cycles / clock Hz`), not
an assertion that a JavaScript timer or a large circuit can run in real time.
The shared definitions are in [output-contracts.js](../web/output-contracts.js).
Changing resolution/rate requires updating that contract and the adapter together;
changing image contents or tone pitch needs only an RTL edit and recompile.

## Video ports and framing

In addition to `clk` and `reset`, a Video top has these unsigned outputs:

| Port | Width | Meaning at each rising edge |
| --- | ---: | --- |
| `video_valid` | 1 | Capture one pixel when high; otherwise ignore all video outputs |
| `video_x` | 6 | Column 0–63 |
| `video_y` | 6 | Row 0–47 (values 48–63 are invalid and stop simulation) |
| `video_rgb` | 24 | Red in bits 23:16, green in 15:8, blue in 7:0 |
| `video_last` | 1 | This valid pixel completes the frame, including this pixel |

Emit every desired pixel, then mark the final pixel with `video_last`. Raster
order is conventional but not required: coordinates address the frame directly;
repeated writes replace that pixel. `video_last` is ignored when valid is low.
A drawing buffer starts cleared after reset and after each completed frame.
Pixels omitted from a frame remain transparent (black against the canvas).
Only completed frames reach the UI. A stalled or partial frame leaves the previous
complete frame visible; a batch containing several complete frames sends only
the latest one. No sync waveform or blanking intervals are emulated.

[video.v](../examples/video.v) emits four vertical color bars, one pixel per clock,
3072 cycles/frame, or 60 frames per simulated second. Change `24'hff0000` to
`24'h804020`, recompile, and Run: the left bar becomes brown. These colors are
computed by the compiled RTL. JavaScript only copies the received RGBA bytes to
Canvas and scales the image with nearest-neighbor display.

The selectable [65C816 PPU backdrop example](cpu816-backdrop.md) uses this same
Video contract. A real CPU program writes a minimal PPU register subset, and RTL
scanout snapshots CGRAM word 0 for each solid frame. The first frame is forced
blank; the next shows the programmed color. Edit the ROM and recompile to change
it. The CPU, PPU and scanout share the Video clock; there is no separate renderer.

## Audio ports and sample timing

In addition to `clk` and `reset`, an Audio top has these outputs:

| Port | Width / type | Meaning at each rising edge |
| --- | --- | --- |
| `audio_valid` | unsigned scalar | Capture a PCM sample when high |
| `audio_sample` | **signed** 16-bit | Two's-complement mono PCM, −32768 to 32767 |

For this board's 48000 Hz simulated clock, emit exactly one valid sample every
six cycles, starting on the sixth cycle after reset. Hold valid low during the
other five cycles. This establishes the declared 8000 Hz sample rate. The host
captures only valid samples and plays them at 8000 Hz; it does not infer a rate
from timers, insert samples during invalid cycles, or validate your RTL's divider.
Violating this cadence changes the relationship between simulation and playback
time. To represent silence without changing time, emit valid samples equal to 0.

[audio.v](../examples/audio.v) implements the six-cycle divider and emits ten
samples of +8192 followed by ten of −8192: a 400 Hz square wave at one-quarter
full scale. Change both amplitudes to ±4096 and change the phase threshold/end
from 10/19 to 5/9: the resulting 800 Hz tone has half the amplitude. Recompile
and Run to hear the change. Neither the adapter nor JavaScript contains a tone
oscillator or pattern fallback.

PCM crosses Wasm/worker boundaries as an `Int16Array`. Web Audio receives one
channel of floats computed as `sample / 32768`. Each 512-sample Run batch becomes
an `AudioBuffer` with its explicit source sample rate; Web Audio resamples for the
output device. Buffered `AudioBufferSourceNode`s connect to the real destination
and are scheduled using `AudioContext.currentTime`, with a 20 ms startup margin.
See the [Web Audio buffer source reference](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode).

## Playback controls, permissions, and lifecycle

- **Run** advances bounded batches. Debug targets 60 video frames/s; Fast runs
  video as quickly as practical. See [simulation modes](simulation-modes.md). Audio production
  follows the audio device clock: request a new batch when less than 100 ms is
  scheduled, with a hard 250 ms queue cap. If the cap would be exceeded, that
  batch is dropped. There is no growing backlog or catch-up loop.
- Audio is unlocked directly by the **Run click gesture**. No autoplay, microphone
  access, or recording permission is used. Browsers may block sound through site
  settings; allow sound and click Run again. Unsupported Web Audio, rejected or
  stalled unlock (5 s), and later suspension pause playback with a retry message
  while preserving the compiled circuit. See [browser audio policy guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices#autoplay_policy).
- **Pause** stops new requests and immediately stops/disconnects queued sound.
  A bounded in-flight batch finishes; the UI acknowledges its actual cycle and
  consumes its final frame, while dropping its pending playback audio. The complete
  circuit state and partial drawing buffer remain live for mode handoff. Resume
  continues from that boundary with a fresh audio queue. Played samples are never
  replayed; inspection/mode replies never redeliver old media.
- **Step** advances exactly one cycle and is silent, even for Audio. A Video Step
  updates the canvas only if that edge completes a frame.
- **Reset** pauses, clocks RTL reset, clears partial/completed frames and queued
  audio, and returns displayed simulated time to zero. Editing, loading an
  example, changing the top or interface, compiling again, leaving the page, and
  simulation errors also discard pending output. Compilation/editing closes the
  previous audio context.
- Compiler/runtime errors appear below the editor. Runtime faults discard the
  worker; fix the design and recompile. The existing 120 s compiler deadline,
  10 s simulation watchdog, and 64 MiB Wasm memory maximum still apply.

## Transfer bounds and performance

The UI permits only one simulation request in flight and consumes its output
before requesting more. Each request is limited to 16384 cycles. C++ batches
clocking and output capture inside Wasm, using two fixed 12288-byte video buffers
and a 16384-element PCM16 buffer.
The worker copies at most one complete frame and one PCM batch out of Wasm and
transfers ownership of their ArrayBuffers to the UI. There is no per-pixel/sample
UI request, unbounded worker queue, SharedArrayBuffer, or external service.

Desktop Chromium and Firefox are covered by the static Playwright suite, including
real Web Audio processing. Recent desktop browsers need Canvas 2D, Web Audio,
module workers, and the browser compiler's Wasm features. Safari/WebKit and mobile
remain unvalidated. Background timer throttling or slow circuits can freeze video
or cause audio gaps. Underruns produce silence, not synthetic replacement samples;
simulation time still advances by completed cycles. This is a small graphics/sound
proof of the browser pipeline, with no large-design real-time guarantee and no
SNES, ROM, DAC, HDMI, GPU, or cycle-accurate physical-device emulation.

## Reproducible validation

Run `npm run test:demo` after installing the dependencies and Playwright browsers
as described in [README](../README.md#validation). The suite serves the exact
static artifact under `/webrtl/` in Chromium and Firefox. It compiles the examples
and edited versions using real Yosys/Clang, checks canvas RGB values and complete
frame timing, checks exact signed samples and six-cycle validity spacing, observes
PCM entering the real Web Audio graph and a nonzero rendered waveform, verifies
queue/transfer bounds, exercises unlock failure/retry and Run/Pause/Reset/edit,
and retains the original counter regression suite. No generated circuit or
browser output generator is substituted.

For a manual check, compile/run Video and change its first color as above; then
compile/run Audio and change amplitude/phase as above. Pause must silence queued
audio immediately; Reset must clear the canvas/time and restart RTL state.

**Required post-merge verification for #10 — pending:** after deployment, open
<https://takahirox.github.io/webrtl/>, load and compile Video, verify the visible
pattern, then load and compile Audio and verify audible sound after clicking Run.
Record the browser, actual public-site results, and any failures separately.
Local pre-merge checks do not establish that publication succeeded.
