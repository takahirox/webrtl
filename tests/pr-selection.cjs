// The same conservative selection runs on EVERY PR, including broad changes.
// Never derive this list from a caller's WEBRTL_SNES_FIXTURES expression.
const snesFixtures = Object.freeze([
  "cpu-binary", "hdma-00", "apu-div-normal", "reject-mode5-as0",
]);
const genericTitles = Object.freeze([
  "serves this checkout's UI, SNES sources and cartridge under /webrtl/",
  "loads the SNES project and compiles an edited counter into fresh browser Wasm",
  "generic RTL retains RAM, both clock edges and inputs through Fast/Debug handoff",
  "falling-edge outputs settle before inspection, history, conditions and mode handoff",
  "clock-triggered asynchronous cascades settle across Fast/Debug capture and conditions",
  "inspection formats high-bit-set 32-bit and multiword inputs, registers and RAM as unsigned hex",
  "video frames come from edited RTL, with precise framing and clean controls",
  "PCM originates in RTL, plays through Web Audio, and clears on Pause/Reset/edit",
]);
module.exports = { snesFixtures, genericTitles };
