---
name: Issue
about: Report a problem or propose a change
title: ""
labels: ""
---

<!-- Write the title and body in English. See the development guidance:
https://github.com/takahirox/webrtl/blob/main/docs/development-flow.md -->

## Problem

Describe the problem and why it matters.

## Expected outcome

Describe what should be true when the Issue is resolved.

## Context and reproduction

Add relevant context, examples, logs, or related Issues. Include reproduction steps
and actual versus expected results when applicable.

## Pre-merge acceptance criteria

List concrete mandatory criteria that can be achieved and verified before merge.
Default to checks an AI agent can execute and verify. Require human confirmation,
physical-device testing, subjective evaluation, or external approval only when
necessary for this Issue; explain why and what result is expected.

- [ ] Describe a verifiable completion criterion.

Checks possible only after merge must not be prerequisites for pre-merge approval.
Keep all implementation requirements and applicable pre-merge checks here.

## Optional validation

List useful additional checks that are not required for completion, or state
"None." Keep these separate from mandatory acceptance criteria.

## Required post-merge verification

Record genuinely necessary checks possible only after merge, or state "None."
Do not add them routinely. For example, verification of a merge-triggered
deployment belongs here and remains pending until performed; pre-merge validation
does not prove publication succeeded.

See the [development guidance](https://github.com/takahirox/webrtl/blob/main/docs/development-flow.md#1-start-with-an-issue)
and [review guidance](https://github.com/takahirox/webrtl/blob/main/docs/review-guidelines.md#check-pre-merge-acceptance-and-post-merge-verification).
