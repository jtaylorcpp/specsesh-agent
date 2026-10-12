// Drafting a change from a host: one loop, four reviews.
import { answerDraftLoop, draftLoopExtensions, startDraftLoop, waitForDraftLoop } from "@specsesh/agent/task";

const options = { change: "add-plan-export", workspace: process.cwd(), intent: "Export a plan as JSON so CI can read it" };
for (const extension of draftLoopExtensions(options)) harness.install(extension);

let id = await startDraftLoop(harness, options, context);
let outcome = await waitForDraftLoop(harness, id, context);

while (outcome.status === "blocked") {
	// outcome.escalation.reason is "review" or "question"; its question names the files to read.
	const decision = await askThePrincipal(outcome.escalation.question); // "approve", or what to change
	id = await answerDraftLoop(harness, id, { by: "principal", principal: "jesse", decision }, context);
	outcome = await waitForDraftLoop(harness, id, context);
}

// converged: { change: "add-plan-export", stages: [
//   { stage: "proposal", approved: true, runs: 2 },
//   { stage: "design",   approved: true, runs: 1 },
//   { stage: "specs",    approved: true, runs: 1 },
//   { stage: "tasks",    approved: true, runs: 1 } ] }
console.log(outcome);
