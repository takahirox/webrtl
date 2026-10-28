const ui = Object.fromEntries(
  ["source", "source-label", "compile", "status", "errors", "count", "run", "pause", "step", "reset", "diagnostics",
    "project", "files", "filename", "add-file", "rename-file", "remove-file", "import-files", "top", "example", "load-example"]
    .map((id) => [id, document.getElementById(id)]),
);
const browser = document.documentElement.dataset.mode === "browser";
const projectTools = browser ? await import("./project.js") : null;
let files = {};
let activeFile = null;
let simulator = null;
let timer = null;
let busy = true;
let advancing = false;

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

function projectChanged() {
  discard();
  ui.errors.hidden = true;
  ui.diagnostics.textContent = "";
  ui.status.textContent = "Source or project changed. Compile to simulate this version.";
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
      const split = ui.example.value === "split";
      const sources = split
        ? [["split-counter.v", "./examples/split-counter/split-counter.v"], ["counter-next.v", "./examples/split-counter/counter-next.v"]]
        : [["counter.v", "./example.v"]];
      const entries = await Promise.all(sources.map(async ([name, url]) => [name, await loadSource(url)]));
      files = Object.fromEntries(entries);
      ui.top.value = split ? "split_counter" : "counter";
      projectChanged();
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
        { files, top: ui.top.value },
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
