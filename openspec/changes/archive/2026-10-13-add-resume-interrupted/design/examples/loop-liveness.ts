// Sketch of the check status and resume --all use to tell "running" from "interrupted".
// Not final code: it shows the data the CLI records and the rule it applies.
import { readFileSync } from "node:fs";
import { uptime } from "node:os";

/** Written by the CLI whenever a process starts or resumes a loop (table loop_owner). */
interface LoopOwner {
  pid: number;
  bootAt: number; // ms since epoch, rounded to the second
}

export const currentBootAt = (): number =>
  Math.round((Date.now() - uptime() * 1000) / 1000) * 1000;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

const lockHolder = (db: string): number | undefined => {
  try {
    const pid = Number(readFileSync(`${db}.lock`, "utf8").trim());
    return Number.isInteger(pid) && alive(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
};

/** Called only for loops whose stored state is running: no outcome, not blocked. */
export function isInterrupted(db: string, owner: LoopOwner | undefined): boolean {
  const holder = lockHolder(db);
  if (owner === undefined) return holder === undefined; // loop from before this change
  if (Math.abs(owner.bootAt - currentBootAt()) > 2000) return true; // rebooted since
  return holder !== owner.pid;
}

// resume --all, in outline:
//   const interrupted = runningLoops(db).filter((l) => isInterrupted(db, ownerOf(l.id)));
//   const roots = groupBy(interrupted, (l) => outermostRunningAncestor(l).id);
//   for (const root of sortBy(roots, (r) => [r.startedAt, r.id])) {
//     const outcome = await resumeLoop(root.id); // same path as `resume <loop-id>`
//     console.log(line(root, roots.get(root.id), outcome));
//   }
