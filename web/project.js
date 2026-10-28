export const MAX_SOURCE_BYTES = 65536;

export function validateFilename(name) {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]*\.v$/.test(name) || !name.endsWith(".v")) {
    throw new Error(`Invalid source name "${name}". Use a flat .v filename starting with a letter, digit or underscore; then letters, digits, underscores or hyphens only.`);
  }
}

export function validateSize(files) {
  const size = Object.values(files).reduce((total, source) => total + new TextEncoder().encode(source).length, 0);
  if (size > MAX_SOURCE_BYTES) throw new Error("Verilog source exceeds the 64 KiB total project limit. Remove files or shorten the source.");
}

export function validateProject({ files, top }) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(top) || top !== top.trim()) {
    throw new Error("Invalid top-module name. Enter a module name starting with a letter, followed by letters, digits or underscores.");
  }
  const names = Object.keys(files);
  if (!names.length) throw new Error("Add or import at least one .v source file before compiling.");
  names.forEach(validateFilename);
  for (const name of names) {
    if (typeof files[name] !== "string" || !files[name].trim()) {
      throw new Error(`Source file "${name}" is empty. Add Verilog source or remove the file.`);
    }
  }
  validateSize(files);
}
