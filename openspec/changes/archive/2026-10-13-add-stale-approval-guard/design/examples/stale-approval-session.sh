#!/bin/sh
# What a user types around the stale-approval guard.
# Change, file and principal names are examples (fake data).

# --- A hand edit to an approved delta is refused ---------------------------
$EDITOR openspec/changes/add-plan-export/specs/plan/export/spec.md
pnpm change build add-plan-export
#   add-plan-export: approved files changed since they were approved; build refused
#     specs: specs/plan/export/spec.md (changed)
#   review it with: pnpm change draft add-plan-export
#   then approve it again: pnpm change approve add-plan-export
#   (exit 2, nothing started)

# Answering a waiting build is refused the same way:
pnpm change build add-plan-export "Use the v2 API"     # exit 2, loop stays blocked

# --allow-dirty does not get around it:
pnpm change build add-plan-export --allow-dirty        # exit 2, same refusal

# --- Recover through review ------------------------------------------------
pnpm change draft add-plan-export        # redrafts from the earliest stale stage
pnpm change approve add-plan-export      # repeat per stage; records new sha256s
pnpm change build add-plan-export "Use the v2 API"     # continues

# --- The one sanctioned mid-build change to a spec delta -------------------
# The build is blocked on an escalation carrying an Amendment:
pnpm change build add-plan-export                      # shows the diff and question
pnpm change build add-plan-export --amend
#   amended openspec/changes/add-plan-export/specs/plan/export/spec.md
#   ## validation: passed
#   approved specs/plan/export/spec.md as jesse: amendment-applied
#   resumed task 2.2 with decision: amendment-applied
#   # add-plan-export — built

# The principal recorded is `git config user.name`, falling back to $USER.
pnpm change close add-plan-export
