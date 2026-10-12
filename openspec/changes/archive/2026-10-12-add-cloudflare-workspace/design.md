## Context

This builds on `add-actors-and-workspaces` and `add-agent-runner`, archived first. They give us:
- `AgentConfig<Env>` and `createAgentHarness` (runtime-neutral, `./durable`);
- `Workspace` with optional `exec`, `snapshot`, `list` and `search`;
- `workspaceActions` and `searchActions`;
- `delegationActions` with runners, and `agentRunner` (runtime-neutral).

`./durable` imports no Node, so `./cloudflare` can use all of it.

`AgentScriptHost` (`src/cloudflare/index.ts`) builds a `PiHarness` around `Harness.open` with one Workers AI provider from `createModel()`, and installs the plain extensions, which refuse every action.

What Cloudflare offers, per its docs as of 2026-10-11:
- **Sandbox SDK:** `getSandbox(namespace, id)` returns a sandbox with:
  - `exec(command: string, { cwd, env, timeout, stdin })` → `{ success, stdout, stderr, exitCode }`;
  - `readFile(path)` → `{ content }`;
  - `writeFile(path, content)`, `mkdir(path, { recursive })`;
  - `gitCheckout(url, { branch, targetDir })`.

  The docs don't say whether `exec`'s string goes through a shell, so we assume it does and quote everything.
- **Artifacts** (private beta): Git-compatible repos, each with its own history and branches, a stable HTTPS remote, and separate read and write tokens. The Workers binding can create, get, list, import, delete and fork repos, and issue tokens. Files move over Git.

We code against our own `SandboxLike` and `ArtifactsLike`. The real binding objects are adapted at the host, a few lines each, and checked against the then-current SDK when the first deploy happens. That deploy is not part of this change.

## defineAgentHost

```ts
export class Host extends defineAgentHost<Env>({
  models:    { default: (env) => workersAI(env.AI, "@cf/meta/llama-4-scout"),
               reviewer: (env) => workersAI(env.AI, "@cf/qwen/qwen3-coder") },
  workspace: (env) => artifactsSandboxWorkspace(env.ARTIFACTS, getSandbox(env.SANDBOX, "task-2.1"),
                                                { repo: "my-app", fork: "task-2.1", dir: "/workspace" }),
  allow:     ["pnpm", "node"],
  checks:    ["pnpm test"],
  delegates: { reviewer: { runner: "agent", model: "reviewer", script: READ_AGENT } },
}) {}
```

- **The constructor wires a `PiHarness`** whose factory calls `createAgentHarness(config, { storage, env: this.env, context })`, with `runners` defaulting to `{ agent: agentRunner() }`. Model factories run once in the constructor, before pi resumes anything, as `createModel()` does today.
- **Routes reuse `AgentScriptHost`'s code,** factored into a shared function. The only addition is the optional `model` name in the `POST` body.
- **A Worker routes to an object per task** (`idFromName("<change>/<task>")`), so one object means one workspace and one fork. That matches "one loop, one workspace".

## sandboxWorkspace

```
read(p)        confine(p) → realpath -m check via exec → sandbox.readFile(join(dir, p)).content
write(p, c)    confine(p) → realpath check → mkdir -p parent → sandbox.writeFile
exec(argv, o)  sandbox.exec("timeout -s KILL <ceil(o.timeoutMs/1000)> " + argv.map(q).join(" "),
                            { cwd: dir, env: o.env, stdin: o.stdin })
               q(a) = "'" + a.replaceAll("'", "'\\''") + "'"
               exit 137 → timed-out;  throw → spawn-error;  else exited
snapshot()     git status --porcelain=v1 -z, then git hash-object per listed file; not a repo → undefined
list(glob)     git ls-files -co --exclude-standard -z, filtered by the shared glob matcher
search(...)    list, then readFile each and match in JavaScript (NUL-byte files skipped)
publish(msg)   git add -A; git diff --cached --quiet → nothing: { commit: HEAD, changed: false }
               else git commit -m msg; git push origin HEAD → { commit: HEAD, changed: true }
```

Every output from the sandbox passes through a redactor holding any secrets the workspace was built with, the fork token among them, before it is returned or thrown.

## artifactsSandboxWorkspace

```
fork   = (await artifacts.get(fork)) ?? await (await artifacts.get(repo)).fork(fork)
token  = await fork.createToken("write")
if (exec git -C dir remote get-url origin) ≠ fork.remote → git clone <fork.remote with token> dir
return sandboxWorkspace(sandbox, { dir, secrets: [token] })
```

How the token reaches git (in the clone URL, or as an `http.extraHeader` credential) is settled against Artifacts' docs at the first deploy. Either way it's in `secrets`, so it's redacted.

## Tests without Cloudflare

- **A local-exec fake `SandboxLike`** runs `bash -c <command>` in a temporary directory (`readFile` and `writeFile` on that directory). That exercises the real quoting, `timeout`, git snapshots, `list`, and `publish` to a local bare repository.
- **A fake `ArtifactsLike`** backs repos with local bare repositories, `fork` = `git clone --bare`, tokens = random strings, `remote` = a `file://` path. Its fork remote echoes the token in failure output, to prove redaction.
- **The example Worker on `wrangler dev --local`** covers the `defineAgentHost` routes, on a faux model over `memoryWorkspace`.

## Risks

- **The Sandbox and Artifacts APIs are young** (Artifacts is in private beta). The narrow `*Like` interfaces keep any drift to one adapter.
- **A container call can outlive an evicted object.** Built-in actions and `agent` delegates are recorded per call, and `run_command` keeps its `"unsafe"` replay. So an interrupted command fails its call, and the task loop retries the iteration within budget.
