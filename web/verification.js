export function runReference(name, source, signal, progress = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./reference-worker.js", import.meta.url), { type: "module" });
    let timer;
    const finish = (error, result) => {
      clearTimeout(timer); worker.terminate(); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(result);
    };
    const deadline = (ms) => { clearTimeout(timer); timer = setTimeout(() => finish(new Error(`Reference exceeded ${ms / 1000} seconds. Worker terminated.`)), ms); };
    const abort = () => finish(new DOMException("Verification cancelled. Worker terminated.", "AbortError"));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || "Reference worker failed.")); };
    worker.onmessage = ({ data }) => {
      if (data.progress) { progress(data.progress); if (data.executing) deadline(5000); }
      else finish(data.error ? new Error(data.error) : null, data);
    };
    deadline(120000);
    worker.postMessage({ name, source });
  });
}

// Numeric CSV is a transport between independent standard programs and the DUT.
// Port names define the columns; no verification language is interpreted here.
export function parseVectors(text, io) {
  if (text.length > 1048576) throw new Error("Reference output exceeds 1 MiB.");
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || lines.length > 257) throw new Error("Reference must emit a CSV header and 1–256 sample rows.");
  const names = lines.shift().split(",").map((s) => s.trim());
  if (names.length > 64 || new Set(names).size !== names.length) throw new Error("CSV needs at most 64 unique port columns.");
  const ports = names.map((name) => {
    const port = io.find((p) => p.name === name && p.lsb === 0 && p.width <= 256);
    if (!port || io.filter((p) => p.name === name).length !== 1) throw new Error(`Unknown, split or unsupported CSV port: ${name}.`);
    return port;
  });
  if (!ports.some((p) => p.direction === "out")) throw new Error("CSV needs at least one expected output column.");
  const inputs = io.filter((p) => p.direction === "in");
  if (inputs.some((p) => !names.includes(p.name))) throw new Error("CSV must define every external input on every row.");
  return lines.map((line, row) => {
    const cells = line.split(",").map((s) => s.trim());
    if (cells.length !== ports.length) throw new Error(`CSV row ${row + 1}: wrong column count.`);
    const sample = { inputs: {}, expected: {} };
    ports.forEach((port, i) => {
      if (!/^(0x[0-9a-f]+|[0-9]+)$/i.test(cells[i])) throw new Error(`CSV row ${row + 1}: unsigned integer required for ${port.name}.`);
      const value = BigInt(cells[i]);
      if (value >= (1n << BigInt(port.width))) throw new Error(`CSV row ${row + 1}: ${port.name} exceeds ${port.width} bits.`);
      sample[port.direction === "in" ? "inputs" : "expected"][port.name] = `0x${value.toString(16)}`;
    });
    return sample;
  });
}

export async function compareVectors(simulator, vectors, signal, update) {
  const samples = [];
  for (const [index, vector] of vectors.entries()) {
    if (signal.aborted) throw new DOMException("Verification cancelled.", "AbortError");
    await simulator._sim_inputs(vector.inputs);
    const result = await simulator._sim_step();
    const mismatches = Object.entries(vector.expected).flatMap(([name, expected]) => {
      const actual = result.io.find((p) => p.name === name)?.hex;
      return actual !== undefined && BigInt(`0x${actual}`) === BigInt(expected) ? [] : [{ name, expected, actual: actual === undefined ? "missing" : `0x${actual}` }];
    });
    const sample = { sample: index + 1, cycle: result.cycles, inputs: vector.inputs, expected: vector.expected,
      values: result.io, mismatches };
    samples.push(sample); update(sample, samples);
    if (mismatches.length) break; // The actual live RTL remains at this boundary.
  }
  return samples;
}

export function toVCD(samples) {
  if (!samples.length) throw new Error("Run verification to record a trace first.");
  const ports = samples[0].values;
  const declarations = ports.map((p, i) => `$var wire ${p.width} s${i} \\${p.name} $end`);
  return ["$version WebRTL sampled settled-low RTL boundaries $end", "$comment One tick is one full clock cycle; no intra-cycle transitions recorded. $end",
    "$timescale 1ns $end", "$scope module dut $end", ...declarations, "$upscope $end", "$enddefinitions $end",
    ...samples.flatMap((sample) => [`#${sample.cycle}`, ...sample.values.map((p, i) => `b${BigInt(`0x${p.hex}`).toString(2).padStart(p.width, "0")} s${i}`)]), ""].join("\n");
}
