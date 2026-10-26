# specsesh for LLM agents

A map for a model that runs `specsesh` for a person, printed by `specsesh llm` from specsesh {{version}}. It gets you to the right command. Before you first use a command, run `specsesh <command> help` for its flags, outputs and edge cases.

## What it does

specsesh turns an OpenSpec change (`openspec/changes/<change>/`: proposal, design, spec deltas, `tasks.md`) into working code with agent loops. A gate or a set of checks decides when work is done, and the person you work for, the **principal**, makes every decision. Settings come from `agentscript.config.json` at the repository root.

## Pick a command

| The principal wants to… | Run | Then read |
|---|---|---|
| spec a new change, revise a draft, approve a stage | `specsesh change draft` / `approve` | `specsesh change help` |
| build a drafted change, answer its questions, close it | `specsesh change build` / `close` | `specsesh change help` |
| run one task or group, see loops, resume or answer one | `specsesh task …` | `specsesh task help` |
| see, write or check an Agent Script (`.agent`) file | `specsesh agent …` | `specsesh agent help` |
| run any script durably, so a crash resumes it | `specsesh durable …` | `specsesh durable help` |
| pick a provider and model, or see which runs where | `specsesh llm providers [<name>]` | the page it prints |
| run locally or on Cloudflare | `specsesh llm deploy <local\|cloudflare>` | the page it prints |

Most work is the change workflow: draft, approve, build, close.

## Rules that always apply

- **Only the principal approves or answers.** Run `change approve`, an answer to a build, or `task answer --by principal` only with the principal's own words, after they've seen what they're deciding. Otherwise show them the review or question and stop.
- **specsesh never commits.** Show the principal `git status` and `git diff`; commit only if they ask.
- **Follow the output.** A blocked or finished run ends with the exact command to run next. Use it; don't guess loop ids.
- **Say what you'll run first.** Runs make model calls and take minutes. Commit or stash before `build` or `task`: a dirty tree is refused.
- **Exit codes:** `0` done; `1` blocked, exhausted or failed (the output says which, and what next); `2` refused before anything ran (fix the cause; nothing changed).

## Usage

```
{{usage}}
```
