"""The build boundary: one Verilog string -> sim.mjs + sim.wasm in a directory."""

import argparse
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parent
BUILD_TIMEOUT = 120
MAX_SOURCE_BYTES = 64 * 1024


class BuildError(Exception):
    pass


def compile_verilog(source, output):
    """Compile trusted HDL only. This invokes native tools; it is not a sandbox."""
    if not isinstance(source, str) or not source.strip():
        raise BuildError("Provide nonempty Verilog source in the 'source' field.")
    if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise BuildError("Verilog source exceeds the 64 KiB limit.")
    for tool in ("verilator", "em++"):
        if not shutil.which(tool):
            raise BuildError(f"Missing {tool}. Install Verilator and Emscripten; see README.md.")

    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    # The CLI can reuse a build directory; never link stale generated model files.
    shutil.rmtree(output / "obj_dir", ignore_errors=True)
    for artifact in ("sim.mjs", "sim.wasm"):
        (output / artifact).unlink(missing_ok=True)
    (output / "counter.v").write_text(source, encoding="utf-8")
    deadline = time.monotonic() + BUILD_TIMEOUT

    def run(arguments):
        # No shell, fixed arguments, and a process group so timeout kills children too.
        with (output / "build.log").open("w+b") as log:
            process = subprocess.Popen(
                arguments, cwd=output, stdout=log, stderr=log, start_new_session=True
            )
            try:
                process.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise BuildError(f"Build exceeded {BUILD_TIMEOUT} seconds. Simplify the design.") from None
            log.seek(0, os.SEEK_END)
            log.seek(max(0, log.tell() - 16000))
            diagnostics = log.read().decode("utf-8", errors="replace")
        if process.returncode:
            raise BuildError(f"{arguments[0]} failed:\n{diagnostics}")
        return diagnostics

    version = run(["verilator", "-V"])
    roots = re.findall(
        r"^[ \t]*VERILATOR_ROOT[ \t]*=[ \t]*(\S[^\r\n]*)$", version, re.MULTILINE
    )
    if not roots:
        raise BuildError("Cannot locate Verilator headers from 'verilator -V'. Check your installation.")
    include = Path(roots[-1].strip()) / "include"
    run([
        "verilator", "--cc", "--top-module", "counter", "--prefix", "Vcounter",
        "--Mdir", "obj_dir", "--no-timing", "--threads", "1", "counter.v",
    ])
    generated = sorted((output / "obj_dir").glob("Vcounter*.cpp"))
    run([
        "em++", "-std=c++17", "-O1", "--no-entry",
        # Verilator 5.020 has no Wasm CPU-relax intrinsic. This model has one thread.
        "-DVL_IGNORE_UNKNOWN_ARCH",
        f"-I{include}", f"-I{include / 'vltstd'}", "-Iobj_dir",
        str(ROOT / "simulator.cpp"), *map(str, generated),
        str(include / "verilated.cpp"), str(include / "verilated_threads.cpp"),
        "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=web",
        "-sFILESYSTEM=0", "-sALLOW_MEMORY_GROWTH=1", "-sMAXIMUM_MEMORY=67108864",
        '-sEXPORTED_FUNCTIONS=["_sim_init","_sim_step","_sim_reset","_sim_count","_sim_destroy"]',
        "-o", "sim.mjs",
    ])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compile trusted local Verilog to WebAssembly.")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        compile_verilog(args.source.read_text(encoding="utf-8"), args.output)
    except (BuildError, OSError) as error:
        parser.exit(1, f"{error}\n")
    print(f"Built {args.output / 'sim.mjs'} and {args.output / 'sim.wasm'}")
