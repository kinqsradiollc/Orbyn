# Expanded companion and assistant UI — 2026-10-02

Worktree: `/Users/anhdang/.codex/worktrees/character/Orbyn`, branch `codex/character`.
User authorized committing and pushing the completed expansion to main. The earlier
companion implementation was already pushed in `0749e6e`; this task expands it.

## Delivered scope

- Nine distinct silhouettes, six palettes using existing theme tokens, six eye styles,
  seven ear/sprout choices, five tails, six markings and three aura choices.
- Independent headwear, eyewear, neckwear, outfit, backwear and extra-accessory slots:
  31 non-empty wardrobe selections, including headphones, scarves, hoodies, crowns,
  glasses and wings. Explicit headwear/eyewear take precedence over legacy cap/glasses.
- Eight starter looks, Surprise me and Reset look. These preserve visibility/movement.
- Shape / Wardrobe / Finish / Motion categories use one shared catalog on both clients.
  Live expression previews, greeting waves, gentle/bouncy/floaty movement, and a padded
  SVG frame for tall hats and moving wings. Actual chat expressions still follow runs.
- Web/Electron and React Native assistant screens now center the character and name,
  with a quieter introduction, softer message bubbles and a pill composer. Desktop
  editor has more room and a sticky Save row. Native closing sheet keeps its title.
- Existing strict account settings contract, migration 205, ownership and MCP scope
  remain in force. Old records gain new field defaults; no migration or dependency added.

## Qualification

- Full workspace typecheck passed.
- Root production build passed; desktop rebuilt after final header CSS changes.
- Focused character, identity/MCP, trust, mobile download and nudge tests: 59 passing.
  Tests include all catalog choices across every silhouette/state, layered wearables,
  randomization without mutation, old records, finite poses, and API 401/403/400/422/429.
- iOS and Android Expo/Hermes exports passed (6.8 MB each).
- Real web/mobile web checks: layered bunny saved on web and loaded on mobile; cloud
  with Honey/stars/floaty saved on mobile and loaded on web; preview waving and working
  movement observed; static stopped transforms and disabled waving; reduced motion
  produced a still web rig. A real unconfigured-provider failure displayed error state.
- Desktop 1280 px and phone 390 px had no horizontal overflow. Compact web header
  controls were checked for overlap; Upcoming opened with real Goals/Routines results.
- Native simulator tap verification remains incomplete: macOS simulator control could
  select the dedicated iPhone 17 but could not target the Expo Go launch confirmation.
  Packaged Electron and physical device animation performance are not verified.

## Environment and ownership

Main's uncommitted `mobile/app.json` and unrelated untracked files must stay untouched.
Latest main before integration: `324d08e`; its additional change only updates ADR notes.
No edits to the concurrent ADR/reflection/Docs worktrees. No deployment/tag/release.

Preview: web 5174, mobile web 8083, API 8018. Only disposable databases were used:
`orbyn_character_test` and `orbyn_character_checks_test`. Test Postgres uses tmpfs;
Docker restarts clear them. Disk exhaustion interrupted Docker/API after the passing
checks. Disk recovered to over 6 GB and the preview database/account were restored.
API now runs the compiled server, avoiding watch restarts during package builds.
No provider is configured for the disposable fixture; live model success was not tested.

## Delivery and remaining qualification

Delivery target is local `main` and `origin/main`, using a normal fast-forward without
rewriting other agents' commits. Git history identifies the expansion commit; the
final delivery report records the verified remote SHA. Unrelated working changes are
preserved. No production deployment, release or tag is part of this request.

Before native release, run a physical-device or simulator tap/performance check. The
new choices can be extended through the shared catalog and pure vector rig.
