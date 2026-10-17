## 1. Catalogue

- [ ] 1.1 `packages/agent/src/cli/bundled.ts` (new): read every shipped `.agent` file (task scripts and delegate scripts) with the authoring parser into `{ name, description, runBy, reads, writes, path }`; `runBy` comes from a small map keyed by script name, and an unmapped script gets `"bundled"`; tests "Every bundled script is listed" and "A new bundled script appears without code"
- [ ] 1.2 `packages/agent/src/cli/explain.ts` (new): `agents` and `agents show`, with Markdown and `--json` output; tests "Show the task agent" and "Unknown agent"

## 2. Language and actions

- [ ] 2.1 `explain.ts`: `language [topic]`. The topic texts are read from `docs/language/<topic>.md` in the package, and `subset` is generated from `SUPPORTED_SUBSET`. A missing topic file prints the subset table and a README pointer. Tests "Subset matches the interpreter" and "Topic list"
- [ ] 2.2 `explain.ts`: `actions` from the built-in action definitions (name, description, input, output, writes); test "delete_file is a write"

## 3. Check and new

- [ ] 3.1 `explain.ts`: `check <file>…` using the parser's diagnostics plus the interpreter's pre-execution scan, with no model; tests "Bundled scripts pass", "Unsupported construct named" and "Syntax error located"
- [ ] 3.2 `packages/agent/templates/new.agent` (new, commented) and `new agent <name> [--out]`; tests "Scaffold then check" and "No overwrite"

## 4. Wiring

- [ ] 4.1 `src/cli/index.ts`: route `agents`, `language`, `actions`, `check` and `new`, and extend `USAGE`; tests "Help lists them" and "check with no files"
- [ ] 4.2 `packages/agent/package.json`: `files` gains `docs` and `templates`, and the build copies them; `pnpm pack:check` sees them in the tarball
- [ ] 4.3 `packages/agent/README.md`: a "Discover from the CLI" section
