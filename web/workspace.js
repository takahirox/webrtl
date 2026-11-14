import { runReference, parseVectors, compareVectors, toVCD } from "./verification.js";
import { validateClockedHarness } from "./project.js";

export function setupWorkspace(app) {
  const $ = (id) => document.getElementById(id);
  let controller = null, samples = [], vectors = [], liveFailure = false;
  const api = { get running() { return controller !== null; }, refresh, sync, invalidate, controls, leaveBoundary };
  const reference = $("reference-model"), split = $("split-file");
  const config = $("verification-config");
  function controls() {
    const locked = app.busy() || api.running;
    $("verify").disabled = locked || !reference.value || app.board() !== "generic";
    $("cancel-verification").disabled = !api.running;
    for (const el of [reference, split, $("load-verification"), $("failure-signal"), $("verification-cycles")]) el.disabled = locked;
    $("reference-source").disabled = locked;
    $("debug-mismatch").disabled = locked || !liveFailure;
    for (const el of document.querySelectorAll("#source-tabs button, #project-tree button")) el.disabled = locked;
  }
  function sync() {
    if (split.value) {
      if ($("reference-source").value !== app.files()[split.value]) $("reference-source").value = app.files()[split.value] ?? "";
      $("reference-label").textContent = split.value;
    }
  }
  function refresh() {
    const files = Object.keys(app.files());
    const previous = reference.value, previousSplit = split.value;
    reference.replaceChildren(new Option("Choose .cpp or .py file", ""), new Option("Clocked SV harness", ":sv"),
      ...files.filter((name) => /\.(cpp|py)$/.test(name)).map((name) => new Option(name, name)));
    reference.value = [...reference.options].some((o) => o.value === previous) ? previous : "";
    split.replaceChildren(new Option("Single editor", ""), ...files.map((name) => new Option(name, name)));
    split.value = files.includes(previousSplit) ? previousSplit : "";
    $("reference-editor").hidden = !split.value;
    $("source-tabs").replaceChildren(...files.map((name) => {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = name; button.setAttribute("aria-pressed", String(name === app.activeFile()));
      button.onclick = () => app.selectFile(name); return button;
    }));
    const root = Object.create(null);
    for (const name of files.filter((name) => name.includes("/"))) {
      const parts = name.split("/"); let dir = root;
      for (const part of parts.slice(0, -1)) dir = dir[part] ??= Object.create(null);
      dir[parts.at(-1)] = name;
    }
    function tree(dir) {
      const list = document.createElement("ul");
      for (const [name, value] of Object.entries(dir)) {
        const li = document.createElement("li");
        if (typeof value === "string") {
          const button = document.createElement("button"); button.textContent = name;
          button.type = "button"; button.onclick = () => app.selectFile(value); li.append(button);
        } else {
          const details = document.createElement("details"), summary = document.createElement("summary");
          details.open = true; summary.textContent = name; details.append(summary, tree(value)); li.append(details);
        }
        list.append(li);
      }
      return list;
    }
    $("project-tree").replaceChildren(tree(root));
    sync(); controls();
  }
  function leaveBoundary() {
    if (liveFailure) {
      liveFailure = false; $("debug-mismatch").hidden = true;
      $("verification-status").textContent += " Live RTL has since changed; rerun verification to reproduce the failure.";
    }
  }
  function invalidate() {
    liveFailure = false;
    $("debug-mismatch").hidden = true;
    if (samples.length) $("verification-status").textContent = "Sources changed. Recorded results belong to the previous run; verify again.";
  }
  split.onchange = () => { $("reference-editor").hidden = !split.value; sync(); };
  $("reference-source").oninput = () => app.edit(split.value, $("reference-source").value);
  reference.onchange = () => { $("harness-config").hidden = reference.value !== ":sv"; controls(); };
  $("load-verification").onclick = async () => {
    try { await app.loadVerification(); config.open = true; reference.value = "adder.cpp"; split.value = "adder.py"; split.onchange(); controls(); }
    catch (error) { app.error(error); }
  };
  for (const button of document.querySelectorAll("[data-workspace]")) button.onclick = () => {
    for (const other of document.querySelectorAll("[data-workspace]")) other.setAttribute("aria-pressed", String(other === button));
    const target = button.dataset.workspace;
    if (target === "design") $("source").focus();
    else if (target === "simulation") $("run").focus();
    else { config.open = true; reference.focus(); }
    (target === "design" ? $("source") : target === "simulation" ? document.querySelector(".simulation-pane") : $("verification-pane")).scrollIntoView({ block: "nearest" });
  };
  $("cancel-verification").onclick = () => controller?.abort();
  $("verify").onclick = async () => {
    if (api.running) return;
    controller = new AbortController();
    const signal = controller.signal;
    samples = []; vectors = []; liveFailure = false;
    $("test-results").replaceChildren(); $("debug-mismatch").hidden = true;
    $("export-vcd").disabled = true; $("export-vectors").disabled = true;
    $("waveform-signal").disabled = true; $("waveform-sample").disabled = true;
    $("waveform").replaceChildren(); $("waveform-values").textContent = "";
    $("trace-boundary").textContent = "No recorded samples.";
    app.pause(); app.controls(); controls();
    const status = (text) => { $("verification-status").textContent = text; };
    try {
      status("Preparing verification…");
      validateClockedHarness(app.files());
      if (!app.simulator() && !await app.compile(signal, true)) throw new Error("DUT compilation failed. See diagnostics.");
      if (signal.aborted) throw new DOMException("Verification cancelled.", "AbortError");
      const simulator = app.simulator();
      const initialIO = simulator._sim_output().io;
      await simulator._sim_inputs(Object.fromEntries(initialIO.filter((p) => p.direction === "in").map((p) => [p.name, "0x0"])));
      await simulator._sim_reset();
      const io = simulator._sim_output().io;
      if (reference.value === ":sv") {
        const count = Number($("verification-cycles").value), failure = $("failure-signal").value;
        if (!Number.isInteger(count) || count < 1 || count > 256) throw new Error("Choose 1–256 harness clocks.");
        if (io.some((p) => p.direction === "in")) throw new Error("Clocked harness must generate its own stimuli (only clk/reset inputs).");
        vectors = parseVectors(`${failure}\n${Array(count).fill("0").join("\n")}`, io);
      } else {
        const result = await runReference(reference.value, app.files()[reference.value], signal, status);
        vectors = parseVectors(result.output, io);
      }
      status(`Running ${vectors.length} sample comparisons…`);
      samples = await compareVectors(simulator, vectors, signal, (sample, recorded) => {
        samples = recorded;
        const li = document.createElement("li");
        li.textContent = `Sample ${sample.sample} · cycle ${sample.cycle} · ${sample.mismatches.length ? "FAIL" : "PASS"}`;
        li.dataset.result = sample.mismatches.length ? "failed" : "passed";
        if (sample.mismatches.length) li.textContent += "\n" + sample.mismatches.map((m) => `${m.name}: expected ${m.expected}, actual ${m.actual}`).join("\n") + `\nInputs: ${JSON.stringify(sample.inputs)}`;
        $("test-results").append(li);
      });
      const failure = samples.at(-1)?.mismatches.length;
      liveFailure = Boolean(failure);
      $("debug-mismatch").hidden = !liveFailure;
      status(failure ? `FAIL at sample ${samples.length}, cycle ${samples.at(-1).cycle}. RTL paused at this boundary. ${vectors.length - samples.length} samples not run.` : `PASS · ${samples.length}/${vectors.length} samples compared after reset.`);
      app.showOutput();
    } catch (error) {
      status(signal.aborted || error.name === "AbortError" ? "Cancelled. Reference worker terminated; any completed RTL samples are retained." : `Verification error: ${error.message}`);
    } finally {
      controller = null;
      if (samples.length) renderTrace();
      if (app.simulator()) app.showOutput();
      app.controls(); controls();
    }
  };
  $("debug-mismatch").onclick = async () => {
    $("sim-mode").value = "debug";
    $("sim-mode").dispatchEvent(new Event("change"));
    $("debug-controls").scrollIntoView({ block: "nearest" });
  };
  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("export-vcd").onclick = () => download(toVCD(samples), "trace.vcd", "text/plain");
  $("export-vectors").onclick = () => {
    const names = [...Object.keys(vectors[0].inputs), ...Object.keys(vectors[0].expected)];
    download([names.join(","), ...vectors.map((v) => names.map((n) => v.inputs[n] ?? v.expected[n]).join(",")), ""].join("\n"), "comparison.csv", "text/csv");
  };
  function renderTrace() {
    $("export-vcd").disabled = false; $("export-vectors").disabled = false;
    $("waveform-signal").disabled = false; $("waveform-sample").disabled = false;
    $("waveform-signal").replaceChildren(...samples[0].values.map((p) => new Option(p.name, p.name)));
    $("waveform-sample").max = samples.length; $("waveform-sample").value = samples.length;
    $("trace-boundary").textContent = `${samples.length} recorded clocks · one tick = one cycle · settled low; intra-cycle transitions are not captured.`;
    drawWaveform();
  }
  function drawWaveform() {
    const name = $("waveform-signal").value;
    const selected = samples[Number($("waveform-sample").value) - 1];
    $("waveform-values").textContent = `Sample ${selected.sample} · cycle ${selected.cycle}\n` + selected.values.map((p) => `${p.name} = 0x${p.hex}`).join("\n");
    const svg = $("waveform"), ns = "http://www.w3.org/2000/svg", width = samples.length * 96;
    svg.replaceChildren(); svg.setAttribute("width", width); svg.setAttribute("viewBox", `0 0 ${width} 70`);
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", samples.map((s, i) => {
      const port = s.values.find((p) => p.name === name);
      if (port.width > 1) return `M${i * 96},25 l5,-10 h86 l5,10 l-5,10 h-86 Z`;
      const value = BigInt(`0x${port.hex}`), y = value ? 15 : 35;
      return `${i ? "L" : "M"}${i * 96},${y} L${(i + 1) * 96},${y}`;
    }).join(" "));
    path.setAttribute("fill", "none"); path.setAttribute("stroke", "#c4a7ff"); svg.append(path);
    samples.forEach((sample, i) => {
      const text = document.createElementNS(ns, "text"); text.setAttribute("x", i * 96 + 5); text.setAttribute("y", 58);
      text.textContent = `${sample.cycle}: ${sample.values.find((p) => p.name === name).hex}`; svg.append(text);
    });
  }
  $("waveform-signal").onchange = drawWaveform; $("waveform-sample").oninput = drawWaveform;
  window.addEventListener("pagehide", () => controller?.abort());
  refresh();
  return api;
}
