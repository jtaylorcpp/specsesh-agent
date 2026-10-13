/**
 * The task loop from the OpenSpec ontology, made runnable.
 *
 * Hand it a change, a task id and an Agent Script, and a durable pi-durable
 * task (`agentscript.task-loop`) runs the script once per iteration, as an
 * `agentscript.run` child, until the task converges, blocks with an
 * escalation, exhausts its budget or fails. The result is the ontology's
 * `LoopOutcome<TaskOutcome>`.
 *
 * A harness runs the loops of one workspace, check list and allowlist: install
 * the three extensions `taskLoopExtensions({ workspace, checks, allow })`
 * returns, then `startTaskLoop` and `waitForTaskLoop`.
 *
 * A task script is any Agent Script declaring the contract variables (see
 * `SEEDED` and `READ_BACK`). The bundled `task.agent` acts with model-callable
 * tools; `task-delegate.agent` hands the work to headless Claude Code.
 */

export { EscalationAnswerError, TaskLoopStartError } from "./errors.js";
export { NEXT_ACTIONS, READ_BACK, SEEDED, checkContract, contractProblems, type ContractType } from "./contract.js";
export { TASK_LOOP, TaskLoop, TaskLoopTask, taskLoopExtensions, type TaskLoopActionOptions } from "./loop.js";
export type { LoopCheckpoint, TaskLoopInput, TaskLoopResult } from "./loop-input.js";
export { BUNDLED_SCRIPTS, DEFAULT_ESCALATE_TO, DEFAULT_MAX_ITERATIONS, type ChangeSource, type LoopWorktree, type Source, type TaskLoopOptions } from "./options.js";
export type { GroupLoopOptions } from "./group.js";
export { GroupLoop, groupLoopExtensions, startGroupLoop, waitForGroupLoop } from "./group-api.js";
export {
	groupCheck,
	groupEnded,
	groupEndedFromOutcome,
	groupStarted,
	rework,
	withGroup,
	type EventSink,
	type GroupEvent,
	type StreamEvent,
	type TaskEvent,
} from "./events.js";
export { answerGroupEscalation } from "./group-answer.js";
export type { ChangeLoopOptions } from "./change-input.js";
export { answerChangeEscalation, changeLoopExtensions, startChangeLoop, waitForChangeLoop } from "./change-api.js";
export { prepareTaskLoop, startTaskLoop } from "./start.js";
export { answerEscalation, waitForTaskLoop, waitForTaskLoopResult } from "./answer.js";
export { SPEC_NEXT_ACTIONS, SPEC_STAGE_CONTRACT, owns, stageContractProblems, type SpecStage, type StageContext, type StageIssue } from "./spec-stage.js";
export { readBundle, type BundleRead } from "./spec-bundle.js";
export {
	SPEC_LOOP,
	SpecLoop,
	SpecLoopTask,
	registerSpecStage,
	specLoopTask,
	type SpecLoopCheckpoint,
	type SpecLoopInput,
	type SpecLoopResult,
	type StageOutcome,
	type StageResolver,
} from "./spec-loop.js";
export {
	prepareSpecLoop,
	specLoopExtensions,
	startSpecLoop,
	waitForSpecLoop,
	type SpecLoopExtensionOptions,
	type SpecLoopOptions,
} from "./spec-api.js";
export { answerSpecLoop, type SpecLoopAnswer } from "./spec-answer.js";
export { proposalStage } from "./stages/proposal.js";
export { designStage } from "./stages/design.js";
export { specsStage } from "./stages/specs.js";
export { tasksStage } from "./stages/tasks.js";
export { SPEC_STAGES } from "./spec-stages.js";
export type { DraftLoopOptions, DraftOutcome } from "./draft-input.js";
export { answerDraftLoop, draftLoopExtensions, startDraftLoop, waitForDraftLoop } from "./draft-api.js";
