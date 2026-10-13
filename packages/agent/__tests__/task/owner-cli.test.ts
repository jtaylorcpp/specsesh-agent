import { chmodSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it } from "vitest";
import { readOwner, writeOwner, type LoopOwner } from "../../src/task/owner.js";
import { FAKE_CLAUDE_CONFIG, cli, fauxModels, gitRepo, spawnBin, workdir } from "./cli-helpers.js";
import { cleanTemps, temp, tinyChange, verdict } from "./helpers.js";

afterEach(() => cleanTemps());

const PASSING = "node --version";
const OLD: LoopOwner = { pid: 100, bootAt: 1_000_000_000_000 };
const ask = verdict(false, "two ways", "ask", "Which way?");

/** The id in the first stderr line, `loop <id> — resume with: …`. */
const idOf = (errLines: readonly string[]) => Number(/^loop (\d+) — resume with: /.exec(errLines[0] ?? "")?.[1]);

async function owners(db: string): Promise<Map<number, LoopOwner>> {
	const sql = await openNodeSqliteDatabase(db);
	try {
		const rows = await sql.all<{ loop_id: number | bigint; pid: number | bigint; boot_at: number | bigint }>("SELECT * FROM loop_owner");
		return new Map(rows.map((r) => [Number(r.loop_id), { pid: Number(r.pid), bootAt: Number(r.boot_at) }]));
	} finally {
		await sql.close();
	}
}

async function seed(db: string, ids: readonly number[]): Promise<void> {
	const sql = await openNodeSqliteDatabase(db);
	for (const id of ids) await writeOwner(sql, id, OLD.pid, OLD.bootAt);
	await sql.close();
}

/** A faux step that waits until `loop_owner` has `count` rows, then answers `reply`. */
const afterOwners = (db: string, count: number, seen: Map<number, LoopOwner>[], reply = verdict(true)) => async () => {
	for (let tries = 0; tries < 400; tries++) {
		const rows = await owners(db).catch(() => new Map<number, LoopOwner>());
		if (rows.size >= count) {
			seen.push(rows);
			return reply;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`loop_owner never reached ${count} rows`);
};

function expectThisProcess(owner: LoopOwner | undefined, pid = process.pid): void {
	expect(owner?.pid).toBe(pid);
	expect((owner?.bootAt ?? 1) % 1000).toBe(0);
	expect(Math.abs((owner?.bootAt ?? 0) - (Date.now() - uptime() * 1000))).toBeLessThanOrEqual(1000);
}

describe("task/headless: each loop records its owner", () => {
	it("run records the owner of a task loop before its first step", async () => {
		const { dir, script, db } = workdir();
		const env = fauxModels();
		const seen: Map<number, LoopOwner>[] = [];
		env.faux.setResponses([afterOwners(db, 1, seen)]);
		const r = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, "--workspace", dir, ...env.args], env);
		expect(r.code, r.err).toBe(0);
		const id = idOf(r.errLines);
		// Already there while the first step ran.
		expectThisProcess(seen[0]?.get(id));
		expect((await owners(db)).get(id)).toEqual(seen[0]?.get(id));
	});

	it("a group run gives every task loop it starts the group loop's owner", async () => {
		const { dir, script, db } = workdir();
		const env = fauxModels();
		const seen: Map<number, LoopOwner>[] = [];
		// Each task's step waits until its own task loop is owned: the group, then 1.1, then 1.2.
		env.faux.setResponses([afterOwners(db, 2, seen), afterOwners(db, 3, seen)]);
		const r = await cli(["run", tinyChange(), "1", "--db", db, "--script", script, "--workspace", dir, "--check", PASSING, ...env.args], env);
		expect(r.code, r.err).toBe(0);
		const group = idOf(r.errLines);
		const rows = await owners(db);
		expect(rows.size).toBe(3);
		expectThisProcess(rows.get(group));
		for (const owner of rows.values()) expect(owner).toEqual(rows.get(group));
	});

	it("answer owns the loop it starts, and leaves the blocked one alone", async () => {
		const { dir, script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([ask]);
		const b = await cli(["run", tinyChange(), "1.1", "--db", db, "--script", script, "--workspace", dir, ...env.args], env);
		expect(b.code).toBe(1);
		const blocked = idOf(b.errLines);
		await seed(db, [blocked]);

		const seen: Map<number, LoopOwner>[] = [];
		env.faux.setResponses([afterOwners(db, 2, seen)]);
		const r = await cli(["answer", String(blocked), "--db", db, "--by", "principal", "--decision", "The first way"], env);
		expect(r.code, r.err).toBe(0);
		const next = idOf(r.errLines);
		expect(next).not.toBe(blocked);
		expectThisProcess(seen[0]?.get(next));
		expect((await owners(db)).get(blocked)).toEqual(OLD);
	});

	it("answer to a group owns the new group loop and the task loops it reruns", async () => {
		const { dir, script, db } = workdir();
		const env = fauxModels();
		env.faux.setResponses([afterOwners(db, 2, [], ask)]);
		const b = await cli(["run", tinyChange(), "1", "--db", db, "--script", script, "--workspace", dir, "--check", PASSING, ...env.args], env);
		expect(b.code).toBe(1);
		const before = await owners(db);
		expect(before.size).toBe(2);
		await seed(db, [...before.keys()]);

		const seen: Map<number, LoopOwner>[] = [];
		// The new group loop, then 1.1's second run, then 1.2.
		env.faux.setResponses([afterOwners(db, 4, seen), afterOwners(db, 5, seen)]);
		const r = await cli(["answer", String(idOf(b.errLines)), "--db", db, "--by", "principal", "--decision", "The first way"], env);
		expect(r.code, r.err).toBe(0);
		const next = idOf(r.errLines);
		const rows = await owners(db);
		expectThisProcess(rows.get(next));
		for (const [id, owner] of rows) expect(owner).toEqual(before.has(id) ? OLD : rows.get(next));
	});
});

/** The killing fake of group-cli.test.ts, in short: converge every task, SIGKILL the CLI on 1.2's first orient. */
function killingClaude(): string {
	const bin = temp("owner-kill-bin-");
	const path = join(bin, "claude");
	writeFileSync(
		path,
		`#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
let stdin = "";
try { stdin = fs.readFileSync(0, "utf8"); } catch {}
const text = stdin + "\\n" + argv.join("\\n");
const schemaAt = argv.indexOf("--json-schema");
let out;
if (schemaAt >= 0) {
	const schema = JSON.parse(argv[schemaAt + 1]);
	const task = /Task (\\d+\\.\\d+)/.exec(text)?.[1];
	if (!("next_action" in (schema.properties || {}))) {
		const marker = path.join(__dirname, "killed");
		if (task === "1.2" && !fs.existsSync(marker)) {
			fs.writeFileSync(marker, "");
			process.kill(process.ppid, "SIGKILL");
			process.exit(137);
		}
		out = { type: "result", is_error: false, result: "", structured_output: { plan: "plan for " + task } };
	} else {
		out = { type: "result", is_error: false, result: "", structured_output: { met: true, unmet: "", next_action: "retry", question: "", amend_path: "", amend_text: "" } };
	}
} else {
	const task = /plan for (\\d+\\.\\d+)/.exec(text)?.[1];
	fs.writeFileSync(path.join(process.cwd(), "done-" + task + ".txt"), "done\\n");
	out = { type: "result", is_error: false, result: "Wrote done-" + task + ".txt" };
}
process.stdout.write(JSON.stringify(out));
`,
	);
	chmodSync(path, 0o755);
	return bin;
}

describe("task/headless: resume takes over the owner of the loops it carries on", () => {
	it("resume owns the group loop and its unfinished task loop, not the finished one", async () => {
		const repo = gitRepo({ "agentscript.config.json": FAKE_CLAUDE_CONFIG });
		const db = join(temp("owner-kill-db-"), "loops.sqlite");
		const bin = killingClaude();

		const killed = await spawnBin(["run", "tiny", "1", "--db", db], { cwd: repo, bin });
		expect(killed.code).not.toBe(0);
		const group = Number(/^loop (\d+) — resume with: /.exec(killed.stderr)?.[1]);
		const status = (await cli(["status", "--db", db])).out.split("\n");
		const idFor = (task: string) => Number(/^loop (\d+)/.exec(status.find((l) => l.includes(`  ${task}  `)) ?? "")?.[1]);
		const done = idFor("1.1");
		const live = idFor("1.2");
		expect([group, done, live].every(Number.isInteger), status.join("\n")).toBe(true);
		await seed(db, [group, done, live]);

		const resumed = await spawnBin(["resume", String(group), "--db", db], { cwd: repo, bin });
		expect(resumed.code, resumed.stderr).toBe(0);
		const sql = await openNodeSqliteDatabase(db);
		try {
			expectThisProcess(await readOwner(sql, group), resumed.pid);
			expect(await readOwner(sql, live)).toEqual(await readOwner(sql, group));
			expect(await readOwner(sql, done)).toEqual(OLD);
		} finally {
			await sql.close();
		}
	});
});
