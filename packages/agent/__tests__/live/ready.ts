/**
 * Whether the live run can use `claude` here: installed, and logged in as far as
 * `claude auth status` says. Never reads Claude Code's credentials or token.
 * AGENTSCRIPT_LIVE_FORCE=1 skips the login question, for a claude without
 * `auth status`.
 */

import { spawnSync } from "node:child_process";

export function claudeReady(): { ok: true } | { ok: false; reason: string } {
	const version = spawnSync("claude", ["--version"], { encoding: "utf8" });
	if (version.error !== undefined) return { ok: false, reason: `claude is not on PATH (${version.error.message})` };
	if (process.env.AGENTSCRIPT_LIVE_FORCE === "1") return { ok: true };
	const auth = spawnSync("claude", ["auth", "status"], { encoding: "utf8", timeout: 30_000 });
	if (auth.status === 0) return { ok: true };
	const said = `${auth.stdout ?? ""}${auth.stderr ?? ""}`.trim().split("\n")[0] ?? "";
	return {
		ok: false,
		reason: `claude is not logged in: \`claude auth status\` exited ${auth.status ?? "by signal"}${said !== "" ? ` (${said})` : ""}. Log in with \`claude\`, or set AGENTSCRIPT_LIVE_FORCE=1 if your claude has no \`auth status\``,
	};
}

