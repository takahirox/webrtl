import { boards } from "./output-contracts.js";
import { AudioOutput } from "./audio-output.js";

const ui = Object.fromEntries(
  ["source", "source-label", "compile", "status", "errors", "count", "run", "pause", "step", "reset", "diagnostics",
    "project", "files", "filename", "add-file", "rename-file", "remove-file", "import-files", "top", "example", "load-example",
    "interface", "video", "audio-status", "timing", "run-help"]
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

function controls() {
  ui.compile.disabled = busy;
  ui.source.disabled = busy || (browser && !activeFile);
  ui.project.disabled = busy;
  ui["rename-file"].disabled = !activeFile;
  ui["remove-file"].disabled = !activeFile;
  ui.run.disabled = !simulator || advancing || timer !== null;
  ui.pause.disabled = timer === null;
  ui.step.disabled = !simulator || advancing || timer !== null;
  ui.reset.disabled = !simulator || advancing;
}

function pause() {
  clearTimeout(timer);
  timer = null;
  runEpoch++;
  audio.clear();
  controls();
}

function clearOutput() {
  canvas.clearRect(0, 0, ui.video.width, ui.video.height);
  ui.timing.textContent = "0 cycles · 0.000 simulated seconds";
}

function discard() {
  pause();
  audio.close();
  if (simulator) {
    try { simulator._sim_destroy(); } catch { /* An aborted module may already be unusable. */ }
  }
  simulator = null;
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
  ui.video.hidden = board !== "video";
  ui["audio-status"].hidden = board !== "audio";
  ui["audio-status"].textContent = "Click Run to enable audio. Step advances silently.";
  ui.timing.hidden = board === "counter";
  ui.count.parentElement.hidden = board !== "counter";
  ui["run-help"].textContent = board === "counter" ? "Step = one full clock cycle. Run = 10 cycles per second." :
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
      if (currentSize + imported.reduce((size, file) => size + file.size, 0) > projectTools.MAX_SOURCE_BYTES) {
        throw new Error("Import exceeds the 64 KiB total project limit. Remove files or select smaller sources.");
      }
      const additions = await Promise.all(imported.map(async (file) => [file.name, await file.text()]));
      const updated = { ...files, ...Object.fromEntries(additions) };
      projectTools.validateSize(updated);
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
      const board = ["single", "split", "bus"].includes(example) ? "counter" : example;
      const split = example === "split";
      const sources = example === "bus"
        ? ["bus-test.v", "bus-master.v", "bus-rom.v", "bus-ram.v", "bus-decoder.v"]
          .map((name) => [name, `./examples/cpu-bus/${name}`])
        : split
        ? [["split-counter.v", "./examples/split-counter/split-counter.v"], ["counter-next.v", "./examples/split-counter/counter-next.v"]]
        : [[`${board}.v`, board === "counter" ? "./example.v" : `./examples/${board}.v`]];
      const entries = await Promise.all(sources.map(async ([name, url]) => [name, await loadSource(url)]));
      files = Object.fromEntries(entries);
      ui.top.value = example === "bus" ? "bus_test" : split ? "split_counter" : boards[board].top;
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
    // Native simulation completes inline; only worker requests need to yield.
    const result = action();
    if (result instanceof Promise) await result;
    if (simulator !== active || epoch !== runEpoch) return;
    ui.count.textContent = active._sim_count();
    const output = active._sim_output?.();
    if (output) {
      ui.timing.textContent = `${output.cycles} cycles · ${output.seconds.toFixed(3)} simulated seconds`;
      if (output.frame) canvas.putImageData(new ImageData(output.frame, 64, 48), 0, 0);
      if (playAudio && selected === "audio") {
        try { audio.play(output.audio, boards.audio.sampleRate); }
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
        { files, top: ui.top.value, board: selected },
        (progress) => { ui.status.textContent = progress; },
      );
      ui.diagnostics.textContent = simulator.diagnostics;
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
    ui.status.textContent = "Ready. The compiled circuit is reset.";
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    controls();
  }
});

ui.step.addEventListener("click", () => simulate(() => simulator._sim_step()));
ui.run.addEventListener("click", async () => {
  const epoch = ++runEpoch;
  timer = 0;
  controls();
  if (selected === "audio") {
    try {
      await audio.unlock();
      if (epoch !== runEpoch) return;
      ui["audio-status"].textContent = "Playing RTL PCM · mono, signed 16-bit, 8000 samples/s.";
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
    if (selected === "audio" && audio.context?.state !== "running") {
      pause();
      ui["audio-status"].textContent = "Audio was suspended. Allow sound for this site and click Run again.";
      ui.status.textContent = "Audio unavailable. Paused; the compiled circuit is preserved.";
      return;
    }
    const start = performance.now();
    // AudioContext's clock paces audio; slow simulation underruns with silence.
    if (selected !== "audio" || audio.queuedSeconds() < 0.10) {
      await simulate(() => browser ? simulator._sim_batch(board.batchCycles) : simulator._sim_step(), true);
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
