# package/explain

## Purpose
The `specsesh` commands that explain the package to a person or another agent: the bundled agents, the language, the built-in actions, checking a script without running it, and scaffolding a new one.

## ADDED Requirements

### Requirement: specsesh agents lists the bundled scripts
`specsesh agents` SHALL list every bundled agent script and delegate script with:
- its name
- its `config.description`
- the command that runs it
- the variables it reads and writes

`--json` SHALL print the same as a JSON array. The list SHALL be read from the shipped `.agent` files, not from a second copy.

#### Scenario: Every bundled script is listed
- **WHEN** `specsesh agents --json` runs
- **THEN** the names include `task`, `task-delegate`, `group`, `spec-proposal`, `spec-design`, `spec-specify`, `spec-plan` and `ci-test-pick`, each with a non-empty description and the command that runs it

#### Scenario: A new bundled script appears without code
- **WHEN** a test adds a `.agent` file with a `config.description` to the bundled scripts directory
- **THEN** `specsesh agents` lists it

### Requirement: specsesh agents show prints a script's source
`specsesh agents show <name>` SHALL print the named script's source exactly as shipped. An unknown name SHALL exit 2 and list the known names.

#### Scenario: Show the task agent
- **WHEN** `specsesh agents show task` runs
- **THEN** it prints the shipped `task.agent` byte for byte and exits 0

#### Scenario: Unknown agent
- **WHEN** `specsesh agents show nope` runs
- **THEN** it exits 2, and stderr names the known agents

### Requirement: specsesh language prints the reference by topic
`specsesh language` SHALL print the table of contents of the topics. `specsesh language <topic>` SHALL print that topic. `specsesh language subset` SHALL be generated from `SUPPORTED_SUBSET`. An unknown topic SHALL exit 2 and list the topics.

#### Scenario: Subset matches the interpreter
- **WHEN** `specsesh language subset --json` runs
- **THEN** its ids are exactly the ids of `SUPPORTED_SUBSET`, in order

#### Scenario: Topic list
- **WHEN** `specsesh language` runs
- **THEN** it lists `overview`, `config`, `system`, `variables`, `subagents`, `prompts`, `interpolation`, `logic`, `outputs`, `actions`, `run`, `refused` and `subset`, each with a one-line summary

### Requirement: specsesh actions lists the built-in actions
`specsesh actions` SHALL list each built-in action with:
- its name
- its description
- its input fields
- its output fields
- whether it writes to the workspace

#### Scenario: delete_file is a write
- **WHEN** `specsesh actions --json` runs
- **THEN** `delete_file` is listed with `writes: true`, and its input includes `path`

### Requirement: specsesh check validates scripts without running them
`specsesh check <file>…` SHALL parse each file and run the interpreter's pre-execution scan with no model. It SHALL print each problem as `file:line:col  message`, naming the subset construct where the problem is one. It SHALL exit 0 when every file would run, and 1 otherwise.

#### Scenario: Bundled scripts pass
- **WHEN** `specsesh check` runs over every shipped `.agent` file
- **THEN** it exits 0 and prints no problems

#### Scenario: Unsupported construct named
- **WHEN** a file uses a construct outside the subset
- **THEN** `specsesh check` exits 1, and the problem has that line and column and the construct's id

#### Scenario: Syntax error located
- **WHEN** a file has a variable declared without a type
- **THEN** `specsesh check` exits 1 with a diagnostic at that line

### Requirement: specsesh new agent scaffolds a script that checks
`specsesh new agent <name>` SHALL write `<name>.agent`, or the file named by `--out`, from the shipped template, with `config.agent_name` set to `<name>`. It SHALL refuse to overwrite an existing file. The file it writes SHALL pass `specsesh check`.

#### Scenario: Scaffold then check
- **WHEN** `specsesh new agent triage` runs in an empty directory, and then `specsesh check triage.agent` runs
- **THEN** `triage.agent` exists with `agent_name: "triage"`, and the check exits 0

#### Scenario: No overwrite
- **WHEN** `triage.agent` already exists and `specsesh new agent triage` runs
- **THEN** it exits 1 and leaves the file unchanged

### Requirement: The help names the explaining commands
`specsesh --help` SHALL list `agents`, `language`, `actions`, `check` and `new`. With no arguments, `specsesh check` and `specsesh new` SHALL print their own usage and exit 2.

#### Scenario: Help lists them
- **WHEN** `specsesh --help` runs
- **THEN** its output has a line for each of `specsesh agents`, `specsesh language`, `specsesh actions`, `specsesh check` and `specsesh new agent`

#### Scenario: check with no files
- **WHEN** `specsesh check` runs with no arguments
- **THEN** it exits 2 and prints `usage: specsesh check <file.agent>…`
