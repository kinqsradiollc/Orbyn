# Web client rebuild

A new web client in `web/`, written from scratch to replace `desktop/`. No code is
copied from `desktop/`, which stays the behavior reference until cutover. Shared
`@orbyn/core` and `@orbyn/api-client` stay. This work is paused and unfinished:
`web/` is not deployed and nothing points at it.

The rebuild has no copied presentation: every screen is new markup and CSS on the kit
in `web/src/ui`. Macro was a design reference only. It is AGPL-3.0 and Orbyn is MIT, so
no Macro code, tokens or assets are used.

## State

Built: Today, Work, Lists, Projects, Views, Notifications, Calendar with the 3D Planner,
sign-in, terms and email gates, landing, legal, security, status, changelog, recovery.

Built but stopped before its checks finished: Library with its editors, Daily brief and
Study. Its worker stopped partway through exercising library operations, block renderers,
sharing, Study and Brief, so treat these as unverified.

Not built, and showing "This screen hasn't been rebuilt yet": Assistant, Background,
Overnight, Review, Teams, Booking, Admin, Settings, Developers, OAuth consent and public
booking pages. `web/src/screens/agents-shared` holds an unfinished start on the Agents
screens that nothing imports yet.

## How to run

    docker compose up -d postgres mailpit
    npm run migrate
    PORT=8008 npm run dev:api
    API_PROXY_URL=http://127.0.0.1:8008 npm run dev:new-web

## Parity gaps

Every capability of `desktop/` must exist in `web/` before cutover. The known gaps:

From Work and Lists:

- Row drag to calendar or a page was dropped. Needs an equivalent.
- Task-done celebration replaced by a toast (decide: keep toast, record the choice).
- Focus: custom rhythms, sound and notifications, and picking up a session running on another device.
- Peek for pages renders plain text, not blocks.
- Saved views: priority, size, single status; Today loses planned sessions; Tomorrow and Due soon approximate.
- Work quick line: `@name` needs team members loaded.
- Not exercised: board drag, bulk actions, Focus timer, Peek, Save as view, team-only flows, repeat scopes "this" and "following".

Cross-screen wiring:

- Calendar reads ?plan=<itemId> and ?date=YYYY-MM-DD.
- Assistant reads ?task=<id>.
- Library honours #blockId on /app/doc/:id.
- Cmd-click links and Cmd-K call tasks.peek. Command bar must search work, not only places.

From Calendar, built but not exercised:

- Plan: pin by dragging a proposal, estimate editing, What if, experiments, roll forward, stale banner.
- Alt-drag copy, dropping a task from the rail, touch drag on a phone.
- Rollback for an event move.
- Manage tabs: create, edit, delete for sets, subscriptions, feeds, frames, habits.
- Teammates overlay with people selected. Focus handover between devices. Find time with a task that needs time.
- Week now starts Monday in every mode (old flat calendar started Sunday): confirm with user.

Shell parity (lead), from desktop/src/app and desktop/src/app/chrome:

- Command bar: page commands, pins and filters. Search, add and go-to work.
- Tabs and the tab strip, split panes (workspace duo), the side dock.
- Sidebar arrange, rail mode, resizer. Starred and pinned groups work.
- Update-available banner. Announcement, maintenance and email gates work.
- Shortcut sheet and custom shortcuts. Live events reconnect. What's new sheet. Activity dialog.

From Today, Projects, Views, Notifications:

- Character art (Character, CharacterEditor) not in web; Browse shows names only.
- Assistant proposals on projects: simplified, needs full ProposalReview diff. AssistantAgents dialog replaced by links.
- Unsaved link draft warning only on the back button, not sidebar navigation.
- View refinements (priority, size, status) in prefs only: not in CSV, shared viewers or server limit. Work SaveViewDialog must write them to view:<id>.
- First run: final step unverified on a fresh account; preset application unverified.
- Mock-only: Notifications actions, 409 move retry, session check-ins. Not exercised: project assistant drafting, file import, cover upload, claiming, promises, asks, agent questions, welcome back, 3D relation map node open.
- Shell: bell unread badge, pinned-views group, mount FirstRun, WhatsNew and pinned panel globally, Today search dialog pattern into command bar.
- Assistant must read ?chat= ?project= ?ask= ?panel=upcoming ?conversation=&entry= ; Booking ?open= ; Teams ?team=.
- Project page makes 29 requests on load; rate limiter trips under rapid navigation.

## Cutover

Not started. Before removing `desktop/`: move the behavior covered by the backend tests
that import `desktop/src`, point Electron and the web image at `web/`, and restore the
homepage prerender and the desktop config output.
