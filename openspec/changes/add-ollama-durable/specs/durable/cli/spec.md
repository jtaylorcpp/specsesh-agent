## ADDED Requirements

### Requirement: ollama is registered when the run needs it
When the model a command needs is on `ollama` (the resolved model for `run`, the stored task's model for `resume`), the CLI SHALL call `registerOllama` on its collection, injected or not, before checking the model, so the run and its resume use the pulled model. Otherwise it MUST NOT contact the Ollama server.

#### Scenario: A durable run completes on a pulled ollama model
- **GIVEN** `OLLAMA_HOST` pointing at a fake Ollama server listing `qwen3:8b` that answers each step
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider ollama --model qwen3:8b`
- **THEN** the exit code SHALL be `0`, stdout SHALL contain `completed`, and every chat request SHALL have reached the fake server

#### Scenario: Other providers never contact Ollama
- **GIVEN** `OLLAMA_HOST` pointing at a fake Ollama server
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider anthropic --model claude-nope`
- **THEN** the exit code SHALL be `2` and the fake server SHALL have received no request

#### Scenario: A crashed ollama run finishes on resume
- **GIVEN** a SQLite file holding a run on `ollama/qwen3:8b` whose process exited with code 137 during its second step, and a fake Ollama server listing `qwen3:8b`
- **WHEN** the CLI runs `resume <id> --db <file>` with `OLLAMA_HOST` pointing at that server
- **THEN** the exit code SHALL be `0`, stdout SHALL contain `completed`, and the fake server SHALL have received no request for the first step

### Requirement: An unreachable ollama is named in the refusal
When the provider is `ollama` and `registerOllama` reported the server unreachable, the `no model "<model>" on provider "ollama"` refusal SHALL end with ` (Ollama at <url>: <reason>)`, still exiting `2` before a task exists.

#### Scenario: An unreachable ollama is named in the refusal
- **GIVEN** `OLLAMA_HOST` pointing at a port nothing listens on
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider ollama --model qwen3:8b`
- **THEN** stderr SHALL contain `no model "qwen3:8b" on provider "ollama" (Ollama at ` followed by that URL
- **AND** the exit code SHALL be `2` and no task SHALL exist in the database
