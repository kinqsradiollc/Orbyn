# Separate documented rationale from plausible explanation

Anchor the question in the changed symbol or behavior, then use bounded path history and blame to locate introducing and corrective commits. Read the relevant diff and surrounding source; line attribution alone does not establish intent.

Follow linked design records or issue discussions only to answer the current question. Record direct rationale, contrary evidence and inference separately. A later comment can describe current policy without proving why the original implementation was chosen.

For a lease replacing a local lock, source can establish cross-process expiry behavior. A linked design note may establish crash-recovery motivation. If that note is absent, report the mechanism as confirmed and the motivation as inferred, with the searched history boundary.

Return the supported explanation, source anchors and constraints a proposed change must preserve. An empty bounded search means no rationale was found in that scope; it does not prove no rationale exists. Do not create issues or message authors merely to complete a historical explanation.
