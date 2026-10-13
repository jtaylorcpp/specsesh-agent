import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import * as task from "../../src/task/index.js";
import { openHarness, setup } from "../durable/helpers.js";
import { cleanTemps, context } from "./helpers.js";
import { draft, proposalStage, specWorkspace } from "./spec-helpers.js";

afterEach(cleanTemps);

describe("spec loop entry points", () => {
	it("the task entry exports startSpecLoop, waitForSpecLoop and specLoopExtensions", () => {
		expect(typeof task.startSpecLoop).toBe("function");
		expect(typeof task.waitForSpecLoop).toBe("function");
		expect(typeof task.specLoopExtensions).toBe("function");
		expect(task.owns({ owns: ["design.md", "design/"] }, "design/examples/a.ts")).toBe(true);
	});

	it("the task entry exports proposalStage, owning proposal.md and slices.md, following no stage, on the bundled spec-proposal.agent", () => {
		expect(task.proposalStage.name).toBe("proposal");
		expect(task.proposalStage.owns).toEqual(["proposal.md", "slices.md"]);
		expect(task.proposalStage.after ?? []).toEqual([]);
		expect("path" in task.proposalStage.script && task.proposalStage.script.path).toMatch(/spec-proposal\.agent$/);
	});

	it("the task entry exports SPEC_STAGES, starting at the proposal, each stage after only earlier ones", () => {
		expect(task.SPEC_STAGES).toEqual([task.proposalStage]);
		expect(Object.isFrozen(task.SPEC_STAGES)).toBe(true);
		task.SPEC_STAGES.forEach((stage, index) => {
			const earlier = task.SPEC_STAGES.slice(0, index).map((s) => s.name);
			for (const name of stage.after ?? []) expect(earlier).toContain(name);
		});
	});

	it("a loop started with startSpecLoop over specLoopExtensions reaches review", async () => {
		const { workspace, changeDir } = specWorkspace();
		const stage = proposalStage();
		const env = setup();
		for (const extension of task.specLoopExtensions({ workspace })) env.registry.install(extension);
		env.faux.setResponses([draft("=== proposal.md\n## Why\n\nBecause.\n")]);
		const harness = await openHarness(new MemoryStorage(), env);
		try {
			const id = await task.startSpecLoop(harness, { change: "add-thing", stage, intent: "Make the thing", workspace, model: env.model }, context);
			harness.resume();
			const outcome = await task.waitForSpecLoop(harness, id, context);

			expect(outcome).toMatchObject({
				status: "blocked",
				escalation: { level: "change", to: "principal", reason: "review" },
				result: { change: "add-thing", stage: "proposal", files: ["proposal.md"], approved: false },
			});
			expect(outcome.status === "blocked" ? outcome.escalation.question : "").toContain("proposal.md");
			expect(readFileSync(join(changeDir, "proposal.md"), "utf8")).toBe("## Why\n\nBecause.\n");
		} finally {
			await harness.close(context);
		}
	});
});
