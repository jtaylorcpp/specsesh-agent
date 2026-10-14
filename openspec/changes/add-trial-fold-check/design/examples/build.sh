#!/bin/sh
# What a user runs. Nothing new to type: the fold runs inside the existing commands.

# Draft the specs: the gate now also runs the trial fold and iterates until it is clean.
pnpm spec add-spec-amendments-judge

# Build: after the change check, the trial fold runs.
pnpm change build add-spec-amendments-judge
# -> blocked · level change · to principal, with the fold's output

# Fix the deltas through the specs stage (and re-approve), then answer
# to re-run only the change check and the trial fold:
pnpm spec add-spec-amendments-judge
pnpm change answer add-spec-amendments-judge "specs shortened and re-approved"
# -> converged
