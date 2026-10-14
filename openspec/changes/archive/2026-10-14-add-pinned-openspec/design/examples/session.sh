#!/bin/sh
# FAKE DATA: paths and versions are examples.
# No new flags. Every command that runs openspec now uses the project's copy first.

# Run directly with node, so node_modules/.bin is not on PATH.
# The project's node_modules/.bin/openspec (1.14.1) is still used.
node packages/agent/dist/bin/agentscript-change.js draft add-spec-amendments-cli

# With no project copy and a global openspec 1.9.0 on PATH:
node packages/agent/dist/bin/agentscript-change.js draft add-spec-amendments-cli
#   stderr: openspec 1.9.0 at /usr/local/bin/openspec is below the minimum supported version 1.14.1
#   exit:   2   (before any model call)

# The same check runs before approve, close and build --amend:
pnpm change approve add-plan-export
pnpm change close add-plan-export
pnpm change build add-plan-export --amend
