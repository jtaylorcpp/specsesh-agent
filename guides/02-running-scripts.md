# Running a script

After this guide you can run an Agent Script file from code or from the command line, on any model
pi-ai supports or on your own Claude subscription. You can test a script with no model at all by
writing a stub port. And if you need to own the loop, for example to save progress between steps,
you can drive the step machine yourself.

## Prerequisites

You have a script that passes the checks in [Writing Agent Script](01-agent-script.md). The
interpreter has no model client and reads no credential. Which peers you install depends on where
the model is:

```bash
# the interpreter alone, with a stub or your own port
npm install @specsesh/agent

# any pi-ai provider, or claudeCodeProvider()
npm install @specsesh/agent @earendil-works/pi-ai
```

`@specsesh/agent/interpreter` needs no peer. `@specsesh/agent/pi` needs `@earendil-works/pi-ai`.
`@specsesh/agent/claude-code` needs no peer for `createClaudeCodeReasoningPort`, and `pi-ai` for
`claudeCodeProvider`. It also needs the `claude` binary on your `PATH`, and it runs on Node only.

The scripts below use this file, `triage.agent`:

```
config:
    agent_name: "triage"

system:
    instructions: |
        You triage support reports. Keep every answer to one short line.

variables:
    report: mutable string = "it crashes on save"
        description: "the report to triage"
    severity: mutable string = ""
        description: "low, medium or high"
    urgent: mutable boolean = False
        description: "whether someone should be paged"
    reply: mutable string = ""

subagent triage:
    description: "Judge the report"

    reasoning:
        instructions: ->
            | Judge this report: {!@variables.report}
            set @variables.severity = @outputs.severity
            set @variables.urgent = @outputs.urgent

subagent respond:
    description: "Write the reply"

    reasoning:
        instructions: ->
            if @variables.urgent:
                | Write a one-line reply to the author of "{!@variables.report}". Say it is urgent.
            else:
                | Write a one-line reply to the author of "{!@variables.report}". Severity is {!@variables.severity}.
```

## Run a script with run()

`run(source, options)` is the whole machine as one async call. It checks the document, composes
each step, hands it to your port, applies the answer and moves on, until the entries are done or a
step stops the run.

```ts
import { readFileSync } from "node:fs";
import { run, type ReasoningPort } from "@specsesh/agent/interpreter";

declare const port: ReasoningPort; // …any port: a stub, pi, Claude Code

const source = readFileSync("triage.agent", "utf8");
const result = await run(source, {
	port,
	entry: ["triage", "respond"],
	variables: { report: "the login page is down for everyone" },
});
console.log(result.kind, result.variables);
```

The options:

| Option | Meaning |
|---|---|
| `port` | The model boundary. Required. Without one `run` throws `NoReasoningPortError`; there is no default. |
| `entry` | A subagent name or an ordered list of names. Defaults to the **first** subagent in the file only. Duplicates run twice. |
| `variables` | Starting values that override the authored ones. Every name must be declared, or `UndeclaredOverrideError`. Values are used as given, with no coercion. |
| `persistVariables` | When `true`, `result.updatedSource` holds your script text with each changed variable's default rewritten to its final value. Off by default. |
| `choices` | Allowed values per string variable, for values taken from a structured result. Each list must be non-empty and include the variable's opening value. |
| `actionHost` | Runs the action calls a `run` statement makes. Required when an entry subagent runs an action; see [Host actions](04-actions.md). |

`run` never writes a file. `persistVariables` returns text and leaves saving it to you:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { run, type ReasoningPort } from "@specsesh/agent/interpreter";

declare const port: ReasoningPort; // …any port

const source = readFileSync("triage.agent", "utf8");
const result = await run(source, { port, entry: ["triage"], persistVariables: true });
if (result.kind === "completed" && result.updatedSource !== undefined) {
	writeFileSync("triage.agent", result.updatedSource);
}
```

Only the default values are spliced. Comments, spacing and everything else stay byte for byte.
Booleans are written as `True` and `False`, so the file still lints clean.

## Read the RunResult

```ts
import type { RunResult } from "@specsesh/agent/interpreter";

function summarise(result: RunResult): void {
	console.log(`run ${result.kind}`);
	for (const step of result.steps) {
		const { subagent, outcome } = step;
		switch (outcome.kind) {
			case "answered":
				console.log(`${subagent}: ${outcome.text}`);
				if (outcome.structured !== undefined) console.log("  structured:", outcome.structured);
				break;
			case "cut-short":
				console.log(`${subagent}: cut short after ${outcome.turns} turns`);
				break;
			case "failed":
				console.log(`${subagent}: ${outcome.category}: ${outcome.message}`);
				break;
		}
	}
	console.log("variables:", result.variables);
}
```

- **`kind`** is `"completed"`, `"cut-short"` or `"failed"`. It comes from the last step; an answered
  step counts as completed. A failed action call also makes the run `failed`.
- **`steps`** has one `StepReport` per model request: `{ subagent, request, outcome }`. `request`
  is exactly what the port saw. A subagent made only of logic lines has no step, because it made
  no request.
- **`actions`** has one `ActionReport` per action call, in order. See [Host actions](04-actions.md).
- **`variables`** is the final state. After a run that stopped early, it is the state from before the
  stopped step's own logic lines ran. Subagents that finished earlier keep their changes.
- **`updatedSource`** is present only with `persistVariables`.

A step has three outcomes:

- `answered`: `text`, plus `structured` when the step asked for a result.
- `cut-short`: the implementation stopped at its own bound, with a `turns` count. A partial answer
  is never reported as a finished one. The pi port never reports this. The Claude Code port does,
  when `maxTurns` is hit.
- `failed`: a `category` and the layer's `message`, kept verbatim.

### Failure categories

A failure carries a `FailureCategory` so you can branch without reading prose:

| Category | Meaning |
|---|---|
| `authentication_failed`, `oauth_org_not_allowed` | Credentials are wrong or not allowed. Retrying will not help. |
| `billing_error` | The account cannot be billed. |
| `rate_limit`, `overloaded` | Back off and retry. |
| `server_error` | The provider failed. Often retryable. |
| `invalid_request` | The request was refused as malformed. A port that cannot run a tool loop also reports this when a step offers tools. |
| `model_not_found` | The model id is wrong. |
| `max_output_tokens` | The reply hit the output cap. |
| `layer_unknown` | The layer itself said "unknown". |
| `unrecognised` | The layer named a category this runtime does not know. The message is kept. |
| `unknown` | Nothing named a category. This includes the interpreter's own contract failures, such as a structured step that got no structured result. |

Nothing is guessed. A category the runtime does not know is `unrecognised`, never folded into the
nearest named one.

A step that asked for a structured result and got none, or got a field of the wrong shape, is a
`failed` step with category `unknown`. No variable is set, and the text of the reply is never
parsed for one.

## ReasoningPort: the model boundary

A port is one method. A reasoning step goes in, an outcome comes out.

```ts
import type { ReasoningRequest, StepOutcome } from "@specsesh/agent/interpreter";

interface ReasoningPort {
	reason(request: ReasoningRequest): Promise<StepOutcome>;
}
```

A `ReasoningRequest` has:

- `systemInstructions`: the script's `system.instructions`, its own channel.
- `prompt`: this step's composed prompt.
- `outputSchema`: a JSON Schema, only when the step has `set … = @outputs.field` lines.
- `tools`: tool declarations, only when the step has `reasoning.actions`. A port that cannot run a
  tool loop answers these with `invalid_request`.

The port is stateless. Every request carries everything, so nothing is remembered from the step
before.

### A stub port: test a script with no model

Write your own port to test the script's logic, composition and variable handling without a model.
This one answers a structured step from its schema and a text step with a fixed line, and keeps
every prompt it saw.

```ts
import { readFileSync } from "node:fs";
import { run, type ReasoningPort, type ReasoningRequest } from "@specsesh/agent/interpreter";

const seen: ReasoningRequest[] = [];

const stub: ReasoningPort = {
	async reason(request) {
		seen.push(request);
		if (request.outputSchema === undefined) {
			return { kind: "answered", text: "Thanks, we are on it." };
		}
		// A structured step: fill every field the schema asks for.
		return {
			kind: "answered",
			text: "",
			structured: { severity: "high", urgent: true },
		};
	},
};

const result = await run(readFileSync("triage.agent", "utf8"), {
	port: stub,
	entry: ["triage", "respond"],
});

console.log(result.kind);       // completed
console.log(result.variables);  // { report: ..., severity: "high", urgent: true, reply: "" }
console.log(seen[1]?.prompt);   // the composed prompt of the "respond" step
```

Run against `triage.agent`, this prints:

```text
completed
{
  report: 'it crashes on save',
  severity: 'high',
  urgent: true,
  reply: ''
}
Write a one-line reply to the author of "it crashes on save". Say it is urgent.
```

The second step took the `urgent` branch, because the first step's structured result set
`urgent` to `True`. That is a test of the script, with no model and no cost.

To test a failure, return one:

```ts
import type { ReasoningPort } from "@specsesh/agent/interpreter";

export const rateLimited: ReasoningPort = {
	async reason() {
		return { kind: "failed", category: "rate_limit", message: "429 from the stub" };
	},
};
```

The run ends with `kind: "failed"`, the step's outcome is the failure you returned, and no variable
from that step is set. The runtime also checks what a port hands back: `null`, an unknown `kind`
or a non-string category become a `failed` step rather than a crash.

## Any pi-ai provider

`@specsesh/agent/pi` builds a port on [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai),
so a script runs on any provider pi knows. `createPiReasoningPort` makes one model request per
step. `resolveModel` looks a model up and throws by name, with some known ids, instead of
returning `undefined`.

```ts
import { readFileSync } from "node:fs";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { run } from "@specsesh/agent/interpreter";
import { createPiReasoningPort, resolveModel } from "@specsesh/agent/pi";

const models = createModels();
models.setProvider(anthropicProvider());
const port = createPiReasoningPort({
	models,
	model: resolveModel(models, "anthropic", "claude-haiku-4-5"),
	maxTokens: 1024,
	onMessage: (message) => console.log("cost", message.usage.cost.total),
});

const result = await run(readFileSync("triage.agent", "utf8"), {
	port,
	entry: ["triage", "respond"],
});
console.log(result.kind, result.variables);
```

Credentials are pi-ai's: `ANTHROPIC_API_KEY` for Anthropic, and the matching variable for each
other provider. The port options are `models`, `model`, `maxTokens` (default `4096`),
`temperature`, `signal` and `onMessage`.

To reach every built-in provider, take the whole collection:

```ts
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createPiReasoningPort, resolveModel, DEFAULT_PROVIDER, DEFAULT_MODEL } from "@specsesh/agent/pi";

const models = builtinModels();
const provider = process.env.AGENTSCRIPT_PROVIDER ?? DEFAULT_PROVIDER; // "anthropic"
const modelId = process.env.AGENTSCRIPT_MODEL ?? DEFAULT_MODEL;        // "claude-haiku-4-5"
export const port = createPiReasoningPort({ models, model: resolveModel(models, provider, modelId) });
```

How the pi port reports a step, from structured fields only and never from message text:

- Stop reason `stop` or `toolUse` is `answered`. With an `outputSchema` the port offers one tool,
  `submit_result` (the exported `RESULT_TOOL`), forces the model to call it where the wire API allows,
  and returns its arguments as `structured`.
- `length` is `failed` with `max_output_tokens`.
- `error` is `failed`, with a category from the HTTP status when pi carried one (401 and 403 are
  `authentication_failed`, 402 `billing_error`, 429 `rate_limit`, 503 and 529 `overloaded`, other
  5xx `server_error`, 400, 413 and 422 `invalid_request`). No status means `unknown`.
- `aborted` is `failed`, `unrecognised`.

It never reports `cut-short` and it runs no tool loop. A step with `reasoning.actions` comes back
`failed` with `invalid_request`; those steps need the durable host.

## Your Claude subscription

`@specsesh/agent/claude-code` runs each step through your own `claude` binary, logged in as you.
It has two forms, and either one takes the same hard lines.

As a port, with no pi-ai needed:

```ts
import { readFileSync } from "node:fs";
import { run } from "@specsesh/agent/interpreter";
import { createClaudeCodeReasoningPort } from "@specsesh/agent/claude-code";

const port = createClaudeCodeReasoningPort({
	model: "claude-haiku-4-5", // any id or alias `claude --model` takes: haiku, sonnet, opus
	maxTurns: 3,
	timeoutMs: 120_000,
	onResult: (r) => console.log("turns", r.num_turns, "notional cost", r.total_cost_usd),
});

const result = await run(readFileSync("triage.agent", "utf8"), {
	port,
	entry: ["triage", "respond"],
});
console.log(result.kind);
```

The options are `model` (default `claude-haiku-4-5`), `binary` (default `claude`), `maxTurns`,
`timeoutMs` (default five minutes), `runner` (replaces process spawning, for tests) and `onResult`.
A step that reaches `maxTurns` settles as `cut-short`, the one place a cut-short comes from.

As a pi provider, so anything built on pi can use it:

```ts
import { createModels } from "@earendil-works/pi-ai";
import { claudeCodeProvider } from "@specsesh/agent/claude-code";
import { createPiReasoningPort, resolveModel } from "@specsesh/agent/pi";

const models = createModels();
models.setProvider(claudeCodeProvider());
export const port = createPiReasoningPort({
	models,
	model: resolveModel(models, "claude-code", "claude-haiku-4-5"),
});
```

The hard lines, which are not options:

- **Never `--bare`.** Every step is one `claude -p --safe-mode` process, started with `--tools ""`,
  `--no-session-persistence` and `--output-format json`. Safe mode keeps your global `CLAUDE.md`,
  skills, plugins, hooks and MCP servers out of the step.
- **`ANTHROPIC_API_KEY` is removed** from the child's environment, so Claude Code uses your
  subscription login and never silently bills an API key. `CLAUDECODE` is removed too, so a run
  started inside a Claude Code session is not refused.
- **The OAuth token is never read, copied or forwarded.** The turn is made by Claude Code, as you.
  Handing the token to another client is exactly what the terms rule out, and nothing here does it.
- The child runs in your temp directory, outside any project.

The costs reported are notional on a subscription. This route is for local work. On a server, use a
real provider and an API key.

The same limits as the pi port apply: a step that offers tools comes back `invalid_request`, and
the provider form refuses a request offering more than one pi tool. Agent Script steps offer at
most `submit_result`, so scripts without `reasoning.actions` are fine.

## The agentscript-pi CLI

Installing the package puts `agentscript-pi` on your path.

```bash
agentscript-pi run triage.agent --entry triage --entry respond \
  --provider anthropic --model claude-haiku-4-5 --var report="login is down"

agentscript-pi run triage.agent --provider claude-code --model haiku --json

agentscript-pi models                 # models on the default provider
agentscript-pi models openai
```

- `--entry <subagent>` may repeat, in order. `--var name=value` may repeat. Values `True` and
  `False` become booleans and plain numbers become numbers; everything else is a string.
- `--max-tokens <n>` sets the output cap for pi providers.
- Provider and model come from the flags, then `AGENTSCRIPT_PROVIDER` and `AGENTSCRIPT_MODEL`, then
  `anthropic` and `claude-haiku-4-5`.
- `--provider claude-code` uses your `claude` binary. `agentscript-pi models claude-code` prints a
  note about the ids it accepts, since there is no fixed list.
- Output is a readable report of each step, the final variables and token usage. With `--json` it is
  the `RunResult` plus `provider`, `model` and `usage`.
- The exit code is `0` for a completed run and `1` otherwise. A missing file or an unknown model is
  an error with a name, not usage text. Usage is printed, with exit code `2`, for an unknown
  command or no file.

The CLI does not run scripts with actions: it passes no `actionHost`. Use the library for those.

## Drive the step machine yourself

`run()` is a loop over four functions. Use them directly when you want to save progress between
steps, run each step somewhere else, or put a person in the loop.

- `start(source, { entry, variables, choices })` checks the whole document and returns the first
  `RunState`.
- `next(source, state)` returns one of: `{ type: "request", request, state }` for you to answer,
  `{ type: "action", call, state }` for you to run, or `{ type: "done", result }`.
- `apply(source, state, outcome)` folds a model answer into the state.
- `applyAction(source, state, result)` folds an action call's `ActionResult` into the state.

`RunState` is **plain JSON**: no functions, no `Map`s, no class instances. Store it anywhere and
read it back. `next` is pure, so a host that crashed after `next` and before `apply` can call `next`
again and get the same request.

```ts
import { readFileSync } from "node:fs";
import {
	apply,
	next,
	start,
	type ReasoningPort,
	type RunState,
} from "@specsesh/agent/interpreter";

declare const port: ReasoningPort; // …any port

const source = readFileSync("triage.agent", "utf8");
let state: RunState = start(source, { entry: ["triage", "respond"] });

for (;;) {
	const step = next(source, state);
	if (step.type === "done") {
		console.log(step.result.kind, step.result.variables);
		break;
	}
	if (step.type === "action") {
		throw new Error("triage.agent runs no actions");
	}
	// step.state holds the awaiting step. Save it before you call the model.
	const saved = JSON.stringify(step.state);
	const outcome = await port.reason(step.request);
	state = apply(source, JSON.parse(saved) as RunState, outcome);
}
```

Rules the machine holds you to:

- A state is valid only with the **exact source** it started on. `next` and `apply` throw
  `SourceMismatchError` for any other text. A changed script is a new run. `hashSource(source)`
  gives the fingerprint the state carries.
- `apply` with no step awaiting, or `next` and `apply` out of order, throws `RunStateError`.
- `next` runs any logic-only subagents on its own and moves past them, so the next request is
  always one that needs a model.
- A failed or cut-short step sets `state.stopped`. Calling `next` then returns `done` with that
  kind.
- Every refusal from [Writing Agent Script](01-agent-script.md) is thrown by `start`, before any
  state exists. `next` can still throw `EmptyPromptError`, when a step's prompt lines all sit behind
  conditions that did not hold but it still asks for a structured result.

Action calls work the same way: `next` returns `{ type: "action", call }`, you run it, and you pass
the answer to `applyAction`. [Host actions](04-actions.md) covers the shape of `ActionCall` and
`ActionResult`. [Durable agents](03-durable-agents.md) shows a host that already does all of this
for you, with checkpoints in SQLite.

## Errors worth knowing

All of these extend `Error`, set `name` to the class name, and are exported from
`@specsesh/agent/interpreter`:

| Error | When |
|---|---|
| `NoReasoningPortError` | `run` without a `port`. |
| `NoActionHostError` | An entry subagent runs an action and `run` has no `actionHost`. |
| `UnparsedDocumentError` | The script has error-severity diagnostics. Carries `diagnostics`. |
| `UnsupportedConstructError` | The script uses something outside the subset. Carries `constructs`. |
| `UndeclaredOverrideError` | `variables` names something the script never declared. |
| `UnknownSubagentError`, `NoEntrySubagentError` | A bad `entry`. |
| `InvalidChoicesError` | `choices` names a non-string or undeclared variable, an empty list, or a list that excludes the opening value. |
| `SourceMismatchError`, `RunStateError` | A state used with the wrong source, or out of order. |
| `EmptyPromptError` | A step would ask the model nothing and expect an answer. |

## Next

- [Durable agents](03-durable-agents.md): the same scripts as crash-safe tasks.
- [Host actions](04-actions.md): `actionHost`, `run` statements and model-callable tools.
- [Cloudflare](05-cloudflare.md): run in a Durable Object.
- [The OpenSpec ontology](06-openspec.md) and [the task loop](07-task-loop.md).
- [Writing Agent Script](01-agent-script.md): back to the language.
