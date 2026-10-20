## Context

A model step's context is three things:

- the script's `system` block;
- the sections hosts add, such as `result`;
- the step's prompt.

The claude-code provider adds a fourth that we don't control: Claude Code's own environment block. In each of #5, #6 and #7, one of these tells the step something false about itself, and the step acts on it:

- it questions which tool to call;
- it reports a wrong repository;
- it asks for tools it was never meant to have.

Each one costs output. The judge cases cost more, because a judge that answers `ask` stops the loop and waits for a person.

## Goals / Non-Goals

**Goals:**

- No bundled prompt names a tool the model may not see by that name.
- A claude-code reasoning step is told that the environment details Claude Code adds are not about its task.
- Every bundled task-script step knows its role, and a tool-less step knows it has no tools.
- A judge doesn't treat iteration feedback as the principal's word.

**Non-Goals:**

- Per-subagent system blocks. The subset has one `system` per document.
- A marker for a principal's answer inside `carried`.
- Any change to `claudeCodeRunner` or delegation.

## Decisions

### 1. The result section is tool-neutral (#5)

`resultSection` (`src/durable/extension.ts`) renders this, followed by the schema as two-space-indented JSON:

```
Finish by submitting a structured result matching this JSON Schema:
```

Two alternatives were rejected:

- **Letting the provider supply the section.** That would put provider knowledge into the runtime-neutral `src/durable`.
- **Rendering it differently per provider.** The extension doesn't know which provider runs the step.

The neutral wording is true everywhere:

- on pi providers the model sees `submit_result`, forced by name;
- on claude-code it sees `StructuredOutput`.

The tool's own description (`Submit this step's result as an object with exactly the fields the system prompt lists…`) is unchanged. It is only seen where the tool is offered by that name.

### 2. The claude-code provider owns the environment note (#6)

**Live finding.** Claude Code injects an environment block into the system prompt even when `--system-prompt` replaces the default one. The block holds `Primary working directory: …`, `Is a git repository: false`, the platform and the date. We checked every relevant flag live. None removes the block: `--exclude-dynamic-system-prompt-sections` is ignored when `--system-prompt` is given, and `--safe-mode` doesn't touch it. So we can't remove the block. We can only make it harmless and tell the model to ignore it.

**Why the provider, not the scripts.** The block is an artifact of running a step through `claude -p`:

- No pi provider adds one.
- A script can't know which provider will run it.

Putting the note in `task.agent` would tell every pi-provider step about details it never sees, and would leave every other script (`ci-test-pick.agent`, the spec stages, user scripts) uncovered. So `claudeArgs` appends the note. `claudeArgs` is the one function both the `ReasoningPort` (`claudeCodeArgs`) and the pi provider (`streamClaude`) build argv with. The `--system-prompt` value becomes:

- `<system>\n\n<note>` when `system` is non-empty;
- `<note>` alone when it is empty.

The note:

```
This step has no workspace. The environment details you may see (working directory, whether it is a git repository, platform) describe the process running this step, not the project the step is about; ignore them.
```

- It says "the project the step is about", not "the task's repository", because the port also runs scripts that have no task (`triage.agent`).
- It leaves out the date. The date is accurate, and a script may legitimately rely on it.
- It is not exported from `@specsesh/agent/claude-code`: `claudeArgs` isn't either. Tests pin the literal string from the spec.

`claudeArgs` has no other caller. `claudeCodeRunner` (`src/node/claude-code-runner.ts`) builds its own argv and runs in the loop's workspace, where the environment block is accurate. It must not get the note, and because it doesn't call `claudeArgs`, it never does.

**Edge case.** On the provider, a step offering exactly one action tool (not `submit_result`) is turned into `--json-schema`. Pi then runs the call in the workspace. "This step has no workspace" is loose there: the model has no workspace of its own, but its single structured answer is executed in one. No bundled script does this; `task.agent`'s `act` offers several tools, which the provider refuses. We accept the looseness.

### 3. A fresh empty directory per call, and an optional `cwd` (#6)

- `spawnRunner(binary, timeoutMs, signal?, cwd?)`. When `cwd` is not given, each call creates `mkdtemp(join(tmpdir(), "agentscript-claude-"))`, spawns there, and removes it recursively after the child closes or fails to spawn.
- The reason for running outside any project is unchanged: no project `.claude/` settings or `CLAUDE.md` load.
- **Why a fresh directory and not `os.tmpdir()` itself.** `os.tmpdir()` is shared. It can hold a stray `.claude/`, a `.git` or anything another process left there, and Claude Code would then describe or load it. A fresh empty directory has nothing, so it is the same for every call, every machine and every concurrent step. Removing it afterwards keeps `/tmp` clean across thousands of steps.
- **Why `cwd` too.** A host may want a fixed neutral directory, for example a sandbox where `/tmp` is not writable, or a test that asserts where `claude` ran. A given `cwd` is used as is, and nothing is created or removed. There is no CLI flag: it is a library option for hosts.
- **Plumbing.**
  - `createClaudeCodeReasoningPort` passes `options.cwd` to its default `spawnRunner`.
  - `claudeCodeProvider` passes `options.cwd` to the `spawnRunner` it builds per request.
  - A custom `runner` replaces spawning and ignores `cwd`.
- **The hard lines hold.** `--safe-mode` stays, `--tools ""` stays, the OAuth token is never read, and `claudeCodeEnv` still strips `ANTHROPIC_API_KEY` and `CLAUDECODE`. The note and the directory don't touch argv apart from the `--system-prompt` value.

### 4. Role-neutral system block, roles in the prompts (#7)

The shared `system` block of both bundled task scripts becomes:

```
You are one step of a task loop that implements one task of an OpenSpec change, one iteration
at a time. Each step's prompt says its role. A step without tools decides only from the text it
is given. The spec deltas are the contract. The task names what to do now. Feedback from earlier
iterations says what was still unmet. Change only what the task needs; never tick boxes, never
edit the spec. If the spec itself looks wrong, say so instead of coding around it.
```

The prompts change as follows. Every other line stays as it is.

| Script | Step | Tools | First prompt line |
|---|---|---|---|
| both | orient | none | `You are the orient step: you write this iteration's plan for the step that acts. You have no tools: decide only from the text below.` (`task-delegate.agent`: "…for the delegate that acts in the workspace.") |
| both | judge | none | `You are the judge step: you decide whether the task is done from the reports and check output below. You have no tools: decide only from the text below.` |
| `task-delegate.agent` | retire | none | Inside its `if @variables.delete_granted:`, so a run without the grant still makes no model request: `You are the retire step: you read the delegate's reply below. You have no tools: decide only from the text below.` |
| `task.agent` | act | `read_file`, `edit_file`, `run_command` (+`delete_file`) | `You are the act step: you act in the real workspace, with the tools you are offered.`, then the existing `Carry out this plan, using the tools: …` |

The spec pins:

- the prefix `You are the <step> step`;
- the sentence `You have no tools: decide only from the text below.`;
- the phrase `you act in the real workspace`.

The rest of each role line is the implementer's to tune.

The judge's `Plan: {!@variables.plan}` line becomes:

- `task-delegate.agent`: `The instructions the delegate was given (for the delegate, not for you): {!@variables.plan}`
- `task.agent`: `The plan the act step followed (for the act step, not for you): {!@variables.plan}`

This keeps "run the tests" or "check git diff" in the plan from reading as orders to the judge.

### 5. The carried label in the judge is neutral

`carried` is built in four places:

- `judge.ts`: the judge's `unmet`, or a failed action's message;
- `loop.ts`: the gate's failing output;
- `answer.ts`: `carriedFor`, the principal's decision as typed, then the feedback messages;
- `group.ts` and `group-answer.ts`: group check output and verdict, or the group answer's decision.

Only an applied amendment has a marker (`The principal applied your amendment to …`). An ordinary answer is the decision text, bare. So a script can't tell a principal's answer from iteration feedback, and the judge must not claim either. The label becomes:

```
Feedback carried in (from an earlier iteration or the principal's answer): {!@variables.carried}
```

The following line stays as it is: `If it answers a question about this task, follow it: it overrides the task text where they differ, and do not choose ask for that question again. The checks still decide whether the task is done.` Feedback from an earlier iteration doesn't answer a question, so the rule only binds an answer.

The orient label (`Carried in (still unmet from an earlier iteration, or the principal's answer):`) is already neutral and stays, along with the tests that pin it (`action-retry`, `e2e`, `carried-scripts`).

A real fix is to seed the principal's answer as its own variable. That changes the task-script contract (`task/contract.ts`) and the loop's seeding, so it is out of scope here.

Measured on one fixed judge prompt (a finished task, checks passed, carried feedback saying the test was missing), the old label read as the principal's own claim. `qwen3.5` 9B judged the task unmet in 10 of 10 runs, each citing "the principal"; with the neutral label it judged met in 10 of 10. `clef-flash` put "the principal said the task is unfinished" at 71% before and 15% after. Haiku 4.5 asked the principal in 3 of 10 runs before and none after.

### 6. next_action when met

`next_action` is only `retry`, `amend-spec` or `ask`, and the loop ignores it on a met verdict (`judge.ts` goes to the gate; with no checks, `outcomeStatus` converges on a met verdict). The judge prompt never said so. With the new wording, `qwen3.5` judged met in 10 of 10 runs but chose `ask` in 4, explaining that no value means done and `ask` would "signal completion". It doesn't change the outcome today, but it spends a small model's output on a question the loop never asks, and it would break a host that reads `next_action` on a met verdict. Both judges gain one line before the `Answer next_action …` line: `When the task is met, next_action is ignored: answer retry.` `retry` is the default `next_action` the contract already checks, so a script keeping its default still passes.

## Risks / Trade-offs

- **Scripts copied from the old template keep the old text.** `specsesh agent show task > my-task.agent` and `examples/agents/06-custom-task-agent.agent` made copies, and copies don't update. We update example 06 in this change. `docs/language/system.md` says why: every model step sees the system block, tool-less ones included, so it should be role-neutral and each prompt should give the step's role. Nothing refuses an old-style script; it only works worse.
- **`task.agent`'s `act` step loses its workspace framing.** The system block used to be the only place that said "real workspace". Without the new act line, act would be told only that it is "one step of a task loop". The act line is pinned by a scenario so it can't be dropped silently.
- **Docs and tests pin the old text.**
  - `__tests__/task/carried-scripts.test.ts` pins the judge label (`JUDGE_CARRIED`), and three scenarios of `task/agent` name it. All of them change here.
  - `__tests__/pi/spawn-runner.test.ts`'s unnamed test "The child runs in the temp directory" asserts `cwd === os.tmpdir()`. It is replaced by the two new scenarios.
  - `__tests__/pi/claude-code.test.ts`'s "Headless, safe mode, no tools, no saved session" pins the exact argv, so its `--system-prompt` value changes.
  - No docs page quotes the old system block or the result-section wording. A grep of `docs/`, `packages/agent/docs/`, `README.md` and `guides/` found only example 06.
- **The note adds about 50 tokens to every claude-code step.** That is negligible next to the environment block it answers.
- **The model may still mention the environment block.** The note reduces that; it can't remove the block. `pnpm test:live` (opt-in) is where to watch whether plan and judge steps stop citing the working directory.
- **Merging with sibling changes.** `judge-sees-loop-changes` edits the judge's files-changed lines in both `.agent` files, and `loop-supplies-delegate-contract` edits `task-delegate.agent`'s `act` step. This change touches other lines of the same steps: the role lines, the plan label and the carried label. A merge may need one hunk resolved by hand, but there is no semantic overlap.

## Open Questions

None blocking. Seeding the principal's answer separately (decision 5) is a candidate for `openspec/parked.md`.
