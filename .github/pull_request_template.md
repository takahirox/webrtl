<!-- Write the title and body in English. -->

## Summary

Describe the source problem and the focused changes that address it.

## Outcome

Describe the resulting behavior, including before/after behavior when useful.
Explain any intentionally partial scope; claim to close an Issue only when fully
addressed.

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

## Related Issues

Link the source Issue and any related Issues. Use `Closes #<number>` only when the
PR fully addresses that Issue.
