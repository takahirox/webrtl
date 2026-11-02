// Disposable worker. User programs exchange ordinary numeric CSV over stdout;
// they never share RTL memory or receive DOM/host filesystem access.
import { limitWasmMemory } from "./wasm-memory.js";

const LIMIT = 1024 * 1024;
let output = "", diagnostics = "", outputBytes = 0, outputExceeded = false;
const append = (value) => {
  const bytes = new TextEncoder().encode(value).length;
  if (outputBytes + bytes > LIMIT) { outputExceeded = true; throw new Error("Reference output exceeds 1 MiB."); }
  outputBytes += bytes; output += value;
};
self.onmessage = async ({ data: { name, source } }) => {
  try {
    if (typeof source !== "string" || new TextEncoder().encode(source).length > 131072) throw new Error("Reference source exceeds 128 KiB.");
    if (name.endsWith(".py")) {
      self.postMessage({ progress: "Loading Python runtime…" });
      const { loadPyodide } = await import("./tools/pyodide/pyodide.mjs");
      // Pyodide supplies additional JS-value imports during instantiation.
      // Preserve that setup and bound only its main module's internal memory.
      const originalStreaming = WebAssembly.instantiateStreaming;
      WebAssembly.instantiateStreaming = async (response, imports) => {
        const loaded = await response;
        if (!loaded.url.endsWith("/pyodide.asm.wasm")) return originalStreaming(loaded, imports);
        try {
          if (!loaded.ok) throw new Error("Could not load Python Wasm runtime.");
          const bytes = limitWasmMemory(new Uint8Array(await loaded.arrayBuffer()), 8192);
          return await WebAssembly.instantiate(bytes, imports);
        } catch (error) {
          self.postMessage({ error: error.message });
          throw error;
        }
      };
      let python;
      try { python = await loadPyodide({ indexURL: new URL("./tools/pyodide/", import.meta.url).href }); }
      finally { WebAssembly.instantiateStreaming = originalStreaming; }
      python.setStdout({ write: (bytes) => { append(new TextDecoder().decode(bytes)); return bytes.length; } });
      python.setStderr({ batched: (line) => { diagnostics = (diagnostics + line + "\n").slice(-4000); } });
      self.postMessage({ progress: "Running Python reference…", executing: true });
      python.runPython(source, { filename: name });
    } else if (name.endsWith(".cpp")) {
      self.postMessage({ progress: "Compiling C++ reference…" });
      const { runClang } = await import("./tools/clang/bundle.js");
      const result = await runClang(["clang++", "-std=c++17", "-O1", "-fno-exceptions", "-Wl,--max-memory=67108864", "model.cpp", "-o", "model.wasm"],
        { "model.cpp": source }, { stdout: (bytes) => { diagnostics = (diagnostics + new TextDecoder().decode(bytes)).slice(-4000); },
          stderr: (bytes) => { diagnostics = (diagnostics + new TextDecoder().decode(bytes)).slice(-4000); } });
      let instance;
      const view = () => new DataView(instance.exports.memory.buffer);
      const imports = { wasi_snapshot_preview1: {
        args_sizes_get: (argc, size) => { view().setUint32(argc, 0, true); view().setUint32(size, 0, true); return 0; },
        args_get: () => 0,
        environ_sizes_get: (count, size) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
        environ_get: () => 0,
        fd_write: (fd, iovs, count, written) => {
          if (fd !== 1 && fd !== 2) return 8;
          const memory = view(); let total = 0;
          for (let i = 0; i < count; i++) {
            const ptr = memory.getUint32(iovs + i * 8, true), size = memory.getUint32(iovs + i * 8 + 4, true);
            if (size > LIMIT || total + size > LIMIT) throw new Error("Reference output exceeds 1 MiB.");
            const value = new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, ptr, size));
            if (fd === 1) append(value); else diagnostics = (diagnostics + value).slice(-4000);
            total += size;
          }
          memory.setUint32(written, total, true); return 0;
        },
        fd_close: () => 0, fd_seek: () => 8, fd_fdstat_get: () => 8,
        proc_exit: (code) => { if (code) throw new Error(`C++ reference exited with ${code}.`); throw { exit: true }; },
      } };
      instance = await WebAssembly.instantiate(await WebAssembly.compile(result["model.wasm"]), imports);
      self.postMessage({ progress: "Running C++ reference…", executing: true });
      try { instance.exports._start(); } catch (error) { if (!error.exit) throw error; }
    } else throw new Error("Choose a .cpp or .py reference model.");
    if (outputExceeded) throw new Error("Reference output exceeds 1 MiB.");
    self.postMessage({ output, diagnostics });
  } catch (error) { self.postMessage({ error: `${outputExceeded ? "Reference output exceeds 1 MiB." : String(error.message).slice(-8000)}\n${diagnostics}` }); }
};
