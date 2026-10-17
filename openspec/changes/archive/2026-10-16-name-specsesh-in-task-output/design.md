# Design: name-specsesh-in-task-output

## Context

Slice 5 of `add-specsesh-command`'s `slices.md` (archived), after `name-specsesh-in-change-output`. `specsesh task` calls `agentscript-task`'s `main` in process with `run` implied, so its output is what `npx specsesh task` users see. Today the usage, the `loop <id> — resume with:` hints and the answer lines name `agentscript-task`, and the spec loop's next steps name `pnpm task`.

## Decisions

- **One wording, both entries**, as for the change CLI: `agentscript-task` and `specsesh task` print `specsesh task …`.
- **Where the strings are.** `src/bin/agentscript-task.ts` (usage, the resume hints of `run`, `resume`, `answer` and group runs, the answer line of text output), `src/task/spec-cli.ts` (review, question and next-step lines, `allApproved`, slice lines, the spec loop's resume hint) and `src/task/resume-all.ts` (the answer line of `resume --all`).
- **`pnpm task` runs `specsesh task`.** The root script becomes `node packages/specsesh/bin/specsesh.js task`. `specsesh task` implies `run` by the rule `scripts/task.mjs` holds, so that wrapper is deleted, and its test with it.
- **Machine output stays.** JSON Lines events and `--json` carry ids and statuses, not commands; nothing there changes.
- **Docs stay**, as for the change CLI.
