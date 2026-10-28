# Durable agents on Node

A plain run lives and dies with its process. A durable run is stored: every step is checkpointed in a database, so when the process is killed, the machine reboots or you close the laptop, a fresh process picks the run up at the step it was on. By the end of this guide you will be able to open a durable harness, run a script to completion (or start it now and await it later), resume runs a dead process left behind, choose the model per run, drive all of it from the `agentscript-durable` command line, and say exactly what is and is not repeated after a crash.

## Prerequisites

Node 22.19 or newer (the SQLite storage uses Node's built-in `node:sqlite`). Install the package and the durable peers:

```bash
npm install @specsesh/agent
npm install @earendil-works/pi-ai @earendil-works/pi-durable @earendil-works/chord
```

You need a script. The examples use `hello.agent` from the [README](../packages/agent/README.md#a-script): two model steps (`greet`, `sign_off`) and a logic-only step (`decide`) between them.

You need a model. Either your own Claude subscription (the `claude` binary signed in; no API key) or a pi-ai provider with its API key in the environment, such as `ANTHROPIC_API_KEY`. [Choosing a model](#choosing-a-model) covers the difference.

## What you get

[pi-durable](https://www.npmjs.com/package/@earendil-works/pi-durable) is a harness that commits conversations, model turns and tool calls to storage before anything is shown. `@specsesh/agent/durable` adds one extension to it that runs an Agent Script as a pi-durable **task**, `agentscript.run`. That gives you:

- **Checkpointed phases.** The run's state is plain JSON, saved after every phase.
- **Resume after a crash.** Reopen the same storage in a new process, call `harness.resume()`, and the run continues from its last checkpoint. The new process does not need the script file: the script is stored inside the task.
- **No step repeated.** A step whose answer was committed is never asked again. [What "never repeated" means](#what-never-repeated-means) says precisely what that covers.

## Open a harness

A harness is storage, a model collection and a registry of extensions. Install both Agent Script extensions into the registry:

```ts
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { AgentScript, AgentScriptStepExtension } from "@specsesh/agent/durable";

const models = createModels();
models.setProvider(claudeCodeProvider());                 // or anthropicProvider()

const registry = createRegistry();
registry.install(AgentScript);                            // the agentscript.run task
registry.install(AgentScriptStepExtension);               // the tool and prompt section each step uses

const harness = await Harness.open(await openNodeSqliteStorage("runs.sqlite"), { models, registry }, context);
// ... start, await and resume runs here ...
await harness.close(context);
```

- `context` is chord's `BACKGROUND_CONTEXT`: a request context for work that is not tied to a user request.
- The package registers nothing on its own. A harness without both extensions cannot create or run a script task.
- Install the **same** extensions and register the **same** providers every time you open the storage, including when you reopen it to resume. A run remembers the provider name and model it was started on; the process that finishes it must be able to resolve them.
- `AgentScript` and `AgentScriptStepExtension` register no actions. To give scripts actions, install `agentScriptExtensions({ actions, workspace })` in their place: [Actions](04-actions.md).

## Run a script

`runScript` starts a run and waits for it:

```ts
import { readFileSync } from "node:fs";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { AgentScript, AgentScriptStepExtension, runScript } from "@specsesh/agent/durable";

const models = createModels();
models.setProvider(claudeCodeProvider());
const registry = createRegistry();
registry.install(AgentScript);
registry.install(AgentScriptStepExtension);
const harness = await Harness.open(await openNodeSqliteStorage("runs.sqlite"), { models, registry }, context);

const result = await runScript(
  harness,
  readFileSync("hello.agent", "utf8"),
  {
    model: { provider: "claude-code", modelId: "claude-haiku-4-5" },
    entry: ["greet", "decide", "sign_off"],
    variables: { name: "Ada" },
  },
  context,
);
console.log(result.kind, result.variables.greeting);
for (const step of result.steps) console.log(step.subagent, step.outcome.kind);
await harness.close(context);
```

The options are the interpreter's start options plus two more:

| Option | Meaning |
|---|---|
| `entry` | The subagent, or subagents in order, to run. Default: the first one the script declares. |
| `variables` | Starting values that override the script's defaults. Every name must be declared. |
| `choices` | Allowed values per string variable, so a step's result schema shows them as an `enum`. |
| `model` | `{ provider, modelId }`: the model every step of this run uses. |
| `conversation` | The conversation that owns the run. Default: the harness's root conversation. |

A script the interpreter refuses (a construct outside the supported subset, an unknown `entry`, an undeclared variable) makes the call reject before anything is stored or sent to a model.

### The result

`runScript` resolves to a `RunResult`:

- `kind` is `"completed"`, `"failed"` or `"cut-short"`. A step that fails (a provider error, a result the model could not get right in three tries) ends the run `failed`, and **the promise still resolves**: the task completed, the script did not. Check `kind`.
- `steps` has one entry per model step, with the subagent, the request it sent and its `outcome` (`answered` with `text`, `structured` and any `toolCalls`, or `failed` with a `category`, `message` and any `toolCalls`). Logic-only subagents make no entry.
- `actions` lists every action call a `run` statement made.
- `variables` holds the final values, including those set by steps that finished before a failure.

`runScript` rejects if the script is refused at start, or if the task did not complete (it was aborted).

### Start now, await later

`runScript` is two calls. Split them when you want the task ID before the run finishes, to answer an HTTP request, say, or to record the ID for a later resume:

```ts
import { readFileSync } from "node:fs";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { AgentScript, AgentScriptStepExtension, startScript, waitForScript } from "@specsesh/agent/durable";

const models = createModels();
models.setProvider(claudeCodeProvider());
const registry = createRegistry();
registry.install(AgentScript);
registry.install(AgentScriptStepExtension);
const harness = await Harness.open(await openNodeSqliteStorage("runs.sqlite"), { models, registry }, context);

const id = await startScript(
  harness,
  readFileSync("hello.agent", "utf8"),
  { model: { provider: "claude-code", modelId: "claude-haiku-4-5" }, entry: ["greet", "decide", "sign_off"] },
  context,
);
console.log(`started task ${id}`);       // stored; no model has been called yet

harness.resume();                         // start the scheduler
const result = await waitForScript(harness, id, context);
console.log(result.kind);
await harness.close(context);
```

`startScript` commits the task and returns its ID. It makes no model request and does not wait. The harness runs the task once its scheduler is going, which `harness.resume()` (or waiting) starts. Task IDs are numbers; pass the number back as you got it. A string ID makes `waitForScript` fail with a message saying so.

## Resume a run

A process died holding runs. In a new process, open the same storage with the same registry and models, call `harness.resume()` and wait for the ID you kept:

```ts
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness, type TaskId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { RunResult } from "@specsesh/agent/interpreter";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { AgentScript, AgentScriptStepExtension, waitForScript } from "@specsesh/agent/durable";

const models = createModels();
models.setProvider(claudeCodeProvider());       // the provider the run was started on
const registry = createRegistry();
registry.install(AgentScript);
registry.install(AgentScriptStepExtension);
const harness = await Harness.open(await openNodeSqliteStorage("runs.sqlite"), { models, registry }, context);

const id = Number(process.argv[2]) as TaskId<RunResult>;
if ((await harness.getTask(id, context)) === undefined) throw new Error(`no task ${id} in runs.sqlite`);

harness.resume();                               // continue every run the last process left unfinished
const result = await waitForScript(harness, id, context);
console.log(result.kind, result.variables);
await harness.close(context);
```

Notes:

- `harness.resume()` continues **every** unfinished task in the storage, not only the one you wait on.
- It does not need `hello.agent`. If you edit the file after starting, the run in progress is unaffected; the task holds the source it started with.
- Resuming a task that already finished is harmless: `waitForScript` returns its stored result.
- One process owns a storage at a time. There is no cross-process locking, so do not resume while the original process might still be alive.

## The run task and its phases

Every run is one task named `agentscript.run`. Its checkpoint is always one of four shapes, and each phase ends by committing the next checkpoint (or the final result) in one transaction:

| Phase | What it does |
|---|---|
| `next` | Pure. Asks the interpreter what comes next: a model step, an action call, or done. Logic lines (`if`, `set`) run here, as plain code; the model never sees them. Makes no model request. |
| `dispatch` | Creates a fresh conversation for the step, owned by the task, configured with the script's system instructions, the step's `submit_result` tool (only if the step writes variables) and any action tools it offers. Creating it and moving on are one commit. |
| `await` | Submits the step's prompt to that conversation with the request ID `agentscript:<task>:<step>`, waits for the answer, and folds it back into the run's state. |
| `act` | For a `run` statement: records the intent, runs the host action once, records the result. See [Actions](04-actions.md). |

A model step goes `next` → `dispatch` → `await` → `next`. A `run` goes `next` → `act` → `next`. A subagent with only logic lines makes no checkpoint of its own: it runs inside `next`. When nothing is left, `next` ends the task `completed`.

Each model step has its own conversation. A step sees the system block, its own prompt and its tools, and nothing from the earlier steps. The only thing that carries over is the variables. If the step writes variables, `submit_result` validates the model's answer against the step's schema and hands the problem back for a retry; the third refusal fails the step.

## What "never repeated" means

The guarantee is built from three facts: every phase ends in one commit, the `await` submission is idempotent by its request ID, and `act` records its intent before it runs anything. From them:

- **A finished step is never run again.** After its answer is committed, a resumed process continues at the next phase. It makes no model request for that step.
- **A step in flight is asked once more.** If the process dies during a model request, no answer was committed, so the resumed process submits the same request ID and the model is asked again. A half-streamed answer is gone. You may pay for that one request twice. It is never asked a third time, and it never produces two answers.
- **Logic is recomputed, harmlessly.** `next` is pure, so running it again from the same checkpoint gives the same result and has no effect.
- **A step's conversation is created once.** A crash during `dispatch` leaves either no new conversation or the committed one, never an orphan.
- **Actions follow their replay policy.** A call to a `safe` action that was interrupted runs again. A call to an `unsafe` action that was interrupted is *not* run again: the run ends `failed`, saying it was interrupted and not re-run. A completed action is never repeated. The details are in [Actions](04-actions.md#replay-after-a-crash).

What it does not cover: anything your own code does outside the harness, such as work you do between `startScript` and `waitForScript`, or side effects of a tool you wrote that is not a registered host action. Make those idempotent yourself.

The repository's crash tests do this literally: a child process exits with code 137 in the middle of the second model request, and a fresh process finishes the run with exactly one more request (`packages/agent/__tests__/durable/crash.test.ts`).

## Choosing a model

The model is per run: `model: { provider, modelId }` in the start options. Register every provider you will use on the `models` collection, then pick per run:

```ts
import { readFileSync } from "node:fs";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { AgentScript, AgentScriptStepExtension, runScript } from "@specsesh/agent/durable";

const models = createModels();
models.setProvider(claudeCodeProvider());       // provider id "claude-code"
models.setProvider(anthropicProvider());        // provider id "anthropic"; reads ANTHROPIC_API_KEY
const registry = createRegistry();
registry.install(AgentScript);
registry.install(AgentScriptStepExtension);
const harness = await Harness.open(await openNodeSqliteStorage("runs.sqlite"), { models, registry }, context);

const source = readFileSync("hello.agent", "utf8");
const entry = ["greet", "decide", "sign_off"];
const local = await runScript(harness, source, { entry, model: { provider: "claude-code", modelId: "claude-haiku-4-5" } }, context);
const hosted = await runScript(harness, source, { entry, model: { provider: "anthropic", modelId: "claude-haiku-4-5" } }, context);
console.log(local.kind, hosted.kind);
await harness.close(context);
```

Without `model`, a run's steps use the model configured on the owning conversation, and a fresh harness configures none. Pass `model`.

| | Claude Code provider | An API provider |
|---|---|---|
| Entry | `claudeCodeProvider()` from `@specsesh/agent/claude-code`; provider id `claude-code` | e.g. `anthropicProvider()` from `@earendil-works/pi-ai/providers/anthropic`; id `anthropic` |
| How a step runs | One headless `claude -p --safe-mode` per request, through your own `claude` binary | One API request through pi-ai |
| Credentials | Your Claude subscription login. `ANTHROPIC_API_KEY` is removed from the child's environment; Claude Code's OAuth token is never read or forwarded | The provider's key in pi-ai's environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, ...) |
| Where | Your own machine, Node only | Anywhere pi-ai runs |
| Tools | At most one per request. A request offering more is refused. A step's `submit_result` fits; a step that also offers action tools does not | As many as the model supports |
| Model ids | What your `claude` accepts, e.g. `claude-haiku-4-5` | The provider's ids; `agentscript-pi models <provider>` lists them |

The one-tool limit decides where model-callable actions can run. If a step offers action tools (`reasoning.actions`), run it on an API provider. Deterministic `run` actions make no model request, so they work with either.

The Claude Code provider is for local work. For a server, use an API provider.

## The `agentscript-durable` command

The package installs a command that does the above for one script and one database file (run it with `npx`, or from `node_modules/.bin`):

```bash
npx agentscript-durable run hello.agent --db runs.sqlite --provider claude-code --model claude-haiku-4-5 \
  --entry greet --entry decide --entry sign_off --var name=Ada
npx agentscript-durable resume 7 --db runs.sqlite
```

`run <file> --db <path>` takes:

| Flag | Meaning |
|---|---|
| `--provider <id>` | Default: `AGENTSCRIPT_PROVIDER`, else `anthropic`. |
| `--model <id>` | Default: `AGENTSCRIPT_MODEL`, else `claude-haiku-4-5`. |
| `--entry <subagent>` | Repeatable; run these in order. Default: the first subagent only. |
| `--var name=value` | Repeatable. `True`/`False` are booleans, a number is a number, anything else (including lower-case `true`) is a string. |
| `--json` | Print the task ID merged with the run result as JSON, instead of the text report. |

Every built-in pi-ai provider is available, plus `claude-code`. An unknown provider or model stops with `no model "<id>" on provider "<id>"` and exit code 2 before a task exists.

`resume <task-id> --db <path>` takes only `--json`. It does not read the script. An ID that is not an integer or has no task in that database stops with `no task <id> in <path>`, exit code 2.

`run` prints the task ID **first**, to stderr, before any model call:

```text
task 7 — resume with: agentscript-durable resume 7 --db runs.sqlite
```

Use that ID, not a guess: IDs in a fresh database are not necessarily 1. Both commands then print the report to stdout:

```text
# task 7 — completed
## step 1: greet → answered
structured: {"greeting":"Hello, World!"}
## step 2: sign_off → answered
That's all, folks! Signing off with a triumphant exit code 0!
## variables
name = "World"
greeting = "Hello, World!"
excited = true
```

Step numbers count model steps only; `decide`, the logic-only subagent, has none. The exit code is 0 when the run completed, 1 when it ended `failed` or `cut-short` or the task was aborted, and 2 for a usage error, unknown model or unknown task.

The command installs the plain extensions, so it does not run scripts that declare actions. For those, write the host in code ([Actions](04-actions.md)) or use the task loop ([Executing changes with the task loop](07-task-loop.md)).

## Storage and where state lives

State lives in the storage you open the harness with. For `openNodeSqliteStorage(path)` that is one SQLite file at `path`, relative to the working directory if you gave a relative path. SQLite may keep `-wal` and `-shm` files beside it while it is open. It holds each task's script source and checkpoints, and every step conversation, including the prompts and the model's answers. Treat it as sensitive, add it to `.gitignore`, and delete it to forget everything.

| Backend | Import | Notes |
|---|---|---|
| SQLite (Node) | `openNodeSqliteStorage(file)` from `@earendil-works/pi-durable/storage/sqlite/node` | One file. Commits survive a process crash; the newest may be lost on power or host failure. What this guide uses. |
| JSONL | `openNodeJsonlStorage(directory, context)` from `@earendil-works/pi-durable/storage/jsonl/node` | Append-only files in one directory. |
| Memory | `MemoryStorage` from `@earendil-works/pi-durable` | Nothing persisted. For tests. |

These are pi-durable's; see its README for the full list. One process owns a storage at a time.

## Kill it mid-run and resume

You can watch the guarantee work with the command line and a signal. This used `hello.agent` and Claude Haiku on a Claude subscription; any provider works.

1. Start a run:

   ```bash
   npx agentscript-durable run hello.agent --db hello.sqlite \
     --provider claude-code --model claude-haiku-4-5 \
     --entry greet --entry decide --entry sign_off
   ```

   Stderr shows `task 7 — resume with: agentscript-durable resume 7 --db hello.sqlite` almost at once. Note the number.

2. A few seconds in, while a step is running, kill the process hard from another terminal:

   ```bash
   pkill -9 -f agentscript-durable
   ```

   Nothing has been printed to stdout; the run was cut off before it could report. (A whole run takes only a few seconds on Haiku. If yours finishes first, resume still works: it reports the finished run.)

3. Resume, with no script file in sight:

   ```bash
   npx agentscript-durable resume 7 --db hello.sqlite
   ```

   It opens `hello.sqlite`, finds task 7 at the checkpoint where it died, finishes the remaining steps and prints the report shown above. The steps that had already been answered are not asked again.

4. Resume once more. The task is finished, so the same report prints again at once, with no model call.

To see the same thing from code, run [Start now, await later](#start-now-await-later) and kill it, then run [Resume a run](#resume-a-run) with the ID it printed.

## Next

- [Actions: letting an agent do work](04-actions.md): give scripts files, commands and checks, and what a crash does to them.
- [Agents on Cloudflare](05-cloudflare.md): the same run task inside a Durable Object.
- [Executing changes with the task loop](07-task-loop.md): durable runs chained into a loop that works OpenSpec tasks.
- [The OpenSpec ontology](06-openspec.md): the typed records the loop produces.
- [Writing Agent Script](01-agent-script.md) and [Running a script](02-running-scripts.md): the scripts and the interpreter this runs.
