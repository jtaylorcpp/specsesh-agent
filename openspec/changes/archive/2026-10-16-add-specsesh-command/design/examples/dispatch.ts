// The whole bin of the `specsesh` package (slice 2), against this change's entry.
// The signal handlers mirror agentscript-task's and agentscript-change's entry guards,
// so an interrupt still releases a database lock.
import { main } from "@specsesh/agent/cli";

process.once("SIGINT", () => process.exit(130));
process.once("SIGTERM", () => process.exit(143));
main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error: unknown) => {
		process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
		process.exit(1);
	},
);

// In a test, in process:
//   const out: string[] = [];
//   const code = await main(["--version"], { out: (l) => out.push(l), err: () => {} });
//   // code === 0, out === ["specsesh 0.1.0"]
