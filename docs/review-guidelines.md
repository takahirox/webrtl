# Review and Merge Guidelines

Follow the [development flow](development-flow.md), including its
[English collaboration convention](development-flow.md#collaboration-language).
These steps apply to contributors and AI reviewers.

## Review against the Issue

Read the source Issue, its acceptance criteria, the PR description, the complete
diff, and relevant existing files. Use the Issue as the reference for the intended
problem and expected outcome. Ask:

**Does the PR completely solve the source Issue, without unnecessary scope or complexity?**

## Check for missing work

Verify that every requirement and acceptance criterion the PR claims to resolve
is implemented and appropriately validated. Check behavior, coherence with
existing conventions, and documentation affected by the change. Do not approve a
PR as closing an Issue while implementation or mandatory pre-merge acceptance
remains incomplete. If the change is intentionally partial, ensure the PR states
the remaining scope, uses a non-closing Issue link and leaves the parent Issue
open. Pending post-merge-only verification does not make a complete implementation
partial.

Review applicable interface changes against the [UI/UX principles](../README.md#uiux).

## Check for unnecessary work

Reject unnecessary abstractions, speculative extensibility, unrelated refactoring,
new frameworks/subsystems, or extra policies/configuration without a demonstrated
need tied to the Issue. Added complexity is not automatically beneficial.

Prefer the smallest coherent design that fully satisfies the Issue. Preserve
justified existing conventions. Do not use simplicity to excuse omitted
requirements or necessary validation.

## Check pre-merge acceptance and post-merge verification

Verify mandatory pre-merge acceptance using evidence appropriate to the changed
files and the actual repository tooling. Check that validation claims accurately
describe checks performed, results, failures, skipped checks, and unperformed
checks. Follow the [repository validation guidance](development-flow.md#repository-validation)
and the [application validation commands](../README.md#validation). For documentation-only
changes, check template/Markdown syntax, links, whitespace, and consistency; do not
require unrelated runtime suites, new tooling, routine manual approval,
physical-device tests, heavyweight model downloads, or deployment.

Apply the [test and CI performance principles](development-flow.md#test-and-ci-performance-principles).
For new or expanded tests, review additional defect coverage, duplication and
execution/maintenance cost together. Ask: **Does this change provide sufficient
confidence with the lightest appropriate validation, without redundant execution?**

Human-only acceptance is appropriate only when necessary for the actual Issue,
with a reason and an expected result. Keep optional validation separate from
mandatory completion criteria.

Mandatory pre-merge acceptance must be achievable and verifiable before merge.
Checks possible only after merge must not be pre-merge approval conditions. For
example, applicable local validation precedes a merge-triggered deployment, while
confirmation of publication follows it. This does not waive implementation
requirements or applicable pre-merge tests.

Ensure genuinely necessary post-merge checks are recorded separately as pending
until performed; do not add them routinely. Pre-merge validation does not prove
deployment or publication succeeded.

For #34's CI policy, require **Fast PR checks** for the latest revision and follow
[the exact selection and affected-area rules](pr-validation.md). For substantial
compiler/runtime/debugger/SNES changes, inspect additional focused/manual evidence
(commands, fixture names, tested SHA and actual results). A bounded pass cannot
justify behavior it does not observe. Require complete manual validation when
focused evidence cannot justify the change; do not require the multi-hour status
unconditionally on every PR. Check nightly failures and their investigation links;
a fast pass does not clear them. Before closing #34/#48, inspect an actual Ubuntu
PR run of the final revision, with attempt-specific queue, dependency waits,
execution and outcomes reported
under the [current timing policy](pr-validation.md#budgets-provenance-and-acceptance).
The <600s execution feedback goal is diagnostic; queue or timing overrun alone
does not invalidate successful tests or require human-only recovery.

## Resolve findings and necessary questions

- **Agent-fixable findings:** request concrete fixes, identifying the affected
  file or behavior, the unmet requirement or risk, and the expected result.
  Review the updated PR again against the Issue and relevant checks.
- **CI or infrastructure wait:** inspect and monitor automated checks for the
  current PR head. Use bounded authorized recovery for transient failures and
  follow the current attempt-aware timing policy. Pending checks, queue delays
  and machine-retrievable evidence do not require a human-confirmation response.
  Reassess when checks finish. Report actual test failures or permission blockers
  accurately; do not waive required checks or repeatedly publish unchanged work.
- **Necessary human input:** record the specific question, why a human answer is
  necessary, and the expected confirmation or decision. Enter the workflow's wait
  path and wait for the answer; do not repeatedly request code fixes for that
  question. Resume review when the answer arrives. State this condition separately
  from agent-fixable findings.
- **Optional suggestions:** label them as nonblocking; do not turn preferences or
  optional checks into new mandatory scope.

## Approve and merge

Approve and merge, within the task's authorization and repository permissions, when:

- The implementation completely satisfies the Issue it claims to resolve.
- There is no unjustified scope or complexity.
- Validation is sufficient and all mandatory pre-merge acceptance criteria pass.
- No blocking review findings or necessary human answers remain outstanding.
- Any required post-merge verification is recorded separately and pending until
  performed.

Preserve `Closes #N` for a complete implementation with satisfied mandatory
pre-merge acceptance. Do not request removing it, keeping the source Issue open,
or withholding approval solely for pending post-merge-only checks: that causes
ProjectWeave publication and review to undo each other in repeated
Review → Fix → Publish → Review rounds. Required protections/reviews and necessary
pre-merge human acceptance remain blockers.

Follow the [post-merge lifecycle](development-flow.md#6-perform-required-post-merge-verification):
merge and close the original Issue, then perform genuinely required checks and
record actual evidence in the merged PR, closed Issue, or linked validation report.
Keep unperformed or environment-blocked checks pending with reasons; closure does
not claim they passed. An unavailable environment alone is not a product defect.
For an actual defect, check for an equivalent Issue before creating a new linked
Issue with reproduction steps, affected revision, expected/actual behavior and
original Issue/PR links. Do not reopen the original Issue solely for this follow-up.
