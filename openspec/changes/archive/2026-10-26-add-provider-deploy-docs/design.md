## Context

After `add-ollama-provider` and `add-ollama-durable`, four providers reach a model (pi-ai's API-key providers, `claude-code`, `ollama`, Workers AI) and there are two places to run (Node, Cloudflare). What each needs is spread through `packages/agent/README.md`, and its `## On Cloudflare` section predates `defineAgentHost` and the Sandbox and Artifacts workspaces. `docs/llm/` already ships pages that `specsesh` prints (`llm.ts`, `check-assets.mjs`).

## Decisions

1. **Pages under `packages/agent/docs/`**, beside `docs/llm/` and `docs/language/`, shipped through the existing `files` entry. Not the repo-root `docs/` (OpenSpec taxonomy, not shipped) or `guides/` (the tour).
2. **Write from the code, not the README.** Each page is checked against the source it describes: `src/pi/ollama.ts`, `src/claude-code/`, `src/bin/models.ts`, `src/cloudflare/{agent-host,workers-ai,sandbox-workspace,artifacts}.ts`, `CLAUDE.md`'s hard lines for `claude-code` (subscription only, never the OAuth token). Where the README and code disagree, the code wins and the README is fixed.
3. **The matrix is data with a test.** The table's values are fixed by the spec; the test parses it and, for the local columns, checks each `yes` against `cliModels()` plus `registerOllama` on the fake server. `api-keys` stands for pi-ai's built-in providers and is checked as `anthropic`. The `cloudflare` column is checked only against the spec's values: `defineAgentHost` takes any `ModelFactory`, so API-key providers work there, while `claude-code` and `ollama` need a local process or server.
4. **`llm.ts` reads pages by fixed name.** A lookup table of the names the spec allows maps to paths; nothing builds a path from user input.
5. **README sections shrink, not vanish.** `## Durable runs on Node` keeps a short code example and links `docs/deploy/local.md`; `## On Cloudflare` keeps the `wrangler.jsonc` and a `defineAgentHost` example and links `docs/deploy/cloudflare.md`. `## Command-line tools` is untouched.
6. **The test** is `__tests__/package/usage-docs.test.ts`: shapes, matrix, links, `.agent` checks, the README rules.

## Risks

- The Cloudflare page describes code not yet deployed. It says so, as `CLAUDE.md` does, and lists what the first deploy must check.
