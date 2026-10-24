# Worked example: organizing a task editor

Synthetic design exercise. These paths describe an example application, not the
current Orbyn layout or a completed refactor.

**Request.** Editing a task requires changing a form in `web/components/`, a hook
in `web/hooks/` and query options in `web/utils/`. A calendar screen imports the
hook's internal draft normalizer. Web and mobile use a canonical task schema;
the API checks permissions and persists changes. Propose an organization in
Markdown without changing application code or adding dependencies.

**Finding.** The form, draft state and query options serve the web editing
capability. The calendar's import couples it to an implementation detail. The
shared schema, transport and API have distinct owners that must remain intact.

## Proposed owner map

| Example owner / path | Public contract | Private detail |
| --- | --- | --- |
| `core/tasks/` | Task schema and valid domain states | Schema implementation |
| `api-client/tasks/` | Typed update operation and recognizable failures | Transport mechanics |
| `web/task-editor/` | `TaskEditor` with task identity and saved-result callback | Draft hook, normalization and query options |
| `web/calendar/` | Calendar interaction flow | Calendar-specific selection and presentation |
| `web/design-system/` | Generic inputs and dialog primitives | Primitive implementation |
| `mobile/task-editor/` | Mobile editing flow | Native draft/presentation details |
| `api/tasks/` | Authenticated task update endpoint | Authorization and transactional update |

The permitted graph is web/mobile feature → transport/domain and web feature →
design system. Shared domain contracts never import web, mobile or API handlers.
The server owns current authority and durable writes. These are logical module
interfaces; the proposal does not require separate packages or public exports of
every local type.

The calendar opens the public editor with a task ID and handles its saved result.
It no longer imports draft normalization. If it needs a genuinely separate editing
operation, first define that caller's contract; do not export the existing hook
just to preserve the accidental dependency. Draft state stays private to its flow.

**Alternative.** Moving everything into `shared/task-editor` would hide platform
differences and mix persistence authority with presentation. Keep the domain
schema shared; extract draft logic later only if real consumers need identical
semantics. Small local duplication can cost less than an unstable shared API.

## Migration and evidence plan

Inventory callers and supported entry points first. Move the web form, hook and
query helper together, migrate the calendar caller, then remove obsolete imports.
Preserve the existing lazy route and update aliases, fixtures or asset paths if
they refer to moved files. Use an existing import restriction to reject access
to editor internals if the project has that capability; otherwise record that
the boundary is a convention until enforcement is separately implemented.

Inspect the final import graph for cycles and remaining old/deep paths. When
implementation checks are authorized, use the affected type/import checks and
exercise opening, saving, validation failure and preserving an unsaved draft
through the changed calendar/editor flow. This document supplies a design and
planned evidence; none of those checks or product changes has been executed.

**Failure example.** Rename `web/components` to `web/features`, leave imports
unrestricted, and export every hook from an index. Discovery changes, but the
calendar still depends on editor internals and the coupling remains.
