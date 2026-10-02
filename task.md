# Customizable Orbyn character

Worktree: `/Users/anhdang/.codex/worktrees/character/Orbyn`
Branch: `codex/character`, rebased onto `main` at `1a26644`.

## Scope and implementation

An original soft orbit spirit shared by web/Electron and React Native: rounded paws,
a sprout, glossy eyes, cheek highlights and themed shading. Name, communication
style, body, palette, eyes, ring, accessory and presence are editable in onboarding,
the assistant header and Settings → Connected agents. All selections persist per
account through `/me/agent`. Older clients and MCP name/persona edits preserve the
appearance. Migration 205 adds the JSON column with legacy defaults.

The shared SVG rig breathes, blinks, looks around while working, tilts while waiting,
celebrates briefly on completion and waves when the user taps the welcome character
or presses Say hello in the preview. Expressions follow actual assistant state.
Static, hidden, reduced motion, background and offscreen web views stop animation.
Motion uses a bounded 30fps requestAnimationFrame loop with cached artwork; native
screens animate only while mounted and the app is active. A real-device performance
check remains necessary.

The native bundle initially failed on the existing Yjs/lib0 crypto dependency. The
Metro resolver now maps only lib0's native random source to Expo Crypto. Web resolution
is unchanged. No third-party artwork, trackers or runtime animation service is used.

## Ownership and local environment

The other ADR worktrees were left untouched. On 2026-10-02 the user authorized
integration into local main; unrelated working changes must remain intact. No PR,
push or deployment has been performed. The preview uses disposable databases
`orbyn_character_test` and `orbyn_character_checks_test`, separate from the main DB.
API is on 8018, web on 5174, mobile web on 8083. Preview fixture: Character Preview,
with assistant named Nova. No AI provider is configured for that fixture; its error
expression was checked by making a failed chat request.

## Validation

- Full workspace typecheck passed; desktop production build passed.
- Focused character, H8 identity and agent trust tests: 23 passing.
- Refreshed native iOS/Android Expo exports passed with the revised rig.
- Web/mobile web verified appearance persistence, cross-client refresh, hidden/static
  presence, a real assistant error and reduced motion before the drawing revision.
- The revised art appears on both previews. Both paw waves were observed through
  SVG transforms; reduced motion returns both rigs to a still pose. Static preview
  disables waving. Mobile 390px and desktop 1280px layouts have no horizontal overflow.
- Native simulator/device interactions and packaged Electron launch are not verified.

## Main integration qualification — 2026-10-02

Rebased cleanly onto current main `1a26644`; migration 205 has no collision. The
last main commit only adds a Docs parity note; application code matches the
validated revision. Full
workspace typecheck, root production build, and refreshed iOS/Android exports pass.
Character, identity/MCP preservation, agent trust, mobile export compatibility and
reminder regressions: **57 tests passing**. An initial run lost its database
connection when the test container exited; it was restarted, only the two disposable
character databases were recreated and marked test, and the complete selection was
rerun successfully. The disposable preview fixture was restored.

Native interaction remains unverified: a booted iPhone 17 with Expo Go was available,
but repeated CUA Simulator selection timed out; one attempt exposed only the iOS
home screen. The follow-up browser control also timed out. Earlier web/mobile web
interaction evidence above remains valid because rebasing changed no character UI
code. Packaged Electron launch and real-device performance remain unverified.

## Handoff

The implementation is qualified for local main integration by the tests/builds and
previous preview checks above. These checks do not establish complete native release
qualification. Preserve the primary checkout's uncommitted mobile/app.json and all
untracked user files during integration. No push, PR, release, production migration
or deployment is part of this request. Before publishing native builds, complete
manual simulator/device and packaged Electron interactions.
