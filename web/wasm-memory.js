// Clamp the pinned Python module's declared linear-memory maximum before
// instantiation. Overriding WebAssembly.Memory cannot bound an internal memory.
export function limitWasmMemory(bytes, maximumPages) {
  if (!Number.isInteger(maximumPages) || maximumPages < 1 || maximumPages > 65536) throw new Error("Invalid Wasm memory limit.");
  let offset = 8, memories = 0;
  if (bytes.length < 8 || ![0, 97, 115, 109, 1, 0, 0, 0].every((v, i) => bytes[i] === v)) throw new Error("Invalid Wasm module.");
  function read() {
    let result = 0, shift = 0;
    for (let i = 0; i < 5; i++) {
      const value = bytes[offset++];
      if (value === undefined) throw new Error("Truncated Wasm module.");
      result += (value & 127) * 2 ** shift;
      if (!(value & 128)) {
        if (result > 0xffffffff) throw new Error("Invalid Wasm section.");
        return result;
      }
      shift += 7;
    }
    throw new Error("Invalid Wasm integer.");
  }
  function encode(value) {
    const result = [];
    do { const part = value % 128; value = Math.floor(value / 128); result.push(part | (value ? 128 : 0)); } while (value);
    return result;
  }
  const sections = [bytes.subarray(0, 8)];
  while (offset < bytes.length) {
    const start = offset, id = bytes[offset++], size = read(), end = offset + size;
    if (end > bytes.length) throw new Error("Truncated Wasm section.");
    if (id === 5) {
      const count = read(), flags = read(), initial = read();
      if (count !== 1 || flags !== 1) throw new Error("Python runtime must declare one bounded wasm32 memory.");
      const maximum = Math.min(read(), maximumPages);
      if (offset !== end || initial > maximum || memories !== 0) throw new Error("Incompatible Python memory declaration.");
      memories = 1;
      const payload = [1, 1, ...encode(initial), ...encode(maximum)];
      sections.push(new Uint8Array([5, ...encode(payload.length), ...payload]));
    } else sections.push(bytes.subarray(start, end));
    offset = end;
  }
  if (memories !== 1) throw new Error("Python runtime has no bounded internal memory.");
  const result = new Uint8Array(sections.reduce((size, section) => size + section.length, 0));
  let cursor = 0;
  for (const section of sections) { result.set(section, cursor); cursor += section.length; }
  return result;
}
