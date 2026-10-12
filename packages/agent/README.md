# @specsesh/agent

Write an agent as an **Agent Script** file, then run it anywhere: once on any model, crash-safe
on Node, on your own Claude subscription, or inside a Cloudflare Durable Object. A script's
steps reason on a model; its **actions** do real work (read and edit files, run commands and
checks) in a workspace you confine them to. On top of that sits an OpenSpec **task loop** that
works a change's tasks until the checks pass.

```bash
npm install @specsesh/agent
# then the peers for the layers you use, e.g. for durable runs on Node:
npm install @earendil-works/pi-ai @earendil-works/pi-durable @earendil-works/chord
```

- [A script](#a-script)
- [Run it once](#run-it-once) (CLI, or from code on any pi provider, or on your Claude subscription)
- [Durable runs on Node](#durable-runs-on-node)
- [Actions: let a script do work](#actions-let-a-script-do-work)
- [The OpenSpec task loop](#the-openspec-task-loop)
- [On Cloudflare](#on-cloudflare)
- [Entry points](#entry-points) · [Command-line tools](#command-line-tools) · [Roadmap](#roadmap)

Going further? The **[guides](https://github.com/jtaylorcpp/specsesh-agent/tree/main/guides)** cover each layer in depth.

## A script

`hello.agent`: two model steps and one deterministic one. Variables are typed; a `set … =
@outputs.x` line makes the step answer with a structured result; logic lines never reach the
model.

```
config:
    agent_name: "hello-world"

system:
    instructions: |
        You are the voice of a tiny hello world program. Keep every answer to one short line.

variables:
    name: mutable string = "World"
        description: "who to greet"
    greeting: mutable string = ""
        description: "the greeting the model wrote"
    excited: mutable boolean = False
        description: "set by logic when greeting the whole world"

subagent greet:
    description: "Write the greeting"

    reasoning:
        instructions: ->
            | Write a one-line greeting for {!@variables.name}.
            set @variables.greeting = @outputs.greeting

subagent decide:
    description: "Decide the tone, without the model"

    reasoning:
        instructions: ->
            if @variables.name == "World":
                set @variables.excited = True

subagent sign_off:
    description: "Close the program"

    reasoning:
        instructions: ->
            if @variables.excited:
                | Write an enthusiastic one-line sign-off for a program that just said: {!@variables.greeting}
            else:
                | Write a calm one-line sign-off for a program that just said: {!@variables.greeting}
```

Anything outside [the supported subset](#the-supported-subset) is refused before the run
starts, by name and position. Nothing is ever compiled.

## Run it once

**From the command line**, on any pi provider (credentials are pi-ai's environment variables,
e.g. `ANTHROPIC_API_KEY`), or on your Claude subscription through your own `claude` binary:

```bash
agentscript-pi run hello.agent --entry greet --entry decide --entry sign_off --provider anthropic --model claude-haiku-4-5 --var name=Ada
agentscript-pi run hello.agent --entry greet --entry decide --entry sign_off --provider claude-code --model claude-haiku-4-5 --json
```

Without `--entry` a run starts at the first subagent only, so list every subagent to run, in order.

**From code.** The interpreter holds no credential and imports no model client: reasoning leaves
through a `ReasoningPort` you inject. `@specsesh/agent/pi` builds one on pi-ai:

```ts
import { readFileSync } from "node:fs";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { run } from "@specsesh/agent/interpreter";
import { createPiReasoningPort, resolveModel } from "@specsesh/agent/pi";

const models = createModels();
models.setProvider(anthropicProvider());
const port = createPiReasoningPort({ models, model: resolveModel(models, "anthropic", "claude-haiku-4-5") });

const result = await run(readFileSync("hello.agent", "utf8"), {
  port,
  entry: ["greet", "decide", "sign_off"],
  variables: { name: "Ada" },
});
console.log(result.kind, result.variables.greeting);   // "completed", "Hello, Ada!"
```

Swap in `claudeCodeProvider()` from `@specsesh/agent/claude-code` (model provider
`claude-code`) to run each step through `claude -p` on your subscription. It never uses
`--bare`, strips `ANTHROPIC_API_KEY`, and never reads Claude Code's OAuth token.

## Durable runs on Node

The same script as a [pi-durable](https://www.npmjs.com/package/@earendil-works/pi-durable)
task: every step is checkpointed in SQLite, so a killed process resumes where it stopped and
never repeats a finished step.

```ts
import { readFileSync } from "node:fs";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { AgentScript, AgentScriptStepExtension, runScript } from "@specsesh/agent/durable";

const models = createModels();
models.setProvider(claudeCodeProvider());                       // or anthropicProvider()
const registry = createRegistry();
registry.install(AgentScript);
registry.install(AgentScriptStepExtension);
const harness = await Harness.open(await openNodeSqliteStorage("hello.sqlite"), { models, registry }, context);

const result = await runScript(
  harness,
  readFileSync("hello.agent", "utf8"),
  { model: { provider: "claude-code", modelId: "claude-haiku-4-5" }, entry: ["greet", "decide", "sign_off"] },
  context,
);
await harness.close(context);
```

`startScript` + `waitForScript` split that in two (start now, await later), and
`harness.resume()` finishes runs whose process died. From the shell:

```bash
agentscript-durable run hello.agent --entry greet --entry decide --entry sign_off --db hello.sqlite --provider claude-code
agentscript-durable resume <task-id> --db hello.sqlite   # its process died mid-step; the id was printed at start
```

The full program is [`examples/hello-world`](../../examples/hello-world).

## Actions: let a script do work

An action is declared in the script with typed inputs and outputs and an `mcpTool://<name>`
target, and called either **deterministically** with `run` or **by the model** as a reasoning
action. The host maps each name to a host action; every binding is checked whole before
anything runs, so a typo or a type mismatch is refused up front, not mid-run.

```
variables:
    passed: mutable boolean = False
        description: "whether the checks passed"

subagent fix:
    description: "Edit the file"

    actions:
        edit_file:
            description: "Replace a file's content"
            inputs:
                path: string
                content: string
            outputs:
                ok: boolean
            target: "mcpTool://edit_file"

    reasoning:
        instructions: ->
            | Make src/greet.ts export greet(name) returning "Hello, <name>!".
        actions:
            edit: @actions.edit_file
                with path = ...
                with content = ...

subagent check:
    description: "Run the checks, without the model"

    actions:
        run_checks:
            description: "Run the configured checks"
            inputs:
                task_id: string
            outputs:
                passed: boolean
                output: string
            target: "mcpTool://run_checks"

    reasoning:
        instructions: ->
            run @actions.run_checks
                with task_id = "1"
                set @variables.passed = @outputs.passed
```

(Shown as a fragment: a full script also has `config` and `system` blocks, as in `hello.agent`.)

The built-ins are `read_file`, `edit_file`, `run_command` (an allowlist of first words, no
shell) and `run_checks`, all confined to one workspace directory, each recording an ontology
`Action` with its `Evidence` (a diff, a command's exit code):

```ts
import { agentScriptExtensions, createActionRegistry } from "@specsesh/agent/durable";
import { builtinActions } from "@specsesh/agent/node";

const workspace = "/path/to/repo";
const actions = createActionRegistry(
  builtinActions({ workspace, allow: ["pnpm", "node"], checks: ["pnpm test"] }),
);
const { run, step } = agentScriptExtensions({ actions, workspace });
registry.install(run);       // instead of AgentScript / AgentScriptStepExtension, which register no actions
registry.install(step);
```

Model-callable actions (`reasoning.actions`) need a durable host and a provider that serves tools, such as `anthropic`; the Claude Code provider can't, which is why `task-delegate.agent` exists. `run` statements work on any provider. A subagent mixes either prompt lines or `run`, not both: split them across subagents and list both in `entry`.

Add your own `HostAction`s beside the built-ins. A command action's replay policy is
`"unsafe"`: if the process dies mid-command, it fails rather than running twice.

## The OpenSpec task loop

`@specsesh/agent/task` works one task of an [OpenSpec](https://github.com/Fission-AI/OpenSpec)
change as a durable loop: **orient → act → check → judge**, again, until the task converges, a
person is needed, or the budget runs out. The judge's "done" only counts when every configured
check passes, and `next_action` is constrained to `retry`, `amend-spec` or `ask`. A converged
task is ticked in `tasks.md`; the loop never commits.

`agentscript.config.json` at the repo root:

```json
{
  "task": {
    "provider": "claude-code",
    "model": "opus",
    "script": "task-delegate",
    "delegateModel": "opus",
    "delegateContext": ["CLAUDE.md"],
    "checks": ["pnpm check", "pnpm test"],
    "allow": ["pnpm", "node"],
    "db": ".agentscript/task-loops.sqlite",
    "maxIterations": 8
  }
}
```

```bash
agentscript-task run add-thing 2.1                     # one task
agentscript-task run add-thing --next                  # the first unticked task
agentscript-task run add-thing 2                       # a whole group (2.1, 2.2, …), then the group check
agentscript-task run add-thing 2.1 --worktree --db .agentscript/2.1.sqlite   # in its own git worktree
agentscript-task status                                # every loop in the database
agentscript-task resume 42                             # finish a loop whose process died
agentscript-task answer 42 --by principal --decision "Relax the schema now"   # unblock an escalation
```

Progress is JSON Lines on stderr. `task.agent` acts with the model's own tools;
`task-delegate.agent` hands the act step to headless Claude Code, for subscription models
that can't serve tools.

## On Cloudflare

`AgentScriptHost` is a Durable Object class: runs are pi-durable tasks in the object's SQLite
storage, on **Workers AI** through the `AI` binding.

`wrangler.jsonc`:

```jsonc
{
  "name": "my-agents",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "durable_objects": { "bindings": [{ "name": "HOST", "class_name": "Agents" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Agents"] }]
}
```

`src/index.ts`:

```ts
import { AgentScriptHost, type AgentScriptEnv } from "@specsesh/agent/cloudflare";

interface Env extends AgentScriptEnv {
  HOST: DurableObjectNamespace<Agents>;
}

export class Agents extends AgentScriptHost<Env> {}      // Workers AI; AGENTSCRIPT_MODEL picks the model

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const [, root, host] = new URL(request.url).pathname.split("/");
    if (root !== "runs" || !host) return new Response("use /runs/<host>", { status: 404 });
    return env.HOST.getByName(host).fetch(request);    // one object (one durable store) per host name
  },
} satisfies ExportedHandler<Env>;
```

```bash
curl -X POST "https://my-agents.example.workers.dev/runs/demo?wait=1" \
  -H 'content-type: application/json' \
  -d "{\"source\": $(jq -Rs . < hello.agent), \"entry\": [\"greet\", \"decide\", \"sign_off\"], \"variables\": {\"name\": \"Ada\"}}"
curl "https://my-agents.example.workers.dev/runs/demo/<task>"   # the task id from the POST; progress, then the outcome
```

To pick a model in code instead of `AGENTSCRIPT_MODEL`, or another provider, override
`createModel()`. It runs in the constructor, before pi resumes unfinished work, and may read
only `this.env`:

```ts
import { createAI } from "agents/models/pi-ai";
import { AgentScriptHost, type ModelChoice } from "@specsesh/agent/cloudflare";

export class Agents extends AgentScriptHost<Env> {
  protected override createModel(): ModelChoice {
    const ai = createAI({ binding: this.env.AI as Ai });
    const model = ai("@cf/qwen/qwen3-coder");
    return { provider: ai.provider, model: { provider: model.provider, modelId: model.id } };
  }
}
```

Today a Cloudflare host runs scripts **without actions** (it has no workspace yet); see the
[roadmap](#roadmap). [`examples/cloudflare-worker`](../../examples/cloudflare-worker) adds a
faux model for local testing on `wrangler dev --local`.

## Entry points

There is no root import: pick the layer you need. Each layer's libraries are optional
peer dependencies, so a consumer of the interpreter alone installs none of them.

| Entry | What it holds | Peers it needs |
|---|---|---|
| `@specsesh/agent/authoring` | `parse`, `analyze`, `Document` (edit with undo/redo, lint) | none |
| `@specsesh/agent/interpreter` | `run`, the step machine (`start`/`next`/`apply`), `ReasoningPort`, the subset | none |
| `@specsesh/agent/pi` | A `ReasoningPort` on pi-ai, plus model helpers | `@earendil-works/pi-ai` |
| `@specsesh/agent/claude-code` | A `ReasoningPort` and a pi provider that run each step through your own `claude -p` (Node only) | `@earendil-works/pi-ai` |
| `@specsesh/agent/durable` | The pi-durable extensions, `startScript` / `waitForScript` / `runScript`, actions and the built-ins | `@earendil-works/pi-ai`, `@earendil-works/pi-durable`, `@earendil-works/chord` |
| `@specsesh/agent/node` | `localWorkspace(dir)`, a workspace over the filesystem, `child_process` and git; `gitSnapshot`; `builtinActions` (Node only) | the durable peers |
| `@specsesh/agent/cloudflare` | `AgentScriptHost`, a Durable Object class for a Worker to re-export (workerd only) | the durable peers and `agents` |
| `@specsesh/agent/openspec` | The OpenSpec ontology: typed schemas for a change, its lifecycle steps, its execution loops and their evidence | none (uses the `typebox` dependency) |
| `@specsesh/agent/task` | The task and group loops (`startTaskLoop`, `startGroupLoop`, `answerEscalation`, …), `taskLoopExtensions`, and the bundled `task.agent`, `task-delegate.agent` and `group.agent` (Node only) | the durable peers |

The authoring, interpreter and openspec entries run on Node and on Workers.

## Roadmap

Specified and validated in [`openspec/changes/`](../../openspec/changes), **not yet built**.
Each lands in order:

1. **[`add-actors-and-workspaces`](../../openspec/changes/add-actors-and-workspaces)** — an agent
   acts by itself or through a **delegate the user grants** (`mcpTool://delegate/<name>`, terms
   set in config), and every actor works in the loop's one `Workspace`. A typed host config,
   with models as closures over the runtime's environment:

   ```ts
   const { harness, models } = await createAgentHarness({
     models: {
       default: () => ({ provider: claudeCodeProvider(), model: { provider: "claude-code", modelId: "opus" } }),
       reviewer: () => ({ provider: anthropicProvider(), model: { provider: "anthropic", modelId: "claude-haiku-4-5" } }),
     },
     workspace: () => localWorkspace("/path/to/worktree"),
     delegates: { claude_code: { runner: "claude-code", model: "opus", allow: ["pnpm"] } },
   }, { storage, env: process.env, context });
   ```

   Adds a `./node` entry, so `./durable` (and `./cloudflare`) carry no Node-only code.
2. **[`add-agent-runner`](../../openspec/changes/add-agent-runner)** — delegate to one of your own
   agents on another model, as a durable child run with only the tools you grant; workspaces
   gain `list_files` and `search_files`.
3. **[`add-cloudflare-workspace`](../../openspec/changes/add-cloudflare-workspace)** — the same
   config on Cloudflare: models on the `AI` binding, the workspace a Cloudflare Sandbox cloned
   from a per-task Artifacts fork:

   ```ts
   export class Agent extends defineAgentHost<Env>({
     models: { default: (env) => workersAI(env.AI, "@cf/meta/llama-4-scout") },
     workspace: (env) => artifactsSandboxWorkspace(env.ARTIFACTS, getSandbox(env.SANDBOX, "task-2.1"),
                                                   { repo: "my-app", fork: "task-2.1", dir: "/workspace" }),
     checks: ["pnpm test"],
   }) {}
   ```
4. **The spec agent, then `pnpm change`** (18 small changes, from
   [`reorder-design-before-specs`](../../openspec/changes/reorder-design-before-specs) to
   [`add-change-close`](../../openspec/changes/add-change-close)). An agent drafts a change in four
   stages (proposal, design with an HTML mock and example code, specs, tasks). Rules check each
   draft, and you approve or revise it. Then the change loop builds it group by group, each
   group with its own task loops and judge, and `close` folds it into the specs:

   ```bash
   pnpm change draft add-plan-export --intent "Export a plan as JSON so CI can read it"
   pnpm change approve add-plan-export     # once per stage; or: pnpm change draft add-plan-export "<what to change>"
   pnpm change build add-plan-export       # stops only when an agent needs a decision
   pnpm change close add-plan-export       # fold the deltas into the specs
   ```

## `@specsesh/agent/openspec`

Types for executing an OpenSpec change, where every step has a typed input and output.
Each type is one [TypeBox](https://github.com/sinclairzx81/typebox) schema exported under the
type's name, with the static type `Static` of it, so a value can be checked wherever it crosses
a boundary (a model's tool call, a durable checkpoint): `check(Clause, value)`, or
`Value.Check(Clause, value)`. A TypeBox schema is a JSON Schema; `toJSONSchema(Clause)` returns
it as plain JSON. A few rules compare two fields of one value (a task id against its group, a
rename's `from` against its `to`); those are refinements on the schema itself, which
`Value.Check` and `check` run and the plain JSON Schema does not carry. The entry reads
no files and runs no loop.

- **Taxonomy:** `Root`, `Capability`, `CapabilityPath`, `Requirement`, `Scenario`, `Clause`,
  `Change`, `Proposal`, `Delta` (`Added`, `Modified`, `Removed`, `Renamed`), `Design`,
  `TaskList`, `TaskGroup`, `Task`, `TaskId`, `TaskLink`, `RequirementRef`, `ScenarioRef`,
  `LinkBasis`; `formatRef` / `parseRef`, `applyDelta`, `unclaimedScenarios`.
- **Steps:** `propose`, `specify`, `design`, `plan`, `validate`, `approve`, `execute` and
  `archive` (`STEPS`, `STEP_SCHEMAS`), each returning a `StepResult` rather than throwing
  (`invokeStep`); the change state machine, `ChangeState` and `transition(state, event)`.
- **Loops:** one shape (`LoopInput`, `Iteration`, `Verdict`, `Feedback`, `Escalation`,
  `LoopOutcome`) used three times: the **task loop** (`TaskOutcome`), the **group loop**
  (`GroupOutcome`) and the **change loop** (`ChangeOutcome`); `outcomeStatus`, `judge`,
  `feedbackFor` and the other rules a runner applies between iterations.
- **Evidence:** `TestEvidence`, `ValidationEvidence`, `CheckEvidence`, `DiffEvidence`,
  `ReviewEvidence`, `Finding`; `satisfies(target, evidence)`.

## Command-line tools

- `agentscript-pi run <file> [--provider <id>] [--model <id>] [--entry <subagent>]... [--var name=value]... [--json]`
  runs a script once, on any pi provider or with `--provider claude-code`; `agentscript-pi models [provider]`
  lists a provider's models. Needs `@earendil-works/pi-ai`.
- `agentscript-durable run <file> --db <path> [...]` runs a script as a durable task on a Node SQLite file;
  `agentscript-durable resume <task-id> --db <path>` finishes one whose process died. Needs the durable peers.
- `agentscript-task run <change> <task-id>|<group>|--next|--next-group [--db <path>] [...]` works a task, or a
  whole task group, of an OpenSpec change as a durable loop until it converges (every check passing), blocks
  on a question, or spends its budget; `resume`, `answer` and `status` manage loops in a database. Defaults
  come from the nearest `agentscript.config.json`. It runs headless (JSON Lines progress on stderr), refuses
  a dirty git tree unless `--allow-dirty`, never commits, and with `--worktree` runs in a new git worktree.
  Needs the durable peers.

Credentials are pi-ai's own environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...).

## What it does not do

**It never compiles.** Agent Script's compiler emits a Salesforce-internal
specification format that executes only on Salesforce infrastructure — the
runtime is not open source. Compiling from here would produce a build that can
never be run.

That is enforced structurally. The dependencies are
`@sf-agentscript/language` (analysis engine, lint passes, Language Service API)
and `@sf-agentscript/parser-javascript` (error-tolerant parser). The compiler
ships in `@sf-agentscript/agentforce`, which is deliberately **not** a
dependency of this package.

**It holds no credential and imports no model client.** Reasoning leaves through
an injected port (`ReasoningPort`, from `@specsesh/agent/interpreter`). The model
clients live in the other entry points, behind optional peers. See
`src/interpreter/port.ts`.

## Drift travels one way

The Agent Script **language specification is closed to outside contribution** —
upstream's own words: *"we're not accepting changes to the language spec for
now. The spec needs to stay in sync with the runtime."* So we cannot propose a
change, and we cannot fork one either: a divergent dialect would be a language
nobody else's tooling reads.

Drift is therefore **absorbed, never upstreamed**. Every upstream dependency is
pinned to an exact version, and `scripts/check-subset-conformance.mjs` — run by
this package's own `test` script — parses one probe per supported construct and
fails naming any whose handling changed. A version bump cannot land while a
construct silently started meaning something else.

The supported constructs are declared once, in `src/interpreter/subset.ts`. The
conformance script, the refusal a caller gets, and the list below all read that
same declaration rather than keeping a copy of it.

## The supported subset

Anything outside this list is refused **before the run starts**, by name and
position, and worded as *unsupported by this runtime* — the document is very
likely valid Agent Script that Salesforce's runtime would execute; what is true
is that we do not implement it.

<!-- SUBSET:BEGIN — generated from renderSubsetMarkdown(); do not hand-edit -->
- `config` — the config block naming the agent
- `system.instructions` — standing instructions, as a multiline block
- `variables` — declared variables with a type and a literal default
- `variables.description` — a variable's description
- `subagent` — a named subagent with a description
- `subagent.reasoning` — a subagent's reasoning block
- `reasoning.prompt-line` — a prompt line, interpreted by the model
- `reasoning.interpolation` — a `{!@variables.x}` reference inside a prompt line
- `reasoning.logic-line` — a logic line, run deterministically every turn
- `reasoning.structured-output` — assigning a variable from a field of the step's structured result
- `subagent.actions` — actions a subagent defines, each bound to a host tool
- `reasoning.run` — a run statement, calling an action deterministically
- `reasoning.actions` — actions a reasoning step offers the model as tools
<!-- SUBSET:END -->

`__tests__/core/subset-single-source.test.ts` fails if that block and the declaration
disagree, so the three restatements this requirement warns about cannot appear.

**This already caught something.** The vocabulary in Salesforce's own README
example is `topic`; the pinned dialect deprecates it — *"'topic' is deprecated:
Replace topic with subagent."* The subset uses `subagent`. Building on the
deprecated spelling would have been a decision nobody made.

## The interpreter runs the dialect's spelling, not a near-miss of it

A document this interpreter runs must be one an author could SAVE — the two
halves of this package parse the same text with the same dialect, and where
they disagreed, the authoring surface was right. Three spellings had drifted,
each runnable and each an error in the author's editor:

| the dialect | the near-miss it rejects |
|---|---|
| `approved: mutable boolean = True` | `true` — *"'true' is not a valid value in AgentScript. Did you mean 'True' (capitalized)?"* |
| `| Draft the {!@variables.stage}.` | `{@variables.stage}` — *"The '!' is required for template interpolation."* |
| `set @variables.verdict = @outputs.verdict` | `@output` — *"'@output' is not a recognized namespace"* |

`run()` now refuses any document carrying error-severity diagnostics, before it
scans and before it dispatches. That covers a fourth case the list above cannot:
the parser RECOVERS from a syntax error rather than throwing, so an unterminated
string used to execute to `completed` with a variable holding a value the
recovery invented. Every fixture the interpreter tests against is asserted
lint-clean by `__tests__/core/fixtures-lint.test.ts`, which is the seam that was
missing when all three drifted.

## License

Apache-2.0. See `LICENSE`.
