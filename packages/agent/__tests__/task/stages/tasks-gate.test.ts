import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StageContext } from "../../../src/task/spec-stage.js";
import type { Delta } from "../../../src/task/stages/openspec-cli.js";
import { tasksGate } from "../../../src/task/stages/tasks.js";
import { cleanTemps, fakeOpenspecBin, temp } from "../helpers.js";

afterEach(cleanTemps);

const CHANGE = "add-thing";
const SCENARIO = "A clean draft waits for review";

/** One ADDED delta of `spec/stages` with the given scenarios, as `openspec show` prints them. */
const deltas = (...scenarios: string[]): Delta[] => [
	{
		spec: "spec/stages",
		operation: "ADDED",
		requirement: { name: "Stages", text: "It SHALL.", scenarios: scenarios.map((name) => ({ name, rawText: "- **WHEN** x" })) },
	},
];

const taskLine = (id: string, text: string) => `- [ ] ${id} ${text}`;
const draft = (groups: { title: string; tasks: string[] }[]) =>
	groups.map((group, i) => `## ${i + 1}. ${group.title}\n\n${group.tasks.join("\n")}\n`).join("\n");

/** A `StageContext` whose workspace's openspec answers `show` with the given deltas; `run` is never used. */
function gateContext(tasksMd: string, shown: Delta[] = deltas(SCENARIO)): StageContext {
	const workspace = temp("tasks-gate-");
	fakeOpenspecBin(join(workspace, "node_modules", ".bin"), { show: { stdout: JSON.stringify({ deltas: shown }) } });
	return {
		changeId: CHANGE,
		workspace,
		changeDir: join(workspace, "openspec", "changes", CHANGE),
		files: { "tasks.md": tasksMd },
		run: async (argv) => ({ command: argv.join(" "), exitCode: 127, output: "unexpected command" }),
	};
}

const CLEAN = draft([{ title: "Tests", tasks: [taskLine("1.1", `\`src/a.ts\`: "${SCENARIO}"`)] }]);

describe.skipIf(process.platform === "win32")("tasksGate", () => {
	it("passes the baseline draft with no issue", async () => {
		expect(await tasksGate(gateContext(CLEAN))).toEqual([]);
	});

	it("Scenario: A ticked task is sent back", async () => {
		const issues = await tasksGate(gateContext(CLEAN.replace("- [ ] 1.1", "- [x] 1.1")));
		expect(issues).toEqual([{ level: "ERROR", path: "tasks.md", message: expect.stringContaining("task 1.1 is ticked") }]);
	});

	it("Scenario: A task naming two files is sent back", async () => {
		const tasksMd = draft([{ title: "Tests", tasks: [taskLine("1.1", `\`src/a.ts\` and \`src/b.ts\`: "${SCENARIO}"`)] }]);
		const issues = await tasksGate(gateContext(tasksMd));
		expect(issues).toEqual([{ level: "WARNING", path: "tasks.md#1.1", message: expect.stringMatching(/^2 files, over the budget of 1\./) }]);
		expect(issues[0]?.message).toContain("src/a.ts");
		expect(issues[0]?.message).toContain("src/b.ts");
	});

	it("Scenario: An unclaimed scenario is sent back", async () => {
		const tasksMd = draft([{ title: "Tests", tasks: [taskLine("1.1", `\`src/a.ts\`: ${SCENARIO}`)] }]);
		const issues = await tasksGate(gateContext(tasksMd));
		expect(issues).toEqual([{ level: "ERROR", path: "tasks.md", message: expect.stringContaining(`"${SCENARIO}"`) }]);
		expect(issues[0]?.message).toContain("spec/stages");
	});

	it("Scenario: Thirteen tasks are sent back", async () => {
		let n = 0;
		const group = (g: number, size: number) => ({
			title: `Group ${g}`,
			tasks: Array.from({ length: size }, (_, i) => {
				n++;
				return taskLine(`${g}.${i + 1}`, `\`src/f${n}.ts\`${n === 1 ? `: "${SCENARIO}"` : ""}`);
			}),
		});
		const tasksMd = draft([group(1, 4), group(2, 3), group(3, 3), group(4, 3)]);
		const issues = await tasksGate(gateContext(tasksMd));
		expect(issues).toEqual([{ level: "WARNING", path: "tasks.md", message: expect.stringMatching(/^13 tasks, over the budget of 12\./) }]);

		// Deltas over the capabilities, requirements and scenarios limits are not this gate's to report.
		const over: Delta[] = ["a/b", "c/d", "e/f"].flatMap((spec) =>
			Array.from({ length: 3 }, (_, r) => ({
				spec,
				operation: "ADDED" as const,
				requirement: { name: `${spec} ${r}`, text: "It SHALL.", scenarios: Array.from({ length: 6 }, (_, s) => ({ name: `${spec} ${r}.${s}`, rawText: "x" })) },
			})),
		);
		const warnings = (await tasksGate(gateContext(tasksMd, over))).filter((issue) => issue.level === "WARNING");
		expect(warnings).toEqual([{ level: "WARNING", path: "tasks.md", message: expect.stringMatching(/^13 tasks, over the budget of 12\./) }]);
	});
});
