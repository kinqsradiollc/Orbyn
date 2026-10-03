# Client error presentation — 3 October 2026

Development previews previously appended method/path/status/request IDs to every
error automatically. The actual native sign-in screenshot showed this diagnostic
suffix after the plain password error. Web/Electron and mobile now show the same
plain messages as production by default. VITE_DEBUG_ERRORS=true and
EXPO_PUBLIC_DEBUG_ERRORS=true still explicitly enable details; logError continues
to preserve diagnostics/context in the console. Production default behavior,
server refusals, HTTP status, retry hints and authentication are unchanged.

Four runtime-helper unit checks pass in /tmp/orbyn-client-error-presentation-retry.log:
both clients/development-production/false-unset flags, explicit true diagnostics,
context logging and network guidance. All workspace types8287 and production
build93498 terminated0. Owned formatting73763 terminated0. Initial transform
failed because this checkout's esbuild install is for another platform; the test
and build used the existing macOS binary. No package/lock/source workaround.

This is text presentation, not full authentication/layout/U1 acceptance. No
current rendered screenshot claim; web visuals remain user-owned and native
Sign in consent remains pending. Preserved desktop settings preview files are
unrelated, untracked and excluded. Fresh committed-head full/CI remain required.
