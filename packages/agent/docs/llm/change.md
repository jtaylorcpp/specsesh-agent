# specsesh change: draft, approve, build, close

A change is addressed by its directory name under `openspec/changes/`, never by a loop id. Each command prints where the change stands, `# <change> — <state>`, and ends with the command to run next.

## draft

- **Start.** `specsesh change draft <change> --intent "<the principal's words>"` (or `--intent-file <path>`) creates the change with `intent.md` and drafts its first stage, the proposal. A new change without either flag exits 2 and creates nothing. On an existing change both flags are refused: edit `intent.md` instead.
- **Stages.** proposal, design, specs, tasks, in order. An agent drafts each one; a gate with no model checks it and sends issues back, until the draft is clean. Then the run stops for review, exit 0.
- **Revise.** `specsesh change draft <change> "<feedback>"` redrafts the current stage with the feedback.
- **Questions.** When the agent asks instead of drafting, the run prints the question and exits 1. Answer with `specsesh change draft <change> "<answer>"`, in the principal's words.
- **Look again.** `specsesh change draft <change>` alone, while a review or question waits, prints it again and starts nothing. With nothing waiting, it drafts from the first stage without a current approval.
- Editing an approved file makes its approval stale, and drafting restarts from that stage. With every stage approved, `draft` starts nothing and points at `build`.

## approve

`specsesh change approve <change> [--principal <name>]` approves the stage under review and records it in the change's `approvals.json`, with a hash of each file. The principal is `--principal`, else `git config user.name`, else `$USER`, so running it in their shell approves **as them**. Run it only when the principal has said to approve that stage. It never commits: the principal commits `approvals.json` with the stage's files.

## build

`specsesh change build <change>` runs every task group of a fully approved change in order: each group's task loops and its judge, then a change check. It stops only when an agent needs a decision.

- **Answer.** A blocked build prints the question and exits 1. Run `specsesh change build <change> "<answer>"` with the principal's answer. `build <change>` alone shows the question again.
- **Amendments.** When a judge proposes a spec amendment, `specsesh change build <change> --amend` applies it. That is the principal's decision.
- **Flags.** It takes the task run's flags (`--check`, `--allow`, `--max-iterations`, `--escalate-to`, `--provider`, `--model`, …) plus `--change-check <command>`, repeatable, defaulting to the configured checks.
- **Refusals.** A dirty tree is refused unless `--allow-dirty`; `--worktree` isn't supported. Both exit 2 and start nothing.
- **Crashes.** Running the same command with the same database continues an unfinished build. Before any model call, stderr names the loop and its resume command.
- **Done.** It prints the groups, the change check, the files changed, and `specsesh change close <change>`. A built change says so and starts nothing.

## close

`specsesh change close <change>` folds the finished change's spec deltas into `openspec/specs/` and archives it under `openspec/changes/archive/<date>-<change>/`. It refuses, with exit 2 and nothing changed, when a task in `tasks.md` is unticked, the newest build didn't converge, or `openspec validate --strict` fails. It folds into a temporary copy and validates that before archiving for real. It never commits: it prints `git add -A openspec && git commit` for the principal.

## Exit codes

`0` drafted for review, approved, built or closed; `1` waiting for an answer, exhausted or failed; `2` usage or a refusal.
