import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync } from "node:fs";
import { tickTask, untick } from "../../src/task/tick.js";
import { baselineCopy,baselineDir, cleanTemps, context, runLoop, temp, verdict } from "./helpers.js";

// Every file written, so a test can show the loop wrote none.
const writes = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	const writeFileSync = ((path: Parameters<typeof fs.writeFileSync>[0], ...rest: unknown[]) => {
		writes.paths.push(String(path));
		return (fs.writeFileSync as (...args: unknown[]) => unknown)(path, ...rest);
	}) as typeof fs.writeFileSync;
	return { ...fs, writeFileSync, default: { ...fs, writeFileSync } };
});

afterEach(cleanTemps);

describe("task/agent: A converged task is ticked only in a tasks.md given by path", () => {
	it("Scenario: Only task 2.4's line changes", async () => {
		const dir = baselineCopy();
		const tasks = join(dir, "tasks.md");
		const before = readFileSync(tasks, "utf8");
		expect(before).toContain("- [ ] 2.4 ");
		const r = await runLoop([verdict(true)], { change: { dir }, task: "2.4" });
		await r.harness.close(context);
		const after = readFileSync(tasks, "utf8");

		expect(r.outcome).toMatchObject({ status: "converged", result: { task: "2.4", ticked: true } });
		expect(after).toBe(before.replace("- [ ] 2.4 ", "- [x] 2.4 "));
		const changed = before.split("\n").filter((line, i) => line !== after.split("\n")[i]);
		expect(changed).toHaveLength(1);
		expect(changed[0]?.startsWith("- [ ] 2.4 ")).toBe(true);
		expect(after.length).toBe(before.length);
	});

	it("ticks a tasks.md given as a path source", async () => {
		const dir = baselineCopy();
		const r = await runLoop([verdict(true)], {
			change: { proposal: { path: join(dir, "proposal.md") }, deltas: [{ text: "d" }], tasks: { path: join(dir, "tasks.md") } },
			task: "2.4",
		});
		await r.harness.close(context);
		expect(r.outcome).toMatchObject({ result: { ticked: true } });
		expect(readFileSync(join(dir, "tasks.md"), "utf8")).toContain("- [x] 2.4 ");
	});
});

describe("task/agent: Ticking never writes in doubt and never unticks", () => {
	it("Scenario: Text input is never written", async () => {
		writes.paths.length = 0;
		const r = await runLoop([verdict(true)], {
			change: { proposal: { text: "p" }, deltas: [{ text: "d" }], tasks: { text: "- [ ] 1.1 do it\n" } },
		});
		await r.harness.close(context);
		expect(r.outcome).toMatchObject({ status: "converged", result: { task: "1.1", ticked: false } });
		expect(writes.paths).toEqual([]);
		expect(r.notes).toEqual([expect.stringContaining("given as text")]);
		// The recorder does see writes.
		writeFileSync(join(temp("task-w-"), "x"), "x");
		expect(writes.paths).toHaveLength(1);
	});

	it("Scenario: A file changed meanwhile is not written", async () => {
		const dir = baselineCopy();
		const tasks = join(dir, "tasks.md");
		let edited = "";
		const r = await runLoop(
			[
				// While the judge works, someone drops task 2.4's line.
				() => {
					edited = readFileSync(tasks, "utf8").replace(/^- \[ \] 2\.4 .*\n/m, "");
					writeFileSync(tasks, edited);
					return verdict(true);
				},
			],
			{ change: { dir }, task: "2.4" },
		);
		await r.harness.close(context);
		expect(edited).not.toContain("2.4 ");
		expect(readFileSync(tasks, "utf8")).toBe(edited);
		expect(r.outcome).toMatchObject({ status: "converged", result: { task: "2.4", ticked: false } });
		expect(r.notes).toEqual([expect.stringContaining("2.4")]);
		expect(r.notes[0]).toContain("no longer");
	});

	it("an already ticked line is not written, and nothing ever unticks", async () => {
		const dir = join(temp("task-change-"), "baseline");
		cpSync(baselineDir(), dir, { recursive: true });
		const tasks = join(dir, "tasks.md");
		const before = readFileSync(tasks, "utf8");
		expect(before).toContain("- [x] 2.4 ");

		const converged = await runLoop([verdict(true)], { change: { dir }, task: "2.4" });
		await converged.harness.close(context);
		expect(converged.outcome).toMatchObject({ result: { ticked: false } });
		expect(converged.notes).toEqual([expect.stringContaining("already ticked")]);

		for (const responses of [[verdict(false, "x", "retry")], [verdict(false, "x", "ask", "q")], [verdict(false, "x", "done")]]) {
			const r = await runLoop(responses, { change: { dir }, task: "2.4", budget: { maxIterations: 1 } });
			await r.harness.close(context);
			expect(r.outcome.status).not.toBe("converged");
		}
		expect(readFileSync(tasks, "utf8")).toBe(before);
	});

	it("the task loop still never unticks", async () => {
		const path = join(temp("tick-"), "tasks.md");
		const before = "## 2. Second\n\n- [x] 2.4 done already\n- [ ] 2.5 not yet\n";
		writeFileSync(path, before);
		writes.paths.length = 0;
		expect(tickTask(path, "2.4")).toEqual({ ticked: false, note: expect.stringContaining("already ticked") });
		expect(readFileSync(path, "utf8")).toBe(before);
		expect(writes.paths).toEqual([]);

		// The task loop's public entry offers no way to untick; only the group loop's rework does.
		const entry = await import("../../src/task/index.js");
		expect(Object.keys(entry).filter((name) => /untick/i.test(name))).toEqual([]);
	});
});

describe("task/agent: untick, for a group's rework only", () => {
	const TASKS = "## 1. First\n\n- [x] 1.1 a\n- [x] 1.2 b\n- [x] 1.10 c\n\n## 2. Second\n\n- [x] 2.1 d\n- [ ] 2.2 e\n";
	const fileWith = (text: string): string => {
		const path = join(temp("untick-"), "tasks.md");
		writeFileSync(path, text);
		return path;
	};

	it("flips only the one line", async () => {
		const path = fileWith(TASKS);
		expect(await untick(path, "1.1")).toEqual({ unticked: true });
		expect(readFileSync(path, "utf8")).toBe(TASKS.replace("- [x] 1.1 a", "- [ ] 1.1 a"));
	});

	it("does not touch 1.10 when asked for 1.1", async () => {
		const path = fileWith(TASKS);
		await untick(path, "1.1");
		expect(readFileSync(path, "utf8")).toContain("- [x] 1.10 c");
	});

	it("writes nothing for an already unticked line", async () => {
		const path = fileWith(TASKS);
		expect(await untick(path, "2.2")).toMatchObject({ unticked: false, note: expect.stringContaining("2.2") });
		expect(readFileSync(path, "utf8")).toBe(TASKS);
	});

	it("writes nothing for a missing id, naming it", async () => {
		const path = fileWith(TASKS);
		expect(await untick(path, "9.9")).toMatchObject({ unticked: false, note: expect.stringContaining("9.9") });
		expect(readFileSync(path, "utf8")).toBe(TASKS);
	});

	it("keeps CRLF line endings and a missing final newline", async () => {
		const crlf = TASKS.replace(/\n/g, "\r\n").trimEnd();
		const path = fileWith(crlf);
		expect(await untick(path, "2.1")).toEqual({ unticked: true });
		expect(readFileSync(path, "utf8")).toBe(crlf.replace("- [x] 2.1 d", "- [ ] 2.1 d"));
	});

	it("untick then tick gives back the original bytes", async () => {
		const path = fileWith(TASKS);
		await untick(path, "1.1");
		expect(tickTask(path, "1.1")).toEqual({ ticked: true });
		expect(readFileSync(path, "utf8")).toBe(TASKS);
	});

	it("no task loop source imports or calls untick", () => {
		const dir = join(import.meta.dirname, "../../src/task");
		for (const name of ["loop.ts", "loop-input.ts", "iteration.ts", "judge.ts", "start.ts", "answer.ts"]) {
			expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/\buntick(Line)?\b/);
		}
	});
});
