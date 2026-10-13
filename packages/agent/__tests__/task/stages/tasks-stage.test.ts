import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../../src/authoring/index.js";
import { readDeclarations } from "../../../src/interpreter/compose.js";
import { localWorkspace } from "../../../src/node/index.js";
import { SPEC_STAGES, tasksStage } from "../../../src/task/index.js";
import { stageContractProblems, type StageContext } from "../../../src/task/spec-stage.js";
import { cleanTemps, temp } from "../helpers.js";

afterEach(cleanTemps);

/** A `run` in `dir` through the local workspace, as the loop gives a stage. */
function localRun(dir: string): StageContext["run"] {
	const workspace = localWorkspace(dir);
	return async (argv) => {
		const ran = await workspace.exec!(argv, { timeoutMs: 30_000 });
		if (ran.kind !== "exited") throw new Error(`${argv.join(" ")}: ${ran.kind}`);
		return { command: argv.join(" "), exitCode: ran.code, output: ran.stdout + ran.stderr };
	};
}

/** A git repo tracking `count` files, `f/0000.txt` and on. */
function gitRepo(count: number): string {
	const dir = temp("tasks-stage-");
	mkdirSync(join(dir, "f"));
	for (let i = 0; i < count; i++) writeFileSync(join(dir, "f", `${String(i).padStart(4, "0")}.txt`), `${i}\n`);
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["add", "-A"], { cwd: dir });
	return dir;
}

const planSource = (): string => readFileSync((tasksStage.script as { path: string }).path, "utf8");

describe("tasksStage scenarios", () => {
	it("Scenario: The tasks stage is seeded with the repository's files", async () => {
		expect(tasksStage.name).toBe("tasks");
		expect(tasksStage.owns).toEqual(["tasks.md"]);
		expect(tasksStage.after).toEqual(["specs"]);

		const workspace = gitRepo(3005);
		const changeDir = join(workspace, "openspec", "changes", "add-thing");
		const base = (await tasksStage.seed?.({ changeId: "add-thing", workspace, changeDir, files: {}, run: localRun(workspace) }))?.base ?? "";
		const lines = base.split("\n");
		expect(lines).toHaveLength(3001);
		expect(lines.slice(0, 3000)).toEqual(Array.from({ length: 3000 }, (_, i) => `f/${String(i).padStart(4, "0")}.txt`));
		expect(lines[3000]).toMatch(/\b5\b/);
		expect(lines[3000]).toMatch(/cut/i);
	});

	it("Scenario: The bundled plan script fits the contract", () => {
		expect("path" in tasksStage.script && tasksStage.script.path).toMatch(/spec-plan\.agent$/);
		const source = planSource();
		const analysis = analyze(source);
		// No error (LSP severity 1).
		expect(analysis.diagnostics.filter((diagnostic) => diagnostic.severity === 1)).toEqual([]);
		expect(stageContractProblems(source)).toEqual([]);
		expect(readDeclarations(analysis.parsed).get("next_action")?.initial).toBe("review");

		expect(source.match(/^subagent /gm)).toHaveLength(1);
		for (const name of ["files", "summary", "next_action", "question"]) {
			expect(source).toContain(`set @variables.${name} = @outputs.${name}`);
		}
	});

	it("Scenario: The design follows the proposal", () => {
		expect(SPEC_STAGES.map((stage) => stage.name)).toEqual(["proposal", "design", "specs", "tasks"]);
		expect(SPEC_STAGES[3]).toBe(tasksStage);
	});
});
