# The change flow, once add-change-draft, -approve, -build and -close are in.
pnpm change draft add-plan-export --intent "Export a plan as JSON so CI can read it"
pnpm change draft add-plan-export "JSON only; no CSV"     # revise the proposal
pnpm change approve add-plan-export                       # the design drafts
pnpm change draft add-plan-export                         # show what's waiting
pnpm change approve add-plan-export                       # the specs draft
pnpm change approve add-plan-export                       # the tasks draft
pnpm change approve add-plan-export                       # drafted
pnpm change build add-plan-export                         # every group, each with its agents
pnpm change build add-plan-export "Use the v2 API"        # answer an agent's question
git diff                                                  # read what the agents changed
pnpm change close add-plan-export                         # fold the deltas into the specs
