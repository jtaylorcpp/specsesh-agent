## Why

Every place that runs `openspec` uses whichever `openspec` comes first on PATH, not the project's own copy. Running `node packages/agent/dist/bin/agentscript-change.js` directly picked up a global openspec 1.9.0, and its `show --json` leaves out requirement names. The specs gate then failed all eight drafts of add-spec-amendments-cli with "`openspec show` failed", and nothing said which openspec it had run (gaps.md #19). The bins and gates should run the project's own openspec, refuse one that is too old, and say which one they ran.

## What Changes

- Every place that runs `openspec` looks for it in this order: the project's `node_modules/.bin/openspec` first, then PATH. That covers the spec stage gates, `close`'s trial fold and `--amend`'s validation.
- The openspec it finds has its `--version` checked once per process against the minimum this package supports, 1.14.1.
- If the version is below the minimum, the command refuses with exit 2 before any model call. The message names the version and path it found, and the minimum.
- When a gate cannot read openspec's output, the issue names the openspec version and path, not just "`openspec show` failed".

## Out of scope

- Installing or upgrading openspec.
- Supporting openspec versions below the minimum (1.14.1).
- The pnpm flag-passing problem (gaps.md #14).

## Capabilities

**Modified:** `spec/stages`, `change/cli`

## Impact

- The spec stage gates, which run `openspec` and report when its output cannot be read.
- The `agentscript-change` commands that run `openspec`: `close`'s trial fold and `--amend`'s validation, plus the up-front version refusal (exit 2) before any model call.
- A shared way to find openspec and check its version, used by both, with 1.14.1 as the minimum supported version.
