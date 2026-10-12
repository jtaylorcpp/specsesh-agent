## Why

Delegation is wired in as a fixed part of the task runner today. A built-in action, `delegate_claude_code`, is always registered. Its model and context come from two `task` config fields, and the subscription script (`task-delegate.agent`) hands every act step to it. Nobody decided that this agent may delegate, or to what. The runner just does.

The principal's model:
- **By default the harness controls everything with the model provided.** Agent Script on pi runs every step on that model, with no delegate.
- **Delegation is a capability an agent author opts into, and the user grants.** An author can write an agent that hands work to another agent, but only to delegates the user has explicitly allowed, on the terms the user set.

Running `add-group-loop` and `iterate-by-default` on our own agent also showed three gaps in today's delegate:
- **A delegate that changed nothing looks like one that did.** In `iterate-by-default` 2.2, one iteration's delegate returned only a plan and the loop couldn't tell.
- **The delegate doesn't know its own terms.** In 2.2, its shell call was denied (a compound command, outside the `Bash(<word>:*)` patterns) and it never learned why.
- **A delegate repeats a failing approach.** 2.2 spent 8 iterations on the same diagnosis without trying anything new.

## What Changes

- **Delegates are declared in Agent Script, with existing syntax.** A delegation is an action whose `target` is `mcpTool://delegate/<name>`. It lints clean against the pinned dialect and passes today's subset scan (probed 2026-10-11). Its inputs are exactly `instructions` (string). Its outputs are exactly:
  - `ok` (boolean);
  - `summary` (string);
  - `files_changed` (number: `-1` when the workspace isn't a git repository).

  It is called like any action: deterministically with `run`, or offered to the model as a reasoning action.
- **The user grants delegates in configuration.** `agentscript.config.json` gains a top-level `delegates` map. Each named grant fixes:
  - `runner`: `claude-code`, the only runner today;
  - `model`;
  - `tools`: Claude Code's tools allowed;
  - `allow`: the shell command allowlist;
  - `permissionMode`: `dontAsk`, the only mode today;
  - `context` files, `timeoutMs`, and `maxCalls` per run.

  Hosts pass grants with `delegationActions(grants, { workspace })`. Nothing is granted by default, and `--no-delegates` withdraws every grant for one run.
- **Binding is checked whole before anything runs.** A script whose `mcpTool://delegate/<name>` names a delegate the user hasn't granted is refused at start, naming it and listing what is granted. A granted delegate that the script doesn't use is fine. A call beyond `maxCalls` fails that action, so the task loop retries the iteration or exhausts by budget.
- **The terms are the user's, not the script's.** The script supplies only `instructions`. Model, tools, permission mode, allowlist and time limit come only from the grant, and a script can't widen them.
- **The delegate is told its terms.** The runner appends them to the instructions: the allowed first words, one command per Bash call (no `cd … &&` chains), and the time limit.
- **Every delegation is recorded.** The `Action` (`kind: "delegate"`) refs the grant name. Its `Evidence` is a `DiffEvidence` of the files the delegate changed (a before-and-after workspace snapshot), plus a `CheckEvidence` for the Claude Code process.
- **The built-in `delegate_claude_code` is retired.** Its hard lines become the `claude-code` runner's rules:
  - `--safe-mode`, and never `--bare`;
  - `ANTHROPIC_API_KEY` and `CLAUDECODE` stripped from its environment;
  - Claude Code's OAuth token never read or forwarded;
  - `dontAsk`.

  The `delegateModel` and `delegateContext` task fields are removed; they live in a grant now. A config that still has them is refused, saying where they moved.
- **The bundled scripts:**
  - `task.agent` stays delegate-free: the harness acts with the model provided.
  - `task-delegate.agent` targets `mcpTool://delegate/claude_code`, so it runs only when the user grants a `claude_code` delegate. Its judge sees `files_changed`. Its orient step changes approach when the carried feedback names a check that already failed.
  - This repo's config grants `claude_code` on Opus, so its own tasks keep running on the subscription until the MCP bridge lets the harness act there itself.

## Out of scope

- **The MCP bridge** that lets the harness drive its own act step on the subscription. That's the next change; it makes `task.agent` usable there with no delegate.
- **Runners other than `claude-code`,** such as other coding agents or pi agents. The grant's `runner` field leaves room for them.
- **Delegates that delegate further.** A delegated Claude Code session gets no access to our grants.
- **A CLI flag that grants or reconfigures a delegate.** Grants live in config, so they're reviewed with the repository.

## Capabilities

- **New:** `actions/delegation`: the `delegate/` namespace, grants, binding, terms, the `claude-code` runner, recording.
- **Modified:**
  - `actions/registry`: four built-ins; the delegate requirements move to `actions/delegation`; the recording rule;
  - `task/agent`: loop options carry grants, not `delegateModel`/`delegateContext`; the bundled scripts' delegation stance;
  - `task/headless`: the `delegates` config, the removed fields, this repo's grant;
  - `task/cli`: the options `run` passes, `--no-delegates`.

## Impact

- `packages/agent/src/durable/builtins.ts` (the delegate leaves), a new `src/durable/delegation.ts`, `src/task/` (options, loop input, the group loop, config, bundled scripts), the CLI, `agentscript.config.json`, `CLAUDE.md`, docs, and tests (fake `claude` only).
- Depends on nothing open. The MCP bridge follows it.
- Breaking for configs using `delegateModel` or `delegateContext`, and for scripts targeting `mcpTool://delegate_claude_code`. This repo's config and bundled script are migrated in the change.
