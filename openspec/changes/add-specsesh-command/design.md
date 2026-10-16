# Design: add-specsesh-command

## Context

The harness runs today as four bins of `@specsesh/agent`, reached in this repository through root scripts:

| Root script | Bin | Commands |
|---|---|---|
| `pnpm agent` | `agentscript-pi` | `run`, `models` |
| `pnpm durable` | `agentscript-durable` | `run`, `resume` |
| `pnpm task` (`scripts/task.mjs`) | `agentscript-task` | `run` (implied), `spec`, `resume`, `answer`, `status` |
| `pnpm change` | `agentscript-change` | `draft`, `approve`, `build`, `close` |

The principal wants the harness on public npm as one command, `specsesh`, so that `npx specsesh change build <change>` works in any repository. This change adds the command as a library entry; slices 2 and 3 package and publish it. The whole plan, and why, is below so each slice can point here.

## The plan across slices

### One command, four subcommands that mirror the root scripts

`specsesh <x>` is `pnpm <x>` for each of the four scripts: `specsesh agent`, `specsesh durable`, `specsesh task`, `specsesh change`. A user of this repository's guides translates `pnpm change approve x` to `npx specsesh change approve x` without a table.

`agentscript-durable` and `agentscript-pi` become subcommands, not extra bins of the new package. They are small, already follow the same `main(argv)` shape, and keeping them under one command gives one `--help` and one `--version`. The four `agentscript-*` bins stay in `@specsesh/agent` unchanged through 0.x, so nothing that calls them today breaks; dropping them is a 1.0 decision.

### `npx specsesh`, from an unscoped `specsesh` package

`npm view specsesh` and `npm view @specsesh/agent` both answer 404 (checked 2026-10-16), and `npm org ls specsesh` lists `jtaylorcpp` as owner, so the scope and the bare name are both free to use.

`npx @specsesh/agent change build` does not work well:

- `@specsesh/agent` has four bins and none is named `agent`, so `npx` cannot pick one; the user would have to type `npx -p @specsesh/agent specsesh change build`.
- The CLIs need `@earendil-works/pi-ai`, `pi-durable` and `chord`, which `@specsesh/agent` declares as **optional** peers so that a Worker or a core-only consumer does not install them. `npx` does not install optional peers, so the bins would fail on import.

So slice 2 adds a second package, unscoped `specsesh` (`packages/specsesh`): one bin, `specsesh`, and real dependencies on `@specsesh/agent` (exact, same version) and the three Node peers (exact, the versions the tests run on). `npx specsesh …` and `npm i -D specsesh` then need nothing else. `@specsesh/agent` stays the library, with its optional peers unchanged.

The bin of that package can only reach the dispatcher through a public entry, because `@specsesh/agent` refuses deep imports. Hence this change's `./cli` entry: `src/cli/index.ts` exports `main(argv, deps)` and `USAGE`, and the `specsesh` package's bin is three lines that call it. `@specsesh/agent` does not get a `specsesh` bin itself: installing `specsesh` would then link two bins of the same name.

### Self-contained now, `@specsesh/ontology` later

`@specsesh/ontology` (the private repo `jtaylorcpp/specsesh-ontology`) holds a copy of this package's OpenSpec model and Markdown readers. A public package cannot depend on a private git repository, so migrating first would block this release on publishing the ontology from another repository. `@specsesh/agent` already ships its own copy as `./openspec` and depends on nothing private, so it publishes as is. Slice 6, `use-published-ontology`, swaps the copy for the public `@specsesh/ontology` once that is published, keeping `@specsesh/agent/openspec` as a re-export so no import changes.

### Versioning

- Semver, starting at `0.1.0`. While 0.x, a minor bump (`0.2.0`) may break a CLI flag, an output line a script parses, or an entry's exports; a patch never does.
- `@specsesh/agent` and `specsesh` are released in lockstep: always the same version, from the same tag `v<version>`, and `specsesh` depends on exactly that `@specsesh/agent` version. `specsesh --version` therefore prints the version of both.
- A prerelease (`v0.2.0-rc.1`) publishes under the `next` dist-tag, a release under `latest`.
- Slice 3's release check enforces the lockstep; slice 2 moves the version out of the spec (today `package/distribution` pins `0.1.0`).

### Publishing

Slice 3 adds `.github/workflows/release.yml`: on a `v*` tag, `pnpm check`, `pnpm test` and `pnpm pack:check`, then `pnpm pack` both packages (which rewrites `workspace:*` to the exact version) and `npm publish <tarball> --access public --provenance` through npm trusted publishing (OIDC, `id-token: write`, no npm token stored). The manual steps (scope, trusted publisher on npmjs.com, first publish) are in that change's `design.md`.

### Order

1 and 2 give a working `npx specsesh` from a local tarball. 3 publishes. 4 and 5 make the sub-CLIs' usage and next-command lines say `specsesh change …` instead of `agentscript-change …` and `pnpm change …`; until then `specsesh change` prints the right result with the old names in its hints. They are better landed before the first public publish (see Open questions). 6 waits on the ontology.

## How it is used

From code (`design/examples/dispatch.ts`):

```ts
import { main, USAGE } from "@specsesh/agent/cli";
process.exitCode = await main(process.argv.slice(2));
```

From a shell, once slice 2 lands (`design/examples/session.sh`, rendered in `design/mock.html`):

```sh
$ npx specsesh --version
specsesh 0.1.0
$ npx specsesh
usage:
  specsesh change <draft|approve|build|close> <change> [options]
  specsesh task <change> <task-id>|<group>|--next|--next-group [options]
  specsesh task <run|spec|resume|answer|status> [options]
  specsesh durable <run|resume> [options]
  specsesh agent <run|models> [options]
  specsesh --version
  specsesh --help
Run a command with no arguments for its own usage.
$ echo $?
2
```

## Inside `src/cli/index.ts`

- `ROUTES`: `agent` → `agentscript-pi`'s `main`, `durable` → `agentscript-durable`'s, `task` → `agentscript-task`'s, `change` → `agentscript-change`'s. Static imports of `../bin/*.js`; each bin's entry guard compares `process.argv[1]` with its own file, so importing it from here runs nothing.
- `agentscript-pi.ts` gains `export` on `main`. It takes no `deps` and writes through `console`, so `specsesh agent` ignores `deps.out`/`deps.err`; the test spies on `console.error`.
- `task`: the same rule as `scripts/task.mjs`: `COMMANDS = run|spec|resume|answer|status`; a first argument outside it that does not start with `-` gets `run` inserted. `scripts/task.mjs` is left alone here.
- `--version`: `readFileSync(new URL("../../package.json", import.meta.url))`, which is `packages/agent/package.json` from both `src/cli/` and `dist/cli/`, read only when asked.
- Interrupts: `agentscript-task` and `agentscript-change` install `SIGINT`/`SIGTERM` → `process.exit(130|143)` in their entry guard so the database lock is released. `main` installs nothing (importing it must stay inert); the `specsesh` bin of slice 2 installs both handlers before calling `main`.
- `src/cli/` is not one of the layers `__tests__/package/layers.test.ts` constrains, like `src/bin/`.

## Open questions

- Should slices 4 and 5 land before the first public publish, so no published version prints `pnpm change approve …`? Recommended yes; the first publish then waits on five changes instead of three.
- `npm` may refuse the bare name `specsesh` at first publish if it judges it too close to an existing package; `npm view` cannot tell. Fallback: publish the command as `@specsesh/cli` (bin still `specsesh`, so `npx @specsesh/cli change build`).
