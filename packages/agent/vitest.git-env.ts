/**
 * Every test file's git sees no global or system config (#49), so a developer's own
 * `user.name`, `commit.gpgsign` or `init.defaultBranch` can't change a result: the task
 * CLI names a principal from `git config user.name` before `$USER`. Commits get an identity
 * from the environment instead, which `git config user.name` doesn't read. A test that
 * needs a config writes its own and points GIT_CONFIG_GLOBAL at it.
 */
process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
process.env["GIT_CONFIG_NOSYSTEM"] = "1";
for (const role of ["AUTHOR", "COMMITTER"]) {
	process.env[`GIT_${role}_NAME`] = "Test";
	process.env[`GIT_${role}_EMAIL`] = "test@example.invalid";
}
