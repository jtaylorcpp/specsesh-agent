# claude-code

Your own `claude` binary, run headless once per step, so a script runs on your Claude subscription with no API key.

## Setup

Install Claude Code, put `claude` on `PATH` and log in once with `claude`. Then pick the provider:

```bash
specsesh agent run triage.agent --provider claude-code --model claude-haiku-4-5
```

Subscription login is the only auth. Each step's child process runs `claude -p --safe-mode` with `ANTHROPIC_API_KEY` and `CLAUDECODE` removed from its environment, so it never silently bills an API key and still starts from inside a Claude Code session. Claude Code's OAuth token is never read, copied or forwarded to pi-ai or any other client: that is against Anthropic's terms.

`--safe-mode` keeps your CLAUDE.md, skills, plugins, hooks and MCP servers out of every step that offers no tools; a tool step uses the replacement in [Tool steps](#tool-steps). `--bare` is never used, because it forces API-key auth.

## Models

Any id or alias `claude --model` accepts. The provider lists `claude-haiku-4-5`, `haiku`, `sonnet` and `opus`; another id is passed through as given. `specsesh agent models claude-code` says so instead of listing.

## Where it runs

On Node, wherever `claude` is installed and logged in: `specsesh agent`, `durable`, `task` and `change`. Not on Cloudflare: a Worker can't start a process. A `defineAgentHost` host has no process runner, so a delegate granted with runner `claude-code` refuses the harness with `DelegateGrantError`.

Each step runs in a fresh empty directory under the system temp directory, removed after, and its system prompt ends with a note that Claude Code's environment block (working directory, git status, platform) describes the process, not the project.

### From code

`createClaudeCodeReasoningPort(options)` from `@specsesh/agent/claude-code` takes:

- `model`, `binary`, `maxTurns`, `timeoutMs` (default 300000), `cwd`, `runner`, `onResult`;
- `tools` and `bridge` (see [Tool steps](#tool-steps));
- `signal?: AbortSignal`, as on the pi port. It is port-wide: there is no per-step signal, and once it aborts every step fails `unrecognised` with "the claude-code step was aborted". Already aborted, nothing is spawned and no bridge is started. Aborted mid-step, `claude` gets `SIGTERM` and the step fails without waiting for it to exit. A custom `runner` gets no signal and isn't killed, but the step still fails at once.

### Tool steps

`specsesh agent run --provider claude-code --tools <module>` (or `--mcp <file>`) serves a step's offered tools to Claude Code as one MCP server, `agentscript`, and Claude Code calls them in its own loop, possibly in parallel. Each call is checked against its offer's schema, bound inputs win, and it runs on this host. A tool step defaults `--max-turns` to 16; reaching it ends the step `cut-short`.

In place of `--safe-mode`, a tool step passes:

```bash
--setting-sources "" --disable-slash-commands --strict-mcp-config \
  --mcp-config <file> --allowedTools mcp__agentscript__<a>,mcp__agentscript__<b> \
  --permission-mode dontAsk
```

The rest of the argv is unchanged, `--tools ""` included, so Claude Code's built-in tools stay off. A step that offers no tools keeps the `--safe-mode` argv exactly. `--bare` is never passed.

Tool steps and provider sessions also drop an inherited `CLAUDE_CODE_SAFE_MODE` (set under a `claude --safe-mode` session) from the child's environment, because it would turn off the `--mcp-config` bridge; steps without tools keep it.

Why, measured on Claude Code 2.1.310:

- `--safe-mode` turns off every MCP server, including the ones `--mcp-config` names, so the step's own server would vanish.
- `--tools ""` doesn't hide MCP tools, so it stays.
- The replacement flags gave the same context as `--safe-mode`: 642 input tokens and no CLAUDE.md, against 4668 tokens and your global CLAUDE.md with no flags.
- `--disable-slash-commands` wasn't needed in the probe but is kept: skills live under your user directory, and it costs nothing.
- `--allowedTools` is variadic, so it goes as one comma-joined argument; otherwise it would swallow the next flag.
- `--permission-mode dontAsk` means no permission prompts: a tool outside `--allowedTools` is denied.

The bridge (`mcpBridge()` from `@specsesh/agent/node`) is Streamable HTTP on `127.0.0.1`, port 0, with a random bearer token per bridge. A request without the token gets `401`. The config naming the URL and the header is written to a mode-`0600` file in a private `mkdtemp` directory, so the token never appears in argv or `ps`. The bridge lives for one step and is closed on every path.

On abort, the bridge is closed before `reason` resolves, and any later tool call is answered as an error ("the claude-code step was aborted") without reaching the host. A host call already in flight is not cancelled.

An offered tool's name must match `^[A-Za-z0-9_-]{1,48}$`, so `mcp__agentscript__<name>` stays within 64 characters; otherwise the step fails `invalid_request` before anything is spawned.

This isolation is an observed equivalence, not a documented one: a later Claude Code could load something these flags don't cover. It applies to tool steps only, and the live check re-runs the measurement.

After updating Claude Code, run `pnpm test:claude-code` from this repository. It is opt-in, runs on your own subscription (Haiku, about six requests) and skips, saying why, when `claude` is missing or not logged in. It checks:

- the isolation, by input tokens against `--safe-mode`, and by a project CLAUDE.md sentinel with a positive control;
- a real tool call through `mcpBridge()`;
- a durable run through the bin.

If it fails, tool steps may be loading your configuration, or Claude Code may no longer serve `--mcp-config` tools under these flags.

### Durable tool steps

`specsesh durable run`/`resume --provider claude-code --tools <module>` (or `--mcp <file>`) offers a step's tools to Claude Code too. Claude Code calls them, but pi-durable runs each call as a checkpointed host action: under its replay rule, recorded in the step's actions, and seen by `watchScript`. The bins register the pi provider as `claudeCodeProvider({ bridge: mcpBridge() })`; the bridge's SDK loads only when a request offers tools.

- **Bridged requests.** With `bridge`, a request offering any tool other than `submit_result` starts a held session: the bridge serves those tools, and one `claude -p` runs with the tool-step flags above, `--max-turns 16`, and `submit_result`'s parameters as `--json-schema` when offered. Reaching the turn limit ends the request as an error. Tool names must match `^[A-Za-z0-9_-]{1,48}$`; otherwise the request ends as an error and nothing starts. A request offering only `submit_result`, or nothing, runs the one-shot `--safe-mode` argv as before, with no `--max-turns`.
- **Held calls.** Each call Claude Code makes through the bridge is held, and the request ends `stopReason` `toolUse` with it as a pi `toolCall`, id `claude-code-<uuid>`. Calls made together arrive in one message, in arrival order. The next request's `toolResult`s go back to the held calls as `{ ok: !isError, text }`, and Claude Code continues. A `toolUse` message carries zero usage.
- **The end.** When the process ends, its answer maps as for any request: text, a `submit_result` call, or an error. The bridge closes and the session is dropped.
- **Crash behaviour.** The held process doesn't survive a crash. On `resume`, results that name no live session start a fresh process with the whole transcript, prior calls and results included, rendered as text by `promptOf`. Every finished call keeps its original result and isn't repeated; pi-durable's replay rules govern a call the crash interrupted. The fresh process sees prior calls as text, so it may re-plan.
- **Abort and timeout.** Aborting the request kills the process (`SIGTERM`), closes the bridge and ends the message `aborted`. `timeoutMs` (default 300000) bounds the whole session, tool time included.

## Limits

- Without `bridge`, the pi provider takes at most one tool per request, sent as `--json-schema` and returned as a call to that tool. More is refused before anything spawns: `the claude-code provider runs at most one pi tool per request without a bridge; this one offered <n> (<names>)`. The bins always pass `bridge: mcpBridge()`.
- No Cloudflare host for tool steps (no `claude` binary there), no streaming text, and a held session doesn't survive a crash (see above).
- A step is killed after 5 minutes by default.
- The cost it prints is what Claude Code reports, notional on a subscription.
- For local work. On a server, use an [API-key provider](api-keys.md).
