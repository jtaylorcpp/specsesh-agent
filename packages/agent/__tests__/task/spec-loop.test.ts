import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Models } from "@earendil-works/pi-ai";
import { Harness, MemoryStorage, defineExtension } from "@earendil-works/pi-durable";
import { TaskLoopStartError, startSpecLoop } from "../../src/task/index.js";
import { SPEC_LOOP, specLoopTask } from "../../src/task/spec-loop.js";
import { setup } from "../durable/helpers.js";
import { cleanTemps, context, prompts } from "./helpers.js";
import { STAGE_SCRIPT, draft, proposalStage, runSpecLoop, specHarness, specWorkspace, startBare, waitForOutcome } from "./spec-helpers.js";

afterEach(cleanTemps);

/** Starts the proposal stage over `script` through `startSpecLoop`: the refusal, and the tasks left behind. */
async function refusedStart(script: string) {
	const { workspace } = specWorkspace();
	const stage = { ...proposalStage(), script: { text: script } };
	const { harness, storage } = await specHarness([stage]);
	try {
		const error = await startSpecLoop(harness, { change: "add-thing", stage, intent: "Make the thing", workspace }, context).then(
			() => undefined,
			(e: unknown) => e,
		);
		const tasks = [
			...(await storage.scanTasks({ kind: SPEC_LOOP }, 100, undefined, context)).items,
			...(await storage.scanTasks({ kind: "agentscript.run" }, 100, undefined, context)).items,
		];
		return { error, tasks };
	} finally {
		await harness.close(context);
	}
}

describe("spec/loop: The stage script keeps the stage contract", () => {
	it("Scenario: A script without files is refused", async () => {
		const r = await refusedStart(STAGE_SCRIPT.replace('    files: mutable string = ""\n', "").replace("            set @variables.files = @outputs.files\n", ""));

		expect(r.error).toBeInstanceOf(TaskLoopStartError);
		expect((r.error as Error).message).toContain("files is not declared; declare it as string");
		expect(r.tasks).toEqual([]);
	});

	it("Scenario: A next_action default outside the choices is refused", async () => {
		const r = await refusedStart(STAGE_SCRIPT.replace('next_action: mutable string = "review"', 'next_action: mutable string = "retry"'));

		expect(r.error).toBeInstanceOf(TaskLoopStartError);
		expect((r.error as Error).message).toContain('@variables.next_action defaults to "retry", which is not one of "review", "ask"');
		expect(r.tasks).toEqual([]);
	});
});

/** The same Models, whose every streamed request calls `onRequest` and then never answers: the process died mid-request. */
function stalled(models: Models, onRequest: () => void): Models {
	return new Proxy(models, {
		get(target, prop, receiver) {
			if (prop === "streamSimple" || prop === "stream") {
				return () => {
					onRequest();
					const never = () => new Promise<never>(() => {});
					return { [Symbol.asyncIterator]: () => ({ next: never }), result: never };
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

describe("spec/loop: The spec loop is one durable task with four phases", () => {
	it("Scenario: A crash during await starts no second run", async () => {
		const { workspace, changeDir } = specWorkspace();
		const stage = proposalStage();
		const storage = new MemoryStorage();

		// The first process reaches iteration 1's model request, and dies there: never closed, never answered.
		const first = setup();
		const task = specLoopTask((name) => (name === stage.name ? stage : undefined));
		first.registry.install(defineExtension({ name: SPEC_LOOP, tasks: [task] }));
		let died = () => {};
		const requested = new Promise<void>((resolve) => (died = resolve));
		const dead = await Harness.open(storage, { models: stalled(first.models, () => died()), registry: first.registry }, context);
		const id = await startBare(dead, task, { workspace, stage: { name: stage.name, owns: stage.owns }, model: first.model });
		dead.resume();
		await requested;

		const stranded = await storage.task(id, context);
		const checkpoint = (stranded?.state as { checkpoint?: { phase: string; child: number } }).checkpoint;
		const before = (await storage.scanTasks({ kind: "agentscript.run" }, 100, undefined, context)).items;

		// A fresh process on the same storage resumes the loop.
		const { env, harness } = await specHarness([stage], storage);
		env.faux.setResponses([draft("=== proposal.md\n## Why\n\nDrafted.\n")]);
		harness.resume();
		try {
			const outcome = await waitForOutcome(harness, id);
			const after = (await storage.scanTasks({ kind: "agentscript.run" }, 100, undefined, context)).items;

			expect(checkpoint?.phase).toBe("await");
			expect(before.map((t) => t.id)).toEqual([checkpoint?.child]);
			// The same child finished the iteration; no other run was created.
			expect(after.map((t) => t.id)).toEqual([checkpoint?.child]);
			expect(after[0]?.state.status).toBe("terminal");
			expect(outcome.status).toBe("blocked");
			expect(outcome.escalation).toMatchObject({ to: "principal", reason: "review" });
			expect(outcome.iterations).toHaveLength(1);
			expect(readFileSync(join(changeDir, "proposal.md"), "utf8")).toBe("## Why\n\nDrafted.\n");
		} finally {
			await harness.close(context);
		}
	});

	it("Scenario: The current files are re-read each iteration", async () => {
		let round = 0;
		// The principal edits the draft between iteration 1's gate and iteration 2.
		const stage = proposalStage(({ changeDir }) => {
			if (++round > 1) return [];
			writeFileSync(join(changeDir, "proposal.md"), "## Why\n\nEDITED BY HAND\n");
			return [{ level: "WARNING", path: "proposal.md", message: "too short" }];
		});
		const r = await runSpecLoop(stage, [draft("=== proposal.md\n## Why\n\nFirst.\n"), draft("=== proposal.md\n## Why\n\nSecond.\n")]);

		const variables = r.runs.map((run) => (run.input as { options: { variables: Record<string, unknown> } }).options.variables);
		expect(variables[0]?.["current"]).toBe("");
		expect(variables[1]?.["current"]).toBe("=== proposal.md\n## Why\n\nEDITED BY HAND\n");
		expect(prompts(r.env.requests)[1]).toContain("EDITED BY HAND");
		expect(readFileSync(join(r.changeDir, "proposal.md"), "utf8")).toBe("## Why\n\nSecond.\n");
		expect(r.outcome.status).toBe("blocked");
	});
});
