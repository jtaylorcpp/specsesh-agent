## Why

Someone using `specsesh` in another repo, or an agent like Claude driving it, can't find out from the CLI:
- which agent scripts ship with the package
- what each one does, and what it reads and writes
- how to write a `.agent` file of their own
- whether a file they wrote will run

The answers are spread across the README, `guides/`, the archived changes, and `src/interpreter/subset.ts`. None of those ship in the npm package except the README, and an agent can't discover any of them from `specsesh --help`.

## What Changes

Six new subcommands under the existing `specsesh agent` tree, beside `specsesh agent run` and `specsesh agent models`. Each prints Markdown by default and JSON with `--json`, so a person or an agent can read the output.

- **`specsesh agent list`** lists the bundled agent scripts. Each row shows the name, `config.description`, the command that runs it (for example `specsesh task`, `specsesh change draft`, or the CI picker), and the variables it reads and writes.
  - The scripts are `task`, `task-delegate`, `group`, `spec-proposal`, `spec-design`, `spec-specify`, `spec-plan` and `ci-test-pick`.
  - Each delegate script (`read`, `edit`) is listed too, marked as a delegate grant's script.
- **`specsesh agent show <name>`** prints that script's source, so it can be copied and changed.
- **`specsesh agent language [topic]`** prints the Agent Script reference, one topic at a time or as a table of contents.
  - The topics are `overview`, `config`, `system`, `variables`, `subagents`, `prompts`, `interpolation`, `logic`, `outputs`, `actions`, `run`, `refused` and `subset`.
  - `subset` is generated from `SUPPORTED_SUBSET` in `interpreter/subset.ts`, so it can't drift from what the interpreter actually runs.
  - The text comes from `docs/language/*.md` in the package, which `add-agent-language-docs` writes.
- **`specsesh agent actions`** lists the built-in actions (`builtinActions`): name, what it does, its inputs and outputs, and whether it writes. These are what a script's `run` and `reasoning.actions` can call.
- **`specsesh agent check <file.agent>…`** parses each file and runs the interpreter's pre-execution scan without calling a model.
  - It prints each diagnostic as `file:line:col  message`, naming the subset construct id where there is one.
  - It exits 0 when every file would run, and 1 otherwise.
- **`specsesh agent new <name> [--out <path>]`** writes a commented starter script with one subagent, one prompt and one structured output. It refuses to overwrite a file. The script it writes passes `specsesh agent check`.

`specsesh --help` lists `specsesh agent <run|models|list|show|new|check|language|actions>`. `specsesh agent` with no arguments (and `specsesh agent --help`) prints a usage covering all eight subcommands. `check` and `new` print their own usage when given no arguments, matching how the existing commands behave. `run` and `models` still go to `agentscript-pi` unchanged: `src/cli/index.ts` routes the new subcommands before handing `agent` to it.

## Out of scope

- Running a script. `specsesh agent run` already does that.
- Changing the language or the subset.
- The guide and example content, which is `add-agent-language-docs`.

## Capabilities

**New:** `package/explain`.

**Modified:** `package/command`. Its routing requirement now says `main` handles the new `agent` subcommands and the agent usage before handing `agent` to `agentscript-pi`, and its usage lists `specsesh agent <run|models|list|show|new|check|language|actions> [options]`.

## Impact

- **New files:**
  - `packages/agent/src/cli/explain.ts`: `list`, `show`, `language`, `actions`, `check` and `new`
  - `packages/agent/src/cli/bundled.ts`: the bundled-script catalogue, read from the files' `config` blocks
  - `packages/agent/templates/new.agent`
- **Changed files:**
  - `src/cli/index.ts`: routes the new `agent` subcommands, the `agent` usage, and `USAGE`
  - `package.json`: `files` gains `docs` and `templates`, and the build copies them
  - `README.md`
  - tests
- **Depends on:** `add-agent-language-docs` for the topic texts. Until they exist, `agent language <topic>` prints the subset table and a pointer to the README.
