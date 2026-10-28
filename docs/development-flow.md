# Development Flow

This is the development flow for webrtl, including work by AI agents:
Issue → implementation → PR → review → revision as needed → merge.
Perform post-merge verification only when the Issue requires it.

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

The repository currently contains collaboration templates and documentation, with
no application files, dependencies, CI, or configured build/test commands. Do not
invent build or runtime commands or add tooling merely to document a process.
Choose validation appropriate to the changed files and actual available tooling.

For templates and documentation, inspect Markdown structure and template syntax,
verify relative links and heading anchors, and check policy consistency. Run
`git diff --check` for unstaged whitespace errors and `git diff --cached --check`
for staged changes; stage new files so the latter check includes them. No runtime
tests, hardware checks, or deployed-site verification are needed for a
templates/documentation-only change. If application tooling is added later, inspect
it before choosing commands.

## 3. Create a Pull Request for the Issue

Use the [PR template](../.github/pull_request_template.md). Target `main` unless the
task specifies another branch. Explain the problem, resulting behavior, focused
changes, related Issues, and validation actually performed. Report failures,
skipped checks, and unperformed checks accurately, including reasons.

Claim to close an Issue only when the PR fully addresses it. Clearly describe any
intentional partial implementation and leave the Issue open. Record required
post-merge checks separately as pending until performed; their pending state does
not make an otherwise complete implementation partial.

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

## 6. Perform required post-merge verification

Only when required, perform the recorded post-merge checks and report actual
results, including failures and follow-up. Keep them pending until performed.
Pre-merge validation does not prove deployment or publication succeeded. Checks
possible only after merge do not prevent pre-merge approval of an otherwise
complete PR.
