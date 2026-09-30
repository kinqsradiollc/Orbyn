# OpenAI DevDay 2026 → Orbyn build & feature plan

Researched 30 September 2026, the day after DevDay (29 September, San
Francisco). Grounded in the current state of every Orbyn worktree (inspected
30 Sept: `main` at `b32257c`; `runs/durable` delivered R1–R10 at `f1df5e4` on
`codex/r1-r10-fixes`, with further agent fixes landing uncommitted;
`runs-review` mirrors `f1df5e4`). The framing: OpenAI's releases are our
requirements spec — for each one we ask **what do we already own, what do we
build ourselves, and in what order**.

**Direction set by Anh:** Sign in with ChatGPT becomes Orbyn's **first**
auth option, and Orbyn's managed API connections remain fully available —
we keep handling model calls exactly as we do today. Both coexist; see A1.

Sources for every external claim are at the bottom; items flagged
(secondhand) still need your double-check.

## DevDay 2026 inventory (what OpenAI shipped)

- **dots** — always-on personal agents (GPT-6 Astra) with their own cloud
  computer/browser, proactive read-only background research, per-action
  Custom Rules (allow / require approval / block), auto-review, Activity
  View, presence in ChatGPT/Slack/Teams, per-agent work/speed dials,
  specialist dots for enterprises (Pro, Business Premium, Enterprise).
- **ChatGPT Space** — shared collaborative pages (replaces Library):
  real-time co-editing, comments, @tag ChatGPT/Codex/dot, pages kept current
  by automations and connected tools (Pro/Business/Enterprise).
- **GPT-6.1 Sol** (`gpt-6.1-sol`) — near-Astra quality at ~1/5 price: $2/M
  input, **$0.10/M cached input**, $10/M output. **Ultrafast** tiers: up to
  8x generation speed (~300 tok/s) at ~6x price.
- **Sign in with ChatGPT (SIWC)** — users sign in with ChatGPT; eligible
  Plus/Pro users spend **their own plan** on the app's AI requests.
  Open-source dynamic-registration flow: no client secret, no partner key.
  Terms dated 29 Sept 2026 (constraints in A1/D).
- **Pro 500** — $500/mo tier, highest limits, Astra Ultrafast in ChatGPT Work
  (secondhand: keynote + press; verify).
- **Decisions API** (preview) — sub-second replies by choosing from a
  developer-defined option set (no public docs yet).
- **Codex fully in the cloud** + **Codex Security Cloud** (continuous scans,
  dedup, patch→PR; open-source `codex-security` CLI; "Daybreak" model).
- **Plugin extensions** — plugins as full native-feeling apps inside
  ChatGPT/Codex; **OpenAI Marketplace**; **ChatGPT Sites** upgraded (SQLite,
  scheduled tasks, SIWC, Plugins-in-Sites); **Agents API** gains Computer
  Use; **GPT-Live** voice sessions demoed with an open starter
  (`openai-live-console`); WebMCP/MCP Events surfaced in sessions
  (secondhand).

Full list: <https://openai.com/index/devday-2026-recap/>. Keynote chronology:
<https://simonwillison.net/2026/Sep/29/openai-devday-2026-live-blog/>.

---

# Part A — Feature plan

Each feature: what DevDay inspired it, what we already own (verified in the
worktrees), what we build, and the first slice worth shipping.

## A1. Sign in with ChatGPT as the first auth option

**Priority: highest. DECIDED: SIWC is the first option users see; Orbyn's
managed API remains fully supported.** Users pick "Continue with ChatGPT"
first; anyone who prefers the current behavior keeps it with zero change.

**What we own today (verified):** providers are per-connection and
admin-configured (`modules/ai/providers/{resolve,adapters}.ts`, admin
surface in `modules/ai/admin.ts`); the gateway keeps clients away from
providers; Orbyn already _runs_ an OAuth server (`modules/oauth/` — dynamic
client registration, PKCE, private_key_jwt with jti replay protection,
consent screens, token issuance), so the client-side machinery we need is a
mirror of code we wrote ourselves. `mcp-server/routes.ts` already answers
OpenAI's directory verification (`OPENAI_APPS_CHALLENGE`).

**The connection lineup (ordered as it will appear in the UI):**

| #   | Connection kind                        | Tokens live           | Billed to                        | Who it fits                                   |
| --- | -------------------------------------- | --------------------- | -------------------------------- | --------------------------------------------- |
| 1   | **ChatGPT plan (SIWC)** — first option | user's device only    | user's own ChatGPT Plus/Pro plan | everyone with a ChatGPT plan; no key handling |
| 2   | **Orbyn-managed API** — unchanged      | Orbyn server          | Orbyn's provider accounts        | default today; automations; teams             |
| 3   | BYO key / other providers              | Orbyn server (as now) | user's own key                   | Anthropic, Azure, etc.                        |

**Build:**

1. **Connection-kind UI:** "Continue with ChatGPT" at the top of sign-in
   and provider settings (approved branding, comparable prominence, same
   option on every visit, per the quickstart's UX rules). Managed API moves
   to second, unchanged in behavior.
2. **Desktop (Electron 44.3.0) SIWC flow:** loopback listener → system
   browser → `https://auth.openai.com/api/accounts/authorize` with
   `client_id=dynamic_agent_client`, `agent_name_hint=Orbyn`, stable
   `ext_agent_host_id`, PKCE S256, `state`+`nonce`; callback returns the
   issued `oaiapp_...` client_id — persist it per ChatGPT account and reuse
   (with `id_token_hint` on re-auth). Exchange at
   `https://auth.openai.com/api/accounts/oauth/token` (no secret); validate
   the ID token against OpenAI's JWKS (issuer, audience, exp, nonce).
3. **Token storage (terms-mandated):** the credential record
   (access/refresh/id tokens, scopes, expiry, client_id, host id) lives only
   on the device — Electron `safeStorage`/keychain, 0600 files as fallback;
   atomic writes; never logged; rotate refresh tokens atomically. The Orbyn
   backend **never persists SIWC tokens**.
4. **Inference path:** for plan connections the desktop/mobile client calls
   the **standard OpenAI API** (`resource=https://api.openai.com/v1`, scope
   `chatgpt.tokens.use.direct`) with the user's token — the same endpoints a
   normal API client uses (Responses for chat work; `GET /v1/models` works
   with the token too, per community guides — verify eligible-request scope
   at integration). The user **picks the model themselves**, exactly like a
   managed connection: populate the model picker from `GET /v1/models`
   using the user's token, falling back to a curated list if it differs.
   Orbyn still shapes the requests; only the credential origin changes.
   The gateway keeps serving managed connections exactly as now;
   per-connection resolution in `providers/resolve.ts` gains a "local"
   origin flag so server code knows which requests it may never see.
5. **Automations on a plan connection:** routines, goals and night runs
   normally execute server-side — where SIWC tokens may not live. When the
   user's desktop app is running, it can act as the **user-controlled local
   runtime** for its own automations (explicit per-agent consent switch:
   "let this agent use my ChatGPT plan for scheduled work"). When the device
   is offline: fall back to the managed connection (if the user allows) or
   defer the run — pick in Part C.
6. **Exclusions:** plan connections never appear in MCP, never serve another
   user, and are never gated behind a paid Orbyn tier ("No charge" clause).
   The existing per-user channel/settings patterns
   (`modules/agents`, night prefs) host the consent switch.

**First slice:** desktop sign-in end-to-end + one real inference call on the
user's plan + connection picker re-order. Days of work; probes demand before
the mobile flow.

**Sources:** quickstart <https://developers.openai.com/siwc/quickstart>;
open-source sign-in guide
<https://developers.openai.com/siwc/token-sharing-open-source/sign-in>
(scopes `openid profile email offline_access resource.invoke
chatgpt.tokens.use.direct`; loopback path fixed/port free; never
`localhost`); terms <https://openai.com/policies/sign-in-with-chatgpt-terms/>.

## A2. Managed AI stays exactly as today

No regression risk: Orbyn-managed connections keep handling every model call
server-side — same adapters, same admin catalog, same rate limits and
budgets. SIWC is additive. The only shared change: connection resolution
grows a kind discriminator (`plan-local | managed`) so routing, usage
accounting, and the automation consent switch can branch on it. Everything
in A3–A12 applies to both kinds unless stated.

## A3. Model catalog: GPT-6.1 Sol as the default workhorse

**DevDay:** `gpt-6.1-sol` at $2/M in / $0.10/M cached in / $10/M out — near
Astra at ~1/5 price. **We own:** the admin model catalog; the agent loop
re-sends checkpointed context every step (exactly what cached input rewards).

**Build:**

1. Add `gpt-6.1-sol` to the catalog/admin defaults; default for specialist
   - loop steps; frontier tier (Astra-class) for lead/planning.
2. Explicit prompt caching in `agent/loop.ts` (verify Responses API caching
   shape at integration); measure cost delta on the nightly batch.
3. Defer Ultrafast (6x price) until a latency-critical surface exists;
   revisit with voice (A8).

**Effort:** hours–1 day. **First win on this list.**

## A4. Agent platform: build our own "dots"

**DevDay:** dots = identity + standing scope + proactive read-only work +
per-action rules + activity view + work/speed dials + specialist agents.
**We own (verified):** durable runs with leases/checkpoints/approvals
(`modules/ai/agent/{run,loop,lease,checker}`), routines
(`worker/assistant-routines.ts`), goals with retry budgets
(`worker/assistant-goals.ts`), night window (`worker/night-shift.ts`),
capability grants (`capabilities/{policy,write,plan-run,registry}`), agent
inbox with `AgentQuestion`/`AgentRule`/`NewAgentWake`
(`modules/agent-inbox`), presence fan-out (`modules/presence/live.ts`),
away-notices (`agent/notices.ts`, `worker/delivery.ts`), per-write change
classification (`agent/change-kind.ts`). Our automations are scheduled jobs,
not agents with identity and standing rules — that's the gap.

**Features to build, in order:**

1. **Per-action Custom Rules.** Map `change-kind` → allow / require approval
   / block, per agent and per space. `capabilities/policy.ts` +
   `capabilities/write.ts` intercept every write; `agent/checker.ts`
   already produces the approval list; `agent-inbox`'s `AgentRule` is the
   storage seed. Strongest user-facing safety win; deepens Review rather
   than replacing it. _First slice: rules UI over the three change-kind
   buckets we already emit._
2. **Agent identities.** A first-class `agent` record above connections:
   name/persona, standing workspace scope, memory bindings, ownership of
   its routines/goals, its own channel settings and budget. Routines and
   goals become _its_ commitments. Migration + admin + client surfaces.
3. **Read-only proactive mode.** A tool profile in
   `capabilities/registry.ts` where background triggers (routines, wakes)
   run read-only unless a Custom Rule or explicit consent allows more.
   Night shift's trust gates become one instance of this profile.
4. **Activity View.** Live run-step streaming to any open client via
   presence `announceTo`; background wakes surface in the same view.
   Replaces poll-only progress for watching users.
5. **Per-agent dials (dots parity).** Monthly work budget + speed tier per
   agent, derived from the lease/budget machinery (`budget_used`,
   `token_estimate`); surfaced in settings like dots' work/speed dials.
6. **Hard stops.** Static deny-list in `capabilities/exclusions.ts` (password
   changes, credential/file deletion, sharing grants) that no rule overrides.
7. **Specialist agents (later).** Workspace-scoped agents with their own
   identity/credentials — lands naturally on the RBAC work
   (`feature/rbac`) plus A4.2 identities.

**No OpenAI technology required** — product design copied from their spec:
<https://openai.com/index/introducing-dots/>.

## A5. Orbyn Spaces: assistant-maintained shared pages

**DevDay:** Space = shared pages kept current by agents, with comments and
@-mentions. **We own (verified):** docs with structure and comments
(`modules/docs/{structure,comments}.ts`), visibility grants
(`lib/visibility.ts`), Home summaries, Overnight cards, routines that write
briefs, projects with progress (`agent/workspace.ts`), an unlanded
`doc-block-tools` branch exploring richer blocks, presence for live editing
signals.

**Features to build:**

1. **Assistant-owned blocks.** A doc block bound to a routine/goal/night run
   whose content the agent regenerates on schedule ("tonight's plan",
   "project status", "exam countdown"). Overnight summary is the first
   instance — generalize into docs.
2. **@orbyn in comments.** Commenting `@orbyn <instruction>` starts a scoped
   assistant run with the page + comments as workspace context; results
   arrive as a reply, a proposed edit (normal Review flow), or both.
   Plumbing: comment hook → `startAssistantAutomation` with doc scope;
   `announceTo` posts completion.
3. **Page-grant inheritance.** Runs triggered from a page inherit the
   _page's_ grant set (not just the requester's) — a deliberate, audited
   extension of `capabilities/context.ts`.
4. **Keep-current automations.** "Update this page every morning at 7" —
   routine creation straight from the page UI, writing only its bound
   blocks (A5.1 makes that enforceable).
5. **Mobile reading first** (matching ChatGPT's own rollout: web/desktop
   editing, mobile read/share), editing later.

**Spec source:** <https://chatgpt.com/features/space/> (no API exists — we
build the equivalent from parts we already ship). _Biggest new surface;
depends on A4.1–2 for rules and identity._

## A6. Reach people where they are: Slack channel for agent notices

**DevDay:** dots message you in Slack/Teams (texting soon). **We own:**
`worker/delivery.ts` with email/push/inapp channels and per-user channel
preferences; webhooks infra (`lib/webhooks.ts`).

**Build:** a Slack (then Teams) delivery channel for agent notices —
completion/failure/waiting questions land in DM; answers flow back through
the agent inbox. _Small, high-visibility; after A4.2 identities give notices
an agent to belong to._

## A7. Published live pages (our "Sites")

**DevDay:** ChatGPT Sites gained SQLite, scheduled tasks, SIWC, plugins.
**We own:** `modules/links` + `modules/app-links` for sharing.

**Build (small):** publish a read-only snapshot page (or Space from A5) to a
link with viewer access and optional refresh — enough for "share the plan
with my team" without new infra. No SQLite/scheduled-task parity needed.

## A8. Voice calls with the assistant (later spike)

**DevDay:** GPT-Live sessions + open `openai-live-console` starter; Ultrafast
makes real-time voice affordable. **We own:** transcription only
(`AI_TRANSCRIBE_MODEL=whisper-1`); no live voice surface.

**Build:** spike only — a "call your agent" mode reusing A4 identities and
notice channels; Ultrafast pricing is the enabling cost change. Not before
Phase 3 (Part B).

## A9. Computer use: internal QA harness first

**DevDay:** Agents API gained Computer Use; 2x latency win shipped.
**We own:** nothing product-side; desktop is Electron, mobile is Expo.

**Build:** use computer-use agents against our own dev builds as a QA
harness (drive the desktop app through R1-style recovery flows — the
runs-durable verification scripts are the test plan). Product-side "agent
operates your apps" stays off the roadmap until the internal harness proves
value.

## A10. Security: codex-security CLI in CI

**DevDay:** open-source `codex-security` CLI; SECURITY.md threat models;
scan→dedup→patch loop. **We own:** no scheduled security scanning; runs-durable
verification docs are already close to the SECURITY.md format.

**Build:** run the CLI against this repo on a schedule in CI; add per-module
SECURITY.md (start with `modules/ai/agent` and `modules/oauth`); human-gated
patch application — mirrors our Review-before-apply stance. _Hours to set
up; Phase 0._

## A11. Distribution: our MCP server as a ChatGPT plugin (watch)

**DevDay:** plugin extensions are full apps inside ChatGPT/Codex;
Marketplace launched. **We own:** a generated MCP catalog (`docs/mcp.md`,
`mcp-catalog.json`) and directory-verification support.

**Build:** nothing until the 2026 extension SDK docs land; then package the
existing MCP server as a ChatGPT app — same capability catalog, new
audience. Re-check the recap page for developer links.

## A12. Decisions API: no action (internal alternative exists)

Preview, no docs. The same job — pick one option from a fixed set in
milliseconds — is a structured-output call (`response_format`, already
supported by our adapters for structured-output providers) or a tiny local
classifier for nudge triage. Revisit only if it ships with pricing that
beats a cached small-model call.

---

# Part B — Roadmap

| Phase                | Window    | Features                                                                                                                   | Exit criteria                                                                                          |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **0 — foundations**  | this week | A3 Sol + prompt caching; A10 CI security scan; A1 desktop SIWC spike (sign-in + one plan call)                             | nightly batch cost measured; CI scan green; spike demo on a real Plus plan                             |
| **1 — auth + rules** | 1–2 wks   | A1 full desktop SIWC + connection picker (SIWC first) + automation consent switch; A4.1 Custom Rules; A4.6 hard stops      | a user completes real work on their own plan; a blocked write is stopped by a rule in production paths |
| **2 — agents**       | wks 3–6   | A4.2 agent identities; A4.3 read-only proactive mode; A4.4 Activity View; A4.5 dials; A6 Slack channel; A7 published pages | an agent owns its routines end-to-end; live steps visible while watching; notices arrive in Slack      |
| **3 — spaces**       | wks 6–10  | A5 Spaces (assistant blocks, @orbyn comments, page-grant inheritance, keep-current automations); A1 mobile SIWC            | a team page updates itself daily; comments summon the agent; mobile plan sign-in ships                 |
| **4 — frontier**     | quarter   | A8 voice spike; A9 computer-use QA harness; A11 MCP-as-plugin (when SDK lands); A4.7 specialist agents                     | each promoted from spike to roadmap or dropped                                                         |

Dependencies: Phase 1 needs `runs/durable` merged (rules hook into the
durable run/checkpoint path). A5 needs A4.1–2. Everything else is
independent.

# Part C — Decisions needed

1. **DECIDED (Anh):** SIWC is the first auth option; managed API unchanged.
2. **DECIDED (Anh):** plan connections use the standard OpenAI API surface
   and the **user chooses the model** (picker from `GET /v1/models` with
   their token) — Orbyn handles requests as it does for any connection
   (A1.4, A3).
3. **Automation fallback on plan connections** (A1.5): when the device is
   offline — defer the run, or fall back to the managed connection with a
   per-user opt-in? _Recommend: managed fallback behind the consent switch,
   deferred otherwise._
4. **Plan connections in team workspaces?** Personal-only initially keeps
   "No charge" and pooling clauses simple. _Recommend: personal-only at
   launch._
5. **Ultrafast / voice timing** (A8): spike in Phase 4 or wait for user
   demand. _Recommend: wait._
6. **Usage accounting boundary:** plan-connection calls happen client-side;
   server-side cost dashboards only cover managed connections. Confirm
   that's acceptable for admin reporting.

# Part D — SIWC compliance checklist (terms → our control)

| Term clause (<https://openai.com/policies/sign-in-with-chatgpt-terms/>) | Our control                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Tokens stored only locally, user-controlled                             | Device keychain/0600 only; backend never persists (A1.3)                             |
| Requests from user's local (or solely-user-controlled) runtime          | Client-side inference path; desktop-as-runtime for automations (A1.4–5)              |
| Express consent for automations/background use                          | Per-agent consent switch gating routines/goals/night (A1.5)                          |
| Connected application only; no general-purpose API                      | Plan connections excluded from MCP and cross-user proxying (A1.6)                    |
| No charge for plan usage                                                | Never gated behind a paid Orbyn tier (A1.6)                                          |
| No pooling/rotating/sharing accounts                                    | One credential record per ChatGPT account; no server-side sharing possible by design |
| Breach disclosure duty                                                  | Standard incident runbook covers it; note in security docs (A10)                     |

# Sources for double-checking

1. <https://openai.com/index/introducing-dots/> — dots scope, rules, safety
2. <https://openai.com/index/introducing-gpt-6-1-sol/> — Sol pricing/evals
3. <https://openai.com/policies/sign-in-with-chatgpt-terms/> — SIWC terms
4. <https://developers.openai.com/siwc/quickstart> — SIWC overview
5. <https://developers.openai.com/siwc/token-sharing-open-source/sign-in> —
   OAuth flow, scopes, token storage
6. <https://chatgpt.com/features/space/> — Space spec/FAQ
7. <https://openai.com/index/devday-2026-recap/> — announcement index
   (JS-rendered)
8. <https://simonwillison.net/2026/Sep/29/openai-devday-2026-live-blog/> —
   keynote chronology (Pro 500, Ultrafast, Decisions API, GPT-Live, Codex
   Security; secondhand)

Flagged secondhand (verify before relying): Pro 500 details, Ultrafast 6x
price, Decisions API shape, MCP Events/WebMCP scope, GPT-Live starter
details, dots rollout markets. Flagged as vendor numbers: all Sol/Astra
benchmark comparisons. Internal file/module references verified against the
worktrees on 30 Sept 2026.
