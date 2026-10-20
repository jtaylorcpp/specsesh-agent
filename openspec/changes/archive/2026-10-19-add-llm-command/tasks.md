## 1. The guide and the skill

- [x] 1.1 `packages/agent/docs/llm/guide.md` and `packages/agent/templates/SKILL.md`, with `{{version}}` and (guide only) `{{usage}}` placeholders; `scripts/check-assets.mjs` requires both. Tests in `__tests__/cli/llm.test.ts`: "Scenario: Both are packed", "Scenario: The build requires them"

## 2. The command

- [x] 2.1 `packages/agent/src/cli/llm.ts` (`LLM_USAGE`, `runLlm`, the guide and skill paths beside `dist/` like `NEW_TEMPLATE`) and the `llm` route and `USAGE` line in `src/cli/index.ts`. Tests in `__tests__/cli/llm.test.ts`: "Scenario: The guide carries the usage", "Scenario: The guide names its version and leaves no placeholder", "Scenario: The guide covers the workflow and its rules", "Scenario: The skill has front matter", "Scenario: The skill points at the guide", "Scenario: Write into a new directory", "Scenario: No overwrite", "Scenario: Help lists llm"
- [x] 2.2 Test "Scenario: An unknown llm subcommand prints usage". README and CLAUDE.md name `specsesh llm`. Run `pnpm check`, `pnpm test`, `pnpm spec:check`, `pnpm docs:check`

The change ends with `pnpm change close add-llm-command`.
