# Challenge a claim with a concrete counterexample

Freeze the candidate, intended behavior and review scope. Read its diff together with the callers and state/effect owners needed to evaluate the claim. Choose risks from the changed contract rather than a generic list of preferences.

For each suspected defect write initial state, actor, action/interleaving, observed or source-derived result and violated contract. Check whether a downstream guard or caller already prevents it. A rejected hypothesis is useful evidence; omit it from actionable findings after recording why it was dismissed.

A finding needs a current source location, practical impact, confidence and correction direction. Keep missing runtime evidence separate from a proven code defect. Rank lost data, authority and recovery consequences above style. Avoid prescribing a new abstraction unless the existing boundary cannot preserve the invariant.

Return findings first, then checked assumptions and unverified scope. A review-only assignment edits no code. If a fix is authorized later, recheck the exact changed candidate rather than carrying the previous verdict forward automatically.
