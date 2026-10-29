## ADDED Requirements

### Requirement: google is registered and its key checked when a loop needs it
When the run's model, the stored loop's model on `resume` or `answer`, or an entry of the config's `models` is on `google`, the CLI SHALL call `registerGemini` on its collection before checking models. When it reports no key, the CLI MUST print `google: GEMINI_API_KEY is not set` and exit `2`, before a loop exists or a resume starts.

#### Scenario: A task loop converges on Gemini
- **GIVEN** a repo config with `"provider": "google"`, `"model": "gemini-3.5-flash"`, `"script": "task"` and one passing check, `GEMINI_API_KEY=test`, and `GEMINI_BASE_URL` pointing at a fake Gemini server that answers the bundled `task` script's steps
- **WHEN** `run <change> 1.1` starts a loop
- **THEN** the loop SHALL end `converged`, exit `0`, and every model request SHALL have reached the fake server

#### Scenario: A loop on google without a key is refused
- **GIVEN** a repo config with `"provider": "google"`, `"model": "gemini-3.5-flash"` and no `GEMINI_API_KEY`
- **WHEN** `run` is called
- **THEN** stderr SHALL contain `google: GEMINI_API_KEY is not set`, the exit code SHALL be `2`, and no loop SHALL exist

#### Scenario: A named model on google needs the key too
- **GIVEN** a repo config whose `models` maps `gem` to `{ "provider": "google", "model": "gemini-3.5-flash" }`, run on another provider, with no `GEMINI_API_KEY`
- **WHEN** `run` is called
- **THEN** stderr SHALL contain `google: GEMINI_API_KEY is not set` and the exit code SHALL be `2`

#### Scenario: A crashed Gemini loop resumes on its model
- **GIVEN** a task loop on `google/gemini-3.5-flash` whose process exited with code 137 mid-iteration, and a fake Gemini server
- **WHEN** the CLI runs `resume <id> --db loops.sqlite` with `GEMINI_API_KEY=test` and `GEMINI_BASE_URL` pointing at that server
- **THEN** the loop SHALL finish on `google/gemini-3.5-flash` and print its outcome
