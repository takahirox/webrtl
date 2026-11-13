# Development Flow

This is the development flow for webrtl, including work by AI agents:
Issue → implementation → PR → review → revision as needed → merge and close the
original Issue → required post-merge verification. Require that verification only
when the actual change needs it, as recorded in the Issue.

## Collaboration language

Use **English** for newly authored templates, development/review/merge
documentation, AI instructions, Issue and PR titles and bodies, review comments,
and commit messages. This collaboration convention does not require translating
historical content or changing product localization.

## 1. Start with an Issue

Use the [Issue template](../.github/ISSUE_TEMPLATE/issue.md) to capture the problem,
expected outcome, relevant context, reproduction steps where applicable, and
concrete completion criteria. An assignee or owner field is not required.

Treat the source Issue as the scope of the work. Inspect the current repository
and default branch (`main`), reuse equivalent files, and preserve useful existing
instructions. Clarify genuinely blocking ambiguity before dependent work rather
than inventing requirements.

Default to completion criteria an AI agent can execute and verify. Require human
confirmation, physical-device testing, subjective evaluation, or external approval
only when necessary for the actual Issue. Explain why and what result is expected.
Separate optional validation from mandatory completion criteria.

Mandatory pre-merge acceptance must be achievable and verifiable before merge.
Checks possible only after merge must not be pre-merge approval conditions. Record
genuinely necessary post-merge work separately; do not add it routinely. This
distinction preserves implementation requirements and applicable pre-merge tests.
For example, if merging triggers deployment, applicable local checks belong before
merge, while confirming deployment and publication belongs after merge.

## 2. Implement the smallest complete change

Prefer the smallest coherent design that fully satisfies the Issue. Check both
for missing requirements and for unjustified scope or complexity. Avoid
unnecessary abstractions, speculative extensibility, unrelated refactoring, new
frameworks/subsystems, or extra policies/configuration without a demonstrated need
tied to the Issue. Added complexity is not automatically beneficial. Preserve
justified existing conventions; simplicity does not excuse omitted requirements
or necessary validation.

### Repository validation

For application changes, follow the toolchain setup and validation commands in
[README.md](../README.md#validation). Python standard-library tests cover the
service and reproducible SNES assets. Playwright compiles and runs real RTL in
trusted-local Chromium and static-site Chromium/Firefox suites. Choose validation
appropriate to the changed files and available tooling, following the
[test and CI performance principles](#test-and-ci-performance-principles).

For templates and documentation, inspect Markdown structure and template syntax,
verify relative links and heading anchors, and check policy consistency. Run
`git diff --check` for unstaged whitespace errors and `git diff --cached --check`
for staged changes; stage new files so the latter check includes them. No runtime
tests, routine manual approval, hardware checks, heavyweight model downloads, or
deployed-site verification are needed solely for a templates/documentation change.

### Test and CI performance principles

**Detect the required failures at the lightest appropriate layer, without
redundant execution.** Preserve required correctness, regressions and meaningful
integration coverage when redistributing checks.

1. **Prefer the lightest meaningful layer.** Cover calculations, branches and
   broad data combinations with fast unit/component checks where possible, as
   the Python service tests do by mocking compilation. Keep real browser/compiler
   tests for RTL-to-Wasm behavior, worker boundaries, Canvas/Web Audio, controls
   and cartridge execution that require them. Assert independent expected
   behavior that catches a concrete defect; avoid mirroring the implementation.
2. **Choose combinations deliberately.** Cover distinct paths with representative
   examples, RTL interfaces, cartridge mappings, device states and browsers.
   Exhaust combinations when their interactions require it, rather than multiplying
   every case by every browser and deployment mode automatically. Preserve the
   existing Chromium/Firefox regressions and independent pixel/PCM/CPU assertions;
   see the [SNES fixture guidance](snes-fixtures.md) for bounded batches and reset
   comparisons that must survive any redistribution.
3. **Match validation to the change.** Documentation needs the Markdown/link and
   whitespace checks above. UI changes need relevant controls, diagnostics and
   output lifecycle checks; compiler/runtime/RTL changes need relevant Python,
   real compilation and circuit regressions. CI/build changes need affected setup,
   static assets and artifact-path validation. Require the fast PR gate and
   additional affected-area evidence before merge,
   following [the selection policy](pr-validation.md). A fast pass does not prove
   exhaustive cartridge compatibility; use focused or complete extra checks when
   the changed behavior needs them. `npm test` runs `test:unit` (Python and reuse
   checks), `test:local`, then `test:demo` (including `build:demo`). The
   [full-validation workflow](../.github/workflows/validation.yml) runs the same
   coverage nightly and on manual dispatch, building once and testing
   Chromium/Firefox in independent jobs. The [Pages workflow](../.github/workflows/pages.yml)
   independently builds and smoke-tests its own `main` publication artifact.
   [Fast PR validation](../.github/workflows/pr.yml) reuses the Pages smoke on
   its single build and runs bounded Chromium generic/SNES lanes on every PR.
   Keep mandatory pre-merge checks applicable to the change, optional checks such
   as extra-browser exploration separate, and genuinely
   required live publication checks recorded separately after merge.
4. **Reuse work and avoid duplicate execution.** Reuse builds, generated fixtures
   and downloads with keys covering relevant source/toolchain inputs and isolation
   that prevents stale results or shared-state leaks. CI already caches npm
   downloads and deploys the tested static artifact; SNES batches reuse a
   browser-compiled module across batches with an exact served-build/browser
   fingerprint, and power resets create fresh instances for every cartridge.
   When changing CI, avoid equivalent push/PR runs for
   the same revision and cancel superseded validation when safe, preserving
   deployment ordering (the current Pages workflow does not cancel running jobs).
   Measure resource use before increasing parallelism; both Playwright configs
   use one worker; CI separates browsers onto independent runners.
5. **Review value and cost together.** Identify the additional defect each new or
   expanded test detects, existing coverage supplying the same assurance, and added
   execution/maintenance cost. Watch repeated fresh browser/compiler setup, large
   cartridge fixtures, long RTL simulation loops and Cartesian-product growth.
   Keep meaningful assertions and required coverage when reducing duplicated work.
6. **Maintain an execution-time budget.** See the
   [regression performance record](regression-performance.md) for the
   reference-runner budget, bounded comparisons and completed Ubuntu acceptance.
   A completed optimized Ubuntu full run is recorded separately from the
   original cancelled baseline and the pending #34 fast-gate acceptance. Use the scoped
   [SNES measurements](snes.md#validation-and-measurements)
   and [recorded run evidence](snes-validation.json) as context, not a normal-CI
   promise: they cover differing fixture selections and worker counts. Establish a
   comparable baseline/target during actual test/CI performance work, track growth
   and investigate overruns. Record elapsed feedback time, total runner/computation
   time and queue time separately; revisit validation structure and duplication
   while retaining required coverage. This guidance adds no benchmark or merge gate.

## 3. Create a Pull Request for the Issue

Use the [PR template](../.github/pull_request_template.md). Target `main` unless the
task specifies another branch. Explain the problem, resulting behavior, focused
changes, related Issues, and validation actually performed. Report failures,
skipped checks, and unperformed checks accurately, including reasons.

Use the normal `Closes #N` reference when the implementation fully addresses the
Issue and applicable mandatory pre-merge acceptance is satisfied. Clearly describe
any intentional partial implementation and its remaining scope; use a non-closing
Issue link and leave the parent Issue open. Record required post-merge checks
separately as pending until performed; their pending state does not make an
otherwise complete implementation partial.

## 4. Review and revise

Every PR should be reviewed using the [review guidelines](review-guidelines.md).
The central question is: **Does the PR completely solve the source Issue, without
unnecessary scope or complexity?**

Request fixes for agent-fixable findings and review the updated PR again. If
genuinely necessary human input is missing, record the specific question, why it
is necessary, and the expected result. Use the workflow's wait path and wait for
the answer rather than repeatedly requesting code fixes. Distinguish this state
from agent-fixable findings.

## 5. Merge

Approve and merge when the implementation and mandatory pre-merge checks are
sufficient and no blocking review findings or necessary human answers remain
outstanding. Follow the task's authorization and repository merge permissions;
guidance alone does not grant permission to merge.

Close the original Issue after successful merge, normally through `Closes #N`.
Review must not request removing that reference, keeping the Issue open, or
withholding approval solely because post-merge-only verification is pending.
ProjectWeave publication adds the closing reference and its merge/close stages
close the Issue; reversing this in review creates a repeated
Review → Fix → Publish → Review loop. Actual missing implementation, mandatory
pre-merge tests, required repository protections/reviews and genuinely necessary
pre-merge human acceptance remain blockers.

## 6. Perform required post-merge verification

After merge and Issue closure, perform genuinely required checks and record
accurate evidence in the merged PR, closed Issue, or a linked validation report.
Include the tested revision, commands or steps, actual results and relevant
run/deployment links. Report unperformed, pending or environment-blocked checks
with reasons; keep them pending until performed. Issue closure does not claim
they passed, and pre-merge validation does not prove deployment or publication
succeeded. An unavailable test environment alone is not evidence of a product
defect.

If verification finds an actual defect, first check for an existing equivalent
Issue. Use that Issue or create a new one with reproduction steps, affected
revision, expected/actual behavior and links to the original Issue and PR. Do not
reopen the original Issue solely for post-merge follow-up.

This lifecycle supersedes older instructions to keep an implemented Issue open
solely for post-merge verification. Preserve historical test outcomes and evidence,
including pending, blocked, failed and cancelled results; this policy does not
rewrite them or waive existing verification requirements.
