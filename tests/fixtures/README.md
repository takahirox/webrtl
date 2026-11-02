# Imported RTL regression projects

These designs retain independent multi-file, CPU/bus and PPU coverage after the
bundled catalog was reduced to Counter, RAM / Debug, Video, Audio and SNES.
They are test fixtures, not extra presets, and are excluded from the static site.
SNES's integrated CPU/PPU/APU sources and original cartridge remain in
`examples/snes/` unchanged.

The browser tests import these sources through the ordinary file controls using
[import-project.cjs](../import-project.cjs). To reproduce manually, remove the
initial `counter.v`, import the files below, and set the top and output interface
in Project settings. Use the default Yosys Verilog frontend. Import the CPU files
in this order: `P65C816_pkg.v`, `P65C816.v`, `mcode.v`, `AddrGen.v`, `ALU.v`,
`AddSubBCD.v`, `BCDAdder.v`, `adder4.v`, `bit_adder.v`.

| Fixture | Sources | Top | Output interface | Coverage |
| --- | --- | --- | --- | --- |
| `split-counter` | Both `.v` files | `split_counter` | Counter | Edited helper, arbitrary top, file switching and imports |
| `cpu-bus` | All five `.v` files | `bus_test` | Counter | ROM/RAM transactions, decoding, protection, reset and faults |
| `cpu816` | `cpu816-test.v`, `cpu816-memory.v`, `cpu816-rom.v`, then nine CPU files | `cpu816_test` | 65C816 | Instructions, bus trace, timeout, 24-bit decoding and faults |
| `cpu816-backdrop` | All four `.v` files, then nine CPU files | `cpu816_backdrop` | Video | CPU register writes, CGRAM, brightness, blanking and reset |
| `cpu816-bg1` | All four `.v` files, then nine CPU files | `cpu816_bg1` | Video | CPU writes, VRAM, tile/map/palette pixels and reset |

Keep the GPL license, upstream provenance and source notices with the CPU/PPU
fixtures. [adapt_cpu816.py](../../scripts/adapt_cpu816.py) and
[generate-bg1-rom.py](../../scripts/generate-bg1-rom.py) regenerate these fixtures;
[benchmark-modes.cjs](../../scripts/benchmark-modes.cjs) reads the bus fixture from
the repository for its optional throughput comparison. These projects remain
part of the complete Chromium/Firefox suite; no cartridge corpus is removed.
