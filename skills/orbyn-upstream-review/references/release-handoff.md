# One shared candidate and a complete release handoff

Before editing shared skills, inspect the public `main`, relevant open PR heads
and bases, consumer lock and owned local diffs. Name the canonical authoring
candidate and one writer for shared skill files. Reuse that owned candidate for
related corrections; do not create another parallel copy or PR for each follow-up.
Company-only material stays in the consumer namespace. A clean checkout does not
mean it contains pending work from another branch.

If work genuinely needs a stack, record dependency order and exact revisions.
The child starts from its actual parent candidate, and its PR targets that
parent until the parent is merged. Do not review the child as an isolated diff
against old `main`, describe an unmerged candidate as released, or resolve drift
by overwriting either checkout. Compare changes against the lock's baseline;
preserve and reconcile both owners' edits when the same managed file changed.

For an authorized release, the owning agent completes this handoff:

1. Verify the public candidate and checks, merge prerequisites in dependency
   order, then retarget/reconcile the next PR against the actual merged parent.
   Recheck the resulting diff and current head; a squash merge changes commit
   identity. Never force-rebase someone else's branch to hide the discrepancy.
2. Verify the intended public change is on `main` and its CI terminal result.
   Use the actual merged full SHA and manifest for the consumer update, even
   when an earlier review pin used an unmerged candidate.
3. Have the consumer owner reconcile its local managed edits, import the exact
   revision, regenerate discovery and check source/hash/context integrity. Keep
   unrelated application work, local output and company configuration preserved.
4. Complete the authorized consumer PR/merge and checks at its actual final
   revision. Reconcile any downstream CI or product-document PR without losing
   its owned delta. Report each repo's `main`, lock and remaining open work.

Merge authority remains a user/project decision. When it is absent, leave a
concrete checked candidate and state that `main` is behind the open PR; do not
claim synchronization or silently switch new users to an unreleased branch.
For offline work, report cached refs and unverified remote freshness. Installing
links from a local working tree exposes that tree's current files; it does not
freeze a release or make its contents equal to public `main`.
