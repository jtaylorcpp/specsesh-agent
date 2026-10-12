pnpm task draft add-plan-export --intent "Export a plan as JSON so CI can read it"
pnpm task answer 12 --by principal --decision "JSON only; no CSV"   # revise the proposal
pnpm task answer 13 --by principal --decision approve              # approve it; the design drafts
pnpm task answer 14 --by principal --decision approve              # approve the design; specs draft
pnpm task answer 15 --by principal --decision approve              # approve the specs; tasks draft
pnpm task answer 16 --by principal --decision approve              # approve the tasks; converged
pnpm task status            # … 17  add-plan-export  draft tasks  converged
pnpm task spec add-plan-export design   # rerun one stage after a hand edit
