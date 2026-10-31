import { boards } from "./output-contracts.js";
import { parseCartridge } from "./snes-rom.js";

// One request produces at most one frame and 16384 PCM samples. The UI only
// issues another request after consuming the previous reply (backpressure).
let simulator;
let circuitModule;
let board, boardName;
let cycles = 0;
let mode = "fast", catalog, selection = [], history = [], checkpoint;
let build, session, generation = 0, inputState = {}, cartridgeIdentity = null;
const decoder = new TextDecoder();
function discover() {
  if (catalog) return catalog;
  catalog = Array.from({ length: simulator.sim_debug_count() }, (_, id) => {
    const ptr = simulator.sim_debug_name(id);
    const bytes = new Uint8Array(simulator.memory.buffer);
    const name = decoder.decode(bytes.subarray(ptr, bytes.indexOf(0, ptr)));
    return { id, name, width: simulator.sim_debug_width(id), depth: simulator.sim_debug_depth(id),
      flags: simulator.sim_debug_flags(id), type: simulator.sim_debug_type(id),
      lsb: simulator.sim_debug_lsb(id), zero: simulator.sim_debug_zero(id) };
  });
  return catalog;
}
function signal(ref, narrow = false) {
  const item = discover()[ref?.id];
  if (!item || !Number.isInteger(ref.row ?? 0) || (ref.row ?? 0) < 0 || (ref.row ?? 0) >= item.depth ||
      (narrow && (item.width < 1 || item.width > 32))) throw new Error("Invalid signal/row; trace and conditions support at most 32 bits per part.");
  return item;
}
function inspect(ref) {
  const item = signal(ref);
  const words = Array.from({ length: Math.ceil(item.width / 32) }, (_, word) =>
    simulator.sim_debug_read(item.id, ref.row ?? 0, word));
  return { ...ref, hex: words.reverse().map((v) => v.toString(16).padStart(8, "0")).join("").slice(-Math.ceil(item.width / 4)) };
}
function retain() {
  // This is a live-state capability, not a serialized memory dump or rewind.
  return checkpoint = { format: "webrtl-live-state", version: 1, backend: "cxxrtl", build,
    session, generation, cycles, phase: "settled-low", initialized: true,
    retention: "shared-live-model", inputs: { ...inputState }, cartridge: cartridgeIdentity,
    media: "pending-playback-cleared", trace: "bounded-forward-history", token: crypto.randomUUID() };
}
function validateCheckpoint(value) {
  if (!checkpoint || JSON.stringify(value) !== JSON.stringify(checkpoint))
    throw new Error("Incompatible or expired live snapshot: only the same paused model, build and generation can resume; serialized/cross-backend restore is unsupported.");
}

self.onmessage = async ({ data: { id, action, wasm, board: requestedBoard, batchCycles, cartridge, offset, bytes, buttons,
    mode: requestedMode, signals, breakpoint, inputs, snapshot, refs } }) => {
  const selected = requestedBoard ?? boardName;
  let extra = {}, advanced = false;
  const started = performance.now();
  try {
    if (action !== "init" && (!simulator || boards[selected] !== board)) throw new Error("Simulator is not initialized for this output interface.");
    if (action === "init" || action === "power-reset") {
      board = boards[selected];
      boardName = selected;
      if (!board) throw new Error("Unknown output interface.");
      if (action === "power-reset" && (selected !== "snes" || !circuitModule)) throw new Error("Power reset requires a compiled SNES board.");
      const unavailable = () => { throw new Error("Circuit attempted unsupported WASI I/O."); };
      if (action === "init") {
        circuitModule = await WebAssembly.compile(wasm);
        build = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", wasm))).map((v) => v.toString(16).padStart(2, "0")).join("");
        session = crypto.randomUUID(); mode = "fast";
      }
      catalog = null; history = []; selection = []; checkpoint = null; inputState = {}; cartridgeIdentity = null;
      generation++;
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
      if (selected === "snes" && buttons !== undefined) {
        if (!Number.isInteger(buttons) || buttons < 0 || buttons > 4095) throw new Error("Invalid controller buttons.");
        simulator.sim_buttons(buttons); inputState.buttons = `0x${buttons.toString(16)}`;
      }
      const completed = mode === "debug" ? simulator.sim_debug_batch(count) : (simulator.sim_batch(count), count);
      cycles += completed;
      advanced = true; checkpoint = null;
      if (mode === "debug") {
        const total = simulator.sim_debug_history_count();
        const words = new Uint32Array(simulator.memory.buffer, simulator.sim_debug_history(), 256 * 17);
        for (let i = Math.max(0, total - 256); i < total; ++i) {
          const slot = (i % 256) * 17;
          history.push({ cycle: cycles - completed + ((words[slot] - ((cycles - completed) >>> 0)) >>> 0), values: Array.from(words.subarray(slot + 1, slot + 1 + selection.length)) });
        }
        history = history.slice(-256);
        extra = { history, hit: Boolean(simulator.sim_debug_hit()) };
        if (extra.hit) extra.snapshot = retain();
      }
    } else if (action === "cartridge") {
      if (selected !== "snes") throw new Error("Cartridge loading requires the SNES board.");
      const parsed = parseCartridge(cartridge);
      simulator.sim_cart_config(parsed.hirom, parsed.mask, parsed.ramSize);
      cartridgeIdentity = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", parsed.bytes))).map((v) => v.toString(16).padStart(2, "0")).join("");
      checkpoint = null;
      // The client sends bounded chunks after this validation, then resets.
    } else if (action === "cartridge-chunk") {
      if (selected !== "snes" || !(bytes instanceof Uint8Array) || bytes.length > 16384 ||
          !Number.isInteger(offset) || offset < 0 || offset + bytes.length > 4194304) {
        throw new Error("Invalid cartridge chunk.");
      }
      checkpoint = null;
      for (let i = 0; i < bytes.length; ++i) simulator.sim_cart_byte(offset + i, bytes[i]);
    } else if (action === "reset") {
      simulator.sim_reset();
      cycles = 0; generation++; checkpoint = null; history = []; selection = [];
      simulator.sim_debug_clear();
      if (mode === "debug") extra.history = [];
      if (selected === "snes") inputState.buttons = "0x0";
    } else if (action === "pause") {
      extra.snapshot = retain();
    } else if (action === "mode") {
      if (!["fast", "debug"].includes(requestedMode)) throw new Error("Unknown simulation mode.");
      if (snapshot !== undefined) validateCheckpoint(snapshot);
      mode = requestedMode;
      extra.snapshot = retain();
      if (mode === "debug") extra.signals = discover();
    } else if (action === "discover") {
      if (mode !== "debug") throw new Error("Signal discovery requires Debug Mode.");
      extra.signals = discover();
    } else if (action === "inspect") {
      if (mode !== "debug" || !Array.isArray(refs) || refs.length > 256) throw new Error("Inspect at most 256 signal parts in Debug Mode.");
      extra.values = refs.map(inspect);
    } else if (action === "debug-config") {
      if (mode !== "debug" || !Array.isArray(signals) || signals.length > 16) throw new Error("Select at most 16 signal parts in Debug Mode.");
      signals.forEach((ref) => signal(ref, true));
      if (breakpoint) {
        const item = signal(breakpoint, true);
        if (!["value", "change", "rising", "falling"].includes(breakpoint.kind) ||
            (breakpoint.kind === "value" && (!Number.isInteger(breakpoint.value) || breakpoint.value < 0 || breakpoint.value >= 2 ** item.width)))
          throw new Error("Invalid breakpoint kind/value.");
      }
      simulator.sim_debug_clear(); history = []; selection = signals;
      for (const ref of signals) simulator.sim_debug_select(ref.id, ref.row ?? 0);
      if (breakpoint) simulator.sim_debug_break(breakpoint.id, breakpoint.row ?? 0,
        ["value", "change", "rising", "falling"].indexOf(breakpoint.kind), breakpoint.value ?? 0);
    } else if (action === "inputs") {
      if (!inputs || typeof inputs !== "object") throw new Error("Invalid inputs.");
      const changes = Object.entries(inputs).map(([name, value]) => {
        const parts = discover().filter((item) => item.name === name && (item.flags & 1));
        const item = parts.length === 1 ? parts[0] : null;
        if (!item || ["clk", "reset"].includes(name) || item.lsb !== 0 || item.depth !== 1 ||
            !/^0x[0-9a-f]+$/i.test(value) || BigInt(value) >= (1n << BigInt(item.width))) throw new Error(`Invalid unsigned hex input: ${name}.`);
        return { item, value };
      });
      for (const { item, value } of changes) {
        for (let word = 0; word < Math.ceil(item.width / 32); ++word)
          simulator.sim_debug_input(item.id, word, Number((BigInt(value) >> BigInt(word * 32)) & 0xffffffffn));
        inputState[item.name] = value;
      }
      simulator.sim_debug_settle(); checkpoint = null;
    } else throw new Error("Unknown simulator action.");
    const reply = { id, count: simulator.sim_count(), cycles, seconds: board.clockHz ? cycles / board.clockHz : 0,
      mode, elapsedMs: performance.now() - started, ...extra };
    if (selected === "snes") reply.memoryBytes = simulator.memory.buffer.byteLength;
    const transfers = [];
    if (selected === "cpu816" || selected === "snes") {
      reply.trace = new Uint32Array(simulator.memory.buffer, simulator.sim_trace(), (advanced && mode === "debug" ? simulator.sim_trace_count() : 0) * 4).slice();
      transfers.push(reply.trace.buffer);
    }
    if (advanced && simulator.sim_frame_ready()) {
      const height = selected === "snes" ? simulator.sim_video_height() : board.height;
      if (height < 1 || height > board.height) throw new Error("Invalid video height.");
      reply.width = board.width; reply.height = height;
      reply.frame = new Uint8ClampedArray(simulator.memory.buffer, simulator.sim_frame(), board.width * height * 4).slice();
      transfers.push(reply.frame.buffer);
    }
    const length = advanced ? simulator.sim_audio_count() : 0;
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
