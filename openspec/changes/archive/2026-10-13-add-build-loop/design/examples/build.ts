// Building a change from a host: every group, each with its own task loops and judge.
import { answerChangeEscalation, changeLoopExtensions, startChangeLoop, waitForChangeLoop } from "@specsesh/agent/task";

const options = {
	change: "add-plan-export",
	workspace: process.cwd(),
	checks: ["pnpm test"],
	changeChecks: ["pnpm test", "pnpm spec:check", "pnpm docs:check"],
	budget: { maxIterations: 6, maxReworks: 2 },
};
for (const extension of changeLoopExtensions(options)) harness.install(extension);

// Refused before anything exists when the change is invalid, a scenario is unclaimed,
// or an approved file changed since its stage was approved.
let id = await startChangeLoop(harness, options, context);
let outcome = await waitForChangeLoop(harness, id, context);

while (outcome.status === "blocked") {
	// level "change": a task or a group judge needs a decision.
	const decision = await askThePrincipal(outcome.escalation.question);
	id = await answerChangeEscalation(harness, id, { by: outcome.escalation.to, decision }, context);
	outcome = await waitForChangeLoop(harness, id, context);
}

// converged: { groups: [
//   { group: 1, runs: 1, outcome: { status: "converged", … } },   // 4 tasks, 0 reworks
//   { group: 2, runs: 2, outcome: { status: "converged", … } },   // blocked once, answered
//   { group: 3, runs: 1, outcome: { status: "converged", … } } ], unclaimed: [] }
console.log(outcome.status, outcome.result?.groups.map((g) => g.group));
