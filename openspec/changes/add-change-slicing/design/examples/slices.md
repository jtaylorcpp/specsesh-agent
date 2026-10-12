1. `add-plan-export`: Export a plan as JSON with `specplan export --json`.
2. `add-plan-export-schema`: Publish the JSON Schema of the export. Follows add-plan-export.
3. `add-plan-export-ci`: A GitHub Action that fails a PR whose plan export is invalid. Follows add-plan-export-schema.
