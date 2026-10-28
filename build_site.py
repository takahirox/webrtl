"""Assemble the static browser compiler; never compile a user's HDL at build time."""

import argparse
import json
from pathlib import Path
import shutil
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent
SITE = ROOT / ".build/pages/webrtl"


def build_site():
    packages = ROOT / "node_modules/@yowasp"
    if not (packages / "yosys/gen/bundle.js").is_file():
        raise OSError("Browser toolchain missing. Run npm ci first.")
    with tempfile.TemporaryDirectory(prefix="webrtl-site-") as temporary:
        staged = Path(temporary) / "site"
        staged.mkdir()
        html = (ROOT / "web/index.html").read_text(encoding="utf-8")
        (staged / "index.html").write_text(
            html.replace('data-mode="local"', 'data-mode="browser"'), encoding="utf-8"
        )
        for source in (ROOT / "web").iterdir():
            if source.suffix in (".js", ".css", ".cpp", ".txt"):
                shutil.copyfile(source, staged / source.name)
        shutil.copyfile(ROOT / "examples/counter.v", staged / "example.v")
        for package in ("yosys", "clang"):
            shutil.copytree(packages / package / "gen", staged / "tools" / package)
        # Use headers from exactly the same pinned Yosys distribution. Pass a
        # virtual directory tree to Clang; do not extract archive paths to disk.
        headers = {}
        with tarfile.open(packages / "yosys/gen/yosys-resources.0.tar") as archive:
            prefix = "include/backends/cxxrtl/runtime/"
            for member in archive.getmembers():
                if member.isfile() and member.name.startswith(prefix):
                    parts = member.name[len(prefix):].split("/")
                    directory = headers
                    for part in parts[:-1]:
                        directory = directory.setdefault(part, {})
                    directory[parts[-1]] = archive.extractfile(member).read().decode("utf-8")
        (staged / "tools/cxxrtl.json").write_text(json.dumps(headers), encoding="utf-8")
        if SITE.exists():
            shutil.rmtree(SITE)
        shutil.copytree(staged, SITE)
    return SITE


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        site = build_site()
    except OSError as error:
        parser.exit(1, f"{error}\n")
    print(f"Built static browser compiler in {site.relative_to(ROOT)}")
