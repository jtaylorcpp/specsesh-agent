# specsesh for LLM agents

This guide is for a model, such as a coding agent, that runs `specsesh` for a person. It was printed by `specsesh llm` from specsesh {{version}}. Read it once before using the CLI in a session.

## What specsesh does

specsesh turns an OpenSpec change into working code with agent loops, and keeps a person in charge of every decision.

- **OpenSpec change:** a directory `openspec/changes/<change>/` holding `proposal.md`, `design.md`, spec deltas under `specs/` and a `tasks.md` checklist. Specs live in `openspec/specs/`.
- **Draft:** an agent writes each stage of a change (proposal, design, specs, tasks). A gate with no model checks each draft, and the person reviews it.
- **Build:** a task loop works each task in `tasks.md` until the configured checks pass, then ticks it. A judge decides when a task is done, asks when it needs a decision, or proposes a spec amendment.
- **Agent Script:** the loops are `.agent` files, written in Salesforce's Agent Script language. specsesh ships its own and runs yours.

The person you work for is the **principal**. Only the principal approves a stage or answers a question meant for them.

## Before you start

- Work at the root of a git repository with an `openspec/` directory and an `agentscript.config.json`. That config sets the provider, the model, the checks, the delegates and the database (`db`).
- Commit or stash first. `build` and `task` refuse a dirty tree, listing the files. `--allow-dirty` overrides that, but every edit then mixes with the loop's.
- A run can take minutes and makes model calls. Say what you're about to run, and why, before you run it.

## The change workflow

Run these in order. Each prints where the change stands and ends with the exact command to run next. Run that command, or show it to the principal. Don't build commands from loop ids you guessed.

1. **Draft.** `specsesh change draft <change> --intent "<what the principal asked for>"` starts a change. Use the principal's own words for the intent. It drafts the first stage and stops for review.
2. **Revise or approve.** `specsesh change draft <change> "<feedback>"` redrafts the current stage with feedback. `specsesh change approve <change>` approves it, and is the principal's decision alone (see the rules below). Repeat for each stage. With every stage approved, `draft` points at `build`.
3. **Build.** `specsesh change build <change>` runs every task group in order, then a change check. When a loop needs a decision, it stops and prints the question. `specsesh change build <change> "<answer>"` carries the answer in, and the answer must come from the principal.
4. **Close.** `specsesh change close <change>` folds the change's spec deltas into `openspec/specs/` and archives it. It refuses an unfinished change and changes nothing.

You can also run one task or one group directly:

- `specsesh task <change> <task-id>` runs one task, for example `2.1`. A bare integer such as `2` runs a group, and `--next` picks the first unticked task.
- `specsesh task status` lists the loops in the database.
- `specsesh task resume <loop-id>` finishes a loop whose process died.
- `specsesh task answer <loop-id> --by principal --principal <name> --decision "<text>"` answers a blocked loop. A blocked loop prints this exact command.

## Rules for an agent

- **Never approve or answer as the principal on your own.** Run `change approve`, an answer to `change build`, or `task answer --by principal` only with the principal's words, after they've seen what they're approving. If they haven't decided, show them the review or question and stop.
- **specsesh never commits.** After a run, show the principal the diff (`git status`, `git diff`), or the worktree path a `--worktree` run printed. Commit only if they ask. `change close` prints the commit command for them.
- **Don't hand-edit what a loop owns while it runs:** `tasks.md` ticks, `approvals.json`, or files in a worktree a loop is using.
- **One process per database.** A second process is refused, naming the holder's pid. Wait, or use another `--db`.
- **Read the exit code:**

  | Exit | Meaning |
  |---|---|
  | `0` | Converged, built, approved or closed: done. |
  | `1` | Blocked (waiting for a review or an answer), exhausted (out of budget) or failed. Read the output: it says which, and what to run next. |
  | `2` | Refused before anything ran: usage, config, a dirty tree, an unknown change or task, or a locked database. Fix the cause; nothing changed. |

- **Machine-readable output:** `--json` prints the outcome as JSON on stdout. Progress goes to stderr as JSON Lines (`loop-started`, `iteration-started`, `verdict`, `loop-ended`, …), after a line naming the loop and how to resume it.

## Agent scripts

Use these to see what the loops run, or to write your own script:

- `specsesh agent list` lists the bundled scripts.
- `specsesh agent show <name>` prints one.
- `specsesh agent language [topic]` prints the language reference.
- `specsesh agent actions` lists the built-in actions.
- `specsesh agent new <name>` scaffolds a script.
- `specsesh agent check <file.agent>` validates a script without running it.
- `specsesh agent run <file>` runs a script once.

A task script must keep the task contract (the variables the loop seeds and reads back). `specsesh agent show task` is the reference.

## Commands

```
{{usage}}
```

Run any command with no arguments for its full usage and flags, for example `specsesh change` or `specsesh task`.
