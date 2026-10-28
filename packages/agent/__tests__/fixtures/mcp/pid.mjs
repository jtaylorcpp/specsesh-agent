// Preloaded with `node --import` before server.mjs: writes this process's pid to
// $PID_FILE, so a test can check that closing the client ended the process.
import { writeFileSync } from "node:fs";

if (process.env.PID_FILE) writeFileSync(process.env.PID_FILE, String(process.pid));
