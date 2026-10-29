## ADDED Requirements

### Requirement: google is registered and its key checked when the run needs it
When the model a command needs is on `google` (the resolved model for `run`, the stored task's model for `resume`), the CLI SHALL call `registerGemini` on its collection, injected or not, before checking the model. When it reports no key, the CLI MUST print `google: GEMINI_API_KEY is not set` and exit `2`, before a task exists or a resume starts.

#### Scenario: A durable run completes on Gemini
- **GIVEN** `GEMINI_API_KEY=test` and `GEMINI_BASE_URL` pointing at a fake Gemini server that answers each step
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider google --model gemini-3.5-flash`
- **THEN** the exit code SHALL be `0`, stdout SHALL contain `completed`, and every request SHALL have reached the fake server

#### Scenario: A durable run on google without a key creates no task
- **GIVEN** no `GEMINI_API_KEY`
- **WHEN** the CLI runs `run hello.agent --db runs.sqlite --provider google --model gemini-3.5-flash`
- **THEN** stderr SHALL contain `google: GEMINI_API_KEY is not set`, the exit code SHALL be `2`, and no task SHALL exist in the database

#### Scenario: A crashed Gemini run finishes on resume
- **GIVEN** a SQLite file holding a run on `google/gemini-3.5-flash` whose process exited with code 137 during its second step, and a fake Gemini server
- **WHEN** the CLI runs `resume <id> --db <file>` with `GEMINI_API_KEY=test` and `GEMINI_BASE_URL` pointing at that server
- **THEN** the exit code SHALL be `0`, stdout SHALL contain `completed`, and the fake server SHALL have received no request for the first step
