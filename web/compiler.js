// Project source -> Yosys CXXRTL -> Clang/LLD -> a new standalone Wasm module.
// The compiler owns virtual filesystems; editor and board behavior live elsewhere.
import { validateProject } from "./project.js";

export async function compileProject(project, progress) {
  validateProject(project);
  const { files, top } = project;
  const names = Object.keys(files);
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
    // The current board adapter's contract, independent of HDL compilation.
    const expected = { clk: ["input", 1], reset: ["input", 1], count: ["output", 8] };
    if (Object.keys(ports).length !== 3 || Object.entries(expected).some(([name, [direction, width]]) =>
      ports[name]?.direction !== direction || ports[name]?.bits.length !== width || ports[name]?.signed)) {
      throw new Error("Counter interface required: scalar inputs clk and reset, unsigned 8-bit output count; no other ports.");
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
      "clang++", "-std=c++17", "-O2", "-I.", "-mexec-model=reactor",
      "-Wl,--export=sim_step", "-Wl,--export=sim_reset", "-Wl,--export=sim_count",
      "-Wl,--max-memory=67108864", "sim.cc", "-o", "sim.wasm",
    ], { ...headers, "design.cc": generated["design.cc"], "sim.cc": await wrapper.text() }, options);
    return { wasm: result["sim.wasm"], diagnostics: diagnostics.replace(/\x1b\[[0-9;]*m/g, "") };
  } catch (error) {
    throw new Error(`${stage} failed: ${error.message}\n${diagnostics}`.replace(/\x1b\[[0-9;]*m/g, ""));
  }
}
