#!/usr/bin/env node
// packages/specsesh/bin/specsesh.js: the whole bin.
import { main } from "@specsesh/agent/cli";

// As agentscript-task and agentscript-change do: an interrupt still releases the database lock.
process.once("SIGINT", () => process.exit(130));
process.once("SIGTERM", () => process.exit(143));

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error) => {
		process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
		process.exit(1);
	},
);
