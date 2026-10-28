import { boards } from "./output-contracts.js";
import { AudioOutput } from "./audio-output.js";

const ui = Object.fromEntries(
  ["source", "compile", "status", "errors", "count", "run", "pause", "step", "reset", "diagnostics",
    "example", "video", "audio-status", "timing", "run-help", "source-label"]
    .map((id) => [id, document.getElementById(id)]),
);
const browser = document.documentElement.dataset.mode === "browser";
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
  ui.source.disabled = busy;
  ui.example.disabled = busy;
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
    await action();
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
        { files: { [`${selected}.v`]: ui.source.value }, top: boards[selected].top, board: selected },
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
  discard();
  ui.errors.hidden = true;
  ui.diagnostics.textContent = "";
  ui.status.textContent = "Source changed. Compile to simulate this version.";
});
window.addEventListener("pagehide", discard);

async function loadExample() {
  discard();
  busy = true;
  selected = ui.example.value;
  ui.video.hidden = selected !== "video";
  ui["audio-status"].hidden = selected !== "audio";
  ui["audio-status"].textContent = "Click Run to enable audio. Step advances silently.";
  ui.timing.hidden = selected === "counter";
  ui.count.parentElement.hidden = selected !== "counter";
  const title = ui.example.selectedOptions[0].textContent;
  ui["source-label"].textContent = selected === "counter" ? "8-bit counter · counter.v" : `${title} · ${selected}.v`;
  ui["run-help"].textContent = selected === "counter" ? "Step = one full clock cycle. Run = 10 cycles per second." :
    `Step = one clock cycle (silent). Run batches ${boards[selected].batchCycles} cycles at a target ${boards[selected].clockHz} simulated clocks/s.`;
  controls();
  try {
    const response = await fetch(selected === "counter" ? "./example.v" : `./examples/${selected}.v`);
    if (!response.ok) throw new Error("Could not load the example. Reload the page.");
    ui.source.value = await response.text();
    ui.errors.hidden = true;
    ui.diagnostics.textContent = "";
    ui.status.textContent = "Edit the example or compile it as is.";
  } catch (error) {
    showError(error);
  }
  busy = false;
  controls();
}
ui.example.addEventListener("change", loadExample);
await loadExample();
