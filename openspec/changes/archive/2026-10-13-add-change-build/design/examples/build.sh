pnpm change build add-plan-export                                   # start, or show what's waiting
pnpm change build add-plan-export --change-check "pnpm spec:check"  # a broader final check
pnpm change build add-plan-export "Use the v2 API"                  # answer the agent that asked
pnpm change build add-plan-export --allow-dirty                     # build over uncommitted edits
