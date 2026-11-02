// The same conservative selection runs on EVERY PR, including broad changes.
// Never derive this selection from a caller's WEBRTL_SNES_FIXTURES expression.
const snesTitle = "SNES PR smoke compiles the complete console and checks cartridge pixels, DSP, input and reset";
const genericTitles = Object.freeze([
  "serves this checkout's UI, SNES sources and cartridge under /webrtl/",
  "loads the SNES project and compiles an edited counter into fresh browser Wasm",
  "workspace keeps editing central, reflows panes and exposes compilation failures",
  "mode controls inspect/stop, pause a pending Fast batch, reset and recompile",
  "scheduled RTL matches reference registers, RAM and inputs at every handoff boundary",
  "unsupported scheduled transitions report fallback and retain the paused circuit",
  "transient asynchronous reset pulses use reference fallback across Fast/Debug handoff",
  "generic RTL retains RAM, both clock edges and inputs through Fast/Debug handoff",
  "falling-edge outputs settle before inspection, history, conditions and mode handoff",
  "clock-triggered asynchronous cascades settle across Fast/Debug capture and conditions",
  "inspection formats high-bit-set 32-bit and multiword inputs, registers and RAM as unsigned hex",
  "video frames come from edited RTL, with precise framing and clean controls",
  "PCM originates in RTL, plays through Web Audio, and clears on Pause/Reset/edit",
]);
module.exports = { snesTitle, genericTitles };
