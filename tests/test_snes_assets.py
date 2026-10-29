"""Ensure distributable cartridges and replacement firmware match their source."""

from pathlib import Path
import runpy
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SnesAssetsTests(unittest.TestCase):
    def test_original_cartridge_is_reproducible(self):
        generator = runpy.run_path(str(ROOT / "scripts/generate-snes-rom.py"))
        rom, _, _ = generator["build"]()
        self.assertEqual(bytes(rom), (ROOT / "examples/snes/test.sfc").read_bytes())
        self.assertEqual(len(rom), 32768)
        checksum = int.from_bytes(rom[0x7fde:0x7fe0], "little")
        self.assertEqual(sum(rom) & 65535, checksum)

    def test_replacement_boot_rom_is_reproducible(self):
        boot = ROOT / "examples/snes/boot"
        with tempfile.TemporaryDirectory() as output:
            subprocess.run([sys.executable, str(boot / "src/assemble.py"), output],
                           check=True, stdout=subprocess.DEVNULL)
            self.assertEqual((Path(output) / "spc700-boot-rom.bin").read_bytes(),
                             (boot / "spc700-boot-rom.bin").read_bytes())
        core = (ROOT / "examples/snes/snes-core.v").read_text()
        table = re.search(r"localparam \[7:0\] IPLROM\[0:63\] = '\{(.*?)\};", core, re.S).group(1)
        self.assertEqual(bytes(int(value, 16) for value in re.findall(r"8'h([0-9a-f]{2})", table)),
                         (boot / "spc700-boot-rom.bin").read_bytes())


if __name__ == "__main__":
    unittest.main()
