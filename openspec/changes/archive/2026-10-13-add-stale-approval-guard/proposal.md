## Why

gaps.md #16: while people were answering add-delete-file-grant 3.2 and add-spec-amendments-cli 4.2, someone edited approved spec deltas by hand. `pnpm change build` kept going as if the deltas were still approved, so the edits went in without review. `build` has to check that approved files are still the ones that were approved. It also needs one sanctioned way to amend an approved delta mid-build so the build can continue.

## What Changes

- `pnpm change build <change>` compares each approved stage's files with their recorded sha256 in `approvals.json` before it starts or continues a build.
- If any approved file no longer matches, `build` refuses: it exits 2 and starts nothing. For each changed file, it names the file and its stage, and tells the user to review it with `pnpm change draft <change>` (which redrafts from that stage) and then approve it again.
- `pnpm change build <change> --amend` is the one sanctioned way to change an approved spec delta mid-build. Once its validation passes, it records the amended file's new sha256 in the specs approval, as the principal, with the note `amendment-applied`. The build then continues.

## Out of scope

- `pnpm change close`: it already validates the fold.
- `pnpm change draft` and `pnpm change approve`: both already treat a changed file as stale.
- Amending anything other than spec deltas (proposal, design or tasks) with `--amend`.

## Capabilities

**Modified:** `change/cli`

## Impact

- `change/cli`: the `build` command gets an approval hash check before it starts or continues, the stale-approval refusal (exit 2, a message per file with its stage, and the `draft`/`approve` next step), and `--amend` writing an `amendment-applied` entry to the specs approval in `approvals.json`.
- `approvals.json`: the specs approval's recorded hashes are updated when an amendment's validation passes. The file's format does not change.
- Users who edited approved files by hand will see `build` refuse until they redraft and approve again, or use `--amend` for spec deltas.
