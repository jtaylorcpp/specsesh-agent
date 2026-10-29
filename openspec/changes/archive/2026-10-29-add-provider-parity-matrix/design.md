## Context

A survey of `packages/agent/__tests__/` (2026-10-29) found the evidence below. `fix-pi-failure-status` lands first on this branch, so the one-shot failure categories cite its scenarios. The command matrix (`docs/providers/README.md`) is checked by `package/usage-docs` against the registered providers; this change leaves it alone and keeps the two consistent.

## Decisions

1. **Shape.** `parity.json` is `{ providers: string[], features: Feature[] }`, where a `Feature` is `{ id, label, cells: Record<provider, Cell> }` and a `Cell` is `{ value: "tested" | "live" | "untested" | "no", note?: string, evidence?: Evidence[] }`. An `Evidence` is `{ test: "<exact it() name>" }` or `{ script: "<repo-relative path>" }`. Features are rows and providers columns: five columns read on a phone, fifteen don't.
2. **Values.**
   - `tested`: an offline test (in `pnpm test`, or a script that needs no account) proves it.
   - `live`: only an opt-in run against the real service proves it.
   - `untested`: the code path exists, and nothing proves it.
   - `no`: not supported.
   
   `tested` and `live` need at least one evidence entry; `untested` and `no` have none.
3. **Evidence check.** A `test` entry must appear, as the whole string literal (quoted with `"`, `'` or `` ` ``), as the first argument of an `it(` or `test(` in some `.ts` file under `packages/agent/__tests__/`, live tests included. A `script` entry must be an existing file. Names, not line numbers, so moving a test breaks nothing and renaming one fails the check.
4. **Rendering** (`renderParity(data)`, exported from `scripts/parity.mjs`):
   - a legend line: `✅ tested · 🟢 live only · ⚪ untested · — not supported`;
   - the table: `| Feature | api-keys | claude-code | gemini | ollama | workers-ai |`, each cell its symbol, then ` ¹`-style footnote numbers when the cell has a note;
   - the notes as a numbered list;
   - `<details><summary>Evidence</summary>`, with one line per `tested`/`live` cell: `- **<feature> × <provider>:** \`<name or path>\`; …`, then `</details>`.
   
   The output is deterministic and ends with a newline. The test imports `renderParity` from the script (`import(pathToFileURL(...))`), so there is one renderer.
5. **Consistency with the command matrix.** The rows `one-shot`, `durable`, `task`, and `cloudflare` map to its columns `agent`, `durable`, `task` (and `change`), and `cloudflare`. A `no` there must be `no` here and the reverse. `untested` is allowed where the command matrix says `yes`, which is how the parity matrix records that Gemini on Cloudflare has no test.
6. **The rule for keeping it current.** The test catches drift in the README, renamed tests and a contradicting command matrix. It cannot see a new feature that nobody declared, so `CLAUDE.md` gains a line in "Specs": "A change that adds or changes a provider's behaviour updates `parity.json` (and `pnpm parity`) in the same change." The `package/parity` spec states the checks.
7. **Where it lives.** The root `README.md` is the page people land on. `parity.json` sits beside it at the root, because it describes the repo, not the package, and the package's `files` don't take it.

## Decisions made during the build

8. **Provider order.** The spec first listed the providers as api-keys, gemini, ollama, claude-code, workers-ai while requiring the command matrix's order, which is api-keys, claude-code, gemini, ollama, workers-ai. The command matrix's order wins: it is shipped and checked by `package/usage-docs`, so `parity.json` and the table follow it.
9. **durable × workers-ai is `no`.** The `durable` row maps to the command matrix's `durable` column, the Node `specsesh durable` command, which says `no` for workers-ai. Decision 5 allows no `untested` beside a `no`, so the cell is `no`, with a note that every Cloudflare run is durable.

## The matrix at this change

Features in order (id: label). Cells are listed per provider; the table's columns follow the command matrix's order (decision 8). Evidence names are exact; the delegate copies them and the test checks them.

1. `one-shot`: One-shot run (`agent run`, `run()`)
   - api-keys: tested, `answers a text-only step and completes`
   - gemini: tested, `Scenario: A script runs on Gemini`
   - ollama: tested, `Scenario: A script runs on a pulled ollama model`
   - claude-code: tested, `Scenario: A completed run prints its steps and usage`
   - workers-ai: no
2. `durable`: Durable run
   - api-keys: tested, `Scenario: A two-model-step script walks the phases in order`
   - gemini: tested, `Scenario: A durable run completes on Gemini`
   - ollama: tested, `Scenario: A durable run completes on a pulled ollama model`
   - claude-code: tested, `Scenario: A durable claude-code run calls a --tools tool`
   - workers-ai: no, note "the Node `durable` command; on Cloudflare every run is durable (see the Cloudflare row)"
3. `resume`: Crash, then resume
   - api-keys: tested, `Scenario: A crash during the second model request resumes at the second step`
   - gemini: tested, `Scenario: A crashed Gemini run finishes on resume`
   - ollama: tested, `Scenario: A crashed ollama run finishes on resume`
   - claude-code: tested, `Scenario: A claude-code run killed during a tool call resumes`
   - workers-ai: untested
4. `task`: Task and change loops
   - api-keys: tested, `Scenario: A converged loop prints its iterations and ticked`
   - gemini: tested, `Scenario: A task loop converges on Gemini`
   - ollama: tested, `Scenario: A task loop converges on a pulled ollama model`
   - claude-code: live, `Scenario: The live run converges and ticks the task`, `Scenario: A live group converges`
   - workers-ai: no
5. `cloudflare`: Cloudflare Durable Object host
   - api-keys: tested, script `examples/cloudflare-worker/test/crash-resume.sh`, script `examples/cloudflare-worker/test/routes.sh`, note "on a faux model under `wrangler dev --local`"
   - gemini: untested, note "`defineAgentHost` takes any model; no test runs Gemini in a Worker"
   - ollama: no
   - claude-code: no
   - workers-ai: untested, note "the binding adapter is tested on a fake binding; no Durable Object run"
6. `structured`: Structured steps
   - api-keys: tested, `Scenario: A structured step offers the result tool`
   - gemini: tested, `Scenario: A forced function call becomes the structured result`
   - ollama: tested, `Scenario: A forced tool call becomes the structured result`
   - claude-code: tested, `Scenario: A schema and a turn bound are appended in order`
   - workers-ai: untested
7. `tools`: Tools on one-shot runs
   - api-keys: tested, `Scenario: A tool call runs on the host and its result reaches the model`
   - gemini: tested, `Scenario: A Gemini tool call is answered with a functionResponse`
   - ollama: tested, `Scenario: The model calls an offered tool from a module`
   - claude-code: tested, `Scenario: A claude-code run calls a --tools tool through the bridge`
   - workers-ai: no
8. `durable-tools`: Tools in durable runs
   - api-keys: tested, `Scenario: Bound inputs are merged into the call`
   - gemini: untested
   - ollama: untested
   - claude-code: tested, `Scenario: A durable claude-code run calls a --tools tool`
   - workers-ai: untested
9. `mcp`: A model calling MCP tools
   - every provider but workers-ai: untested, note on api-keys "MCP tools are tested through `run` statements, never a model's call"
   - workers-ai: no
10. `stream`: Streaming text, one-shot
    - api-keys: tested, `Scenario: Deltas concatenate to the step's text`
    - gemini: tested, `Scenario: A listening Gemini step streams its text`
    - ollama: untested
    - claude-code: tested, `Scenario: A listening text step streams its text`
    - workers-ai: no
11. `durable-stream`: Streaming text, durable (`watchScript`)
    - api-keys: tested, `Scenario: A step's deltas join to its text`
    - gemini: untested
    - ollama: untested
    - claude-code: no, note "the claude-code pi provider doesn't stream"
    - workers-ai: untested
12. `abort`: Abort a one-shot step (`signal`)
    - api-keys, gemini, ollama: untested
    - claude-code: tested, `Scenario: Aborting a text step kills claude`
    - workers-ai: no
13. `categories`: Failure categories, one-shot
    - api-keys: tested, `Scenario: A 429 on the Anthropic wire is a rate limit`
    - gemini: tested, `Scenario: A 429 from Gemini is a rate limit`
    - ollama: tested, `Scenario: A 500 from Ollama is a server error`
    - claude-code: tested, `takes an API error's category from its status`
    - workers-ai: no
14. `durable-categories`: Failure categories, durable
    - every provider: no, note on api-keys "every durable failure is `unknown`; parked"
15. `live`: A live check against the real service
    - api-keys: no
    - gemini: live, script `scripts/test-gemini.mjs`
    - ollama: live, script `scripts/test-ollama.mjs`
    - claude-code: live, `Scenario: A real claude calls a bridged tool`
    - workers-ai: no

If the evidence check finds a name above missing, the delegate looks for the test's current name and uses it. If no test exists, the cell becomes `untested`, and the delegate does not write a test to fill it.

## Testing

`__tests__/package/parity.test.ts` reads the root files (`../../../../parity.json` from the test's directory, resolved with `fileURLToPath`). It covers one scenario per requirement. The drift scenarios run the checks as functions on mutated copies, so the repo's own files are never edited.
