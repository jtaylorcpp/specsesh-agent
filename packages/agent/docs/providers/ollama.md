# ollama

A local Ollama server, keyless, on its OpenAI-compatible API; its models are the ones you have pulled.

## Setup

Install Ollama, start the server and pull a model:

```bash
ollama serve
ollama pull qwen3:8b
specsesh agent run triage.agent --provider ollama --model qwen3:8b
```

The server is `OLLAMA_HOST`, default `http://localhost:11434`. A host with no scheme gets `http://`, and a trailing `/` is dropped. Steps go to `<server>/v1`. No key is needed: the client sends a placeholder that Ollama ignores.

The CLIs register `ollama` only when a command needs a model on it (the run's model, or a model named in `agentscript.config.json`), so any other provider makes no request to the server. From code, `registerOllama(models)` from `@specsesh/agent/pi` adds the provider to a pi-ai model collection and lists the server's models; it never throws, and answers `{ ok: false, baseUrl, reason }` when the server doesn't answer.

## Models

The server's pulled models, from `GET <server>/api/tags`, in the server's order:

```bash
specsesh agent models ollama
```

An unpulled model is refused before the run starts: `no model "<id>" on provider "ollama"`. When the server didn't answer, the line ends with ` (Ollama at <url>: <reason>)`, and `specsesh agent` prints `ollama: not reachable at <url>: <reason>` and exits `1`.

## Where it runs

On Node, wherever the server is reachable: `specsesh agent`, `durable`, `task` and `change`. `durable resume` and `task resume` run on the model the run started on, so a run started on `ollama` resumes on the same pulled model. Not on Cloudflare: a Worker has no local server to reach.

## Limits

- Forced tool calls on small models. A structured step sends `tool_choice` naming `submit_result`. Ollama passes it on only to models whose template supports tools, and a small model may answer in text instead. A reply with no `submit_result` call fails the step, sets no variable and ends the run `failed`. That is the model's limit; a larger model, or one with tool support, fixes it.
- Every model is registered with a 32768-token context window and 8192 output tokens, whatever the server holds.
- Text input only, no reasoning effort, no cost: the printed cost is always `$0`.
- A one-shot step that fails on an HTTP status takes its category from it: `500` is `server_error`, `429` `rate_limit`. Durable, task and change runs report every failure as `unknown`.
