# package/language-docs

## Purpose
The Agent Script reference that ships with the package, the tour, and the runnable examples, kept checked so they can't drift from what the interpreter accepts.

## ADDED Requirements

### Requirement: Each topic has a shipped reference file
The package SHALL ship `docs/language/<topic>.md` for each of `overview`, `config`, `system`, `variables`, `subagents`, `prompts`, `interpolation`, `logic`, `outputs`, `actions`, `run` and `refused`. Each file's first line SHALL be a one-line summary, and each file SHALL contain at least one example block.

#### Scenario: Every topic is present
- **WHEN** the package is packed
- **THEN** the tarball holds the twelve topic files, and `specsesh language` shows each one's summary line

### Requirement: Examples and reference blocks pass check
Every `examples/**/*.agent` file, and every example block marked `agent` in `docs/language/*.md`, SHALL pass `specsesh check`.

#### Scenario: Examples check clean
- **WHEN** the docs test runs `specsesh check` over `examples/agents/*.agent`
- **THEN** it exits 0

#### Scenario: A broken doc example fails the build
- **WHEN** a test introduces a construct outside the subset into an example block of `logic.md`
- **THEN** the docs test fails, naming `logic.md` and the block's line

### Requirement: The tour builds one script step by step
`guides/00-language-tour.md` SHALL build one script in at least six steps: prompt, variables, structured output, logic, a `run` action, and model-callable actions. Each step SHALL show the whole script so far and the commands to check and run it.

#### Scenario: Each tour step checks
- **WHEN** the docs test extracts the script shown at each step of the tour
- **THEN** each one passes `specsesh check`
