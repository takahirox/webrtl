"""Build the static counter demo using the same trusted HDL pipeline as the service."""

import argparse
from pathlib import Path
import shutil
import tempfile

from build import BuildError, ROOT, compile_verilog

SITE = ROOT / ".build/pages/webrtl"


def build_site():
    # Keep compiler intermediates and diagnostics out of the published artifact.
    with tempfile.TemporaryDirectory(prefix="webrtl-site-") as temporary:
        compiled = Path(temporary) / "compiled"
        compile_verilog((ROOT / "examples/counter.v").read_text(encoding="utf-8"), compiled)
        staged = Path(temporary) / "site"
        staged.mkdir()
        html = (ROOT / "web/index.html").read_text(encoding="utf-8")
        (staged / "index.html").write_text(
            html.replace('data-mode="local"', 'data-mode="demo"'), encoding="utf-8"
        )
        for name in ("app.js", "style.css"):
            shutil.copyfile(ROOT / "web" / name, staged / name)
        shutil.copyfile(ROOT / "examples/counter.v", staged / "example.v")
        for name in ("sim.mjs", "sim.wasm"):
            shutil.copyfile(compiled / name, staged / name)
        # Only replace the fixed generated destination after a successful build.
        if SITE.exists():
            shutil.rmtree(SITE)
        shutil.copytree(staged, SITE)
    return SITE


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        site = build_site()
    except (BuildError, OSError) as error:
        parser.exit(1, f"{error}\n")
    print(f"Built static demo in {site.relative_to(ROOT)}")
