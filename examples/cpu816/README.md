# P65C816 browser example

Load **65C816 CPU · machine-code ROM test** in WebRTL. The integration guide in
[docs/cpu816.md](../../docs/cpu816.md) documents source order, browser compilation,
bus/reset timing, machine-code bytes, expected traces, limits and validation.

The existing CPU is pinned to Apple-IIgs_MiSTer revision
`9adbba8622f378253765b7d438b6cbcc4d03fc57`; its original provenance notes are in
[UPSTREAM.md](UPSTREAM.md). All nine CPU source files retain upstream notices.
The three `cpu816-*.v` files supply the small board and original test ROM.
See [LICENSE](LICENSE) for GPL-3.0-or-later terms and the integration guide for
the reproducible Yosys compatibility adaptations.
