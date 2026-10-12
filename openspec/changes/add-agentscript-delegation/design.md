## Context

Probed against the pinned dialect on 2026-10-11: `target: "mcpTool://delegate/claude_code"` lints with zero diagnostics and passes today's subset scan, both in a `run` statement and as a reasoning action. So delegation needs no language change, only a reserved namespace and a host that resolves it through grants.

Today `delegate_claude_code` is a built-in host action, always registered (`durable/builtins.ts`), configured by `delegateModel` and `delegateContext`, which flow from the config through `TaskLoopOptions`, the loop's durable input, and the group loop's input. `task-delegate.agent` targets `mcpTool://delegate_claude_code`.

## Shape

```
script:  actions:
             hand_off:
                 description: "…"
                 inputs:  { instructions: string }
                 outputs: { ok: boolean, summary: string, files_changed: number }
                 target: "mcpTool://delegate/claude_code"

config:  { "delegates": { "claude_code": {
             "runner": "claude-code",          required
             "model": "opus",                  optional (Claude Code's default)
             "tools": [...],                   default ["Read","Edit","Write","Glob","Grep","Bash"]
             "allow": ["pnpm", "node"],        default []
             "permissionMode": "dontAsk",      default "dontAsk"; nothing else accepted
             "context": ["CLAUDE.md"],         default []; relative to the config file
             "timeoutMs": 900000,              default 900000
             "maxCalls": 5 } },                default 5
           "task": { … } }

host:    delegationActions(grants, { workspace, claudeBinary? }) → HostAction[]   one per grant, named delegate/<name>
         taskLoopExtensions({ workspace, checks, allow, delegates? })            built-ins + delegationActions(delegates)
```

- **The `delegate/` namespace is reserved.** `createActionRegistry` refuses an action whose name starts with `delegate/` unless `delegationActions` made it. A built-in or a host's own action can't claim the namespace. That's how "only the user grants" holds even for a host that adds its own actions.
- **Binding is today's binding check plus one message.** A delegate action is an ordinary registered host action, so declared names and types are already checked exactly. An unregistered `mcpTool://delegate/<name>` gets an `ActionBindingError` that also lists the granted names, or says `no delegates are granted`.
- **Grants are validated whole when read.** An unknown key, a wrong type, an unknown `runner`, a `permissionMode` other than `dontAsk`, a non-positive `timeoutMs` or `maxCalls`, or a name that isn't `[a-z][a-z0-9_]*` is a config error: exit `2`, naming the grant and the key.
- **Terms come from the grant only.** The executor builds its argv and environment from the grant and the workspace. Script inputs reach only stdin.
- **`maxCalls` counts per run, from the run's own action reports,** so it holds across a resume. A call beyond the limit answers `{ ok: false, message: "delegate <name> reached its limit of <n> calls in this run" }`. That is a failed action, so the task loop retries the iteration within budget (`task/agent`, "A run ended by a failed action is retried within budget").
- **Grants are part of the loop's durable input.** A resumed loop delegates on the terms it started with, even if the config changed since.

## The claude-code runner

```
claude -p --safe-mode [--model <grant.model>] --output-format json --no-session-persistence
       --tools <grant.tools joined by ","> --permission-mode dontAsk
       [--append-system-prompt-file <each grant.context, resolved>]
       --allowedTools <grant.tools except Bash…> [<"Bash(<word>:*)" per grant.allow, only when Bash is in grant.tools>]
cwd = workspace; ANTHROPIC_API_KEY and CLAUDECODE stripped; never --bare; never the OAuth token
stdin = instructions + "\n\n" + terms block
killed after grant.timeoutMs → { ok: false, "Claude Code timed out after <ms>ms" }
```

This is today's headless delegate argv, with every value now coming from the grant. `Bash` in `tools` with an empty `allow` means no shell: `--allowedTools` carries no Bash pattern.

The terms block, appended to stdin:

```
Your terms for this delegation (set by the user; you cannot change them):
- Shell: only commands whose first word is one of: pnpm, node.   (or: "Shell: none.")
- One command per Bash call. Chained or prefixed commands (cd … &&, ;, |) are denied; use the tool's own flags, e.g. pnpm -C <dir> or pnpm --filter <pkg>.
- Time limit: 900 seconds.
```

## Recording

```
before = snapshot(workspace)      git porcelain status + content hash per listed path (task/git.ts)
run Claude Code
after  = snapshot(workspace)
changed = changedBetween(before, after)
files_changed = changed.length             (-1 outside a git repository, and no DiffEvidence)
record = Action { kind: "delegate", summary: first line of instructions, refs: ["delegate/<name>"] }
         DiffEvidence { files: changed → added (absent before) | deleted (absent after) | modified }
         CheckEvidence { command: "claude -p", exitCode, output: summary }
```

## The bundled delegate script

`task-delegate.agent`:
- **act:** `run @actions.claude_code` (`target: "mcpTool://delegate/claude_code"`), setting `act_ok`, `act_summary` and `act_files`.
- **judge:** the prompt gains `Files the delegate changed: {!@variables.act_files}`. When it is `0`, the judge sees that nothing changed.
- **orient:** gains one line: "If the carried feedback names a check that already failed before, the last approach did not work: choose a different one and say what you will do differently."

## Migration

- `delegateModel` and `delegateContext` leave `TaskLoopOptions`, the loop input, `GroupLoopOptions`, `builtinActions` and the `task` config. A config that still has them is refused: `"delegateModel" moved: grant a delegate under "delegates" instead`.
- This repo's config gains `delegates.claude_code`: runner `claude-code`, model `opus`, allow `["pnpm", "node"]`, context `["CLAUDE.md"]`. It keeps `script: "task-delegate"` until the MCP bridge lands.
- `--no-delegates` withdraws every grant for one run, so a delegating script is refused at start.

## Risks

- **A grant is real power.** Shell access within the allowlist is still shell access. That's why grants are explicit, named, listed in every refusal, and why nothing is granted by default.
- **Retiring `delegate_claude_code` breaks scripts that named it directly.** The only such script is the bundled `task-delegate.agent`, which this change updates.
- **The snapshot costs a `git status` and a hash pass** on each side of a delegation: milliseconds against minutes of Claude Code.
