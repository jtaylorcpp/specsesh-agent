#!/bin/sh
# Build a change. After the change checks pass, the trial fold runs;
# a failing fold ends the build blocked with the fold's output (the same text close prints).
pnpm change build add-spec-amendments-judge

# Blocked by the fold: shorten the MODIFIED requirements in the deltas...
$EDITOR openspec/changes/add-spec-amendments-judge/specs/spec/judge/spec.md

# ...then answer the escalation; a new run re-runs only the check phase
# (the change checks, then the trial fold).
pnpm change answer add-spec-amendments-judge "deltas shortened"
