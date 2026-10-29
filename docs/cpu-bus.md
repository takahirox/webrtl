# CPU bus and ROM/RAM self-test

Load **CPU bus · ROM/RAM self-test (pass = 1, fail = 255)** in the browser's
**Example** selector, click **Load example (replaces project)**, then **Compile**.
This selects the five source files in [examples/cpu-bus](../examples/cpu-bus),
top module `bus_test`, and the existing **8-bit counter** output interface.
All files are compiled together by Yosys/Clang in the browser into a fresh Wasm
circuit. No native compiler, build API, uploaded ROM, or precompiled circuit is
used. The static site works under `/webrtl/`.

The `count` display is this example's **result/last transaction byte**, in decimal;
it is wired directly to the test master's `result` register. **0** means reset,
**1** means PASS, and **255** means FAIL. Other values are the progress bytes in
the table below. These codes are distinct for the supplied data. Click **Step**
13 times to see every byte and then PASS, or **Run** to complete in about 1.3 s
at the Counter interface's 10 clocks/s. **Pause** preserves state. Further clocks
after PASS or FAIL keep the result and issue no bus transactions. **Reset** pauses,
clears RAM and master state in RTL, and returns the display to 0; the same sequence
can then be repeated. Reset also works partway through copying or verification.

## Bus contract

The internal bus is a simple byte-addressed, synchronous, single-master interface.
All signals are unsigned. It intentionally has no peripheral framework or
arbitrary top-level port adapter.

| Signal | Direction relative to master | Width | Meaning |
| --- | --- | ---: | --- |
| `clk` | input | 1 | Rising-edge transaction clock |
| `reset` | input | 1 | Active-high synchronous reset shared by master and memory |
| `valid` | output | 1 | A transaction is present for this clock edge |
| `write` | output | 1 | 1 = write; 0 = read; ignored when `valid` is 0 |
| `address` | output | 16 | Byte address, 0–65535 |
| `write_data` | output | 8 | Byte to store for a write |
| `read_data` | input | 8 | Combinationally decoded byte for a read |

The master presents `valid`, direction, address and write data for a cycle,
stable before the rising edge. For a read, the decoder/memory returns combinational
`read_data`, which the master samples **at that rising edge**. For a write, RAM
captures `write_data` **at that rising edge**. There is no `ready`, wait state,
request queue, or separate response cycle. Every valid transaction completes at
the next rising edge, and back-to-back transactions are allowed. Reads never
modify memory. Write-cycle `read_data` is zero; there is no read-during-write
result to consume. A following read sees the stored byte.

Reset has priority over writes, clears every RAM byte and master register, and
suppresses bus requests. The decoder returns zero while reset is asserted. The
browser adapter clocks one reset cycle, deasserts reset and settles the design;
that reset edge is excluded from the sequence below. At deassertion the master
already presents its first ROM read, but no transaction completes until Step/Run.
After each rising edge settles, the adapter reads the updated result register;
the internal bus may already present the *next* transaction at that time.

## Address map and RTL files

| Range (hex, inclusive) | Device | Behavior |
| --- | --- | --- |
| `0000`–`0003` | ROM | Inline bytes `12 34 56 78`; writes ignored |
| `0100`–`0103` | RAM | Four bytes, cleared to zero on reset |
| All other addresses | Unmapped | Reads return `00`; writes ignored |

Inactive (`valid=0`) cycles return zero and cannot write. Full upper address
bits are decoded, so addresses outside these ranges do not alias the tiny memories.
ROM is a synthesizable `case`, with no `$readmemh` or browser-side HDL file I/O.
RAM is a four-element register array with synchronous writes/reset and
combinational reads. Clearing this small array is intentional; it does not claim
efficient block-RAM inference for large memories on an FPGA.

- [bus-test.v](../examples/cpu-bus/bus-test.v) connects master and decoder and
  maps the result register to the Counter contract's `count` output.
- [bus-master.v](../examples/cpu-bus/bus-master.v) sequences transactions and checks
  the readback against independent constants. It is a test state machine, not a CPU.
- [bus-decoder.v](../examples/cpu-bus/bus-decoder.v) selects the address ranges
  and gates writes.
- [bus-rom.v](../examples/cpu-bus/bus-rom.v) supplies the inline ROM data.
- [bus-ram.v](../examples/cpu-bus/bus-ram.v) implements writable memory.

## Test sequence and expected results

For indices 0–3, the master reads ROM, XORs the byte with `a5`, then writes it to
RAM at `0100 + index`. After all four writes, it reads all four RAM locations and
compares them to the independent expected bytes `b7 91 f3 dd`. A mismatch sets
FAIL (255) on that edge and halts. Successful final readback is followed by a
separate completion cycle setting PASS (1). This is a hardwired test sequence;
there is no instruction set or executable CPU program.

| Step after reset | Completed transaction | Result (hex) | Display (decimal) |
| ---: | --- | --- | ---: |
| 0 | Reset; no transaction | `00` | 0 |
| 1 | Read ROM `0000` | `12` | 18 |
| 2 | Write RAM `0100` = `b7` | `b7` | 183 |
| 3 | Read ROM `0001` | `34` | 52 |
| 4 | Write RAM `0101` = `91` | `91` | 145 |
| 5 | Read ROM `0002` | `56` | 86 |
| 6 | Write RAM `0102` = `f3` | `f3` | 243 |
| 7 | Read ROM `0003` | `78` | 120 |
| 8 | Write RAM `0103` = `dd` | `dd` | 221 |
| 9 | Read/verify RAM `0100` | `b7` | 183 |
| 10 | Read/verify RAM `0101` | `91` | 145 |
| 11 | Read/verify RAM `0102` | `f3` | 243 |
| 12 | Read/verify RAM `0103` | `dd` | 221 |
| 13 | Completion; bus idle | `01` (PASS) | 1 |

To see a failure, select `bus-rom.v`, change the first byte from `8'h12` to
`8'h13`, then compile again. Step 1 displays 19, Step 2 displays 182, and Step 9
reports FAIL (255), since the expected RAM byte is still `b7`. Reset repeats the
failure deterministically. Restore the ROM byte and compile to recover. Source
edits discard the old simulation. Syntax errors, missing modules and incompatible
top ports retain the project and show compiler diagnostics below the editor.
You may rename the top module and enter that name in **Top module**; keep the
Counter interface's exact `clk`, `reset`, and unsigned 8-bit `count` ports.

## Validation and limits

Run `npm run test:demo` using the [README setup](../README.md#validation).
[cpu-bus.spec.js](../tests/static/cpu-bus.spec.js) compiles the five files in
Chromium and Firefox under `/webrtl/`, observes each displayed byte from compiled
RTL, repeats after full/partial reset and through Run/Pause, checks edited ROM
and broken RAM failures, and checks compilation errors/recovery. It also drives
the compiled decoder with a small RTL test sequencer to verify inactive and
unmapped transactions, ROM write protection, address boundaries, RAM storage and
reset clearing/write suppression. The existing counter, multi-file, video and
audio tests remain part of that suite.

This is a small two-state CXXRTL cycle simulation using the existing browser
toolchain's source, memory and timeout limits. It does not implement a 65C816,
SNES address map, CPU debugger, external ROM loader, or cycle-accurate SNES timing.
A later CPU adapter would need to translate its bus strobes, address width,
read/write phases and any wait behavior into this contract; no core compatibility
has been verified. Large memories and physical FPGA integration are outside this
example's scope.

**Required post-merge verification for #14 — pending:** after deployment, run an
automated browser check against <https://takahirox.github.io/webrtl/> in a fresh
context: load this example, compile, observe the 13-step sequence above and PASS,
then Reset and Run to PASS again. Record browser/version, deployment commit and
actual results separately. Local static-site tests are pre-merge evidence and do
not prove that the deployed site serves this change.
