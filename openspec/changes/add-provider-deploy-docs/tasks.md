## 1. Provider pages

- [x] 1.1 `packages/agent/docs/providers/{api-keys,claude-code,ollama,workers-ai}.md`, written from the code (`design.md` decision 2), each with a summary line and `## Setup`, `## Models`, `## Where it runs`, `## Limits`; `docs/providers/README.md` with a summary line, the matrix (`design.md` decision 3) and a link to each page. `scripts/check-assets.mjs` requires all five. Tests in a new `__tests__/package/usage-docs.test.ts`: "Scenario: Every page has its sections" (provider pages only for now, deploy pages added in 2.1), "Scenario: The matrix holds the agreed values", "Scenario: Each local yes resolves" (using `__tests__/pi/fake-ollama.ts`), and in `__tests__/package/` beside the existing asset tests: "Scenario: The build requires them"

## 2. Deployment pages and the readme

- [x] 2.1 `packages/agent/docs/deploy/{local,cloudflare}.md` with a summary line and `## Setup`, `## Providers`, `## Running and resuming`, `## Limits`; `check-assets.mjs` requires both. `packages/agent/README.md`: link all seven pages, shrink `## Durable runs on Node` and `## On Cloudflare` (`design.md` decision 5), remove the stale "without actions" claim. Tests in `usage-docs.test.ts`: "Scenario: Every page has its sections" (now all seven), "Scenario: A broken link fails by name", "Scenario: The readme links every page", plus the `.agent` paths check, and "Scenario: The pages are packed" beside the existing pack dry-run test

## 3. specsesh llm

- [x] 3.1 `packages/agent/src/cli/llm.ts` and `src/cli/index.ts`: `llm providers [<name>]` and `llm deploy <local|cloudflare>` by fixed lookup (`design.md` decision 4), the new `USAGE` line, and `docs/llm/guide.md` naming both (still at most 60 lines); `templates/SKILL.md` says to run `specsesh llm providers` before choosing a model. Tests in `__tests__/cli/llm.test.ts`: "Scenario: providers prints the matrix", "Scenario: A provider page prints by name", "Scenario: A deployment page prints by name", "Scenario: An unknown page prints usage", and update "Scenario: The guide covers the workflow and its rules", "Scenario: Help lists llm" and "Scenario: An unknown llm subcommand prints usage" to the new text. `CLAUDE.md`: name `docs/providers/` and `docs/deploy/` in the layout. Run `pnpm docs:check`, `pnpm check` and `pnpm test`

The change ends with `pnpm change close add-provider-deploy-docs`.
