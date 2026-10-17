## Why

Someone using `specsesh` in another repo, or an agent like Claude driving it, can't find out from the CLI:
- which agent scripts ship with the package
- what each one does, and what it reads and writes
- how to write a `.agent` file of their own
- whether a file they wrote will run

The answers are spread across the README, `guides/`, the archived changes, and `src/interpreter/subset.ts`. None of those ship in the npm package except the README, and an agent can't discover any of them from `specsesh --help`.

## What Changes

Five new `specsesh` commands. Each prints Markdown by default and JSON with `--json`, so a person or an agent can read the output.

- **`specsesh agents`** lists the bundled agent scripts. Each row shows the name, `config.description`, the command that runs it (for example `specsesh task`, `specsesh change draft`, or the CI picker), and the variables it reads and writes.
  - The scripts are `task`, `task-delegate`, `group`, `spec-proposal`, `spec-design`, `spec-specify`, `spec-plan` and `ci-test-pick`.
  - Each delegate script (`read`, `edit`) is listed too, marked as a delegate grant's script.
- **`specsesh agents show <name>`** prints that script's source, so it can be copied and changed.
- **`specsesh language [topic]`** prints the Agent Script reference, one topic at a time or as a table of contents.
  - The topics are `overview`, `config`, `system`, `variables`, `subagents`, `prompts`, `interpolation`, `logic`, `outputs`, `actions`, `run`, `refused` and `subset`.
  - `subset` is generated from `SUPPORTED_SUBSET` in `interpreter/subset.ts`, so it can't drift from what the interpreter actually runs.
  - The text comes from `docs/language/*.md` in the package, which `add-agent-language-docs` writes.
- **`specsesh actions`** lists the built-in actions (`builtinActions`): name, what it does, its inputs and outputs, and whether it writes. These are what a script's `run` and `reasoning.actions` can call.
- **`specsesh check <file.agent>…`** parses each file and runs the interpreter's pre-execution scan without calling a model.
  - It prints each diagnostic as `file:line:col  message`, naming the subset construct id where there is one.
  - It exits 0 when every file would run, and 1 otherwise.
- **`specsesh new agent <name> [--out <path>]`** writes a commented starter script with one subagent, one prompt and one structured output. It refuses to overwrite a file. The script it writes passes `specsesh check`.

`specsesh --help` lists all five, and each prints its own usage when given no arguments, matching how the existing commands behave.

## Out of scope

- Running a script. `specsesh agent run` already does that.
- Changing the language or the subset.
- The guide and example content, which is `add-agent-language-docs`.

## Capabilities

**New:** `package/explain`. The routing requirement in `package/command` is left as it is: the new commands are routed in the same `main`, and `package/explain` specifies them.

## Impact

- **New files:**
  - `packages/agent/src/cli/explain.ts`: `agents`, `language`, `actions`, `check` and `new`
  - `packages/agent/src/cli/bundled.ts`: the bundled-script catalogue, read from the files' `config` blocks
  - `packages/agent/templates/new.agent`
- **Changed files:**
  - `src/cli/index.ts`: routes and `USAGE`
  - `package.json`: `files` gains `docs` and `templates`, and the build copies them
  - `README.md`
  - tests
- **Depends on:** `add-agent-language-docs` for the topic texts. Until they exist, `language <topic>` prints the subset table and a pointer to the README.
