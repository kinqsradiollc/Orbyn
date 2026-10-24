# Asynchronous UI state and recovery

Use when changing fetch/search/save flows, optimistic updates, subscriptions or
screen lifetime. Read the actual framework/lifecycle and shared domain contract.
Keep loading, domain progress and presentation state distinct; a view should not
invent its own durable operation lifecycle.

## Own each request and result

Identify the inputs, identity/scope, operation key or request generation, and
cleanup owner. A result may update the view only while it belongs to the current
request and resource. Cancel supported work on replacement/disposal, and reject
stale results independently when the underlying effect cannot be cancelled.
Cancellation does not roll back an already committed server write.

Example: search A starts, search B starts, B resolves, then A resolves. The visible
result must remain B. An abort request alone is insufficient if A's operation
ignores cancellation or completed before the signal; compare the current request
identity before applying its result.

Account changes and permission revocation also change ownership. Clear or fence
cached results according to the actual cache owner; a URL or component name alone
is not a tenant-safe cache key. Current server-side authority remains required.

## Preserve the person's work

For a failed save, retain the draft and original identity/version. Distinguish
local edit, pending submission, known committed result and unknown outcome. A
retry must reuse or reconcile the operation contract rather than duplicate an
external action. An optimistic update needs a defined conflict/rebase/rollback
owner and must not overwrite a newer confirmed update with an old snapshot.

Keep long-lived subscriptions and event listeners attached to the appropriate
lifecycle. Define reconnect ordering, duplicate handling and cleanup where relevant.
Avoid a second local domain-status store that continually synchronizes with the
canonical result. Platform focus, selection and expansion state can remain local.

When authorized, check the relevant out-of-order response, account/scope change,
failed-save recovery and disposal path at the actual renderer width. Inspect
keyboard/accessibility state for changed interactions. A screenshot or unit stub
alone does not establish the complete recovery flow or installed-native behavior.

Return state ownership, sequence/failure behavior, implemented recovery and actual
evidence. Use the backend owner for committed effects and the local language
guides for JS promises, Kotlin coroutines, Swift actors or other actual runtimes.

Reviewed 24 October 2026 against [AbortController's supported cancellation contract](https://developer.mozilla.org/en-US/docs/Web/API/AbortController).
The stale-result method and examples are independently authored and framework-neutral.
