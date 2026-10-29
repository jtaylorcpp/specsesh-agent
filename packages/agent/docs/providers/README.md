# Providers

Five ways to reach a model, and which command or host each one works with.

| provider | agent | durable | task | change | cloudflare |
|---|---|---|---|---|---|
| api-keys | yes | yes | yes | yes | yes |
| claude-code | yes | yes | yes | yes | no |
| gemini | yes | yes | yes | yes | yes |
| ollama | yes | yes | yes | yes | no |
| workers-ai | no | no | no | no | yes |

`agent`, `durable`, `task` and `change` are the `specsesh` commands on Node; `cloudflare` is a Durable Object host (`AgentScriptHost` or `defineAgentHost`). Pick a provider on Node with `--provider` and `--model`, or `AGENTSCRIPT_PROVIDER` and `AGENTSCRIPT_MODEL`.

- [api-keys](api-keys.md): pi-ai's built-in providers (`anthropic`, `openai`, `google`, ...), on an API key.
- [claude-code](claude-code.md): your own `claude` binary, on your subscription.
- [gemini](gemini.md): Gemini on `GEMINI_API_KEY`, under pi-ai's provider id `google`.
- [ollama](ollama.md): a local Ollama server, keyless.
- [workers-ai](workers-ai.md): Workers AI through a Worker's `AI` binding.
