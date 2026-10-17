## 1. Catalogue

- [x] 1.1 `packages/agent/src/cli/bundled.ts` (new): read every shipped `.agent` file (task scripts and delegate scripts) with the authoring parser into `{ name, description, runBy, reads, writes, path }`; `runBy` comes from a small map keyed by script name, and an unmapped script gets `"bundled"`; tests "Every bundled script is listed" and "A new bundled script appears without code"
- [x] 1.2 `packages/agent/src/cli/explain.ts` (new): `agents` and `agents show`, with Markdown and `--json` output; tests "Show the task agent" and "Unknown agent"

## 2. Language and actions

- [x] 2.1 `explain.ts`: `language [topic]`. The topic texts are read from `docs/language/<topic>.md` in the package, and `subset` is generated from `SUPPORTED_SUBSET`. A missing topic file prints the subset table and a README pointer. Tests "Subset matches the interpreter" and "Topic list"
- [x] 2.2 `explain.ts`: `actions` from the built-in action definitions (name, description, input, output, writes); test "delete_file is a write"

## 3. Check and new

- [x] 3.1 `explain.ts`: `check <file>…` using the parser's diagnostics plus the interpreter's pre-execution scan, with no model; tests "Bundled scripts pass", "Unsupported construct named" and "Syntax error located"
- [x] 3.2 `packages/agent/templates/new.agent` (new, commented) and `agent new <name> [--out]`; tests "Scaffold then check" and "No overwrite"

## 4. Wiring

- [x] 4.1 `src/cli/index.ts`: put every new command under `specsesh agent`: route `list`, `show`, `new`, `check`, `language` and `actions` (and `specsesh agent` alone or with `--help`/`-h`/`help`, which prints an agent usage naming `run`, `models`, `list`, `show`, `new`, `check`, `language` and `actions`) before handing `agent` to `agentscript-pi`, so `agent run` and `agent models` reach it unchanged. `explain.ts`'s usages, messages and tests say `specsesh agent list`, `specsesh agent show`, `specsesh agent language`, `specsesh agent actions`, `specsesh agent check` and `specsesh agent new` (no `specsesh agents`, `specsesh language`, `specsesh check` or `specsesh new agent` remains). `USAGE` lists `specsesh agent <run|models|list|show|new|check|language|actions> [options]`, and the existing `package/command` tests follow the modified scenarios. Tests "Help lists them", "agent usage covers every subcommand", "run still runs a script", "agent alone prints the agent usage", "agent routes to the pi CLI" and "check with no files"
- [x] 4.2 `packages/agent/package.json`: `files` gains `docs` and `templates`, and the build copies them; `pnpm pack:check` sees them in the tarball
- [x] 4.3 `packages/agent/README.md`: a "Discover from the CLI" section
