// Even a nonconverging circuit stays off the UI thread. Generated code has no
// filesystem or network imports; unexpected WASI calls fail explicitly.
let simulator;
self.onmessage = async ({ data: { id, action, wasm } }) => {
  try {
    if (action === "init") {
      const unavailable = () => { throw new Error("Circuit attempted unsupported WASI I/O."); };
      const instance = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: {
        fd_close: unavailable, fd_seek: unavailable, fd_write: unavailable,
      } });
      simulator = instance.instance.exports;
      simulator._initialize();
      simulator.sim_reset();
    } else if (action === "step") simulator.sim_step();
    else if (action === "reset") simulator.sim_reset();
    else throw new Error("Unknown simulator action.");
    self.postMessage({ id, count: simulator.sim_count() });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
