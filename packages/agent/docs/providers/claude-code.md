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

### Tool steps

`specsesh agent run --provider claude-code --tools <module>` (or `--mcp <file>`) serves a step's offered tools to Claude Code as one MCP server, `agentscript`, and Claude Code calls them in its own loop, possibly in parallel. Each call is checked against its offer's schema, bound inputs win, and it runs on this host. A tool step defaults `--max-turns` to 16; reaching it ends the step `cut-short`.

In place of `--safe-mode`, a tool step passes:

```bash
--setting-sources "" --disable-slash-commands --strict-mcp-config \
  --mcp-config <file> --allowedTools mcp__agentscript__<a>,mcp__agentscript__<b> \
  --permission-mode dontAsk
```

The rest of the argv is unchanged, `--tools ""` included, so Claude Code's built-in tools stay off. A step that offers no tools keeps the `--safe-mode` argv exactly. `--bare` is never passed.

Why, measured on Claude Code 2.1.310:

- `--safe-mode` turns off every MCP server, including the ones `--mcp-config` names, so the step's own server would vanish.
- `--tools ""` doesn't hide MCP tools, so it stays.
- The replacement flags gave the same context as `--safe-mode`: 642 input tokens and no CLAUDE.md, against 4668 tokens and your global CLAUDE.md with no flags.
- `--disable-slash-commands` wasn't needed in the probe but is kept: skills live under your user directory, and it costs nothing.
- `--allowedTools` is variadic, so it goes as one comma-joined argument; otherwise it would swallow the next flag.
- `--permission-mode dontAsk` means no permission prompts: a tool outside `--allowedTools` is denied.

The bridge (`mcpBridge()` from `@specsesh/agent/node`) is Streamable HTTP on `127.0.0.1`, port 0, with a random bearer token per bridge. A request without the token gets `401`. The config naming the URL and the header is written to a mode-`0600` file in a private `mkdtemp` directory, so the token never appears in argv or `ps`. The bridge lives for one step and is closed on every path.

An offered tool's name must match `^[A-Za-z0-9_-]{1,48}$`, so `mcp__agentscript__<name>` stays within 64 characters; otherwise the step fails `invalid_request` before anything is spawned.

This isolation is an observed equivalence, not a documented one: a later Claude Code could load something these flags don't cover. It applies to tool steps only, and the live check re-runs the measurement.

Durable runs (`durable`, `task`, `change`) don't run tool steps on claude-code yet: pi-durable must run and checkpoint each call itself.

## Limits

- One tool per step on durable runs. The pi provider behind `durable`, `task` and `change` takes at most one tool per request, sent as `--json-schema` and returned as a call to that tool; a request offering more is refused, so a step that offers an action as a tool and also writes variables fails.
- A step is killed after 5 minutes by default.
- The cost it prints is what Claude Code reports, notional on a subscription.
- For local work. On a server, use an [API-key provider](api-keys.md).
