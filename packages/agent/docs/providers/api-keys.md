# API-key providers

pi-ai's built-in providers (Anthropic, OpenAI, Google and the rest), each reached with its own API key from the environment.

## Setup

Export the provider's key in the environment that runs `specsesh`. The variable names are pi-ai's:

```bash
export ANTHROPIC_API_KEY=...   # anthropic
export OPENAI_API_KEY=...      # openai
export GEMINI_API_KEY=...      # google
```

Nothing else is installed or registered: every command's model collection starts from pi-ai's `builtinModels()`. `anthropic` is the default provider, and `claude-haiku-4-5` the default model.

## Models

A model is a provider id and a model id, given as two values:

```bash
specsesh agent run triage.agent --provider anthropic --model claude-haiku-4-5
specsesh agent run triage.agent --provider openai --model gpt-4o-mini
specsesh agent models anthropic   # the ids pi-ai knows for a provider, one per line
```

`--provider` and `--model` work on `agent`, `durable` and `task`. `AGENTSCRIPT_PROVIDER` and `AGENTSCRIPT_MODEL` set them for every command, `change` included; `agentscript.config.json` sets `task.provider` and `task.model`, and names more models under `models` for delegates. A model the provider doesn't list is refused before the run starts: `no model "<id>" on provider "<provider>"`, followed by some ids it does list.

A structured step forces the `submit_result` tool on every wire API that can force one (Anthropic, OpenAI, Bedrock, Google, Mistral). Other APIs get the provider's default tool choice and rely on the tool's description.

## Where it runs

Everywhere: `specsesh agent`, `durable`, `task` and `change` on Node, and a Cloudflare host built with `defineAgentHost`, whose `models` takes any `ModelFactory` returning a pi-ai provider and a model. The [matrix](README.md) has every pair.

## Limits

- Billed per token to the key's account; `specsesh agent run` prints the tokens and the cost pi-ai reports.
- The key is read from the environment only. pi-ai sends it only to its provider; nothing in `specsesh` stores or prints it.
- A failed one-shot step (`specsesh agent run`, or the library's `run`) takes its category from the response's HTTP status, which the port records itself: `429` is `rate_limit`, `401` `authentication_failed`, `500` `server_error`. A diagnostic code from pi-ai wins when one is present. Categories never come from the message text. Google reads the status from its error envelope instead: see [gemini](gemini.md#limits).
- Durable, task and change runs still report every failure as `unknown`.
- Categories are labels only: nothing retries by category.
