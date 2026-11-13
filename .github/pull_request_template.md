<!-- Write the title and body in English. -->

## Summary

Describe the source problem and the focused changes that address it.

## Outcome

Describe the resulting behavior, including before/after behavior when useful.
Explain any intentionally partial scope and remaining work; leave the parent Issue
open for that work. Pending post-merge-only verification does not make an otherwise
complete implementation partial.

## Validation

Record the checks actually performed and their results. Report failures, skipped
checks, and unperformed checks with reasons. Choose checks appropriate to the
changed files and available repository tooling; do not invent commands or require
unrelated runtime suites for documentation-only changes.

For substantial compiler/runtime/debugger/SNES changes, record additional
affected-area evidence per [the CI policy](../docs/pr-validation.md): changed
behavior, commands/fixture names, tested SHA, results and artifact/run links.
Explain why the observations cover the change and identify unresolved gaps.
Fast PR checks alone do not establish exhaustive SNES compatibility.

## Required post-merge verification

List genuinely necessary checks possible only after merge as pending until
performed, or state "None." Keep them separate from pre-merge validation.
After merge and Issue closure, record actual evidence per the
[post-merge lifecycle](../docs/development-flow.md#6-perform-required-post-merge-verification).
Report unperformed/environment-blocked checks honestly; closure does not claim
they passed. Track actual defects in an equivalent or new linked Issue.

## Related Issues

Link the source Issue and any related Issues. Use `Closes #<number>` when the PR
fully implements that Issue and mandatory pre-merge acceptance is satisfied.
Preserve it when only post-merge verification is pending. Use a non-closing link
for intentional partial work.
