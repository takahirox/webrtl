import { boards } from "./output-contracts.js";

// One request produces at most one frame and 16384 PCM samples. The UI only
// issues another request after consuming the previous reply (backpressure).
let simulator;
let board;
let cycles = 0;
self.onmessage = async ({ data: { id, action, wasm, board: selected, batchCycles } }) => {
  try {
    if (action === "init") {
      board = boards[selected];
      if (!board) throw new Error("Unknown output interface.");
      const unavailable = () => { throw new Error("Circuit attempted unsupported WASI I/O."); };
      const instance = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: {
        fd_close: unavailable, fd_seek: unavailable, fd_write: unavailable,
      } });
      simulator = instance.instance.exports;
      simulator._initialize();
      simulator.sim_reset();
      cycles = 0;
    } else if (action === "step" || action === "batch") {
      const count = action === "step" ? 1 : batchCycles;
      if (!Number.isInteger(count) || count < 1 || count > 16384) throw new Error("Invalid simulation batch size.");
      simulator.sim_batch(count);
      cycles += count;
    } else if (action === "reset") {
      simulator.sim_reset();
      cycles = 0;
    } else throw new Error("Unknown simulator action.");
    const reply = { id, count: simulator.sim_count(), cycles, seconds: cycles / board.clockHz };
    const transfers = [];
    if (simulator.sim_frame_ready()) {
      reply.frame = new Uint8ClampedArray(simulator.memory.buffer, simulator.sim_frame(), board.width * board.height * 4).slice();
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
