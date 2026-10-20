// `loop-ended.changed` and the seeded `changed` as the CLI runs them: measured from the loop's
// baseline across resume and answer, per task in a group, and never listing the database.

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_CLAUDE_CONFIG, cli, events, fakeClaudeWriting, fauxModels, gitRepo, spawnBin, storedLoops } from "./cli-helpers.js";
import { cleanTemps, temp, verdict, writer } from "./helpers.js";

afterEach(() => cleanTemps());

const lines = (stderr: string) => stderr.trimEnd().split("\n");

const repoWithConfig = () => gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });

/**
 * A fake `claude` whose delegate writes `src/a.ts` on its first call and `src/b.ts` on every
 * later one, sleeping `$FAKE_CLAUDE_LATER_MS` before a later write. Its judge answers the next
 * of `verdicts` (`retry`, `ask` or `met`), then `met`.
 */
function claudeWritingTwo(verdicts: readonly string[]): string {
	const bin = temp("task-fake-bin-");
	writeFileSync(join(bin, "verdicts.json"), JSON.stringify(verdicts));
	const path = join(bin, "claude");
	writeFileSync(
		path,
		`#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
try { fs.readFileSync(0, "utf8"); } catch {}
const schemaAt = argv.indexOf("--json-schema");
const write = (out) => process.stdout.write(JSON.stringify(out));
if (schemaAt >= 0) {
	const schema = JSON.parse(argv[schemaAt + 1]);
	let structured;
	if (!("next_action" in (schema.properties || {}))) structured = { plan: "write the file" };
	else {
		const file = path.join(__dirname, "verdicts.json");
		const queue = JSON.parse(fs.readFileSync(file, "utf8"));
		const next = queue.shift() || "met";
		fs.writeFileSync(file, JSON.stringify(queue));
		structured =
			next === "met" ? { met: true, unmet: "", next_action: "retry", question: "", amend_path: "", amend_text: "" }
			: next === "ask" ? { met: false, unmet: "two ways", next_action: "ask", question: "Which way?", amend_path: "", amend_text: "" }
			: { met: false, unmet: "not yet", next_action: "retry", question: "", amend_path: "", amend_text: "" };
	}
	write({ type: "result", is_error: false, result: "", structured_output: structured });
} else {
	const marker = path.join(__dirname, "wrote-a");
	if (!fs.existsSync(marker)) {
		fs.writeFileSync(path.join(process.cwd(), "src", "a.ts"), "export const a = 2;\\n");
		fs.writeFileSync(marker, "");
		write({ type: "result", is_error: false, result: "Wrote src/a.ts." });
	} else {
		setTimeout(() => {
			fs.writeFileSync(path.join(process.cwd(), "src", "b.ts"), "export const b = 1;\\n");
			write({ type: "result", is_error: false, result: "Wrote src/b.ts." });
		}, Number(process.env.FAKE_CLAUDE_LATER_MS || 0));
	}
}
`,
	);
	chmodSync(path, 0o755);
	return bin;
}

const loopEnded = (stderr: string) => events(lines(stderr)).filter((e) => e["event"] === "loop-ended");

describe("task/headless: The CLI leaves its database out of changed", () => {
	it("Scenario: A database in the repository is not seeded as changed", async () => {
		const repo = gitRepo();
		const script = join(temp("task-script-"), "writer.agent");
		writeFileSync(script, writer([["src/a.ts"]]));
		const db = join(repo, "runs.sqlite");
		const env = fauxModels();
		env.faux.setResponses([verdict(false, "not yet"), verdict(true)]);
		const r = await cli(["run", join(repo, "openspec", "changes", "tiny"), "1.1", "--db", db, "--script", script, ...env.args], env, { cwd: repo });
		expect(r.code, r.err).toBe(0);
		const { inputs, runs } = await storedLoops(db);
		expect(inputs[0]?.excludeChanged).toEqual(expect.arrayContaining(["runs.sqlite", "runs.sqlite-wal", "runs.sqlite.lock"]));
		const changed = runs.map((t) => (t.input as { options: { variables: Record<string, unknown> } }).options.variables["changed"]);
		expect(changed).toEqual(["", "src/a.ts"]);
	});
});

describe("task/headless: loop-ended lists the files the loop changed", () => {
	it("Scenario: A resumed loop lists edits made before the crash", async () => {
		const repo = repoWithConfig();
		const bin = claudeWritingTwo(["retry", "met"]);
		const killed = await spawnBin(["run", "tiny", "1.1"], {
			cwd: repo,
			bin,
			env: { FAKE_CLAUDE_LATER_MS: "3000" },
			onStderr: (text, kill) => {
				if (/"event":"iteration-started"[^\n]*"iteration":2/.test(text)) kill();
			},
		});
		expect(killed.code, killed.stderr).toBe(-1);
		const id = /^loop (\d+)/.exec(killed.stderr)?.[1];
		expect(id).toBeDefined();

		const resumed = await spawnBin(["resume", String(id)], { cwd: repo, bin });
		expect(resumed.code, resumed.stderr).toBe(0);
		expect(loopEnded(resumed.stderr).at(-1)).toMatchObject({ status: "converged", changed: ["src/a.ts", "src/b.ts"] });
	}, 60_000);

	it("Scenario: An answered run lists the blocked run's edits", async () => {
		const repo = repoWithConfig();
		const bin = claudeWritingTwo(["ask", "met"]);
		const blocked = await spawnBin(["run", "tiny", "1.1"], { cwd: repo, bin });
		expect(blocked.code, blocked.stderr).toBe(1);
		expect(loopEnded(blocked.stderr).at(-1)).toMatchObject({ status: "blocked", changed: ["src/a.ts"] });
		const id = /^loop (\d+)/.exec(blocked.stderr)?.[1];

		const answered = await spawnBin(["answer", String(id), "--by", "principal", "--decision", "the first way"], { cwd: repo, bin });
		expect(answered.code, answered.stderr).toBe(0);
		expect(loopEnded(answered.stderr).at(-1)).toMatchObject({ status: "converged", changed: ["src/a.ts", "src/b.ts"] });
	}, 60_000);

	it("Scenario: A group's task lists only its own files", async () => {
		const repo = repoWithConfig();
		const r = await spawnBin(["run", "tiny", "1"], { cwd: repo, bin: fakeClaudeWriting(["src/a.ts", "src/b.ts"]) });
		expect(r.code, r.stderr).toBe(0);
		const ended = loopEnded(r.stderr);
		expect(ended).toHaveLength(2);
		expect(ended[0]).toMatchObject({ status: "converged", changed: ["src/a.ts"] });
		expect(ended[1]).toMatchObject({ status: "converged", changed: ["src/b.ts"] });
	}, 60_000);
});
