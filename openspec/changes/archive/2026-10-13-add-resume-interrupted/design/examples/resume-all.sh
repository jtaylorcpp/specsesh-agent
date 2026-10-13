#!/usr/bin/env sh
# After a reboot or a killed session: see what was interrupted, then resume it all.
# Every command reads the database from the repo config's "db" unless --db is given.

# 1. Interrupted loops show as `interrupted`; blocked and ended loops are unchanged.
pnpm task status

# 2. Resume every interrupted loop, in the order the loops started, each through
#    its outermost parent. One outcome line per loop on stdout; progress as JSON Lines on stderr.
pnpm task resume --all 2>progress.jsonl
echo "exit: $?"   # 0 when all converged (or a spec loop stopped for review), 1 otherwise

# 3. A worktree-mode run keeps its own database, so resume it by naming that database.
pnpm task resume --all --db task-2.4.sqlite

# 4. A single loop still resumes exactly as it does today.
pnpm task resume 13 --json
