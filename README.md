# specsesh-agent

The source of **[`@specsesh/agent`](packages/agent)**: write an agent as an Agent Script file, run it
once, crash-safe on Node, on your own Claude subscription, or in a Cloudflare Durable Object, and
let it do real work through actions confined to a workspace. On top sits an OpenSpec change flow
(`pnpm change draft → approve → build → close`), which this repository used to build itself; see
[How we built the spec agent with itself](#how-we-built-the-spec-agent-with-itself).

**Start with the package README:** [`packages/agent/README.md`](packages/agent/README.md). It has
runnable examples for Node and Cloudflare, the entry points, the CLIs, and the supported subset.
Then the **[guides](guides/README.md)** go deep: writing Agent Script, durable agents, actions,
Cloudflare, the OpenSpec ontology, and executing changes with the task loop.

## Thirty seconds

```bash
pnpm install && pnpm build

# run a script once on your Claude subscription
pnpm agent run examples/hello-world/hello.agent --entry greet --entry decide --entry sign_off \
  --provider claude-code --model claude-haiku-4-5

# the same script as a durable, resumable task
pnpm --filter hello-world-example start Ada

# work task 2.1 of an OpenSpec change with our own agent, until its checks pass
pnpm task <change-id> 2.1

# or the whole change, from intent to archive
pnpm change draft   <id> --intent "…"   # proposal → design → specs → tasks, one stage at a time
pnpm change approve <id>                # once per stage
pnpm change build   <id>                # every task group, each with task loops and a judge
pnpm change close   <id>                # trial-fold into the specs, then archive
```

## Layout

| Path | What's there |
|---|---|
| [`guides/`](guides/README.md) | Step-by-step guides, from a first script to running OpenSpec changes with the task loop |
| [`packages/agent`](packages/agent) | The package: authoring, interpreter, pi and Claude Code ports, durable execution, the Cloudflare host, the OpenSpec ontology, the task and group loops |
| [`examples/hello-world`](examples/hello-world) | One script, run durably on Node |
| [`examples/cloudflare-worker`](examples/cloudflare-worker) | `AgentScriptHost` in a Worker, with a faux model for `wrangler dev --local` |
| [`openspec/`](openspec) | The specs (`specs/`) and changes in flight (`changes/`) that this code is held to |
| [`docs/`](docs) | The taxonomy and ontology for executing an OpenSpec change, one concept per page ([index](docs/README.md)) |
| [`agentscript.config.json`](agentscript.config.json) | How this repo runs its own tasks: provider, model, checks, allowlist |
| [`CLAUDE.md`](CLAUDE.md) | Working rules for agents (and people) in this repo |
| [`gaps.md`](gaps.md) | What we still did by hand while the repo built itself; each row is a candidate tool |

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
| `pnpm parity` | Regenerates the provider parity table in this README from `parity.json` (`--check` in the test fails on drift) |
| `pnpm task …` | The task runner (`agentscript-task`): `<change> <task>`, `<change> <group>`, `--next`, `spec`, `status`, `resume`, `answer` |
| `pnpm change …` | The change flow (`agentscript-change`): `draft <id> --intent "…"` (or `"<feedback>"`), `approve <id>`, `build <id> ["<answer>"]`, `close <id>` |

## Provider parity

Each cell says how a feature is proven for a provider: by an offline test, only by a live run against the real service, not at all, or not supported; the table is rendered from `parity.json` by `pnpm parity`, and the build fails when it drifts.

<!-- PARITY:BEGIN -->
✅ tested · 🟢 live only · ⚪ untested · — not supported

| Feature | api-keys | claude-code | gemini | ollama | workers-ai |
|---|---|---|---|---|---|
| One-shot run (`agent run`, `run()`) | ✅ | ✅ | ✅ | ✅ | — |
| Durable run | ✅ | ✅ | ✅ | ✅ | — ¹ |
| Crash, then resume | ✅ | ✅ | ✅ | ✅ | ⚪ |
| Task and change loops | ✅ | 🟢 | ✅ | ✅ | — |
| Cloudflare Durable Object host | ✅ ² | — | ⚪ ³ | — | ⚪ ⁴ |
| Structured steps | ✅ | ✅ | ✅ | ✅ | ⚪ |
| Tools on one-shot runs | ✅ | ✅ | ✅ | ✅ | — |
| Tools in durable runs | ✅ | ✅ | ⚪ | ⚪ | ⚪ |
| A model calling MCP tools | ⚪ ⁵ | ⚪ | ⚪ | ⚪ | — |
| Streaming text, one-shot | ✅ | ✅ | ✅ | ⚪ | — |
| Streaming text, durable (`watchScript`) | ✅ | — ⁶ | ⚪ | ⚪ | ⚪ |
| Abort a one-shot step (`signal`) | ⚪ | ✅ | ⚪ | ⚪ | — |
| Failure categories, one-shot | ✅ | ✅ | ✅ | ✅ | — |
| Failure categories, durable | — ⁷ | — | — | — | — |
| A live check against the real service | — | 🟢 | 🟢 | 🟢 | — |

1. the Node durable command; on Cloudflare every run is durable (see the Cloudflare row)
2. on a faux model under `wrangler dev --local`
3. `defineAgentHost` takes any model; no test runs Gemini in a Worker
4. the binding adapter is tested on a fake binding; no Durable Object run
5. MCP tools are tested through `run` statements, never a model's call
6. the claude-code pi provider doesn't stream
7. every durable failure is `unknown`; parked

<details><summary>Evidence</summary>

- **One-shot run (`agent run`, `run()`) × api-keys:** `answers a text-only step and completes`
- **One-shot run (`agent run`, `run()`) × claude-code:** `Scenario: A completed run prints its steps and usage`
- **One-shot run (`agent run`, `run()`) × gemini:** `Scenario: A script runs on Gemini`
- **One-shot run (`agent run`, `run()`) × ollama:** `Scenario: A script runs on a pulled ollama model`
- **Durable run × api-keys:** `Scenario: A two-model-step script walks the phases in order`
- **Durable run × claude-code:** `Scenario: A durable claude-code run calls a --tools tool`
- **Durable run × gemini:** `Scenario: A durable run completes on Gemini`
- **Durable run × ollama:** `Scenario: A durable run completes on a pulled ollama model`
- **Crash, then resume × api-keys:** `Scenario: A crash during the second model request resumes at the second step`
- **Crash, then resume × claude-code:** `Scenario: A claude-code run killed during a tool call resumes`
- **Crash, then resume × gemini:** `Scenario: A crashed Gemini run finishes on resume`
- **Crash, then resume × ollama:** `Scenario: A crashed ollama run finishes on resume`
- **Task and change loops × api-keys:** `Scenario: A converged loop prints its iterations and ticked`
- **Task and change loops × claude-code:** `Scenario: The live run converges and ticks the task`; `Scenario: A live group converges`
- **Task and change loops × gemini:** `Scenario: A task loop converges on Gemini`
- **Task and change loops × ollama:** `Scenario: A task loop converges on a pulled ollama model`
- **Cloudflare Durable Object host × api-keys:** `examples/cloudflare-worker/test/crash-resume.sh`; `examples/cloudflare-worker/test/routes.sh`
- **Structured steps × api-keys:** `Scenario: A structured step offers the result tool`
- **Structured steps × claude-code:** `Scenario: A schema and a turn bound are appended in order`
- **Structured steps × gemini:** `Scenario: A forced function call becomes the structured result`
- **Structured steps × ollama:** `Scenario: A forced tool call becomes the structured result`
- **Tools on one-shot runs × api-keys:** `Scenario: A tool call runs on the host and its result reaches the model`
- **Tools on one-shot runs × claude-code:** `Scenario: A claude-code run calls a --tools tool through the bridge`
- **Tools on one-shot runs × gemini:** `Scenario: A Gemini tool call is answered with a functionResponse`
- **Tools on one-shot runs × ollama:** `Scenario: The model calls an offered tool from a module`
- **Tools in durable runs × api-keys:** `Scenario: Bound inputs are merged into the call`
- **Tools in durable runs × claude-code:** `Scenario: A durable claude-code run calls a --tools tool`
- **Streaming text, one-shot × api-keys:** `Scenario: Deltas concatenate to the step's text`
- **Streaming text, one-shot × claude-code:** `Scenario: A listening text step streams its text`
- **Streaming text, one-shot × gemini:** `Scenario: A listening Gemini step streams its text`
- **Streaming text, durable (`watchScript`) × api-keys:** `Scenario: A step's deltas join to its text`
- **Abort a one-shot step (`signal`) × claude-code:** `Scenario: Aborting a text step kills claude`
- **Failure categories, one-shot × api-keys:** `Scenario: A 429 on the Anthropic wire is a rate limit`
- **Failure categories, one-shot × claude-code:** `takes an API error's category from its status`
- **Failure categories, one-shot × gemini:** `Scenario: A 429 from Gemini is a rate limit`
- **Failure categories, one-shot × ollama:** `Scenario: A 500 from Ollama is a server error`
- **A live check against the real service × claude-code:** `Scenario: A real claude calls a bridged tool`
- **A live check against the real service × gemini:** `scripts/test-gemini.mjs`
- **A live check against the real service × ollama:** `scripts/test-ollama.mjs`

</details>
<!-- PARITY:END -->

## How work happens here

Every behaviour is a requirement in `openspec/specs/`, with one test per scenario. A change starts as
a proposal, design, spec deltas and tasks in `openspec/changes/<id>/`. It is drafted and approved
stage by stage (`pnpm change draft` / `approve`), executed group by group by our own agents
(`pnpm change build`), and folded into the specs once every check passes (`pnpm change close`).
The package README's [Roadmap](packages/agent/README.md#roadmap) says what comes next.

## How we built the spec agent with itself

The spec agent and the `pnpm change` flow were written as 21 OpenSpec changes, then executed in
order (2026-10-12 to 2026-10-13) by this repo's own tools, on a Claude subscription through the
claude-code provider:

1. **Specs by hand.** Three foundation changes (actors and workspaces, the agent runner, the
   Cloudflare workspace), thirteen spec-agent changes (the spec loop, its proposal, design, specify
   and plan stages, review, slicing, size rules, the spec CLI and its events, the draft loop), and
   five for the change flow (the build loop, then `pnpm change draft`, `approve`, `build` and
   `close`). Each change kept to the size budget:
   at most 6 requirements, 16 scenarios and 12 tasks.
2. **Groups by `pnpm task <change> <group>`.** Each task ran in its own task loop: an agent works
   the task with actions confined to the repo, then `pnpm check` and `pnpm test` decide whether it
   converged. A judge agent reviewed each group. A small shell driver ran the groups in order,
   rebuilt `dist/` before each one (the runner was changing its own source), and committed each
   converged group so the next started on a clean tree.
3. **Verify, then archive.** After the last group: `pnpm -r check`, `pnpm -r test` twice,
   `pack:check`, `spec:check`, `docs:check` and the live acceptance run (`pnpm test:live`). Then
   `pnpm spec:archive`, a commit and a push. The last change, `add-change-close`, archived itself
   with `pnpm change close`.

**What it took.** About 14 hours of group-loop time across the 21 changes. The test suite grew
from 1162 to 1649 tests, all passing at every verify. 190 of 211 task loops converged on their
first iteration.

### How long things take

**14.1 hours of group-loop time took the repo from
[`b630e03`](https://github.com/jtaylorcpp/specsesh-agent/commit/b630e03) (21 changes specified,
none built) to [`31c39dd`](https://github.com/jtaylorcpp/specsesh-agent/commit/31c39dd) (all 21
built, verified and archived), on a 16 GB RAM Ubuntu machine.** The wall clock between the two
commits was 17.5 hours; the rest was verify runs, escalations and a reboot.

Times are from the stored loops' `startedAt` and `endedAt` in `.agentscript/task-loops.sqlite`, on
Opus through the claude-code provider. Verify and archive times are from the queue log.

| Item | What runs | Typical | Range |
|---|---|---|---|
| Task loop | One task: an agent's iterations, then `pnpm check` and `pnpm test` | 3.7 min median, 6.5 min p90 | under 1 min to 56 min |
| Iteration | One agent pass at a task | 1.1 per task loop (232 across 211 loops) | 1 to 8 |
| Group | Its task loops in order, then the judge | 10.8 min median | 2.9 to 86.7 min |
| Change | Every group (2 to 5 per change) | 33.0 min median | 9.2 to 146.5 min |
| Verify and archive | `check`, `test` twice, `pack:check`, `spec:check`, `docs:check`, archive, commit, push | 2 to 3 min | plus the live run when it is part of the change |
| All 21 changes | 61 groups, 211 task loops | 14.1 h of group time | |

The slow outliers were in the first foundation change. Its task 1.1 took 56 minutes and three
iterations, and its group 3 was run twice: the stored script named an action the group had
retired, so the group was restarted. Past the foundation changes, every change took between 9
and 52 minutes.

Per change, in the order they ran:

| # | Change | Groups | Task loops run | Converged first try | Median task (min) | Slowest task (min) | Group time (min) |
|---|---|---|---|---|---|---|---|
| 1 | `add-actors-and-workspaces` | 5 | 25 | 14 | 5.4 | 56.0 (1.1, 3 it.) | 146.5 |
| 2 | `add-agent-runner` | 5 | 17 | 16 | 3.7 | 7.5 (2.2, 1 it.) | 76.6 |
| 3 | `add-cloudflare-workspace` | 3 | 12 | 11 | 4.6 | 7.0 (1.2, 1 it.) | 56.7 |
| 4 | `reorder-design-before-specs` | 2 | 9 | 8 | 2.1 | 4.7 (1.1, 2 it.) | 23.3 |
| 5 | `add-design-attachments` | 2 | 3 | 3 | 2.2 | 3.5 (1.1, 1 it.) | 9.2 |
| 6 | `add-change-size-rules` | 3 | 10 | 9 | 2.8 | 4.9 (1.1, 2 it.) | 31.6 |
| 7 | `add-spec-loop` | 3 | 9 | 9 | 3.6 | 8.0 (1.3, 1 it.) | 38.1 |
| 8 | `add-spec-review` | 3 | 9 | 9 | 3.2 | 5.9 (1.1, 1 it.) | 36.4 |
| 9 | `add-spec-proposal-stage` | 3 | 9 | 9 | 2.8 | 4.0 (1.1, 1 it.) | 30.4 |
| 10 | `add-spec-cli` | 3 | 11 | 10 | 3.5 | 5.7 (1.1, 1 it.) | 25.6 |
| 11 | `add-spec-cli-events` | 2 | 4 | 4 | 4.1 | 4.9 (1.2, 1 it.) | 18.3 |
| 12 | `add-change-slicing` | 2 | 8 | 8 | 3.8 | 5.2 (1.3, 1 it.) | 30.7 |
| 13 | `add-spec-design-stage` | 2 | 8 | 8 | 3.5 | 4.0 (1.4, 1 it.) | 27.4 |
| 14 | `add-spec-specify-stage` | 2 | 9 | 9 | 3.6 | 5.3 (1.1, 1 it.) | 35.0 |
| 15 | `add-spec-plan-stage` | 3 | 11 | 10 | 2.8 | 4.2 (3.1, 1 it.) | 25.0 |
| 16 | `add-draft-loop` | 3 | 8 | 8 | 4.4 | 7.1 (1.2, 1 it.) | 38.9 |
| 17 | `add-change-draft` | 3 | 11 | 8 | 4.3 | 14.0 (1.4, 3 it.) | 25.0 |
| 18 | `add-change-approve` | 3 | 8 | 8 | 4.2 | 5.0 (1.1, 1 it.) | 33.0 |
| 19 | `add-build-loop` | 3 | 10 | 10 | 4.3 | 6.8 (1.3, 1 it.) | 46.4 |
| 20 | `add-change-build` | 3 | 10 | 10 | 5.0 | 8.3 (1.2, 1 it.) | 51.1 |
| 21 | `add-change-close` | 3 | 10 | 9 | 3.1 | 6.0 (1.2, 2 it.) | 39.3 |
| | **All 21** | **61** | **211** | **190** | **3.7** | **56.0** | **844.5** (14.1 h) |

"Task loops run" counts every loop started, including those restarted after an escalation.
"Group time" counts groups that converged.

**Where a person stepped in: five times.**

- One task needed to delete files, and no action can delete one. After the files were removed by
  hand, the stored loop's script still named an action the group had just retired, so that group
  was restarted.
- Four were defects in the hand-written specs, which agents caught and escalated with
  `amend-spec` instead of guessing: a git command the runner may not run, a design line the loop
  could not honour, a bins requirement left to a later change, and migration lines naming
  requirements that did not exist. Each was fixed in the delta and answered with
  `pnpm task answer`.

**What we still did by hand** is in [`gaps.md`](gaps.md): 13 entries. `pnpm change build` closed
"run the groups in order" and `pnpm change close` closed most of "archive"; the rest are open.
The most useful next tools are a `delete_file` action, applying an agent's spec amendment, showing
why a loop failed, duration stats per change and group, and restarting stored loops after a
reboot.

## License

Apache-2.0. See [`packages/agent/LICENSE`](packages/agent/LICENSE).
