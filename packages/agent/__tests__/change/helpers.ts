/**
 * Driving `agentscript-change` in process, on a faux model, in a temp workspace whose
 * config names the changes directory and the database.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FauxResponseStep } from "@earendil-works/pi-ai";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { main } from "../../src/bin/agentscript-change.js";
import { DRAFT_LOOP_TASK } from "../../src/task/draft-input.js";
import type { DraftLoopInput } from "../../src/task/draft-loop.js";
import type { SpecStage } from "../../src/task/spec-stage.js";
import { listLoops } from "../../src/task/status.js";
import { fauxModels } from "../task/cli-helpers.js";
import { context, temp } from "../task/helpers.js";

export const CHANGE = "add-plan-export";

/** A workspace with `agentscript.config.json`: changes under `openspec/changes`, the database at `loops.sqlite`. */
export function workspace() {
	const dir = temp("change-cli-");
	writeFileSync(join(dir, "agentscript.config.json"), JSON.stringify({ task: { changesDir: "openspec/changes", db: "loops.sqlite" } }));
	return { dir, changesDir: join(dir, "openspec", "changes"), changeDir: join(dir, "openspec", "changes", CHANGE), db: join(dir, "loops.sqlite") };
}

/** main() in process, on a faux model answering `responses` over `stages` (default `SPEC_STAGES`); it never reads stdin. */
export async function change(argv: string[], cwd: string, responses: FauxResponseStep[] = [], stages?: readonly SpecStage[]) {
	const { faux, models } = fauxModels();
	faux.setResponses(responses);
	const model = faux.getModel();
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(argv, {
		models: () => models,
		out: (line) => out.push(line),
		err: (line) => err.push(line),
		cwd,
		env: { AGENTSCRIPT_PROVIDER: model.provider, AGENTSCRIPT_MODEL: model.id, USER: "jesse" },
		...(stages !== undefined ? { stages } : {}),
	});
	return { code, out: out.join("\n"), err: err.join("\n"), calls: faux.state.callCount };
}

export async function loopsIn(db: string) {
	const storage = await openNodeSqliteStorage(db);
	try {
		return await listLoops(storage, context);
	} finally {
		await storage.close(context);
	}
}

/** Every draft loop run in the database, by ID, with its input. */
export async function draftLoopsIn(db: string) {
	const storage = await openNodeSqliteStorage(db);
	try {
		const page = await storage.scanTasks({ kind: DRAFT_LOOP_TASK }, 100, undefined, context);
		return page.items.map((record) => ({ id: Number(record.id), input: record.input as unknown as DraftLoopInput })).sort((a, b) => a.id - b.id);
	} finally {
		await storage.close(context);
	}
}
