# SPDX-License-Identifier: GPL-3.0-or-later
"""Build the original GPL-3.0-or-later WebRTL integration cartridge.

No external assembler, proprietary firmware, game code or assets are used.
The listing documents every opcode; unused ROM bytes are WAI instructions.
"""

from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "examples/snes"


class Program:
    def __init__(self, base):
        self.base = base
        self.data = bytearray()
        self.labels = {}
        self.fixups = []
        self.jumps = []
        self.listing = []
        self.records = []

    def emit(self, text, *values):
        self.records.append((len(self.data), len(values), text))
        self.listing.append(f"{self.base + len(self.data):04x}: {bytes(values).hex(' '):20} {text}")
        self.data.extend(values)

    def label(self, name):
        self.labels[name] = self.base + len(self.data)

    def branch(self, opcode, name):
        self.fixups.append((len(self.data) + 1, name))
        self.emit(f"branch {name}", opcode, 0)

    def finish(self):
        for offset, name in self.fixups:
            distance = self.labels[name] - (self.base + offset + 1)
            assert -128 <= distance <= 127
            self.data[offset] = distance & 255
        for offset, name in self.jumps:
            struct.pack_into("<H", self.data, offset, self.labels[name])
        self.listing = [f"{self.base + offset:04x}: {self.data[offset:offset + length].hex(' '):20} {text}"
                        for offset, length, text in self.records]
        return self.data


def build(mode=0, sprite_priority=None, display=0, effect=None, autojoy=False):
    assert mode in range(8)
    apu = Program(0x200)
    # Disable echo, release reset/mute, configure voice 0 with direct gain.
    for reg, value in [(0x6c, 0x20), (0x0c, 0x7f), (0x1c, 0x7f),
                       (0x00, 0x7f), (0x01, 0x7f), (0x02, 0), (0x03, 0x10),
                       (0x04, 0), (0x05, 0), (0x07, 0x7f), (0x5d, 3),
                       (0x5c, 0), (0x4c, 1)]:
        apu.emit(f"MOV $f2,#${reg:02x}; MOV $f3,#${value:02x}", 0x8f, reg, 0xf2, 0x8f, value, 0xf3)
    apu.emit("MOV $fa,#1; MOV $f1,#1 (timer 0)", 0x8f, 1, 0xfa, 0x8f, 1, 0xf1)
    apu.emit("MOV $f5,#0; MOV $f4,#$5a (driver ready)", 0x8f, 0, 0xf5, 0x8f, 0x5a, 0xf4)
    apu.label("idle")
    apu.emit("MOV A,$fd (timer 0 read-and-clear)", 0xe4, 0xfd)
    apu.branch(0xf0, "idle")
    apu.emit("MOV $f5,A (timer tick proof)", 0xc4, 0xf5)
    apu.branch(0x2f, "idle")
    payload = bytearray(0x300)
    payload[:len(apu.finish())] = apu.data
    payload[0x100:0x104] = bytes([0, 4, 0, 4])  # sample directory: start and loop $0400
    payload[0x200:0x209] = bytes([0xb3] + [0x77] * 4 + [0x99] * 4)  # original looping BRR square wave

    cpu = Program(0x8000)
    def write(address, value):
        cpu.emit(f"LDA #${value:02x}; STA ${address:04x}", 0xa9, value, 0x8d, address & 255, address >> 8)
    def stz(address):
        cpu.emit(f"STZ ${address:04x}", 0x9c, address & 255, address >> 8)
    def load(address):
        cpu.emit(f"LDA ${address:04x}", 0xad, address & 255, address >> 8)
    def check(value):
        cpu.emit(f"CMP #${value:02x}; BEQ +3", 0xc9, value, 0xf0, 3)
        cpu.jumps.append((len(cpu.data) + 1, "fail"))
        cpu.emit("JMP fail", 0x4c, 0, 0)

    cpu.emit("SEI; CLD; CLC; XCE; REP #$10; LDX #$1fff; TXS", 0x78, 0xd8, 0x18, 0xfb, 0xc2, 0x10, 0xa2, 0xff, 0x1f, 0x9a)
    stz(0x4200)
    stz(0x420c)
    # Independently specified bus/arithmetic checks. Failure prevents sound/video.
    write(0x11, 0x5a)
    cpu.emit("LDA $7e0011", 0xaf, 0x11, 0, 0x7e)
    check(0x5a)
    cpu.emit("LDA $800011", 0xaf, 0x11, 0, 0x80)
    check(0x5a)
    write(0x4202, 0x12)
    write(0x4203, 3)
    cpu.emit("16 NOP (multiply settle)", *([0xea] * 16))
    load(0x4216)
    check(0x36)
    write(0x4204, 0x34)
    write(0x4205, 0x12)
    write(0x4206, 3)
    cpu.emit("16 NOP (divide settle)", *([0xea] * 16))
    load(0x4214)
    check(0x11)
    load(0x4215)
    check(6)
    load(0x4216)
    check(1)
    write(0x1e, 1)
    write(0x2100, 0x80)
    write(0x2105, mode)
    stz(0x2107)
    write(0x210b, 1)
    if mode == 7:
        # Identity Mode 7 matrix; map bytes and pixels occupy opposite VRAM lanes.
        for reg in [0x210d, 0x210e, 0x211b, 0x211c, 0x211d, 0x211e, 0x211f, 0x2120]:
            value = 0x100 if reg in [0x211b, 0x211e] else 0
            if effect == "zoom" and reg == 0x211b: value = 0x200
            if effect == "constant" and reg == 0x211b: value = 0
            if effect == "constant" and reg == 0x211f: value = 1
            write(reg, value & 255)
            write(reg, value >> 8)
    stz(0x2121)
    for value in [0, 0x7c, 0x1f, 0, 0xe0, 3, 0xff, 0x7f]:
        write(0x2122, value)
    bpp = 2 if mode == 0 else 4 if mode in [1, 2, 5, 6] else 8
    tile = bytes([0x55, 0] * 8 + [0] * (8 * bpp - 16))
    graphics = tile * (2 if mode in [5, 6] else 1)
    if mode == 7:
        graphics = bytes(v for y in range(8) for x in range(8) for v in [0, x % 2])
    # DMA cartridge graphics into VRAM through the normal alternating-byte port.
    write(0x2115, 0x80)
    stz(0x2116)
    write(0x2117, 0 if mode == 7 else 0x10)
    for address, value in [(0x4300, 1), (0x4301, 0x18), (0x4302, 0),
                           (0x4303, 0x90), (0x4304, 0), (0x4305, len(graphics)), (0x4306, 0), (0x420b, 1)]:
        write(address, value)
    if sprite_priority is not None:
        assert mode == 0 and sprite_priority in [0, 3]
        # One opaque green 8x8 sprite at (16,16); other objects are offscreen.
        write(0x2121, 130)
        write(0x2122, 0xe0)
        write(0x2122, 3)
        write(0x2101, 1)
        stz(0x2116)
        write(0x2117, 0x20)
        for address, value in [(0x4302, 0x40), (0x4305, 32), (0x420b, 1)]:
            write(address, value)
        stz(0x2102)
        stz(0x2103)
        for address, value in [(0x4320, 0), (0x4321, 4), (0x4322, 0),
                               (0x4323, 0x94), (0x4324, 0), (0x4325, 0x20), (0x4326, 2), (0x420b, 4)]:
            write(address, value)
    write(0x212c, 0x11 if sprite_priority is not None else 1)
    if display:
        write(0x2133, display)
    if effect == "window":
        for address, value in [(0x2123, 2), (0x2126, 64), (0x2127, 127), (0x212e, 1)]:
            write(address, value)
    if effect == "math":
        for address, value in [(0x2130, 0), (0x2131, 1), (0x2132, 0x5f)]:
            write(address, value)
    # Standard IPL port handshake; send the SPC program, sample table and BRR.
    cpu.label("ipl")
    load(0x2140)
    cpu.emit("CMP #$aa", 0xc9, 0xaa)
    cpu.branch(0xd0, "ipl")
    write(0x2142, 0)
    write(0x2143, 2)
    write(0x2141, 1)
    write(0x2140, 0xcc)
    cpu.label("kick")
    load(0x2140)
    cpu.emit("CMP #$cc", 0xc9, 0xcc)
    cpu.branch(0xd0, "kick")
    cpu.emit("LDX #0", 0xa2, 0, 0)
    cpu.label("upload")
    cpu.emit("LDA $009100,X", 0xbf, 0, 0x91, 0)
    cpu.emit("STA $2141; TXA; STA $2140", 0x8d, 0x41, 0x21, 0x8a, 0x8d, 0x40, 0x21)
    cpu.label("echo")
    cpu.emit("CMP $2140", 0xcd, 0x40, 0x21)
    cpu.branch(0xd0, "echo")
    cpu.emit("INX; CPX #$0300", 0xe8, 0xe0, 0, 3)
    cpu.branch(0xd0, "upload")
    write(0x2142, 0)
    write(0x2143, 2)
    stz(0x2141)
    write(0x2140, 1)  # last counter ff; next expected 00; 01 terminates block
    cpu.label("sound")
    load(0x2140)
    cpu.emit("CMP #$5a", 0xc9, 0x5a)
    cpu.branch(0xd0, "sound")
    cpu.label("timer")
    load(0x2141)
    cpu.branch(0xf0, "timer")
    write(0x2100, 0x0f)
    # Channel 1 HDMA reselects CGRAM address 0 at rows 0 and 127. It changes
    # no palette contents, keeping the independently specified BG pixels simple.
    for address, value in [(0x4310, 0), (0x4311, 0x21), (0x4312, 0x80),
                           (0x4313, 0x90), (0x4314, 0), (0x420c, 2)]:
        write(address, value)
    # NMI increments WRAM $10; main loop waits for it, then samples controller B.
    stz(0x10)
    write(0x4207, 128)
    stz(0x4208)
    write(0x4200, 0x91 if autojoy else 0x90)
    cpu.emit("CLI (enable horizontal timer IRQ)", 0x58)
    cpu.label("frame")
    load(0x10)
    cpu.branch(0xf0, "frame")
    stz(0x10)
    if autojoy:
        cpu.label("joybusy")
        load(0x4212)
        cpu.emit("AND #1", 0x29, 1)
        cpu.branch(0xd0, "joybusy")
        load(0x4219)
        cpu.emit("AND #$80 (automatic B)", 0x29, 0x80)
    else:
        write(0x4016, 1)
        stz(0x4016)
        load(0x4016)
        cpu.emit("AND #1", 0x29, 1)
    cpu.branch(0xf0, "red")
    write(0x2121, 1)
    write(0x2122, 0xe0)
    write(0x2122, 3)
    cpu.branch(0x80, "frame")
    cpu.label("red")
    write(0x2121, 1)
    write(0x2122, 0x1f)
    write(0x2122, 0)
    cpu.branch(0x80, "frame")
    cpu.label("nmi")
    cpu.emit("PHA", 0x48)
    load(0x4210)
    cpu.emit("INC $10; PLA; RTI", 0xe6, 0x10, 0x68, 0x40)
    cpu.label("irq")
    cpu.emit("PHA", 0x48)
    load(0x4211)
    cpu.emit("INC $12; PLA; RTI", 0xe6, 0x12, 0x68, 0x40)
    cpu.label("fail")
    write(0x1e, 0xff)
    write(0x2100, 0x80)
    cpu.label("failed")
    cpu.branch(0x80, "failed")
    rom = bytearray([0xcb] * 32768)
    rom[:len(cpu.finish())] = cpu.data
    rom[0x1000:0x1000 + len(graphics)] = graphics
    rom[0x1080:0x1085] = bytes([127, 0, 97, 0, 0])
    if sprite_priority is not None:
        rom[0x1040:0x1060] = bytes([0, 255] * 8 + [0] * 16)
        oam = bytearray([0, 240, 0, 0] * 128 + [0] * 32)
        oam[:4] = bytes([16, 16, 0, sprite_priority << 4])
        rom[0x1400:0x1620] = oam
    rom[0x1100:0x1400] = payload
    rom[0x7fc0:0x7fd5] = b"WEBRTL ORIGINAL TEST ".ljust(21)
    rom[0x7fd5:0x7fdc] = bytes([0x20, 0, 5, 0, 1, 0, 0])
    # Both native and emulation NMI vectors, reset and IRQ (unexpected -> NMI).
    for offset in [0x7fea, 0x7ffa]:
        struct.pack_into("<H", rom, offset, cpu.labels["nmi"])
    for offset in [0x7fee, 0x7ffe]:
        struct.pack_into("<H", rom, offset, cpu.labels["irq"])
    struct.pack_into("<H", rom, 0x7ffc, 0x8000)
    rom[0x7fdc:0x7fe0] = bytes([0xff, 0xff, 0, 0])
    checksum = sum(rom) & 0xffff
    struct.pack_into("<HH", rom, 0x7fdc, checksum ^ 0xffff, checksum)
    return rom, cpu, apu


if __name__ == "__main__":
    rom, cpu, apu = build()
    (TARGET / "test.sfc").write_bytes(rom)
    (TARGET / "test-listing.txt").write_text("Original GPL-3.0-or-later fixture. All labels are resolved below and in test.sfc.\n\n65C816\n" + "\n".join(cpu.listing) + "\n\nSPC700\n" + "\n".join(apu.listing) + "\n")
