/** A loop refused before any task was created or any model called. */
export class TaskLoopStartError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TaskLoopStartError";
	}
}

/** An escalation answer the loop does not accept: not blocked, or not from the escalation's recipient. */
export class EscalationAnswerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EscalationAnswerError";
	}
}
