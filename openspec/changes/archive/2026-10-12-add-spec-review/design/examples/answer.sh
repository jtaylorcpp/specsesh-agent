# The review the loop printed:
#   blocked: Review proposal.md for the proposal stage of add-plan-export. Answer approve, or say what to change.
pnpm task answer 12 --by principal --decision "Drop the CSV export; JSON only."   # revise: a new draft
pnpm task answer 13 --by principal --decision approve                             # approve: approvals.json gains an entry
pnpm task spec add-plan-export design                                              # now allowed
