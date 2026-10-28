const ui = Object.fromEntries(
  ["source", "compile", "status", "errors", "count", "run", "pause", "step", "reset"]
    .map((id) => [id, document.getElementById(id)]),
);
const demo = document.documentElement.dataset.mode === "demo";
ui.source.readOnly = demo;
let simulator = null;
let timer = null;
let busy = false;

function controls() {
  ui.compile.disabled = demo || busy;
  ui.source.disabled = busy;
  ui.run.disabled = !simulator || timer !== null;
  ui.pause.disabled = timer === null;
  ui.step.disabled = !simulator || timer !== null;
  ui.reset.disabled = !simulator;
}

function pause() {
  clearInterval(timer);
  timer = null;
  controls();
}

function discard() {
  pause();
  if (simulator) {
    try { simulator._sim_destroy(); } catch { /* An aborted module may already be unusable. */ }
  }
  simulator = null;
  ui.count.textContent = "—";
  controls();
}

function showError(error) {
  discard();
  ui.errors.textContent = error.message;
  ui.errors.hidden = false;
  ui.status.textContent = demo
    ? "Demo failed to load or run. Reload the page to try again."
    : "Failed. Fix the source or toolchain and compile again.";
}

async function loadSimulator(moduleUrl) {
  const { default: createSimulator } = await import(moduleUrl);
  simulator = await createSimulator();
  simulator._sim_init();
  ui.count.textContent = simulator._sim_count();
  ui.status.textContent = "Ready. The compiled circuit is reset.";
}

function simulate(action) {
  try {
    action();
    // The displayed value always comes from the Verilator model in WebAssembly.
    ui.count.textContent = simulator._sim_count();
  } catch (error) {
    showError(error);
  }
}

ui.compile.addEventListener("click", async () => {
  if (demo) return;
  discard();
  busy = true;
  controls();
  ui.errors.hidden = true;
  ui.status.textContent = "Compiling with Verilator and Emscripten…";
  try {
    const response = await fetch("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: ui.source.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Build failed.");
    await loadSimulator(result.moduleUrl);
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    controls();
  }
});

ui.step.addEventListener("click", () => simulate(() => simulator._sim_step()));
ui.run.addEventListener("click", () => {
  timer = setInterval(() => simulate(() => simulator._sim_step()), 100);
  ui.status.textContent = "Running the compiled circuit.";
  controls();
});
ui.pause.addEventListener("click", () => {
  pause();
  ui.status.textContent = "Paused.";
});
ui.reset.addEventListener("click", () => {
  pause();
  ui.status.textContent = "Reset. Paused.";
  simulate(() => simulator._sim_reset());
});
ui.source.addEventListener("input", () => {
  discard();
  ui.errors.hidden = true;
  ui.status.textContent = "Source changed. Compile to simulate this version.";
});

try {
  const response = await fetch("./example.v");
  if (!response.ok) throw new Error("Could not load the counter example. Reload the page.");
  ui.source.value = await response.text();
  if (demo) {
    ui.status.textContent = "Loading precompiled counter…";
    await loadSimulator("./sim.mjs");
  } else {
    ui.status.textContent = "Edit the example or compile it as is.";
  }
} catch (error) {
  showError(error);
}
controls();
