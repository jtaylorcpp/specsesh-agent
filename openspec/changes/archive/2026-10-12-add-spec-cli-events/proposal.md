## Why

Task and group loops stream JSON Lines events on stderr, which is how a person, or another agent, watches a run live. After `add-spec-cli`, a spec loop prints only its text outcome at the end. A long draft shows nothing while it runs, and nothing machine-readable says which issues each draft had. We also have no live proof that a real model, on the claude-code provider, can return a whole proposal as one structured string and get through the gate.

## What Changes

- **Five event kinds for a spec loop:**
  - `stage-started`: `change`, `stage`, `script`, `at`;
  - `stage-draft`: `draft`, `issues` (`{ level, path, message }[]`), `written` (paths);
  - `stage-review`: `files`, `question`, or `stage-question` with the script's question;
  - `stage-ended`: `status`, `drafts`, `approved`.

  They are streamed like the task loop's, after the resume hint, with `loop` set.
- **The live run also drafts a proposal.** `pnpm test:live` runs `spec fixture-live-spec --intent "<a one-line intent>"` in its copy of the repo, and expects a review with a gate-clean `proposal.md`.

## Out of scope

- Live runs of the design, specs and tasks stages. Each stage change adds its own.

## Capabilities

- **Modified:** `task/headless`.

## Impact

- Updated: `packages/agent/src/task/events.ts`, `src/task/spec-cli.ts`, `__tests__/live/task.live.test.ts`.
- Depends on `add-spec-cli`, archived first.
