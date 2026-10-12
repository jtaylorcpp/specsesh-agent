pnpm task spec add-plan-export --intent "Export a plan as JSON so CI can read it"
pnpm task answer 12 --by principal --decision "JSON only; no CSV"
pnpm task answer 13 --by principal --decision approve
pnpm task status            # … 13  add-plan-export  spec proposal  converged  2
pnpm task spec add-plan-export          # the next stage
