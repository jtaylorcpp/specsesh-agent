# claude-code

Your own `claude` binary, run headless once per step, so a script runs on your Claude subscription with no API key.

## Setup

Install Claude Code, put `claude` on `PATH` and log in once with `claude`. Then pick the provider:

```bash
specsesh agent run triage.agent --provider claude-code --model claude-haiku-4-5
```

Subscription login is the only auth. Each step's child process runs `claude -p --safe-mode` with `ANTHROPIC_API_KEY` and `CLAUDECODE` removed from its environment, so it never silently bills an API key and still starts from inside a Claude Code session. Claude Code's OAuth token is never read, copied or forwarded to pi-ai or any other client: that is against Anthropic's terms.

`--safe-mode` keeps your CLAUDE.md, skills, plugins, hooks and MCP servers out of every step. `--bare` is never used, because it forces API-key auth.

## Models

Any id or alias `claude --model` accepts. The provider lists `claude-haiku-4-5`, `haiku`, `sonnet` and `opus`; another id is passed through as given. `specsesh agent models claude-code` says so instead of listing.

## Where it runs

On Node, wherever `claude` is installed and logged in: `specsesh agent`, `durable`, `task` and `change`. Not on Cloudflare: a Worker can't start a process. A `defineAgentHost` host has no process runner, so a delegate granted with runner `claude-code` refuses the harness with `DelegateGrantError`.

Each step runs in a fresh empty directory under the system temp directory, removed after, and its system prompt ends with a note that Claude Code's environment block (working directory, git status, platform) describes the process, not the project.

## Limits

- One tool per step. The reasoning port behind `specsesh agent run` offers no tools at all: a step that offers tools fails, and needs `durable` or `task`. The pi provider behind `durable`, `task` and `change` takes at most one tool per request, sent as `--json-schema` and returned as a call to that tool; a request offering more is refused, so a step that offers an action as a tool and also writes variables fails.
- A step is killed after 5 minutes by default.
- The cost it prints is what Claude Code reports, notional on a subscription.
- For local work. On a server, use an [API-key provider](api-keys.md).
