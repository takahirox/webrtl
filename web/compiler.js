import { boards } from "./output-contracts.js";

// Project source -> Yosys CXXRTL -> Clang/LLD -> a new standalone Wasm module.
// The compiler owns virtual filesystems; editor and board behavior live elsewhere.
export async function compileProject(project, progress) {
  const { files, top, board = "counter" } = project;
  const contract = boards[board];
  if (!contract) throw new Error("Unknown output interface.");
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(top)) throw new Error("Invalid top-module name.");
  const names = Object.keys(files);
  if (!names.length || names.some((name) => !/^[a-zA-Z0-9_-]+\.v$/.test(name))) {
    throw new Error("Provide Verilog files with simple .v filenames.");
  }
  if (Object.values(files).some((source) => typeof source !== "string" || !source.trim())) {
    throw new Error("Provide nonempty Verilog source.");
  }
  if (Object.values(files).reduce((size, source) => size + new TextEncoder().encode(source).length, 0) > 65536) {
    throw new Error("Verilog source exceeds the 64 KiB limit.");
  }
  let diagnostics = "";
  let stage = "Loading browser toolchain";
  const decoder = new TextDecoder();
  const output = (bytes) => {
    if (bytes) diagnostics = (diagnostics + decoder.decode(bytes)).slice(-16000);
  };
  const options = {
    stdout: output, stderr: output,
    fetchProgress: ({ doneLength, totalLength }) => progress(`${stage}: ${Math.round(doneLength / totalLength * 100)}%`),
  };
  try {
    progress(stage);
    const { runYosys } = await import("./tools/yosys/bundle.js");
    stage = "Compiling Verilog with Yosys";
    progress(stage);
    const generated = await runYosys(["-Q", "-T", "-p", [
      `read_verilog -sv ${names.join(" ")}`,
      `hierarchy -check -top ${top}`,
      "proc", "flatten", "check -assert",
      `rename ${top} webrtltop`,
      "write_json design.json", "write_cxxrtl -g0 design.cc",
    ].join("; ")], files, options);
    const ports = JSON.parse(generated["design.json"]).modules.webrtltop.ports;
    const expected = { clk: ["input", 1], reset: ["input", 1], ...contract.ports };
    if (Object.keys(ports).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([name, [direction, width, signed = false]]) =>
        ports[name]?.direction !== direction || ports[name]?.bits.length !== width ||
        Boolean(ports[name]?.signed) !== signed)) {
      throw new Error(`${board[0].toUpperCase() + board.slice(1)} interface required: ${
        Object.entries(expected).map(([name, [direction, width, signed]]) =>
          `${direction} ${signed ? "signed" : "unsigned"} ${width}-bit ${name}`).join(", ")}; no other ports.`);
    }
    stage = "Compiling and linking CXXRTL with Clang";
    progress(stage);
    const { runClang } = await import("./tools/clang/bundle.js");
    const response = await fetch(new URL("./tools/cxxrtl.json", import.meta.url));
    if (!response.ok) throw new Error("Could not load CXXRTL runtime headers. Reload and retry.");
    const headers = await response.json();
    const wrapper = await fetch(new URL("./browser-simulator.cpp", import.meta.url));
    if (!wrapper.ok) throw new Error("Could not load the simulator adapter. Reload and retry.");
    const result = await runClang([
      "clang++", `-DBOARD_${board.toUpperCase()}`, "-std=c++17", "-O2", "-I.", "-mexec-model=reactor",
      ...["sim_step", "sim_reset", "sim_count", "sim_batch", "sim_frame", "sim_frame_ready",
        "sim_audio", "sim_audio_count"].map((name) => `-Wl,--export=${name}`),
      "-Wl,--max-memory=67108864", "sim.cc", "-o", "sim.wasm",
    ], { ...headers, "design.cc": generated["design.cc"], "sim.cc": await wrapper.text() }, options);
    return { wasm: result["sim.wasm"], diagnostics: diagnostics.replace(/\x1b\[[0-9;]*m/g, "") };
  } catch (error) {
    throw new Error(`${stage} failed: ${error.message}\n${diagnostics}`.replace(/\x1b\[[0-9;]*m/g, ""));
  }
}
