# specsesh-agent

The source of **[`@specsesh/agent`](packages/agent)**: write an agent as an Agent Script file, run it
once, crash-safe on Node, on your own Claude subscription, or in a Cloudflare Durable Object, and
let it do real work through actions confined to a workspace. On top sits an OpenSpec task loop,
which this repository uses to build itself.

**Start with the package README:** [`packages/agent/README.md`](packages/agent/README.md). It has
runnable examples for Node and Cloudflare, the entry points, the CLIs, and the supported subset.

## Thirty seconds

```bash
pnpm install && pnpm build

# run a script once on your Claude subscription
pnpm agent run examples/hello-world/hello.agent --provider claude-code --model claude-haiku-4-5

# the same script as a durable, resumable task
pnpm --filter hello-world-example start Ada

# work task 2.1 of an OpenSpec change with our own agent, until its checks pass
pnpm task <change-id> 2.1
```

## Layout

| Path | What's there |
|---|---|
| [`packages/agent`](packages/agent) | The package: authoring, interpreter, pi and Claude Code ports, durable execution, the Cloudflare host, the OpenSpec ontology, the task and group loops |
| [`examples/hello-world`](examples/hello-world) | One script, run durably on Node |
| [`examples/cloudflare-worker`](examples/cloudflare-worker) | `AgentScriptHost` in a Worker, with a faux model for `wrangler dev --local` |
| [`openspec/`](openspec) | The specs (`specs/`) and changes in flight (`changes/`) that this code is held to |
| [`docs/`](docs) | The taxonomy and ontology for executing an OpenSpec change, one concept per page ([index](docs/README.md)) |
| [`agentscript.config.json`](agentscript.config.json) | How this repo runs its own tasks: provider, model, checks, allowlist |
| [`CLAUDE.md`](CLAUDE.md) | Working rules for agents (and people) in this repo |

## Commands

| Command | Does |
|---|---|
| `pnpm build` | Compiles `packages/agent` to `dist/` |
| `pnpm check` | Type-checks every package |
| `pnpm test` | Unit and integration tests (faux models and a fake `claude`, no live calls) |
| `pnpm test:live` | Opt-in acceptance run against real models on your subscription |
| `pnpm test:cloudflare` | The example Worker's routes on `wrangler dev --local` |
| `pnpm pack:check` | Packs the tarball and proves it installs and runs |
| `pnpm spec:check` | Validates every spec and change (`openspec validate --all --strict`) |
| `pnpm spec:archive <id>` | Trial-folds a finished change into the specs, validates, then archives it |
| `pnpm docs:check` | Keeps `docs/` honest: front matter, index, spec references, links |
| `pnpm task …` | The task runner (`agentscript-task`): `<change> <task>`, `<change> <group>`, `--next`, `status`, `resume`, `answer` |

## How work happens here

Every behaviour is a requirement in `openspec/specs/`, with one test per scenario. A change starts as
a proposal, design, spec deltas and tasks in `openspec/changes/<id>/`. It is then executed task by
task, increasingly by `pnpm task` itself, and archived with `pnpm spec:archive` once every check
passes. The changes in flight are the roadmap; see the package README's
[Roadmap](packages/agent/README.md#roadmap).

## License

Apache-2.0. See [`packages/agent/LICENSE`](packages/agent/LICENSE).
