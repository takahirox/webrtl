import { boards } from "./output-contracts.js";
import { AudioOutput } from "./audio-output.js";

const ui = Object.fromEntries(
  ["source", "source-label", "compile", "status", "errors", "count", "run", "pause", "step", "reset", "diagnostics",
    "project", "files", "filename", "add-file", "rename-file", "remove-file", "import-files", "top", "example", "load-example",
    "interface", "frontend", "video", "audio-status", "timing", "run-help", "cpu-result", "cpu-trace",
    "cartridge-controls", "cartridge", "test-cartridge", "cartridge-status"]
    .map((id) => [id, document.getElementById(id)]),
);
const browser = document.documentElement.dataset.mode === "browser";
const projectTools = browser ? await import("./project.js") : null;
let files = {};
let activeFile = null;
const audio = new AudioOutput();
const canvas = ui.video.getContext("2d");
let selected = "counter";
let simulator = null;
let timer = null;
let busy = true;
let advancing = false;
let runEpoch = 0;
let cartridgeData = null;
let cartridgeLoaded = false;
let keyboardButtons = 0;
let frames = 0, runningCycles = 0, runningMs = 0;
const audioBoard = () => selected === "audio" || selected === "snes";
const keyBits = { KeyZ: 11, KeyA: 10, ShiftLeft: 9, ShiftRight: 9, Enter: 8,
  ArrowUp: 7, ArrowDown: 6, ArrowLeft: 5, ArrowRight: 4, KeyX: 3, KeyS: 2, KeyQ: 1, KeyW: 0 };
function controllerButtons() {
  let result = keyboardButtons;
  const pad = Array.from(navigator.getGamepads?.() || []).find((pad) => pad?.mapping === "standard");
  if (pad) {
    const map = [11, 3, 10, 2, 1, 0, null, null, 9, 8, null, null, 7, 6, 5, 4];
    map.forEach((bit, index) => { if (bit !== null && pad.buttons[index]?.pressed) result |= 1 << bit; });
    if (pad.axes[0] < -0.5) result |= 1 << 5;
    if (pad.axes[0] > 0.5) result |= 1 << 4;
    if (pad.axes[1] < -0.5) result |= 1 << 7;
    if (pad.axes[1] > 0.5) result |= 1 << 6;
  }
  return result;
}
for (const type of ["keydown", "keyup"]) ui.video.addEventListener(type, (event) => {
  const bit = keyBits[event.code];
  if (selected !== "snes" || bit === undefined) return;
  event.preventDefault();
  if (type === "keydown") keyboardButtons |= 1 << bit;
  else keyboardButtons &= ~(1 << bit);
});
ui.video.addEventListener("blur", () => { keyboardButtons = 0; });

function controls() {
  ui.compile.disabled = busy;
  ui.source.disabled = busy || (browser && !activeFile);
  ui.project.disabled = busy;
  ui["rename-file"].disabled = !activeFile;
  ui["remove-file"].disabled = !activeFile;
  ui.run.disabled = busy || !simulator || advancing || timer !== null || (selected === "snes" && !cartridgeLoaded);
  ui.pause.disabled = timer === null;
  ui.step.disabled = busy || !simulator || advancing || timer !== null || (selected === "snes" && !cartridgeLoaded);
  ui.reset.disabled = busy || !simulator || advancing;
  ui["cartridge-controls"].disabled = busy || !simulator || advancing;
}

function pause() {
  clearTimeout(timer);
  timer = null;
  runEpoch++;
  audio.clear();
  controls();
}

function clearOutput() {
  frames = 0; runningCycles = 0; runningMs = 0;
  canvas.clearRect(0, 0, ui.video.width, ui.video.height);
  ui.timing.textContent = "0 cycles · 0.000 simulated seconds";
  ui["cpu-result"].textContent = "—";
  ui["cpu-trace"].textContent = "";
}

function discard() {
  pause();
  audio.close();
  if (simulator) {
    try { simulator._sim_destroy(); } catch { /* An aborted module may already be unusable. */ }
  }
  simulator = null;
  cartridgeLoaded = false;
  advancing = false;
  ui.count.textContent = "—";
  clearOutput();
  controls();
}

function showError(error) {
  discard();
  ui.errors.textContent = error.message;
  ui.errors.hidden = false;
  ui.status.textContent = "Failed. Fix the source or toolchain and compile again.";
}

function projectChanged() {
  discard();
  ui.errors.hidden = true;
  ui.diagnostics.textContent = "";
  ui.status.textContent = "Source or project changed. Compile to simulate this version.";
}

function selectInterface(board) {
  selected = board;
  ui.interface.value = board;
  ui.video.hidden = board !== "video" && board !== "snes";
  ui.video.width = boards[board].width || 64;
  ui.video.height = board === "snes" ? 224 : boards[board].height || 48;
  ui.video.style.aspectRatio = board === "snes" ? "8 / 7" : "";
  ui["cartridge-controls"].hidden = board !== "snes";
  ui["audio-status"].hidden = !audioBoard();
  ui["audio-status"].textContent = "Click Run to enable audio. Step advances silently.";
  ui.timing.hidden = board === "counter";
  ui.count.parentElement.hidden = board !== "counter";
  ui["cpu-result"].parentElement.hidden = board !== "cpu816";
  ui["cpu-trace"].parentElement.hidden = board !== "cpu816";
  ui["run-help"].textContent = board === "counter" ? "Step = one full clock cycle. Run = 10 cycles per second." :
    board === "cpu816" ? "Step = one CPU clock. Run = 10,000 clocks per second. A result freezes the CPU until Reset." :
    `Step = one clock cycle (silent). Run batches ${boards[board].batchCycles} cycles at a target ${boards[board].clockHz} simulated clocks/s.`;
}

function selectFile(name) {
  activeFile = name;
  ui.files.value = name || "";
  ui.source.value = name ? files[name] : "";
  ui.filename.value = name || "";
  ui["source-label"].textContent = name ? `Verilog source · ${name}` : "Verilog source · no files";
  controls();
}

function refreshFiles(name) {
  ui.files.replaceChildren(...Object.keys(files).map((filename) => new Option(filename, filename)));
  selectFile(name);
}

// File-operation errors leave the project (and any running circuit) intact.
function projectError(error) {
  ui.errors.textContent = error.message;
  ui.errors.hidden = false;
}

function checkNewName(name, names = Object.keys(files)) {
  projectTools.validateFilename(name);
  if (names.includes(name)) throw new Error(`Source file "${name}" already exists. Choose another filename; existing files are never overwritten.`);
}

if (browser) {
  ui.files.addEventListener("change", () => selectFile(ui.files.value));
  ui.top.addEventListener("input", projectChanged);
  ui.frontend.addEventListener("change", projectChanged);
  ui.interface.addEventListener("change", () => {
    projectChanged();
    selectInterface(ui.interface.value);
  });
  ui["add-file"].addEventListener("click", () => {
    try {
      const name = ui.filename.value;
      checkNewName(name);
      files[name] = "";
      projectChanged();
      refreshFiles(name);
    } catch (error) { projectError(error); }
  });
  ui["rename-file"].addEventListener("click", () => {
    try {
      const name = ui.filename.value;
      if (name === activeFile) return;
      checkNewName(name);
      files = Object.fromEntries(Object.entries(files).map(([key, source]) => [key === activeFile ? name : key, source]));
      projectChanged();
      refreshFiles(name);
    } catch (error) { projectError(error); }
  });
  ui["remove-file"].addEventListener("click", () => {
    delete files[activeFile];
    projectChanged();
    refreshFiles(Object.keys(files)[0] || null);
  });
  ui["import-files"].addEventListener("change", async () => {
    const imported = Array.from(ui["import-files"].files);
    if (!imported.length) return;
    busy = true;
    controls();
    try {
      const names = Object.keys(files);
      for (const file of imported) {
        checkNewName(file.name, names);
        names.push(file.name);
      }
      // Reject oversized imports before reading their contents into memory.
      const currentSize = Object.values(files).reduce((size, source) => size + new TextEncoder().encode(source).length, 0);
      if (currentSize + imported.reduce((size, file) => size + file.size, 0) > projectTools.sourceLimit(ui.frontend.value)) {
        throw new Error(`Import exceeds the ${ui.frontend.value === "slang" ? "2 MiB" : "128 KiB"} total project limit. Remove files or select smaller sources.`);
      }
      const additions = await Promise.all(imported.map(async (file) => [file.name, await file.text()]));
      const updated = { ...files, ...Object.fromEntries(additions) };
      projectTools.validateSize(updated, ui.frontend.value);
      files = updated;
      projectChanged();
      refreshFiles(imported[0].name);
    } catch (error) { projectError(error); }
    finally {
      ui["import-files"].value = "";
      busy = false;
      controls();
    }
  });
  ui["load-example"].addEventListener("click", async () => {
    busy = true;
    controls();
    try {
      const example = ui.example.value;
      const board = ["backdrop", "bg1"].includes(example) ? "video" :
        ["single", "split", "bus"].includes(example) ? "counter" : example;
      const split = example === "split";
      const sources = example === "snes" ? ["snes.v", "snes-core.v"].map((name) => [name, `./examples/snes/${name}`])
        : ["backdrop", "bg1"].includes(example)
        ? [
          ...(example === "bg1"
            ? ["cpu816-bg1.v", "bg1-ppu.v", "bg1-rom.v", "bg1-scanout.v"]
            : ["cpu816-backdrop.v", "backdrop-ppu.v", "backdrop-rom.v", "backdrop-scanout.v"])
            .map((name) => [name, `./examples/cpu816-${example}/${name}`]),
          ...["P65C816_pkg.v", "P65C816.v", "mcode.v", "AddrGen.v", "ALU.v",
            "AddSubBCD.v", "BCDAdder.v", "adder4.v", "bit_adder.v"]
            .map((name) => [name, `./examples/cpu816/${name}`]),
        ]
        : example === "cpu816"
        ? ["cpu816-test.v", "cpu816-memory.v", "cpu816-rom.v", "P65C816_pkg.v", "P65C816.v", "mcode.v",
          "AddrGen.v", "ALU.v", "AddSubBCD.v", "BCDAdder.v", "adder4.v", "bit_adder.v"]
          .map((name) => [name, `./examples/cpu816/${name}`])
        : example === "bus"
        ? ["bus-test.v", "bus-master.v", "bus-rom.v", "bus-ram.v", "bus-decoder.v"]
          .map((name) => [name, `./examples/cpu-bus/${name}`])
        : split
        ? [["split-counter.v", "./examples/split-counter/split-counter.v"], ["counter-next.v", "./examples/split-counter/counter-next.v"]]
        : [[`${board}.v`, board === "counter" ? "./example.v" : `./examples/${board}.v`]];
      const entries = await Promise.all(sources.map(async ([name, url]) => [name, await loadSource(url)]));
      files = Object.fromEntries(entries);
      ui.frontend.value = example === "snes" ? "slang" : "verilog";
      ui.top.value = example === "bg1" ? "cpu816_bg1" : example === "backdrop" ? "cpu816_backdrop" : example === "bus" ? "bus_test" : split ? "split_counter" : boards[board].top;
      projectChanged();
      selectInterface(board);
      refreshFiles(entries[0][0]);
    } catch (error) { projectError(error); }
    finally { busy = false; controls(); }
  });
}

async function loadSimulator(moduleUrl) {
  const { default: createSimulator } = await import(moduleUrl);
  simulator = await createSimulator();
  simulator._sim_init();
}

async function simulate(action, playAudio = false) {
  if (advancing || !simulator) return;
  const active = simulator;
  const epoch = runEpoch;
  advancing = true;
  controls();
  try {
    const started = performance.now();
    const before = active._sim_output?.()?.cycles || 0;
    // Native simulation completes inline; only worker requests need to yield.
    const result = action();
    if (result instanceof Promise) await result;
    if (simulator !== active || epoch !== runEpoch) return;
    ui.count.textContent = active._sim_count();
    const output = active._sim_output?.();
    if (output) {
      ui.timing.textContent = `${output.cycles} cycles · ${output.seconds.toFixed(3)} simulated seconds`;
      if (selected === "snes") {
        const completed = Math.max(0, output.cycles - before);
        if (completed) {
          runningMs += performance.now() - started;
          runningCycles += completed;
        }
        if (output.frame) frames++;
        const rate = runningCycles / Math.max(0.001, runningMs / 1000);
        ui.timing.textContent += ` · ${Math.round(rate)} clocks/s · ${(frames / Math.max(0.001, runningMs / 1000)).toFixed(2)} frames/s · ${(rate / boards.snes.clockHz).toFixed(4)}× real time`;
      }
      if (selected === "cpu816") showCpuOutput(output);
      if (output.frame) {
        if (ui.video.width !== output.width || ui.video.height !== output.height) {
          ui.video.width = output.width; ui.video.height = output.height;
        }
        canvas.putImageData(new ImageData(output.frame, output.width, output.height), 0, 0);
      }
      if (playAudio && audioBoard()) {
        try { audio.play(output.audio, boards[selected].sampleRate); }
        catch (error) {
          pause();
          ui["audio-status"].textContent = `${error.message} Click Run to retry.`;
          ui.status.textContent = "Audio unavailable. Paused; the compiled circuit is preserved.";
        }
      }
    }
  } catch (error) {
    if (simulator === active) showError(error);
  } finally {
    if (simulator === active) { advancing = false; controls(); }
  }
}

function showCpuOutput(output) {
  ui["cpu-result"].textContent = output.count === 1 ? "PASS" : output.count === 255 ? "FAIL" : `Running (${output.count})`;
  if (!output.trace?.length) return;
  const hex = (value, width) => value.toString(16).padStart(width, "0");
  const lines = ui["cpu-trace"].textContent.split("\n").filter(Boolean);
  for (let i = 0; i < output.trace.length; i += 4) {
    const [cycle, address, data, flags] = output.trace.slice(i, i + 4);
    lines.push(`${cycle}: ${hex(address, 6)} ${flags & 1 ? "W" : "R"} ${hex(data, 2)} VPA=${(flags >> 2) & 1} VDA=${(flags >> 1) & 1}`);
  }
  ui["cpu-trace"].textContent = lines.slice(-128).join("\n");
}

ui.compile.addEventListener("click", async () => {
  discard();
  busy = true;
  controls();
  ui.errors.hidden = true;
  ui.diagnostics.textContent = "";
  ui.status.textContent = browser ? "Loading browser compiler…" : "Compiling with Verilator and Emscripten…";
  try {
    if (browser) {
      const { compileBrowser } = await import("./browser-client.js");
      simulator = await compileBrowser(
        { files, top: ui.top.value, board: selected, frontend: ui.frontend.value },
        (progress) => { ui.status.textContent = progress; },
      );
      ui.diagnostics.textContent = simulator.diagnostics;
      if (selected === "snes" && cartridgeData) {
        await simulator._sim_cartridge(cartridgeData);
        cartridgeLoaded = true;
      }
    } else {
      const response = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: ui.source.value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Build failed.");
      await loadSimulator(result.moduleUrl);
    }
    ui.count.textContent = simulator._sim_count();
    if (selected === "cpu816") showCpuOutput(simulator._sim_output());
    ui.status.textContent = "Ready. The compiled circuit is reset.";
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    controls();
  }
});

ui.step.addEventListener("click", () => simulate(() => simulator._sim_step()));
async function loadCartridge(bytes, name) {
  const { parseCartridge } = await import("./snes-rom.js");
  const parsed = parseCartridge(bytes);
  pause();
  busy = true;
  controls();
  ui.status.textContent = "Loading cartridge…";
  try {
    await simulator._sim_cartridge(parsed.bytes);
    cartridgeData = parsed.bytes;
    cartridgeLoaded = true;
    clearOutput();
    ui["cartridge-status"].textContent = `${name} · ${parsed.bytes.length} bytes · ${parsed.hirom ? "HiROM" : "LoROM"} · loaded locally. Click Run.`;
    ui.status.textContent = "Cartridge loaded. Reset and paused.";
  } catch (error) {
    showError(error);
    throw error;
  } finally { busy = false; controls(); }
}
ui.cartridge.addEventListener("change", async () => {
  const file = ui.cartridge.files[0];
  if (!file) return;
  try {
    if (file.size > 4194816) throw new Error("Cartridge exceeds the 4 MiB ROM limit.");
    await loadCartridge(await file.arrayBuffer(), file.name);
  } catch (error) { projectError(error); }
  finally { ui.cartridge.value = ""; }
});
ui["test-cartridge"].addEventListener("click", async () => {
  try {
    const response = await fetch("./examples/snes/test.sfc");
    if (!response.ok) throw new Error("Could not load the original test cartridge.");
    await loadCartridge(await response.arrayBuffer(), "WebRTL original test");
  } catch (error) { projectError(error); }
});
ui.run.addEventListener("click", async () => {
  const epoch = ++runEpoch;
  timer = 0;
  controls();
  if (audioBoard()) {
    try {
      await audio.unlock();
      if (epoch !== runEpoch) return;
      ui["audio-status"].textContent = `Playing RTL PCM · mono, signed 16-bit, ${boards[selected].sampleRate} samples/s.`;
    } catch (error) {
      if (epoch !== runEpoch) return;
      pause();
      ui["audio-status"].textContent = `${error.message} Allow sound and click Run to retry.`;
      ui.status.textContent = "Audio unavailable. Paused; the compiled circuit is preserved.";
      return;
    }
  }
  ui.status.textContent = "Running the compiled circuit.";
  const board = boards[selected];
  const advance = async () => {
    if (epoch !== runEpoch) return;
    if (audioBoard() && audio.context?.state !== "running") {
      pause();
      ui["audio-status"].textContent = "Audio was suspended. Allow sound for this site and click Run again.";
      ui.status.textContent = "Audio unavailable. Paused; the compiled circuit is preserved.";
      return;
    }
    const start = performance.now();
    // AudioContext's clock paces audio; slow simulation underruns with silence.
    if (!audioBoard() || audio.queuedSeconds() < 0.10) {
      await simulate(() => browser ? simulator._sim_batch(board.batchCycles, controllerButtons()) : simulator._sim_step(), true);
    }
    if (epoch !== runEpoch) return;
    const delay = selected === "audio" ? 10 : Math.max(0, 1000 * board.batchCycles / board.clockHz - (performance.now() - start));
    timer = setTimeout(advance, delay);
  };
  timer = setTimeout(advance, selected === "counter" ? 100 : 0);
});
ui.pause.addEventListener("click", () => {
  pause();
  ui.status.textContent = "Paused. Pending audio cleared.";
});
ui.reset.addEventListener("click", () => {
  pause();
  clearOutput();
  ui.status.textContent = "Reset. Paused.";
  simulate(() => simulator._sim_reset());
});
ui.source.addEventListener("input", () => {
  if (browser && activeFile) files[activeFile] = ui.source.value;
  projectChanged();
});
window.addEventListener("pagehide", discard);

async function loadSource(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load example source ${url}. Retry loading the example.`);
  return response.text();
}

try {
  const source = await loadSource("./example.v");
  if (browser) {
    files = { "counter.v": source };
    refreshFiles("counter.v");
  } else ui.source.value = source;
  ui.status.textContent = "Edit the example or compile it as is.";
} catch (error) {
  showError(error);
}
busy = false;
controls();
