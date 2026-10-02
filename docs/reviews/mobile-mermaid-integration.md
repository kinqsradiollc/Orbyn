# Mobile Mermaid integration checkpoint

The model/Docs worktree now uses a bundled Mermaid renderer on mobile instead
of a flowchart-only implementation. Native uses a restricted WebView; mobile web
uses an opaque sandboxed iframe. The renderer blocks network access, strips
active/external SVG resources, bounds source and output, and fences stale render
responses. Source, zoom, SVG export and Orbyn object-link controls are provided.

The earlier planning worktree's source was integrated selectively. Its unrelated
ChatGPT files and documents were not copied. Mobile dependency declarations and
the lockfile include Mermaid, WebView and the bundle builder; the generated asset
is checked against the source, package manifests and lockfile digest.

## Verified locally

- Package build and `npm run build:diagrams --workspace mobile`: passed.
- Nine focused tests passed: bundle/source consistency, source bounds and
  configuration rejection, message fencing, renderer policy and external style
  rejection. Ten diagram fixtures pass source bounds; this is not evidence of
  ten rendered diagrams. Log: `/tmp/orbyn-mobile-mermaid-tests.log`.
- Workspace typecheck passed, including backend, desktop and mobile. Log:
  `/tmp/orbyn-mobile-mermaid-workspace-final-types.log`.
- `git diff --check`: passed.

The first typecheck failed because the temporary WebView package lacked React
peer type resolution. Local peer links corrected the validation environment;
no production type casts or suppressed diagnostics were added. Primary checkout
dependencies were not changed.

## Remaining release gates

The actual-engine syntax check is now reproducible with
`npm run check:diagrams --workspace mobile`. It uses a local DOM, the actual
Mermaid parser under strict policy, and shared fixtures in
`docs/fixtures/mermaid.json`. All ten families parsed successfully. Evidence:
`/tmp/orbyn-mermaid-parser-acceptance-final.log`. The rebuilt bundle, nine runtime
regressions and workspace typecheck also passed; logs are
`/tmp/orbyn-mermaid-parser-bundle.log`, `/tmp/orbyn-mermaid-parser-regressions.log`
and `/tmp/orbyn-mermaid-parser-types.log`. Initial plain-Node probes could not
initialize DOMPurify and are superseded by this DOM-backed parser check. This
does not render SVG or prove appearance, layout, export or browser permissions.

`npm run export --workspace mobile` completed for iOS and Android after the
parser checkpoint. Both generated Hermes bundles contain the
`orbyn-diagram-result` runtime marker. Evidence:
`/tmp/orbyn-mobile-mermaid-native-export.log` (exit 0). This proves the isolated
renderer is included in the native bundles; it does not prove native WebView
interaction, file sharing, navigation isolation or responsive layout.

Render all ten fixtures with the actual engine; verify web/mobile layout,
overflow, source editing, zoom, export and object links; exercise native WebView
navigation and malformed input; validate the frozen full suite and production
build. Browser Use still blocks the saved local preview permission. This
checkpoint remains local and is not a completed Docs parity or UI release.
