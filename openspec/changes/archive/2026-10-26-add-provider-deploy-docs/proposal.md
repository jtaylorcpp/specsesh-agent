## Why

How to pick a model and where to run are scattered through a 925-line `packages/agent/README.md`, mixed in with the language, the task loop and the CLI reference. Each provider's setup sits beside whichever feature first needed it, and the `## On Cloudflare` section is stale: it still says a Cloudflare host runs scripts without actions, though `defineAgentHost` and the Sandbox and Artifacts workspaces exist. With Ollama arriving there are four ways to reach a model and two places to run. Which pairs work, and how to set each one up, needs one place to look, shipped with the package so `specsesh llm` can point an agent at it.

## What Changes

- Shipped provider pages, one per provider: `docs/providers/{api-keys,claude-code,ollama,workers-ai}.md`. Each covers setup, credentials or login, picking and listing models, which commands and deployments it works with, and its limits: one tool per step for `claude-code`, forced tool calls on small Ollama models, Workers AI only in a Worker.
- Shipped deployment pages: `docs/deploy/local.md` (one-shot runs, durable runs on Node SQLite with `resume`, the task and change loops, worktrees) and `docs/deploy/cloudflare.md` (`AgentScriptHost`, `defineAgentHost`, `workersAI`, the Sandbox and Artifacts workspaces, local testing on `wrangler dev --local`, that `claude-code` grants are refused there, and that nothing has been deployed yet).
- `docs/providers/README.md` holds a matrix of provider × deployment × command (`agent`, `durable`, `task`, `change`, Cloudflare host). A test checks it against the providers each CLI and host registers, so it can't drift the way the Cloudflare section did.
- `packages/agent/README.md` keeps one short example per section and links to the pages for the rest. `## Durable runs on Node` and `## On Cloudflare` shrink to pointers.
- The `specsesh llm` map names the provider and deployment pages, and `specsesh llm providers [<name>]` and `specsesh llm deploy <local|cloudflare>` print them, like `<command> help`, from the package.
- A usage-docs test holds every page to one shape (a one-line summary first, fixed sections), resolves its relative links, and checks every `.agent` it names with `specsesh agent check`.

## Out of scope

- The Agent Script language reference (`docs/language/`), the tour, and the repo's OpenSpec taxonomy pages (`docs/` at the root).
- A docs site or anything published outside the package.
- New behaviour in any provider or host; pages describe what exists when this change is built.
- The CLI reference half of the README (`## Command-line tools`); it stays where it is.

## Capabilities

- **New:** `package/usage-docs`.
- **Modified:** `package/llm`.

## Impact

- New `packages/agent/docs/providers/` and `packages/agent/docs/deploy/`, shipped through `files` and required by `scripts/check-assets.mjs`.
- `packages/agent/README.md`, `packages/agent/docs/llm/guide.md`, `templates/SKILL.md`; `src/cli/llm.ts` and `src/cli/index.ts` (the `llm providers` and `llm deploy` routes).
- Tests in `__tests__/package/` (pages, links, the matrix against the registered providers) and `__tests__/cli/llm.test.ts`.
- Lands after `add-ollama-provider` and `add-ollama-durable` are closed, so the Ollama page and matrix describe built behaviour.
