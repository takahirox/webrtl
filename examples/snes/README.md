# SNES RTL integration

This experimental board integrates SNESTang's CPU, PPU and APU with RTL memories
and a serial joypad. It uses the browser compiler, Canvas and Web Audio. It does
not establish complete SNES compatibility or completion of Issue #22. See the
[feature matrix, validation and limitations](../../docs/snes.md).

- `snes.v`: WebRTL board, cartridge mapping, memory and controller adapter.
- `snes-core.v`: reproducibly adapted complete console core, including P65C816,
  SCPU/DMA/HDMA, SPPU, SPC700/SMP and DSP.
- `upstream.json`: pinned revisions and SHA-256 hashes of every imported source.
- `LICENSE`: SNESTang's GPL version 3 license.
- `boot/`: independently authored replacement IPL, its source and GPL license.
- `test.sfc`: original GPL-3.0-or-later integration cartridge, reproduced by
  [generate-snes-rom.py](../../scripts/generate-snes-rom.py).
- `test-listing.txt`: annotated instructions for its 65C816 and SPC700 programs.

The sources, source generator, licenses, firmware source and cartridge are copied
to the static site. No circuit is compiled during the site build.
