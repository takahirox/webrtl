# CPU-programmed BG1 tiles

Load **65C816 CPU → BG1 tiles · 64 × 48**, Compile, then Run. The actual P65C816
writes a small RTL PPU's palette, character and tilemap memories. The Video
interface displays a repeating checkerboard with one contrasting striped tile.
See the [BG1 guide](../../docs/cpu816-bg1.md) for registers, sparse VRAM layout,
ROM edits, expected pixels, timing, measurements, tests and pending deployment
verification.

The nine CPU files are reused unchanged from [cpu816](../cpu816/README.md), pinned
to Apple-IIgs_MiSTer revision `9adbba8622f378253765b7d438b6cbcc4d03fc57`;
see [provenance](../cpu816/UPSTREAM.md) and [GPL license](../cpu816/LICENSE).
The four RTL files, original machine-code program and its
[generator](../../scripts/generate-bg1-rom.py) are GPL-3.0-or-later.
Preserve upstream notices and corresponding-source obligations when distributing
the combined design or generated simulator. Sources and license ship with the
static site. No game or firmware ROM is included.
