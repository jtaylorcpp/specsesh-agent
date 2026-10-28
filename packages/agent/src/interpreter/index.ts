/**
 * The interpreter over a parsed Agent Script document.
 *
 * Executes an enumerated subset of the language and fails by name on anything
 * outside it. Reasoning leaves through an injected port: this package imports
 * no model client, constructs no endpoint and reads no credential, because it
 * is published and the harness it would otherwise call is a private workspace
 * package.
 *
 * The port carries one reasoning step — system instructions as a channel
 * distinct from the prompt, the prompt, an optional structured result, optional
 * tool offers, and an outcome. It carries no executor and no round bound: a
 * contract holding those is a model boundary, and this product has exactly one.
 * Actions a `run` statement calls leave through the step machine as action
 * calls, for the host to run.
 */

export {
	KNOWN_FAILURE_CATEGORIES,
	isFailureCategory,
	NoReasoningPortError,
	TOOLS_NEED_DURABLE_HOST,
	toFailureCategory,
	type FailureCategory,
	type ReasoningPort,
	type ReasoningRequest,
	type StepOutcome,
	type ToolCallRecord,
} from "./port.js";

export type { RunEvent, StreamDelta, StreamSink } from "./events.js";

export {
	BOOLEAN_LITERALS,
	READABLE_NAMESPACES,
	ASSIGNABLE_NAMESPACES,
	ACTIONS_NAMESPACE,
	ACTION_PARAMETER_TYPES,
	ACTION_TARGET_SCHEME,
	STRUCTURED_RESULT_NAMESPACE,
	SUPPORTED_BLOCK_FIELDS,
	SUPPORTED_CONSTRUCTS,
	SUPPORTED_CONSTRUCT_IDS,
	SUPPORTED_DEFAULT_VALUE_KINDS,
	SUPPORTED_EXPRESSION_KINDS,
	SUPPORTED_NODE_KINDS,
	SUPPORTED_STATEMENT_KINDS,
	renderSubsetInline,
	renderSubsetMarkdown,
	type SupportedConstruct,
} from "./subset.js";

export { UnsupportedConstructError, scanDocument, type UnsupportedConstruct } from "./scan.js";

export {
	UndeclaredVariableError,
	UnreadableDefaultError,
	type Composition,
	type DeclaredVariable,
	type PendingAssignment,
	type ToolAssignment,
	type ToolOffer,
	type VariableValue,
} from "./compose.js";

export {
	EmptyPromptError,
	RunStateError,
	SourceMismatchError,
	apply,
	applyAction,
	hashSource,
	next,
	start,
	type ActionCall,
	type ActionReport,
	type ActionResult,
	type AwaitingAction,
	type AwaitingStep,
	type ResumePoint,
	type DeclaredAction,
	declaredActions,
	NoActionHostError,
	type NextStep,
	type RunState,
	type StartOptions,
	NoEntrySubagentError,
	UndeclaredOverrideError,
	InvalidChoicesError,
	UnknownSubagentError,
	UnparsedDocumentError,
	UnreadableDocumentError,
	run,
	streamRun,
	type RunOptions,
	type RunResult,
	type RunStream,
	type StepReport,
} from "./run.js";
