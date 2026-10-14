# Design: add-pinned-openspec

## Context

Every place in the package that runs `openspec` currently spawns the bare name `openspec`, so it gets whichever one comes first on PATH. These are the places:

- the specs gate (`openspec validate <change> --strict --json` and `openspec show <change> --json --deltas-only`), and any other spec stage gate that calls `openspec`;
- `close`'s trial fold (`openspec archive <change> --yes`, then `openspec validate --specs --strict`, in a temporary copy, then `archive` in the repository) and its `openspec validate <change> --strict` refusal check;
- `build --amend`'s validation (`openspec validate --all --strict`, then the trial fold).

When `agentscript-change.js` is run directly with `node` instead of through `pnpm`, `node_modules/.bin` is not on PATH, so a global openspec 1.9.0 was used. Its `show --json` leaves out requirement names. The specs gate failed eight drafts in a row with "`openspec show` failed", and it never said which openspec it had run (gaps.md #19).

This change adds one shared way to find openspec and check its version. All the places above use it. Only `spec/stages` and `change/cli` change. Installing or upgrading openspec, supporting versions below 1.14.1, and the pnpm flag-passing problem (gaps.md #14) are out of scope.

## How it is used

### From the command line

Nothing new to type. Every `agentscript-change` command that will run `openspec` (`draft`, `approve`, `close` and `build --amend`) finds openspec and checks its version first, before any model call or any write. The full session is in `design/examples/session.sh`, and the rendered terminal flow is in `design/mock.html`.

```sh
# The project's copy is found even without pnpm putting node_modules/.bin on PATH
$ node packages/agent/dist/bin/agentscript-change.js draft add-spec-amendments-cli
# add-spec-amendments-cli — waiting for review
...

# With no project copy, the PATH one is used. If it is too old, the command refuses:
$ node packages/agent/dist/bin/agentscript-change.js draft add-spec-amendments-cli
openspec 1.9.0 at /usr/local/bin/openspec is below the minimum supported version 1.14.1
$ echo $?
2
```

The refusal is one line on stderr, with exit `2`. It names the version found, the path it was found at, and the minimum. No loop starts, no model is called, and nothing is written.

When a gate cannot read openspec's output (because it cannot run, exits with no parseable JSON, or the JSON is missing what the gate needs), the issue now ends with the openspec it ran:

```
ERROR  `openspec show add-plan-export --json --deltas-only` printed no parseable JSON (openspec 1.14.1 at /repo/node_modules/.bin/openspec)
```

### From code

A new module, `openspec-bin.ts`, is the only place that knows how to find and run openspec. Its use is shown in `design/examples/resolve.ts`:

```ts
import {
  OPENSPEC_MIN_VERSION,   // "1.14.1"
  resolveOpenspec,        // (workspace) => Promise<OpenspecBin>, memoised per process
  checkOpenspec,          // (workspace) => Promise<{ ok: true; bin } | { ok: false; message }>
  runOpenspec,            // (bin, args, { cwd }) => Promise<{ code, stdout, stderr }>
  describeOpenspec,       // (bin) => "openspec 1.14.1 at /repo/node_modules/.bin/openspec"
} from "./openspec-bin.js";
```

- `resolveOpenspec(workspace)` looks for `<workspace>/node_modules/.bin/openspec` first, then searches each PATH entry for `openspec`, and returns `{ path, version, source: "project" | "path" }`. `path` is absolute. `version` is the first `x.y.z` in the output of `<path> --version` (run with `OPENSPEC_TELEMETRY=0`), or `null` when there is no such text. The result is memoised per workspace for the life of the process, so `--version` runs once.
- `checkOpenspec(workspace)` resolves and compares the version against `OPENSPEC_MIN_VERSION`. The CLI calls it at the start of the four commands above and turns `{ ok: false, message }` into stderr plus exit `2`.
- `runOpenspec(bin, args, { cwd })` spawns `bin.path` with `OPENSPEC_TELEMETRY=0`. The gates, `close` and `--amend` all use it instead of spawning `"openspec"`.
- `describeOpenspec(bin)` is the `openspec <version> at <path>` text used in both the refusal and gate issues.

## Decisions

- **Project copy first, then PATH.** "The project" is the workspace the command runs in: the directory that holds `openspec/`, which is the same root the config's `changesDir` is under. Only `<workspace>/node_modules/.bin/openspec` is tried. There is no walking up through parent directories, which keeps the rule easy to predict and state.
- **Resolve once and use the absolute path everywhere.** `close`'s trial fold runs in a temporary copy of `openspec/` that has no `node_modules`. It must use the path resolved for the repository, not resolve again from the temporary directory. `runOpenspec` takes the resolved `bin` for this reason.
- **Check up front, in the CLI.** The version check runs before any model call in `draft`, `approve`, `close` and `build --amend`. `draft` and `approve` are included because their spec stages' gates run openspec. `build` without `--amend` and `build` with a text answer are not checked; this change does not add openspec to paths that don't already use it.
- **Gates name what they ran, and do not refuse.** A gate called through the library outside the CLI also goes through `resolveOpenspec`. A gate does not enforce the minimum itself, because the CLI already did. What it does is add `(openspec <version> at <path>)` to every issue about unreadable output, so a mismatch can be diagnosed from the issue alone.
- **An unreadable version is refused.** If `--version` prints no `x.y.z`, the message is `openspec (version unknown) at <path> is below the minimum supported version 1.14.1`, with exit `2`. Running an openspec whose version cannot be confirmed would bring back the silent failure this change removes.
- **A missing openspec is not a new refusal.** If neither the project nor PATH has openspec, behaviour stays as it is today: the gate reports one `ERROR` naming the command (now with `(openspec not found)`), and `close` or `--amend` fail their validation. Adding a "not installed" refusal would cover installation, which is out of scope.
- **Version comparison is numeric on `major.minor.patch`.** Any pre-release or build suffix is ignored. `1.14.1` passes and `1.14.0` fails.

## Risks

- **Windows shims.** On Windows, `node_modules/.bin` holds `openspec.cmd`. The resolver also tries `.cmd` on `win32`, but this is not tested in CI.
- **`--version` output format.** If a future openspec changes the `--version` text, every command would refuse with "version unknown". The parse only looks for the first `x.y.z`, which keeps that risk small.
- **Memoisation in long-lived processes.** A test or daemon that upgrades openspec in the middle of a process will keep the old result. A `resetOpenspecCache()` is exported for tests only.
- **The gate's text changes.** The gate issues now end with the openspec suffix, so existing tests that assert the exact "`openspec show` failed" text will need updating.
