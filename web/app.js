const ui = Object.fromEntries(
  ["source", "compile", "status", "errors", "count", "run", "pause", "step", "reset", "diagnostics"]
    .map((id) => [id, document.getElementById(id)]),
);
const browser = document.documentElement.dataset.mode === "browser";
let simulator = null;
let timer = null;
let busy = true;
let advancing = false;

function controls() {
  ui.compile.disabled = busy;
  ui.source.disabled = busy;
  ui.run.disabled = !simulator || advancing || timer !== null;
  ui.pause.disabled = timer === null;
  ui.step.disabled = !simulator || advancing || timer !== null;
  ui.reset.disabled = !simulator || advancing;
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
  advancing = false;
  ui.count.textContent = "—";
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

function simulate(action) {
  if (advancing || !simulator) return;
  const active = simulator;
  const update = () => {
    if (simulator === active) ui.count.textContent = active._sim_count();
  };
  const fail = (error) => { if (simulator === active) showError(error); };
  try {
    const result = action();
    if (result instanceof Promise) {
      advancing = true;
      controls();
      result.then(update, fail).finally(() => {
        if (simulator === active) { advancing = false; controls(); }
      });
    } else update();
  } catch (error) { fail(error); }
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
        { files: { "counter.v": ui.source.value }, top: "counter" },
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
  ui.diagnostics.textContent = "";
  ui.status.textContent = "Source changed. Compile to simulate this version.";
});
window.addEventListener("pagehide", discard);

try {
  const response = await fetch("./example.v");
  if (!response.ok) throw new Error("Could not load the counter example. Reload the page.");
  ui.source.value = await response.text();
  ui.status.textContent = "Edit the example or compile it as is.";
} catch (error) {
  showError(error);
}
busy = false;
controls();
