# hello-world

The smallest complete program on `@specsesh/agent`: one Agent Script file, run as a durable task on
Claude Haiku.

`hello.agent` has three steps. `greet` asks the model for a one-line greeting and stores it in a
variable. `decide` is pure logic: if the name is `World` it sets `excited` to `True`, with no model
call. `sign_off` picks an enthusiastic or a calm sign-off prompt from `excited`, and the model
answers it.

`main.ts` runs those three in order, as a [pi-durable](https://www.npmjs.com/package/@earendil-works/pi-durable)
task stored in `hello.sqlite`. Every step is checkpointed there, so a process that dies mid-run can
resume without repeating a finished step.

## Run it

From the repository root, install and build once:

```bash
pnpm install
pnpm --filter @specsesh/agent build
```

Then run it. You need Node 22.19 or newer, because `main.ts` runs directly under Node's type
stripping.

```bash
pnpm --filter hello-world-example start            # greets "World"
pnpm --filter hello-world-example start Ada        # greets "Ada"
```

By default each step runs through your own `claude` binary, on your Claude subscription. Install
Claude Code and log in first. To use the Anthropic API instead:

```bash
AGENTSCRIPT_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... pnpm --filter hello-world-example start Ada
```

The model is `claude-haiku-4-5` either way. The name you pass becomes the `name` variable, which
overrides the default in `hello.agent`.

## What to expect

The program prints:

1. A header line: the provider and model, the run's kind and how long it took, such as
   `claude-code/claude-haiku-4-5 — completed in 4.1s`.
2. The greeting the model wrote, which is the `greeting` variable.
3. The sign-off, which is the text of the last step. For `World` it is the enthusiastic one. For any
   other name it is the calm one.
4. A final `variables:` line with the whole final state as JSON: `name`, `greeting` and `excited`.

The wording differs on every run, because a model wrote it. The shape does not. `excited` is `true`
only when the name was `World`.

If a step fails, the run is not `completed`. The program prints each failed step with its message to
stderr and sets a non-zero exit code. Common causes are a missing `claude` binary, not being logged
in, or a missing `ANTHROPIC_API_KEY` when `AGENTSCRIPT_PROVIDER=anthropic`.

Each run adds a task to `hello.sqlite`. The file is gitignored. Delete it any time.

## Change it

Edit `hello.agent`. A few ideas, each small:

- **Change the tone.** Edit the prompt line in `greet`, or the `system.instructions`. Those are
  the only text the model sees.
- **Add a variable.** Declare it with a type and a literal default, then use it in a prompt line
  as `{!@variables.your_name}`. Pass a different starting value by adding it to the `variables`
  object in `main.ts`.
- **Add a branch.** In `decide`, add another `if` with `set`. Logic lines cost no model call.
  Remember that an `if` cannot sit inside another `if`, and `True` and `False` are capitalised.
- **Add a step.** Add another `subagent` block, then add its name to the `entry` list in `main.ts`.
  Steps run in the order of that list, and a subagent that is not listed does not run.
- **Take another field from the model.** Add `set @variables.mood = @outputs.mood` to a step after
  declaring a `mood` string variable. The step then answers with a structured result, and the
  schema is derived from your declaration.

Check your edit before you spend a model call. From `packages/agent`, `start` refuses a script with
errors or unsupported constructs and names the problem and its position:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { start } from "./dist/interpreter/index.js";
start(readFileSync("../../examples/hello-world/hello.agent", "utf8"));
console.log("ok");
'
```

You can also type-check the program with `pnpm --filter hello-world-example check`.

## Where to go next

- [Writing Agent Script](../../guides/01-agent-script.md): every construct `hello.agent` uses, and
  the ones it does not.
- [Running a script](../../guides/02-running-scripts.md): `run()`, ports, the CLI, and a stub port to
  test scripts without a model.
- [Durable agents](../../guides/03-durable-agents.md): what `runScript`, the harness and
  `hello.sqlite` are doing in `main.ts`.
- [`packages/agent/README.md`](../../packages/agent/README.md): the package reference.
