export const MAX_SOURCE_BYTES = 131072;
export const MAX_SLANG_SOURCE_BYTES = 2097152;

export function sourceLimit(frontend = "verilog") {
  if (!["verilog", "slang"].includes(frontend)) throw new Error("Unknown HDL frontend.");
  return frontend === "slang" ? MAX_SLANG_SOURCE_BYTES : MAX_SOURCE_BYTES;
}

export const isHDL = (name) => /\.(v|sv)$/.test(name);
export function validateFilename(name) {
  if (typeof name !== "string" || name.length > 180 ||
      !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_-]*\/)*[a-zA-Z0-9_][a-zA-Z0-9_-]*\.(v|sv|cpp|py)$/.test(name)) {
    throw new Error(`Invalid source name "${name}". Use relative .v, .sv, .cpp or .py paths; letters, digits, underscores and hyphens only. Absolute paths, traversal and shell characters are forbidden.`);
  }
}

export function validateSize(files, frontend = "verilog") {
  if (Object.keys(files).length > 128) throw new Error("Projects support at most 128 source files.");
  const size = Object.values(files).reduce((total, source) => total + new TextEncoder().encode(source).length, 0);
  if (size > sourceLimit(frontend)) throw new Error(`Source exceeds the ${frontend === "slang" ? "2 MiB" : "128 KiB"} total project limit. Remove files or shorten the source.`);
}

export function validateProject({ files, top, frontend = "verilog" }) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(top) || top !== top.trim()) {
    throw new Error("Invalid top-module name. Enter a module name starting with a letter, followed by letters, digits or underscores.");
  }
  const names = Object.keys(files);
  if (!names.some(isHDL)) throw new Error("Add or import at least one .v or .sv source file before compiling.");
  names.forEach(validateFilename);
  for (const name of names) {
    if (typeof files[name] !== "string" || (isHDL(name) && !files[name].trim())) {
      throw new Error(`Source file "${name}" is empty. Add HDL source or remove the file.`);
    }
  }
  validateSize(files, frontend);
}

// YoWASP uses directory objects, never host filesystem paths.
export function virtualFiles(files) {
  const root = Object.create(null);
  for (const [name, source] of Object.entries(files)) {
    validateFilename(name);
    const parts = name.split("/");
    let directory = root;
    for (const part of parts.slice(0, -1)) directory = directory[part] ??= Object.create(null);
    directory[parts.at(-1)] = source;
  }
  return root;
}

// Synthesis discards delays and some system tasks. Reject those in verification
// instead of presenting an event-driven testbench as a clocked hardware harness.
export function validateClockedHarness(files) {
  for (const [name, source] of Object.entries(files).filter(([name]) => isHDL(name))) {
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"/g, " ");
    const delayed = [...code.matchAll(/#\s*\(/g)].some((match) => {
      const previous = code.slice(0, match.index).match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*$/)?.[1];
      return !previous || /^(always|always_ff|always_comb|always_latch|assign|begin|end|else|initial|forever|repeat)$/.test(previous);
    });
    if (delayed || /`(?:define|include)|\b(class|program|interface|clocking|property|sequence|assert|assume|cover|fork|join|wait|force|release|initial|final)\b|\buvm_\w*|`uvm_|\$(?!(?:clog2|signed|unsigned|bits|size|left|right|low|high)\b)\w+|#\s*(?!\()[^\s]|##/.test(code)) {
      throw new Error(`${name}: verification supports synthesizable clocked SV harnesses only. Timing delays, initial/final, system tasks, assertions, classes and UVM require an event-driven simulator. See the verification guide.`);
    }
  }
}
