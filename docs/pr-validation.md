# Fast PR and comprehensive validation (#34)

Require **Fast PR validation / Fast PR checks** on every PR to `main`, including
updates. The aggregate runs with `always()` and accepts only successful unit/build
and both browser lanes. Failure, skip, cancellation and timeout cannot pass it.
There are no path filters, retries, external compiler services or uploaded RTL.
Build once, transfer that run's SHA-named artifact, verify checkout/build SHA, then
use static GETs and browser-generated Wasm. Chromium lanes run on independent
Ubuntu 24.04 runners with one worker each. The generic lane reuses the Pages
build/provenance smoke. Pages publication runs separately on `main` pushes/manual
requests and deploys only its own successful build/smoke artifact.

## Deterministic selection and limits

Every PR runs the same conservative selection in
[pr-selection.cjs](../tests/pr-selection.cjs); broad changes cannot fall back to a
counter-only test. Selection does not depend on changed filenames. The dedicated
[PR config](../playwright.pr.config.js) rejects a cartridge-expression override.
Unit discovery checks reject missing selected tests, accidental corpus expansion,
and loss of the complete fixture inventory. The PR smoke has its own bounded
observations; no comprehensive assertion or simulation loop is changed.

| Every PR | Observable behavior |
| --- | --- |
| Python/Node units | Service validation/errors/origins, reproducible assets, immutable compilation invalidation, PR selection and aggregate failure semantics |
| Two Pages smoke checks | Same-commit served files, user-edited counter → real frontend/Clang/Wasm → Step=3,6; static same-origin GETs |
| Four generic mode checks | RAM, inputs, both clock edges, Fast→Debug→Fast continuity, reset, breakpoints/history, asynchronous cascades, unsigned wide inspection |
| Two output checks | Edited RTL → Canvas pixels and framing/errors; independent PCM/sample timing → real Web Audio; pause/reset/edit lifecycle and bounds |
| One SNES cartridge smoke | Compile the complete unmodified console via Slang/Clang in the browser; boot `test.sfc` through the production simulator worker; check every tile/palette pixel, exact independently calculated DSP PCM, sample clock, serial B input, HDMA and NMI/IRQ activity; power-reset into a fresh instance and compare every startup CPU bus transaction |

The SNES smoke exercises genuine CPU/PPU/APU/cartridge/DMA/control integration.
It runs 32,768 startup clocks, 1,638,400 boot/output clocks, 786,432 input
clocks and a 32,768-clock CPU startup replay, with unchanged production resets.
It does not repeat the comprehensive UI/LoROM/HiROM baselines or run the four
previously selected corpus cartridges on each PR; those remain in the full suite.
It does **not** establish compatibility across all 260
cartridge variants, instruction/addressing combinations, display modes, DSP
states, interrupt positions, HiROM, SNES keyboard/gamepad UI behavior, Firefox
behavior or trusted-local toolchains. Changes to CPU arithmetic, HDMA edge cases,
SPC700 division or cartridge mapping require the affected corpus cases below;
the single boot cartridge does not replace that evidence.

## Additional affected-area validation before merge

A fast pass supplies bounded confidence. Reviewers must inspect the diff and
record additional commands, selected fixture names, tested SHA, results and
artifact/run links in the PR for substantial changes in these areas. The PR
template prompts for this evidence; a green aggregate does not waive review.

| Changed files/behavior | Additional required evidence appropriate to the change |
| --- | --- |
| `examples/snes/`, `scripts/adapt_snes.py`, SNES ROM generator | Select affected CPU/IRQ, PPU/raster, DMA/HDMA, APU/audio or bus/cartridge cases from the full corpus; include related reset replay and independent pixel/PCM expectations |
| `web/compiler-worker.js`, C++ adapters/debug runtime, toolchain dependencies, generic compiler/service | Real edited project/interface compilation, error handling and relevant circuit regressions; run trusted-local checks for native service/compiler changes |
| `web/simulator-worker.js`, project/clock/reset/debugger logic | Relevant `modes*.spec.js`, generic examples, reset/input/state continuity and affected SNES circuits |
| Canvas/audio/UI/cartridge parsing | Relevant `outputs.spec.js`, cartridge layout, control lifecycle and browser checks; use Firefox when behavior depends on browser APIs |
| Broad compiler/runtime/SNES changes | A representative selection spanning **all affected** CPU, PPU, DMA, APU, cartridge, reset and output behavior; dispatch the complete suite on the PR branch if a bounded selection cannot justify the change |

Use [the fixture guide](snes-fixtures.md) to choose names and independent oracles.
Narrow validation is insufficient when the changed behavior is outside those
observations. Require additional focused or manual full evidence before approval;
record unresolved gaps explicitly and do not claim exhaustive pre-merge coverage.
Do not require the multi-hour full status unconditionally for every PR.

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:pr                  # units + build + both bounded lanes, sequential locally
npm run test:pr:built -- --project=pr-generic
npm run test:pr:built -- --project=pr-snes
# Extra affected-area checks against the same build (not the fixed PR config):
WEBRTL_SNES_FIXTURES='^(cpu-binary|irq-h-80|dma-1|mode-7|audio-gain|bus-sram-hirom)$' \
  npm run test:demo:built -- --project=chromium --grep 'focused SNES RTL'
npm run test:demo:built -- --project=chromium --grep 'falling-edge outputs'
```

## Nightly/manual full coverage and failure response

[Full validation](../.github/workflows/validation.yml) runs nightly at **18:17 UTC**
(03:17 JST), on the default branch, and via `workflow_dispatch` on a selected ref.
It no longer runs automatically on PRs. **Full regression suite** remains a
separate status: units, native trusted-local Chromium, and all 80 static tests
(40 per browser), including **260 cartridge fixtures + 29 CPU/IRQ reset replays
per browser**. The original AUX repeat is included in the 260. Every fixture,
independent oracle, simulation loop and immutable-Wasm reuse survives. Discovery
checks verify both browser inventories. Native tools and Firefox audio setup stay
in this workflow. Full jobs retain their 180-minute limits and failure artifacts.

```sh
# Install native Verilator/Emscripten and the Firefox audio backend as in README.
npx playwright install --with-deps chromium firefox
npm test                         # complete local regression, unchanged
npm run test:demo                 # complete browser regression, builds once
npm run test:demo:built -- --list  # discover both complete browser inventories
# Maintainer operation when authorized; select a PR branch for additional evidence:
gh workflow run validation.yml --ref <branch>
```

A failed full run stays red, with the run URL and source SHA in its aggregate
summary/error. Maintainers should enable GitHub Actions failure notifications and
inspect the nightly run each working day. Link the failed run and the downloaded
`regression-chromium`/`regression-firefox` JSON, traces, Wasm and measurement files
in an investigation Issue. Reproduce the failing names against that SHA locally
or dispatch that ref; determine whether a recent merge, environment or a flaky
assumption caused it. A subsequent fast pass does not clear the full failure.
For an introduced regression, fix or revert the responsible change promptly,
add the smallest independent regression that catches it, and confirm affected
checks plus a subsequent comprehensive run. Record failed/cancelled attempts;
never reclassify them as success or discard their assertions.

## Budgets, provenance and acceptance

Preparation has a two-minute limit, browser jobs nine minutes, Playwright 510
seconds per lane (including server startup), and the aggregate one minute.
The aggregate queries this run/attempt's Actions timestamps. For its running job,
it anchors the runner-local duration since the first setup step to the Actions
job start, avoiding subtraction across clocks (the first Ubuntu run had a
one-hour offset). It fails at a **590s creation-to-check estimate**, reserving
ten seconds for initial aggregate setup, timestamp precision and cleanup.
Initial queue, dependency waits, job start/end clocks and completed runner work
are separate. The definitive creation-to-result duration must use the completed
aggregate's Actions `completed_at` minus the run's `created_at`; rerunning the
budget script on completed job JSON uses exactly those timestamps.
An overrun is a failure to investigate,
not grounds to raise timeouts or accept cancelled work. Superseded PR revisions
cancel their entire group; nightly/manual runs and Pages deployment ordering use
independent groups.

Before closing #34, record a successful Ubuntu PR run for the **final revision**:
source/merge SHA and tree identity, URL, creation → aggregate completion **<600s**,
queue/dependency-ready waits separately, total runner work, both lane results and
fixture inventory. Local timings and YAML checks cannot satisfy this criterion.
See [the performance record](regression-performance.md#fast-pr-policy-34).

An administrator must replace unconditional `Full regression suite` and the old
PR Pages status in `main` branch protection/rulesets with **Fast PR checks** after
its first run. Repository settings are not modified by this code change. Until
configured, reviewers must enforce the same check/evidence policy. A merge queue
needs equivalent `merge_group` validation before it can be enabled safely.
