// The task loop's delegation: the grant stored and required, which bundled script delegates,
// and what the delegate script shows its steps. A fake `claude` stands in for Claude Code.

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "@earendil-works/pi-durable";
import { analyze } from "../../src/authoring/index.js";
import { readActionDefinitions } from "../../src/interpreter/actions.js";
import { readSubagents } from "../../src/interpreter/compose.js";
import { claudeCodeRunner } from "../../src/node/index.js";
import { BUNDLED_SCRIPTS, startTaskLoop, taskPreamble, type TaskLoopInput } from "../../src/task/index.js";
import { gitRepo } from "./cli-helpers.js";
import { COUNT_CHECK, JUDGE_ONLY, PROPOSAL, cleanTemps, context, loopEnv, loopHarness, plan, prompts, runLoop, temp, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const DELEGATE_SCRIPT = fileURLToPath(BUNDLED_SCRIPTS.delegate);

/**
 * A fake `claude` that changes no file and prints an `is_error` false result. With
 * `FAKE_CLAUDE_OUT` set, it writes its cwd there.
 */
function idleClaude(): string {
	const binary = join(temp("task-claude-"), "claude");
	writeFileSync(
		binary,
		`#!${process.execPath}\nconst out = process.env.FAKE_CLAUDE_OUT;\nif (out) require("node:fs").writeFileSync(out, process.cwd());\nprocess.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "nothing" }));\n`,
		{ mode: 0o755 },
	);
	return binary;
}

/** The `claude_code` grant, its runner on a fake `claude` at `binary`, and one passing check so `run_checks` lets the run reach its judge. */
const granted = (binary: string) => ({
	overrides: { delegates: { claude_code: { runner: "claude-code" } }, checks: [COUNT_CHECK] },
	actions: { runners: { "claude-code": claudeCodeRunner({ binary }) } },
});

/** Every action target a script's subagents define. */
function targetsOf(source: string): string[] {
	const targets: string[] = [];
	for (const block of readSubagents(analyze(source).parsed).values()) {
		for (const definition of readActionDefinitions(block)) if (definition.target !== undefined) targets.push(definition.target);
	}
	return targets;
}

describe("task/agent: A harness binds the loop's actions to one workspace", () => {
	it("Scenario: The delegate configuration is stored with the loop", async () => {
		const delegates = { claude_code: { runner: "claude-code", model: "opus" } };
		const { env, workspace } = loopEnv({ delegates, runners: { "claude-code": claudeCodeRunner({ binary: idleClaude() }) } });
		const harness = await loopHarness(env, new MemoryStorage());
		const id = await startTaskLoop(
			harness,
			{
				change: { dir: tinyChange() },
				task: "1.1",
				script: { text: JUDGE_ONLY },
				workspace,
				model: env.model,
				delegates,
				worktree: { path: "/w", branch: "task/c/1.1" },
			},
			context,
		);
		const input = (await harness.getTask(id, context))?.input as unknown as TaskLoopInput;
		expect(input.delegates).toEqual(delegates);
		expect(input.worktree).toEqual({ path: "/w", branch: "task/c/1.1" });
		await harness.close(context);
	});

	it("Scenario: A delegating script without a grant is refused at start", async () => {
		const { env, workspace } = loopEnv();
		const storage = new MemoryStorage();
		const harness = await loopHarness(env, storage);
		const started = startTaskLoop(
			harness,
			{ change: { dir: tinyChange() }, task: "1.1", script: { path: DELEGATE_SCRIPT }, workspace, model: env.model },
			context,
		);
		const error = await started.then(
			() => undefined,
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(Error);
		const message = (error as Error).message;
		expect(message).toMatch(/delegate\/claude_code[\s\S]*no delegates are granted/);
		expect(message).not.toContain("delete_file");
		const page = await storage.scanTasks({ kind: "agentscript.task-loop" }, 10, undefined, context);
		expect(page.items).toHaveLength(0);
		await harness.close(context);
	});
});

describe("task/agent: The bundled scripts are the default and the subscription variant", () => {
	it("Scenario: Only the delegate script delegates", () => {
		const delegating = (path: URL) => targetsOf(readFileSync(path, "utf8")).filter((t) => t.startsWith("mcpTool://delegate/"));
		expect(delegating(BUNDLED_SCRIPTS.task)).toEqual([]);
		expect(new Set(delegating(BUNDLED_SCRIPTS.delegate))).toEqual(new Set(["mcpTool://delegate/claude_code"]));
	});
});

describe("task/agent: The delegate script shows the judge what changed and changes approach", () => {
	it("Scenario: The judge sees an idle delegate", async () => {
		const grant = granted(idleClaude());
		const r = await runLoop(
			[plan("change nothing"), verdict(false, "nothing changed")],
			{ script: { path: DELEGATE_SCRIPT }, workspace: gitRepo(), budget: { maxIterations: 1 }, ...grant.overrides },
			grant.actions,
		);
		await r.harness.close(context);

		expect(r.outcome.status).toBe("exhausted");
		const judge =prompts(r.env.requests).filter((p) => p.includes("Is the task done against the spec deltas?"));
		expect(judge).toHaveLength(1);
		expect(judge[0]).toContain("Files the delegate changed: 0");
	});

	it("Scenario: Orient asks for a different approach", async () => {
		const grant = granted(idleClaude());
		const r = await runLoop(
			[plan("first"), verdict(false, "still 1"), plan("second"), verdict(false, "still 1")],
			{ script: { path: DELEGATE_SCRIPT }, budget: { maxIterations: 2 }, ...grant.overrides },
			grant.actions,
		);
		await r.harness.close(context);

		expect(r.outcome.status).toBe("exhausted");
		const orients = prompts(r.env.requests).filter((p) => p.includes("Write a short, concrete plan for this iteration"));
		expect(orients).toHaveLength(2);
		expect(orients[0]).not.toContain("the last approach did not work");
		expect(orients[1]).toContain("This is iteration 2.");
		expect(orients[1]).toContain("the last approach did not work");
	});
});

describe("actions/delegation: A delegate acts only through its run's workspace", () => {
	it("Scenario: The delegate runs in the loop's worktree", async () => {
		const worktree = gitRepo();
		const out = join(temp("task-claude-out-"), "cwd.txt");
		const grant = granted(idleClaude());
		const saved = process.env["FAKE_CLAUDE_OUT"];
		process.env["FAKE_CLAUDE_OUT"] = out;
		try {
			const r = await runLoop(
				[plan("edit"), verdict(false, "not yet")],
				{
					script: { path: DELEGATE_SCRIPT },
					workspace: worktree,
					worktree: { path: worktree, branch: "task/c/1.1" },
					budget: { maxIterations: 1 },
					...grant.overrides,
				},
				grant.actions,
			);
			await r.harness.close(context);
		} finally {
			if (saved === undefined) delete process.env["FAKE_CLAUDE_OUT"];
			else process.env["FAKE_CLAUDE_OUT"] = saved;
		}
		expect(readFileSync(out, "utf8")).toBe(realpathSync(worktree));
	});
});

/** A fake `claude` that writes its stdin to `out` and changes no file. */
function recordingClaude(out: string): string {
	const binary = join(temp("task-claude-"), "claude");
	writeFileSync(
		binary,
		`#!${process.execPath}\nconst fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(out)}, fs.readFileSync(0, "utf8"));\nprocess.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "nothing" }));\n`,
		{ mode: 0o755 },
	);
	return binary;
}

describe("task/agent: The loop hands every delegate the task preamble", () => {
	it("Scenario: The bundled delegate script's delegate sees the contract", async () => {
		const out = join(temp("task-claude-out-"), "stdin.txt");
		const grant = granted(recordingClaude(out));
		const r = await runLoop(
			[plan("Edit src/value.txt"), verdict(false, "not yet")],
			{ script: { path: DELEGATE_SCRIPT }, workspace: gitRepo(), budget: { maxIterations: 1 }, ...grant.overrides },
			grant.actions,
		);
		const input = (await r.harness.getTask(r.id, context))?.input as unknown as TaskLoopInput;
		await r.harness.close(context);

		const preamble = taskPreamble(input);
		expect(preamble).toContain("Change: tiny\nTask 1.1: `src/value.txt` holds 2");
		expect(preamble).toContain(`# proposal.md\n\n${PROPOSAL.trimEnd()}`);
		const stdin = readFileSync(out, "utf8");
		expect(stdin.startsWith(`${preamble}\n\nEdit src/value.txt`)).toBe(true);
		expect(stdin).toContain("Your terms for this delegation");
	});
});
