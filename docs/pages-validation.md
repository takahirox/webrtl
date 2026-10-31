# Pages workflow split: pre-merge validation for #26

Validated locally on 2026-10-31 on macOS/arm64, Node 26.12.1, npm 11.20.0,
Python 3.13.13, and the lockfile's Playwright 1.64.1. Actions use Ubuntu 24.04
and Node 22; these local timings do not measure hosted installation or deployment.

The sequential fast-path rehearsal used npm/browser download caches and a fresh
static build. Each command exited successfully:

| Command | Local elapsed |
| --- | ---: |
| `npm ci` | 0.71 s |
| `npx playwright install chromium` | 0.49 s |
| `npm run build:demo` | 0.25 s |
| `npm run test:pages` (two Chromium checks) | 3.05 s |
| Total | 4.51 s |

The initial smoke-only run reported two passing tests in 2.9 s. A cold hosted
runner also installs browser OS dependencies, downloads tools, uploads the Pages
artifact, and waits for the Pages service. The initial operational target is
under ten minutes excluding runner/environment approval queues, to be measured
on real `main` runs and adjusted from evidence. It is not a deployment guarantee.
The old workflow run linked in [Issue #26](https://github.com/takahirox/webrtl/issues/26)
was reported still in the full suite after three hours; no full-suite duration
was measured in this local validation.

`actionlint` v1.7.12 passed on both workflows. Read-only YAML assertions verified
PR/main/manual events, `main` targets, build → smoke → upload order, deployment's
dependency on build and `main`-only condition, no full/native/Firefox suite in
Pages, separate concurrency groups, no cancellation of active Pages runs, no
ignored smoke failure, and exactly one `npm test` invocation in full validation.

Failure injection against the existing built artifact produced exit 1 and one
failed test in each case. The original bytes were restored after every case:

| Deliberate damage | Check that rejected it |
| --- | --- |
| Remove `examples/snes/test.sfc` | Asset response must succeed |
| Replace `index.html` with unrelated HTML | Served index must match this checkout's browser-mode HTML |
| Replace `build-info.json` with a stale SHA | Provenance must match checkout `HEAD` |
| Replace `app.js` with a thrown error | Browser must load the example and compile successfully |

To reproduce these negative checks after a successful build, run this from the
repository root with no other static tests running. Only ignored build outputs
are modified, and each is restored even when the assertion fails:

```sh
python3 - <<'PY'
from pathlib import Path
import subprocess

site = Path('.build/pages/webrtl')
cases = [
    ('examples/snes/test.sfc', None, 'serves this checkout'),
    ('index.html', b'<html>broken build</html>', 'serves this checkout'),
    ('build-info.json', b'{"commit":"stale"}', 'serves this checkout'),
    ('app.js', b'throw new Error("broken static app");', 'loads the SNES project'),
]
for relative, replacement, pattern in cases:
    path = site / relative
    original = path.read_bytes()
    try:
        if replacement is None:
            path.unlink()
        else:
            path.write_bytes(replacement)
        result = subprocess.run(
            ['npm', 'run', 'test:pages', '--', '--grep', pattern],
            capture_output=True, text=True)
        assert result.returncode == 1 and '1 failed' in result.stdout, result.stdout
        print(f'PASS: rejected {relative}')
    finally:
        path.write_bytes(original)
PY
```

Python service and SNES asset validation passed: ten tests in 3.086 s.
`npm run test:demo -- counter.spec.js` also passed all eight existing counter
tests across Chromium and Firefox in 48.1 s, exercising the preserved build/test
command and real browser toolchain.
`npx playwright test --config=playwright.static.config.js --list` discovered all
68 tests in seven files, including thirteen full SNES cartridge batches and the
Slang/layout check in **each** of Chromium and Firefox. Existing full-suite files
and the `npm test`, `test:local`, and `test:demo` commands were preserved.

Trusted-local validation could not pass on this host: the default port 8765 was
already occupied. Repeating the unchanged test with a temporary configuration on
port 18765 reached native compilation with Verilator 5.052 and Emscripten 6.0.13,
which failed in the linker with undefined `pthread_getaffinity_np`,
`pthread_setaffinity_np` and `sched_getcpu` symbols from Verilator. This is outside the changed static build
and workflow code; no native-toolchain workaround was added. The complete
`npm test`/SNES regression execution remains a required PR/manual CI check on the
Ubuntu reference toolchain, not a claimed local pass.

At the time of the initial #26 validation, real `main` deployment, public SNES
selector/commit verification, and a hosted full-validation result remained
**pending after merge**, as described in the
[deployment runbook](../README.md#github-pages-deployment). No hosted workflows
were dispatched and no repository settings were changed during that validation.


## Sequencing outcome and #30 follow-up

The maintainer explicitly advanced the CI-only #26 split before its full suite
finished. Full run [41162403351](https://github.com/takahirox/webrtl/actions/runs/41162403351)
was **cancelled**, not passed; the ordinary full-check-before-merge policy remains.
PR #27 merged as `f1436da63cf4003334fc1cc49af53508c890675d`.
The [real main Pages run](https://github.com/takahirox/webrtl/actions/runs/41180403737)
passed: build/smoke 42 seconds, deploy 9 seconds, publication 55 seconds from build
start, with queue wait separate. The Issue records HTTP 200 for public index and
build metadata matching that merge commit, plus fresh Chromium SNES selection,
source loading and no page errors. This supersedes the pending publication status
above; it does not establish a full-regression pass.

[Issue #30's performance record](regression-performance.md) owns optimized full
validation and its required subsequent CI verification. The full workflow now
splits the same local `npm test` coverage across preparation and both browser
jobs. Pages retains its own bounded build/smoke/upload/deploy provenance and
failure propagation, without depending on that expensive workflow.
