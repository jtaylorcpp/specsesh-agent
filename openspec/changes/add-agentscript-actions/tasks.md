## 1. Prerequisites

- [x] 1.1 Land `package-specsesh-agent` and `add-openspec-ontology` first; this change uses the post-packaging layout (`packages/agent/src/...`) and the ontology's `Action` and `Evidence` types
- [x] 1.2 Rebase this change's MODIFIED requirements onto `package-specsesh-agent`'s wording once it archives (both change `core/step-machine` "The Step Machine Is Exported From The Interpreter Entry" and entry names elsewhere); re-run `openspec validate add-agentscript-actions --strict`

## 2. Subset and scan

- [ ] 2.1 `packages/agent/src/interpreter/subset.ts`: add constructs `subagent.actions`, `reasoning.run`, `reasoning.actions` (ids, summaries, probes, kinds); `RunStatement` in `SUPPORTED_STATEMENT_KINDS`; `actions` in `SubagentBlock`/`ReasoningBlock` fields; `ActionBlock` fields
- [ ] 2.2 `packages/agent/src/interpreter/scan.ts`: action definitions (scalar `inputs`/`outputs`, no defaults), `mcpTool://` only with `target <scheme>://` refusals, `run` clauses (every input once, no `Ellipsis`, known output fields), the deterministic-subagent rule, reasoning-action entries (every input once, a prompt line required), `@actions` positions and same-subagent names
- [ ] 2.3 `packages/agent/scripts/check-subset-conformance.mjs`: probes for the three new constructs produce every declared kind on the pinned dialect

## 3. Composition

- [ ] 3.1 `packages/agent/src/interpreter/compose.ts`: walk to a `run`, evaluate its inputs at that point with type checks; stage-and-apply `run` outputs; `ToolOffer` derivation (model-filled vs bound inputs, `inputSchema`); last-call outputs for reasoning-action `set`s; outputs never from model text or arguments

## 4. Step machine

- [ ] 4.1 `packages/agent/src/interpreter/run.ts`: `NextStep` `action` variant, `ActionCall`, `AwaitingAction`, resume `index`; `RunState.actions` and `RunResult.actions`; `next` re-returns an awaiting call unchanged
- [ ] 4.2 `packages/agent/src/interpreter/run.ts`: `applyAction` (RunStateError cases, outputs, `ActionReport`, failure → `stopped: "failed"` with `awaiting.before`), `apply` refuses an awaiting call, `run()` drives actions through an optional host callback
- [ ] 4.3 `packages/agent/src/interpreter/index.ts`: export `applyAction`, `ActionCall`, `ActionResult`, `ActionReport`, `AwaitingAction`, `ToolOffer`

## 5. Port

- [ ] 5.1 `packages/agent/src/interpreter/port.ts`: `ReasoningRequest.tools`, `ToolOffer`, `answered.toolCalls`; normalisation fails a call to an unoffered tool
- [ ] 5.2 `packages/agent/src/pi/port.ts` and `packages/agent/src/claude-code/claude-code.ts`: refuse a request with `tools` as `invalid_request`, before any model request

## 6. Registry and built-ins

- [ ] 6.1 `packages/agent/src/durable/actions.ts`: `HostAction`, `ActionRegistry`, `createActionRegistry`, `ActionBindingError` and the whole binding check
- [ ] 6.2 `packages/agent/src/durable/builtins.ts`: `builtinActions` with `read_file`, `edit_file` (workspace confinement incl. symlinks), `run_command` (argv split, no shell, allowlist, timeout), `run_checks`, `delegate_claude_code` (hard lines), each with its replay policy and ontology `record`
- [ ] 6.3 `packages/agent/src/durable/extension.ts`: `agentScriptExtensions({ actions, workspace })`; the plain exports act as an empty registry

## 7. Durable execution

- [ ] 7.1 `packages/agent/src/durable/extension.ts`: `act` phase (intent committed before execution, `applyAction`, throwing executor → `{ ok: false }`), safe/unsafe recovery; `next` phase routes `action` to `act`
- [ ] 7.2 `packages/agent/src/durable/extension.ts`: offered tools as pi-durable tools (`parameters` = `inputSchema`, `replay` from the action, bound inputs merged, error results); `toolCalls` collected in call order, `submit_result` excluded

## 8. Tests, one per scenario, named `Scenario: <exact name>`

- [ ] 8.1 `packages/agent/__tests__/core/`: every scenario of `core/subset`, `core/composition`, `core/step-machine`, `core/reasoning-port` added or modified by this change
- [ ] 8.2 `packages/agent/__tests__/durable/actions/`: every scenario of `actions/registry` (real temp workspaces; a fake `claude` on `PATH` for `delegate_claude_code`; never a network call)
- [ ] 8.3 `packages/agent/__tests__/durable/`: every scenario of `durable/run-task` added or modified here, including both crash-recovery scenarios with a crash fixture that exits 137 mid-action
- [ ] 8.4 `openspec/changes/add-task-agent/task.agent` and `task-delegate.agent` scan clean and run end to end on a faux model against a temp workspace

## 9. Close

- [ ] 9.1 All suites pass, types clean, conformance passes on the pinned dialect
- [ ] 9.2 `pnpm spec:archive add-agentscript-actions`, then `pnpm spec:check`
