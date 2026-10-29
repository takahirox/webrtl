"""Reproduce the Yosys-compatible P65C816 sources from a pinned upstream checkout.

Usage: python3 scripts/adapt_cpu816.py /path/to/upstream/rtl/65C816
Upstream commit: 9adbba8622f378253765b7d438b6cbcc4d03fc57
No HDL compiler or network access is used by this script or the site build.
"""

from pathlib import Path
import re
import sys

source = Path(sys.argv[1])
target = Path(__file__).resolve().parents[1] / "examples/cpu816"
banner = "// WebRTL adaptation: package-qualified types and case-function ROMs for Yosys.\n"


def case_rom(match):
    width, name, end, body = match.groups()
    entries = re.findall(r"\{([^{}]+)\}", re.sub(r"//[^\n]*", "", body))
    assert len(entries) == int(end) + 1
    lines = [f"function [{int(width)}:0] {name};", "  input [10:0] index;", "  begin", "    case (index)"]
    for index, entry in enumerate(entries):
        bits = "".join(re.findall(r"\d+'b([01xX]+)", entry)).lower()
        assert len(bits) == int(width) + 1
        if set(bits) == {"x"}:
            continue  # Preserve all undefined entries via the default arm.
        value = f"{len(bits)}'h{int(bits, 2):x}" if "x" not in bits else f"{len(bits)}'b{bits}"
        lines.append(f"      11'd{index}: {name} = {value};")
    lines += [f"      default: {name} = {int(width) + 1}'bx;", "    endcase", "  end", "endfunction"]
    return "\n".join(lines)


names = ["P65C816_pkg.sv", "P65C816.sv", "mcode.sv", "AddrGen.sv", "ALU.sv", "AddSubBCD.sv", "BCDAdder.v", "adder4.v", "bit_adder.v"]
for name in names:
    text = (source / name).read_text()
    text = text.replace("import P65C816_pkg::*;", "")
    if name != "P65C816_pkg.sv":
        for typename in ("MicroInst_r", "ALUCtrl_r", "MCode_r"):
            text = re.sub(rf"\b{typename}\b", f"P65C816_pkg::{typename}", text)
    if name == "mcode.sv":
        text = re.sub(r"localparam logic \[(\d+):0\] (\w+)\[0:(\d+)\] = '\{(.*?)\};", case_rom, text, flags=re.S)
        text = text.replace("ALU_TAB[MI.ALUCtrl]", "ALU_TAB(MI.ALUCtrl)")
        text = text.replace("M_TAB[({IR, STATE2[2:0]})]", "M_TAB({IR, STATE2[2:0]})")
    (target / name.replace(".sv", ".v")).write_text(banner + text)

(target / "LICENSE").write_bytes((source / "LICENSE").read_bytes())
(target / "UPSTREAM.md").write_bytes((source / "README.md").read_bytes())
