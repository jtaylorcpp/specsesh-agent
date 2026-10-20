## Why

An LLM agent driving `specsesh`, such as Claude Code acting for a user, has only the usage lines and whatever it guesses. It doesn't know:
- the change workflow (draft → approve → build → close);
- that blocked runs print the exact next command;
- that approvals and answers are the principal's to give;
- that the tool never commits;
- what the exit codes mean.

The guides hold this, but they live in the repository, not in the installed package, and they're written for people. A command that prints a guide for models from what ships, plus a starter skill that points at it, lets any agent pick the tool up correctly.

## What Changes

- `specsesh llm` prints a Markdown guide for LLM agents (`docs/llm/guide.md`, shipped). It holds the package version and the CLI's own `USAGE`, so its command list can't drift from the real one.
- `specsesh llm skill` prints a starter `SKILL.md` (`templates/SKILL.md`, shipped): front matter naming `specsesh` with a one-line description, and a body that tells the model to read `specsesh llm` first and never to approve or answer as the principal on its own.
- `specsesh llm skill --out <path>` writes it, creating parent directories, and never overwrites.
- `specsesh --help` lists `llm`; the build fails when either shipped file is missing.

## Out of scope

- Installing the skill into an agent's own configuration directory, or choosing one: `--out` takes any path.
- Generating the guide from the `guides/` pages, or translating it.
- An MCP server or any machine-readable form beyond Markdown.

## Capabilities

- **New:** `package/llm`.

## Impact

- `packages/agent/src/cli/llm.ts` (new) and `src/cli/index.ts` (the route and a `USAGE` line).
- `packages/agent/docs/llm/guide.md` and `packages/agent/templates/SKILL.md` (new, shipped through `files`); `scripts/check-assets.mjs` requires both.
- Tests in `packages/agent/__tests__/package/llm.test.ts`; README and CLAUDE.md mention the command.
