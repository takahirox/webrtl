// Parse a local cartridge; this module performs no I/O and no emulation.
export function parseCartridge(input) {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length % 32768 === 512) bytes = bytes.subarray(512);
  if (bytes.length < 32768 || bytes.length > 4194304 || (bytes.length & (bytes.length - 1))) {
    throw new Error("Use a power-of-two LoROM/HiROM cartridge of 32 KiB to 4 MiB, optionally with a 512-byte copier header.");
  }
  const candidates = [false, true].filter((hirom) => {
    const offset = hirom ? 0xffc0 : 0x7fc0;
    return offset + 64 <= bytes.length && (bytes[offset + 0x15] & 0xef) === (hirom ? 0x21 : 0x20)
      && bytes[offset + 0x3d] >= 0x80;
  });
  if (candidates.length !== 1) throw new Error("Cartridge header must identify one unambiguous LoROM or HiROM mapping and a ROM reset vector.");
  const hirom = candidates[0];
  const offset = hirom ? 0xffc0 : 0x7fc0;
  if (bytes[offset + 0x16] > 2) throw new Error("This board supports base-console cartridges; enhancement chips are unsupported.");
  const ramSize = bytes[offset + 0x18];
  if (ramSize > 7) throw new Error("Cartridge SRAM exceeds the 128 KiB limit.");
  return { bytes: bytes.slice(), hirom, mask: bytes.length - 1, ramSize };
}
