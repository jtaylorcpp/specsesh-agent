## Why

Three things in a step's context mislead the model about what it is and where it is. Each one has stopped task loops to wait for a person (GitHub issues #5, #6, #7):

- **#5. The result section names a tool the claude-code provider never offers.** Every structured step is told `Finish by calling submit_result with an object matching this JSON Schema:`. On the claude-code provider that tool reaches the model as Claude Code's own `StructuredOutput`, and smaller models spend output on the mismatch, on exactly the plan and judge steps that should be crisp.
- **#6. Claude Code tells every reasoning step where its process runs.** It adds an environment block to the system prompt (working directory, whether it is a git repository, platform, date) even with `--system-prompt`. The port and provider run in `os.tmpdir()`, so a tool-less plan or judge step is told it sits in a temp directory that is not a git repository. Plan steps have told the delegate to stop if there is no baseline, and judges have asked the principal for "the correct repository path".
- **#7. The bundled task scripts tell tool-less steps they work in a real workspace.** `task.agent` and `task-delegate.agent` open their system block with `You implement one task of an OpenSpec change, in a real workspace`. Every step sees it, including orient and judge, which have no tools. The judge is also shown the plan, written as instructions to the delegate, and reads it as things it must verify itself. In a sample of 84 task loops, 3 of the 5 escalations from a small judge model were this confusion. The judge also labels `carried` as `The principal's answer or earlier feedback`, so feedback from an earlier iteration reads as if the principal said it. In our validation Haiku asked the principal 3 times in 10 to settle a "contradiction" between that feedback and passing checks.

## What Changes

- **#5. The result section names no tool.** The `result` section reads `Finish by submitting a structured result matching this JSON Schema:`, then the schema. The pi port still forces `submit_result` by name, and the tool keeps its name and description. Only the prompt text changes.
- **#6. The claude-code port and provider own the fix.** Both are built on `claudeArgs` and `spawnRunner`:
  - `claudeArgs` appends one fixed note to the system prompt it passes after `--system-prompt`. The note says the step has no workspace and the environment details describe the process, not the project. The exact text is in the spec.
  - `spawnRunner` runs each call in a fresh empty directory (`mkdtemp` under `os.tmpdir()`) and removes it afterwards, instead of in `os.tmpdir()` itself. It still runs outside any project, so no project settings load.
  - `ClaudeCodeReasoningPortOptions` and `ClaudeCodeProviderOptions` get an optional `cwd` that replaces the fresh directory. There is no CLI flag.
  - The hard lines for this provider hold: `--safe-mode`, `--tools ""`, no OAuth token, `ANTHROPIC_API_KEY` and `CLAUDECODE` stripped.
- **#7. The bundled task scripts give each step its role.**
  - The shared system block becomes role-neutral: `You are one step of a task loop that implements one task of an OpenSpec change…`. It says each step's prompt gives its role, and that a step without tools decides only from the text it is given. It keeps the contract rules: the spec deltas are the contract, never tick boxes, never edit the spec, and say so if the spec looks wrong.
  - Each tool-less step's prompt starts with its role and `You have no tools: decide only from the text below.` These are orient and judge in `task.agent`, and orient, judge and retire in `task-delegate.agent`.
  - `task.agent`'s `act` step has tools. Its prompt now says `you act in the real workspace`, since the system block no longer does.
  - Each judge sees the plan under a label saying it was written for another step. In `task-delegate.agent` that is `The instructions the delegate was given (for the delegate, not for you):`, and in `task.agent` `The plan the act step followed (for the act step, not for you):`.
  - The judge's `carried` label becomes neutral: `Feedback carried in (from an earlier iteration or the principal's answer):`. The loop's `carried` string has no marker for a principal's answer, so the script can't tell the two apart. The rule to follow it when it answers a question stays.
- **Docs and examples.** `examples/agents/06-custom-task-agent.agent` takes the same role-neutral system block and role lines. `docs/language/system.md` says that every model step sees the system block, tool-less ones included, so it should be role-neutral and each step's prompt should say its role. That page is also where someone with a script copied from the old template learns to update it.

## Out of scope

- Per-subagent system instructions. The subset has one `system` block per document, and this change keeps that.
- Marking a principal's answer inside `carried`, or seeding it as its own variable, so a judge could label the two apart. That changes the loop's seeding and its contract. It is a candidate for a later change.
- `group.agent` (its system block already says `You change nothing yourself`), and `READ_AGENT` and `EDIT_AGENT`, whose single step has workspace tools, so "in a real workspace" is true for them.
- The judge's lines about the files the delegate changed (`Files the delegate changed: …`, `0 means the delegate changed nothing…`), and any new seeded variable for them. Those belong to `judge-sees-loop-changes`.
- What a delegate receives on stdin, and `task-delegate.agent`'s `act` step. Those belong to `loop-supplies-delegate-contract`.
- `claudeCodeRunner`, the delegate's way into Claude Code. It runs in the loop's workspace, where the environment block is accurate.

## Capabilities

- **Modified:**
  - `durable/run-task`;
  - `pi/claude-code`;
  - `task/agent`.

## Impact

- **Code:**
  - `packages/agent/src/durable/extension.ts` (`resultSection`)
  - `packages/agent/src/claude-code/claude-code.ts` (`claudeArgs`, `spawnRunner`, the port's `cwd`)
  - `packages/agent/src/claude-code/claude-code-provider.ts` (`cwd`)
  - `packages/agent/src/task/scripts/task.agent` and `task-delegate.agent`
- **Docs and examples:**
  - `examples/agents/06-custom-task-agent.agent`
  - `packages/agent/docs/language/system.md`
  - `CLAUDE.md` (the claude-code provider notes)
- **Tests:**
  - `__tests__/durable/actions-run-task.test.ts`
  - `__tests__/pi/claude-code.test.ts`, `claude-code-provider.test.ts` and `spawn-runner.test.ts`. The unnamed test "The child runs in the temp directory" pins `os.tmpdir()` and is replaced.
  - `__tests__/task/carried-scripts.test.ts` (the judge label)
  - A new `__tests__/task/step-roles.test.ts`
- **Behaviour.** Users of the claude-code provider get a slightly longer system prompt on every step. A custom script copied from the old template keeps its old system block until its author updates it.
- **Concurrency.** `judge-sees-loop-changes` and `loop-supplies-delegate-contract` edit the same two `.agent` files, but on other lines: the judge's files-changed lines, and `task-delegate.agent`'s `act` step. A merge may need a hand-resolved hunk in the judge steps.
