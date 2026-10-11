import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default function setup(): void {
	execFileSync("pnpm", ["build"], { cwd: dirname(fileURLToPath(import.meta.url)), stdio: "inherit" });
}
