# Design: make-bins-executable

## Context

Reported from a fresh clone of `publish-specsesh-cli`: after `pnpm install --frozen-lockfile && pnpm build`, `packages/agent/dist/bin/*.js` are `0644`. `tsc` creates new files with the default mode and never sets the execute bit; an existing checkout only looked fine because its `dist/` files had been made executable once and `tsc` keeps the mode of a file it overwrites. A packed and installed package is unaffected (npm sets bin modes on install), so this hits the workspace: running a bin directly, or through a link such as `pnpm link` or a symlink on `PATH`.

## Decisions

- **One script, driven by the manifest.** `scripts/chmod-bins.mjs` reads `bin` from `packages/agent/package.json` and `chmodSync(target, 0o755)` for each, so a new bin needs no second edit. A missing target exits `1` naming it, which also catches a `bin` entry the build no longer emits.
- **Both `build` and `check`.** `pnpm check` also emits `dist/` (`tsc -p tsconfig.build.json`), and `pnpm check` is what the task loop and CI run first; both end with `node scripts/chmod-bins.mjs`.
- **`specsesh`'s bin is a source file**, so its mode is git's: it is committed `100755`, and a test reads `git ls-files -s` to keep it so.
- **README.** The first code block of `packages/agent/README.md` gains the command-line install, `npm install -g specsesh` / `npx specsesh`, with one line saying that a global `@specsesh/agent` lacks the optional Node peers.
