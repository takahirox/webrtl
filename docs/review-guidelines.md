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
PR as closing an Issue while required work remains. If the change is intentionally
partial, ensure the PR says so and the Issue remains open.

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
require unrelated runtime suites, new tooling, physical-device tests, or deployment.

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

## Resolve findings and necessary questions

- **Agent-fixable findings:** request concrete fixes, identifying the affected
  file or behavior, the unmet requirement or risk, and the expected result.
  Review the updated PR again against the Issue and relevant checks.
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

Pending checks possible only after merge do not block pre-merge approval. When
post-merge checks are required, perform them after merge and report actual results,
failures, and follow-up honestly. Never claim they passed from pre-merge evidence.
