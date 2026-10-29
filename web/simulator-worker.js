import { boards } from "./output-contracts.js";
import { parseCartridge } from "./snes-rom.js";

// One request produces at most one frame and 16384 PCM samples. The UI only
// issues another request after consuming the previous reply (backpressure).
let simulator;
let circuitModule;
let board;
let cycles = 0;
self.onmessage = async ({ data: { id, action, wasm, board: selected, batchCycles, cartridge, offset, bytes, buttons } }) => {
  try {
    if (action === "init" || action === "power-reset") {
      board = boards[selected];
      if (!board) throw new Error("Unknown output interface.");
      if (action === "power-reset" && (selected !== "snes" || !circuitModule)) throw new Error("Power reset requires a compiled SNES board.");
      const unavailable = () => { throw new Error("Circuit attempted unsupported WASI I/O."); };
      if (action === "init") circuitModule = await WebAssembly.compile(wasm);
      const instance = await WebAssembly.instantiate(circuitModule, { wasi_snapshot_preview1: {
        fd_close: unavailable, fd_seek: unavailable, fd_write: unavailable,
      } });
      simulator = instance.exports;
      simulator._initialize();
      simulator.sim_reset();
      cycles = 0;
    } else if (action === "step" || action === "batch") {
      const count = action === "step" ? 1 : batchCycles;
      if (!Number.isInteger(count) || count < 1 || count > 16384) throw new Error("Invalid simulation batch size.");
      if (selected === "snes") simulator.sim_buttons((buttons || 0) & 4095);
      simulator.sim_batch(count);
      cycles += count;
    } else if (action === "cartridge") {
      if (selected !== "snes") throw new Error("Cartridge loading requires the SNES board.");
      const parsed = parseCartridge(cartridge);
      simulator.sim_cart_config(parsed.hirom, parsed.mask, parsed.ramSize);
      // The client sends bounded chunks after this validation, then resets.
    } else if (action === "cartridge-chunk") {
      if (selected !== "snes" || !(bytes instanceof Uint8Array) || bytes.length > 16384 ||
          !Number.isInteger(offset) || offset < 0 || offset + bytes.length > 4194304) {
        throw new Error("Invalid cartridge chunk.");
      }
      for (let i = 0; i < bytes.length; ++i) simulator.sim_cart_byte(offset + i, bytes[i]);
    } else if (action === "reset") {
      simulator.sim_reset();
      cycles = 0;
    } else throw new Error("Unknown simulator action.");
    const reply = { id, count: simulator.sim_count(), cycles, seconds: cycles / board.clockHz };
    if (selected === "snes") reply.memoryBytes = simulator.memory.buffer.byteLength;
    const transfers = [];
    if (selected === "cpu816" || selected === "snes") {
      reply.trace = new Uint32Array(simulator.memory.buffer, simulator.sim_trace(), simulator.sim_trace_count() * 4).slice();
      transfers.push(reply.trace.buffer);
    }
    if (simulator.sim_frame_ready()) {
      const height = selected === "snes" ? simulator.sim_video_height() : board.height;
      if (height < 1 || height > board.height) throw new Error("Invalid video height.");
      reply.width = board.width; reply.height = height;
      reply.frame = new Uint8ClampedArray(simulator.memory.buffer, simulator.sim_frame(), board.width * height * 4).slice();
      transfers.push(reply.frame.buffer);
    }
    const length = simulator.sim_audio_count();
    if (length) {
      reply.audio = new Int16Array(simulator.memory.buffer, simulator.sim_audio(), length).slice();
      transfers.push(reply.audio.buffer);
    }
    self.postMessage(reply, transfers);
  } catch (error) {
    self.postMessage({ id, error: error instanceof WebAssembly.RuntimeError
      ? `Circuit execution failed: ${error.message}. Check RTL coordinates and combinational logic.`
      : error.message });
  }
};
