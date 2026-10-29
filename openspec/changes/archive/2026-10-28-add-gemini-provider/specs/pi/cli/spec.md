## ADDED Requirements

### Requirement: google's key is checked before a run
With provider `google`, `run` SHALL first call `registerGemini`. When it reports no key, the CLI MUST print `google: GEMINI_API_KEY is not set` to stderr and exit `1`, before any model request. `models google` SHALL list pi's catalog without checking the key.

#### Scenario: A run on google without a key is refused
- **GIVEN** no `GEMINI_API_KEY`
- **WHEN** the CLI runs `run <script> --provider google --model gemini-3.5-flash`
- **THEN** stderr SHALL be `google: GEMINI_API_KEY is not set`, the exit code SHALL be `1`, and no request SHALL be made

#### Scenario: A script runs on Gemini
- **GIVEN** `GEMINI_API_KEY=test` and `GEMINI_BASE_URL` pointing at a fake Gemini server that answers each step
- **WHEN** the CLI runs `run <script> --provider google --model gemini-3.5-flash`
- **THEN** the exit code SHALL be `0`, stdout SHALL start with `# google/gemini-3.5-flash — completed`, and every request SHALL have reached the fake server

#### Scenario: google's models list without a key
- **GIVEN** no `GEMINI_API_KEY`
- **WHEN** the CLI runs `models google`
- **THEN** stdout SHALL include a line starting `gemini-3.5-flash\t`, and the exit code SHALL be `0`
