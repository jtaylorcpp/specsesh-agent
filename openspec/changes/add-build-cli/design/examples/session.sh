# Draft, then build: an idea to working code in two commands, plus answers.
pnpm task draft add-plan-export --intent "Export a plan as JSON so CI can read it"
pnpm task answer 12 --by principal --decision approve      # … once per stage
pnpm task build add-plan-export --change-check "pnpm spec:check" --change-check "pnpm docs:check"
pnpm task answer 21 --by principal --decision "Use the v2 API"   # a group asked
pnpm task status            # loop 22  add-plan-export  build 3  converged
git diff                    # read what the agents changed
pnpm spec:archive add-plan-export
