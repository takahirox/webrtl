function workerError(event) {
  event.preventDefault();
  return new Error(event.message || "Browser worker failed. Check browser compatibility and reload.");
}

export async function compileBrowser(project, progress) {
  const compiler = new Worker(new URL("./compiler-worker.js", import.meta.url), { type: "module" });
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Compilation exceeded 120 seconds. Simplify the design or retry.")), 120000);
      const finish = (callback, value) => { clearTimeout(timeout); callback(value); };
      compiler.onerror = (event) => finish(reject, workerError(event));
      compiler.onmessage = ({ data }) => {
        if (data.progress) progress(data.progress);
        else if (data.error) finish(reject, new Error(data.error));
        else finish(resolve, data);
      };
      compiler.postMessage(project);
    });
  } finally {
    compiler.terminate();
  }
  progress("Loading newly compiled circuit…");
  const worker = new Worker(new URL("./simulator-worker.js", import.meta.url), { type: "module" });
  let nextId = 0;
  let count = 0;
  let output = {};
  const pending = new Map();
  const destroy = () => {
    worker.terminate();
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(new Error("Simulator discarded."));
    }
    pending.clear();
  };
  worker.onerror = (event) => {
    const error = workerError(event);
    for (const { reject, timeout } of pending.values()) { clearTimeout(timeout); reject(error); }
    pending.clear();
    worker.terminate();
  };
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else { count = data.count; output = data; request.resolve(data); }
  };
  const call = (action, wasm, batchCycles) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => {
      reject(new Error("Circuit did not respond within 10 seconds. Check for combinational loops."));
      destroy();
    }, 10000);
    pending.set(id, { resolve, reject, timeout });
    worker.postMessage({ id, action, wasm, board: project.board || "counter", batchCycles }, wasm ? [wasm.buffer] : []);
  });
  try { await call("init", result.wasm); }
  catch (error) { destroy(); throw error; }
  return {
    _sim_step: () => call("step"),
    _sim_batch: (cycles) => call("batch", undefined, cycles),
    _sim_output: () => output,
    _sim_reset: () => call("reset"),
    _sim_count: () => count,
    _sim_destroy: destroy,
    diagnostics: result.diagnostics,
  };
}
