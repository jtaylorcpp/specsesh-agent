// `pnpm task <change-id> <task-id>`: the built agentscript-task bin, with `run`
// implied when the first argument is not one of its commands, so
// `pnpm task spec <change>`, `pnpm task status` and `pnpm task resume <loop>`
// still reach theirs.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../packages/agent/dist/bin/agentscript-task.js", import.meta.url));
if (!existsSync(bin)) {
	console.error("agentscript-task is not built yet: run `pnpm build` first");
	process.exit(2);
}
const COMMANDS = new Set(["run", "spec", "resume", "answer", "status"]);
const args = process.argv.slice(2);
const argv = args.length > 0 && !COMMANDS.has(args[0]) && !args[0].startsWith("-") ? ["run", ...args] : args;
const ran = spawnSync(process.execPath, [bin, ...argv], { stdio: "inherit" });
process.exit(ran.status ?? 1);
