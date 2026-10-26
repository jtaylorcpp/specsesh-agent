## ADDED Requirements

### Requirement: ollama is registered when a loop needs it
When the run's model, the stored loop's model on `resume` or `answer`, or an entry of the config's `models` is on `ollama`, the CLI SHALL call `registerOllama` on its collection before checking models, so loops, named models and resumes use the pulled models. Otherwise it MUST NOT contact the Ollama server.

#### Scenario: A task loop converges on a pulled ollama model
- **GIVEN** a repo config with `"provider": "ollama"`, `"model": "qwen3:8b"`, `"script": "task"` and one passing check, and `OLLAMA_HOST` pointing at a fake Ollama server listing `qwen3:8b` that answers the bundled `task` script's steps
- **WHEN** `run <change> 1.1` starts a loop
- **THEN** the loop SHALL end `converged`, exit `0`, and every model request SHALL have reached the fake server

#### Scenario: A named model on ollama reaches the harness
- **GIVEN** a repo config whose `models` maps `local` to `{ "provider": "ollama", "model": "qwen3:8b" }`, run on another provider, with a fake Ollama server listing `qwen3:8b`
- **WHEN** `run` starts a loop
- **THEN** the harness SHALL get a `local` model on provider `ollama` with id `qwen3:8b`

#### Scenario: Other providers never contact Ollama
- **GIVEN** a repo config with no `ollama` provider or model, and `OLLAMA_HOST` pointing at a fake Ollama server
- **WHEN** `run` is called with `--model claude-nope`
- **THEN** the fake server SHALL have received no request

#### Scenario: A crashed ollama loop resumes on its model
- **GIVEN** a task loop on `ollama/qwen3:8b` whose process exited with code 137 mid-iteration, and a fake Ollama server listing `qwen3:8b`
- **WHEN** the CLI runs `resume <id> --db loops.sqlite` with `OLLAMA_HOST` pointing at that server
- **THEN** the loop SHALL finish on `ollama/qwen3:8b` and print its outcome

### Requirement: An unreachable ollama is named in a loop's refusal
When the provider is `ollama` and `registerOllama` reported the server unreachable, the `no model "<model>" on provider "ollama"` refusal SHALL end with ` (Ollama at <url>: <reason>)`, still exiting `2` before a task exists.

#### Scenario: An unreachable ollama is named in the refusal
- **GIVEN** a repo config with `"provider": "ollama"`, `"model": "qwen3:8b"` and `OLLAMA_HOST` pointing at a port nothing listens on
- **WHEN** `run` is called
- **THEN** stderr SHALL contain `no model "qwen3:8b" on provider "ollama" (Ollama at `, the exit code SHALL be `2`, and no task SHALL exist
