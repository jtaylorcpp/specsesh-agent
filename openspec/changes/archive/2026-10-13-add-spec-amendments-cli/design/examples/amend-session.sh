#!/usr/bin/env sh
# What a principal types to answer an amend-spec escalation.
# Change names are fake examples.

# 1. Show the blocked build. When the escalation (from a task loop or the
#    group judge) carries Amendment { delta, text }, this prints a diff from
#    openspec/changes/add-plan-export/<delta> on disk to text, then the
#    question. Exits 1 and starts nothing.
pnpm change build add-plan-export

# 2a. Apply the amendment. This writes text to
#     openspec/changes/add-plan-export/<delta> and runs
#     `openspec validate --all --strict`, the same check as `pnpm spec:check`.
#     - No errors and no warnings: the loop the build is blocked on (task loop
#       or group judge) is answered with the decision amendment-applied.
#     - Any error or warning: the delta is restored, nothing resumes, the
#       validation output is printed, and the command exits 2.
pnpm change build add-plan-export --amend

# 2b. Or answer with text instead, as today. Nothing is written.
pnpm change build add-plan-export "Keep JSON, drop the sort"

# Refused with exit 2, nothing written: --amend together with an answer.
pnpm change build add-plan-export --amend "Use v2"

# After the build converges:
pnpm change close add-plan-export