import { compileProject } from "./compiler.js";

self.onmessage = async ({ data: project }) => {
  try {
    const result = await compileProject(project, (progress) => self.postMessage({ progress }));
    self.postMessage(result, [result.wasm.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
