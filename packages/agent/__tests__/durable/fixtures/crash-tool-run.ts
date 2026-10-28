/**
 * Runs the durable bin's `main` on ECHO_THEN_RESPOND with `--tools <module>` and dies mid-run.
 *
 * Subagent `act` runs `@actions.echo` with no model. When `respond` makes its model request,
 * the process exits with code 137 on the spot — no close, no flush. The bin's stderr (the
 * task ID and resume hint) is copied to stdout first.
 *
 *   node --import ./ts-resolve.mjs crash-tool-run.ts <db-path> <tools-module>
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { main } from "../../../src/bin/agentscript-durable.js";
import { counting, ECHO_THEN_RESPOND, setup } from "../helpers.js";

const [dbPath, tools] = process.argv.slice(2);
if (dbPath === undefined || tools === undefined) throw new Error("usage: crash-tool-run.ts <db-path> <tools-module>");

const script = join(dirname(dbPath), "echo-then-respond.agent");
writeFileSync(script, ECHO_THEN_RESPOND);

const env = setup();
const crashing = counting(env.models, (count) => {
	if (count === 1) {
		process.stdout.write("CRASH\n");
		process.exit(137);
	}
});

const argv = ["run", script, "--db", dbPath, "--provider", env.model.provider, "--model", env.model.modelId];
await main([...argv, "--entry", "act", "--entry", "respond", "--tools", tools], {
	models: () => crashing,
	out: (line) => process.stdout.write(`${line}\n`),
	err: (line) => process.stdout.write(`${line}\n`),
});
// Unreachable: the first model request ends the process.
process.exit(1);
