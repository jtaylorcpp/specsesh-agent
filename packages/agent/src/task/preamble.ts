/**
 * The task preamble: the text the loop puts before every delegate's instructions,
 * so the agent that writes the code sees the change's contract itself, not only
 * the plan's paraphrase of it. Rendered from the loop's durable input (the texts
 * read at start), carried in each iteration's `RunInput.delegatePreamble`. Pure.
 */

import type { TaskLoopInput } from "./loop-input.js";

const OPENING =
	"You are working on one task of an OpenSpec change. The documents below are its contract; the instructions after them are this iteration's plan.";

const RULES = [
	"Rules:",
	"- Change only what the task needs.",
	"- Never tick boxes in tasks.md, and never edit the change's proposal, design or spec deltas.",
	"- If the spec itself looks wrong, say so in your reply instead of coding around it.",
].join("\n");

const trimEnd = (text: string): string => text.replace(/\n+$/, "");

/**
 * The opening line, the change (when named) and the task, the rules, then the
 * proposal, the design (when not empty) and the deltas in full, ending with
 * `# Instructions`. Blocks are separated by one blank line.
 */
export function taskPreamble(input: Pick<TaskLoopInput, "task" | "change" | "taskText" | "proposal" | "design" | "deltas">): string {
	const named = input.change !== undefined ? `Change: ${input.change}\n` : "";
	return [
		OPENING,
		`${named}Task ${input.task}: ${input.taskText}`,
		RULES,
		`# proposal.md\n\n${trimEnd(input.proposal)}`,
		...(input.design !== "" ? [`# design.md\n\n${trimEnd(input.design)}`] : []),
		`# Spec deltas\n\n${trimEnd(input.deltas)}`,
		"# Instructions",
	].join("\n\n");
}
