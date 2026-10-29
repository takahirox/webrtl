# 65C816 PPU backdrop example

Load **65C816 CPU → PPU backdrop · 64 × 48** and compile/run in the static browser
app. This original ROM drives a three-register RTL PPU subset through the real
P65C816 bus, producing a solid CGRAM backdrop through the existing Video output.
See [the integration guide](../../docs/cpu816-backdrop.md) for register semantics,
ROM edits, timing, tests, measurements and pending deployment verification.

The nine pinned CPU sources are reused from [cpu816](../cpu816/README.md).
All four new RTL files and the original ROM program are GPL-3.0-or-later,
consistent with the inherited CPU license; see [LICENSE](../cpu816/LICENSE).
Preserve upstream notices and corresponding-source obligations when distributing
the combined design or generated simulator. Sources and the license ship with
the static site. No commercial game or firmware is included.
