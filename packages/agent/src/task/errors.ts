/** A loop refused before any task was created or any model called. */
export class TaskLoopStartError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TaskLoopStartError";
	}
}

/** A change's `approvals.json` that is not JSON or fails its schema; the message names the file and the first problem. */
export class ApprovalsFileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ApprovalsFileError";
	}
}

/** An escalation answer the loop does not accept: not blocked, or not from the escalation's recipient. */
export class EscalationAnswerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EscalationAnswerError";
	}
}
