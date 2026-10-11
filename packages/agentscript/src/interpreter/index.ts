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
 * distinct from the prompt, the prompt, an optional structured result, and an
 * outcome. It carries no tool set, no executor and no round bound: a contract
 * holding those is a model boundary, and this product has exactly one.
 */

export {
	KNOWN_FAILURE_CATEGORIES,
	isFailureCategory,
	NoReasoningPortError,
	toFailureCategory,
	type FailureCategory,
	type ReasoningPort,
	type ReasoningRequest,
	type StepOutcome,
} from "./port.js";

export {
	BOOLEAN_LITERALS,
	READABLE_NAMESPACES,
	ASSIGNABLE_NAMESPACES,
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
	type VariableValue,
} from "./compose.js";

export {
	EmptyPromptError,
	NoEntrySubagentError,
	UndeclaredOverrideError,
	UnknownSubagentError,
	UnparsedDocumentError,
	UnreadableDocumentError,
	run,
	type RunOptions,
	type RunResult,
	type StepReport,
} from "./run.js";
