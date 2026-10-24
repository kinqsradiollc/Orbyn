# Worked example: an offline release draft with missing associations

Synthetic history, not actual REA release content or contributor attribution.

**Request:** Draft REA release notes offline. A real REA history export identifies
baseline `rea-agents-X.Y.Z` and a target commit. It contains a resource-cleanup fix,
a new inspection operation and a later revert of that operation. No GitHub account
mapping or release-automation configuration is supplied.

Verify that the supplied range is REA's history and account for the revert before
writing highlights. Describe the cleanup fix if its diff supports the behavior;
do not announce the reverted operation as shipping. Preserve author identities
in the local contribution inventory with account mapping explicitly unresolved.
Do not guess `@handles`, credit a merger instead or fetch external profiles offline.

A useful draft states its baseline/target, supported user outcome, relevant source
commit links and incomplete association coverage. Unknown future version metadata
must be labelled, not replaced with a made-up release number. Do not apply live
finalization labels, tag or publish from the draft.

**If only Orbyn's vendored REA files are supplied:** Explain that consumer Git
commits cannot establish the REA release range. Summarize observable file behavior
only as a partial source-based draft, and request/propose obtaining the actual
history within scope. A missing history is not an empty release.
