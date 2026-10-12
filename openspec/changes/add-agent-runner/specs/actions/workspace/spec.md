## ADDED Requirements

### Requirement: A workspace may list and search
`Workspace` SHALL allow two optional methods: `list(glob)`, resolving the workspace's file paths matching `glob` (relative, sorted), and `search(pattern, { glob?, limit? })`, resolving `{ path, line, text }` for each line matching the regular expression `pattern` in those files, at most `limit` (default `200`), in path then line order.

#### Scenario: A search finds lines in matching files
- **GIVEN** a workspace with `src/a.ts` holding `export const a = 1;` on line 3
- **WHEN** `search("const a", { glob: "src/**/*.ts" })` is called
- **THEN** it SHALL resolve `[{ path: "src/a.ts", line: 3, text: "export const a = 1;" }]`

### Requirement: localWorkspace lists and searches, honouring .gitignore in git
`localWorkspace` SHALL implement `list` and `search`. Inside a git repository the listed files SHALL be the tracked and untracked files git does not ignore; outside git, every file under the directory except `.git/`. Search SHALL read files as UTF-8 in JavaScript and skip files containing a NUL byte.

#### Scenario: An ignored file is not listed
- **GIVEN** a git workspace with `.gitignore` holding `dist/`, and files `src/a.ts` and `dist/a.js`
- **WHEN** `list("**/*")` is called
- **THEN** it SHALL include `src/a.ts` and SHALL NOT include `dist/a.js`

### Requirement: list_files and search_files are built-ins over list and search
`searchActions(workspace)` SHALL return `list_files` (`{ glob } → { paths }`, newline-joined) and `search_files` (`{ pattern, glob } → { matches }`, one `<path>:<line>: <text>` per line), kind `"read"`, replay `"safe"`, recording no `Action`. A workspace without `list` or `search` SHALL answer `{ ok: false }` with `this workspace cannot list files` or `cannot search files`.

#### Scenario: search_files formats matches
- **GIVEN** the workspace from "A search finds lines in matching files"
- **WHEN** `search_files` is called with `pattern` `"const a"` and `glob` `"src/**/*.ts"`
- **THEN** it SHALL answer `{ ok: true, outputs: { matches: "src/a.ts:3: export const a = 1;" } }`

#### Scenario: Search needs a searchable workspace
- **GIVEN** a workspace without `search`
- **WHEN** `search_files` is called
- **THEN** it SHALL answer `{ ok: false }` with `cannot search files`
