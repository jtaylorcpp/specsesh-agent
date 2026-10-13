// A stage defined inline, as the tests in this change do.
import { startSpecLoop, waitForSpecLoop, specLoopExtensions, type SpecStage } from "@specsesh/agent/task";

const notesStage: SpecStage = {
	name: "notes",
	owns: ["notes.md"],
	script: { path: "notes.agent" },
	gate: ({ files }) =>
		files["notes.md"]?.includes("## Why")
			? []
			: [{ level: "ERROR", path: "notes.md", message: "needs a ## Why section" }],
};

harness.install(...specLoopExtensions({ workspace: process.cwd() }));
const id = await startSpecLoop(harness, { change: "add-notes", stage: notesStage, intent: "Keep notes", workspace: process.cwd() }, context);
console.log(await waitForSpecLoop(harness, id, context));
