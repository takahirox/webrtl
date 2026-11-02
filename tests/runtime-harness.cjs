// Real production compiler/runtime workers, shared by focused backend checks.
async function install(page, project) {
  await page.goto('./');
  return page.evaluate(async (project) => {
    const compiler = new Worker('./compiler-worker.js', { type: 'module' });
    let compiled;
    try {
      compiled = await new Promise((resolve, reject) => {
        compiler.onmessage = ({ data }) => {
          if (data.error) reject(new Error(data.error));
          if (data.wasm) resolve(data);
        };
        compiler.onerror = (event) => reject(new Error(event.message));
        compiler.postMessage(project);
      });
    } finally { compiler.terminate(); }
    const workers = [];
    window.circuit = {
      compiled,
      async create(backend) {
        const worker = new Worker('./simulator-worker.js', { type: 'module' });
        workers.push(worker);
        let id = 0;
        const call = (message) => new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data);
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage({ id: id++, board: project.board, ...message });
        });
        const initial = await call({ action: 'init', wasm: compiled.wasm });
        await call({ action: 'backend', backend });
        return { call, initial };
      },
      destroy() { workers.forEach((w) => w.terminate()); },
    };
    return compiled.metrics;
  }, project);
}
module.exports = { install };
