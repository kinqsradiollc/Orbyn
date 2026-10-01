# ChatGPT default inference adapter checkpoint

The credential-owning desktop model runtime now provides a private
`completeDefault` adapter. It requires a ready catalog, an available saved
default and no pending preference save. It captures that model for the turn,
uses the fixed plan transport, rechecks live entitlement before inference and
rechecks the selected connection before returning completed text. Closing the
runtime aborts through its existing lifetime signal. Caller model overrides do
not replace the saved default; no managed-provider fallback is introduced.

The adapter is not an IPC command and is not exposed to the renderer. It returns
text only after connection validation; credentials remain in the main process.
Existing settings/default commands continue to use their metadata interface.

The actual runtime and transport suites passed 24/24 with controlled upstream
responses, including missing defaults, caller overrides, removed entitlement and
account switch/revocation during inference. Evidence:
`/tmp/orbyn-chatgpt-default-inference-tests.log`. No real ChatGPT account or
provider request was used. This is adapter evidence, not delivered composer or
executor-job inference. Job assignment, signed receipts, tool/approval authority,
composer connection selection and real eligible-account acceptance remain open.

The expanded runtime/transport checks passed 26/26, adding proof that a turn
keeps its captured model when the saved default is cleared mid-response and that
closing the runtime aborts inference before any output returns. Evidence:
`/tmp/orbyn-chatgpt-default-lifetime-tests.log`. These checks use controlled
upstream responses and do not replace real-account or composer acceptance.
