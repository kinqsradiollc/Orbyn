import { inspectPages } from "./receipts";
import { useRef, useState } from "react";
import {
  bookingPageInput,
  bookingPageUpdate,
  type BookingPage,
} from "@orbyn/core";
import { useAccount } from "../../app/account";
import { client } from "../../lib/session";
import { Button, Field, Input, SelectBox, TextArea } from "../../ui/kit";
import {
  validId,
  CommandState,
  ReadState,
  matches,
  requireReceipt,
  useCommand,
  useExit,
  useLeave,
  useRead,
} from "./shared";
import { CoHosts, usePeople } from "./people";
import { PageRules } from "./page-rules";
import { newPage, pageDraft, type PageDraft } from "./page-data";
import { CopyButton } from "./sharing";
type PageRead = ReturnType<typeof useRead<BookingPage[]>>;
export function Pages({
  pages,
  onChanged,
}: {
  pages: PageRead;
  onChanged: () => void;
}) {
  const { user } = useAccount(),
    leave = useLeave(),
    op = useCommand(),
    [editing, setEditing] = useState<BookingPage | "new" | null>(null),
    [q, setQ] = useState("");
  const canEdit = (p: BookingPage) => p.can_edit ?? p.owner_id === user?.id;
  return (
    <section>
      <div className="booking-web-actions">
        <h2>Booking pages</h2>
        <Button
          variant="primary"
          disabled={op.blocked || !pages.fresh}
          onClick={() =>
            void leave().then((ok) => {
              if (ok && op.owner()) setEditing("new");
            })
          }
        >
          New booking page
        </Button>
        <Button
          disabled={pages.loading}
          onClick={() =>
            void leave().then((ok) => {
              if (ok && pages.own()) void pages.reload();
            })
          }
        >
          Refresh pages
        </Button>
      </div>
      <Field label="Find a page">
        <Input value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <ReadState read={pages}>
        {!pages.loading && !pages.data?.length && (
          <p>
            No booking pages yet. Create a page to offer your available time.
          </p>
        )}
        <ul className="booking-web-page-list">
          {pages.data
            ?.filter((p) =>
              `${p.title} ${p.slug} ${p.team_name || ""}`
                .toLowerCase()
                .includes(q.toLowerCase()),
            )
            .map((p) => (
              <li key={p.id}>
                <div>
                  <h3 dir="auto">
                    <span
                      className="booking-web-color-dot"
                      style={{ backgroundColor: p.color }}
                      aria-label="Page color"
                    />
                    {p.title}
                  </h3>
                  <p>
                    {p.active ? "Active configuration" : "Paused"} ·{" "}
                    {p.team_name || "Personal"} ·{" "}
                    {p.durations.map((d) => `${d} min`).join(" / ")}
                  </p>
                  <p>
                    {p.counts.upcoming} upcoming · {p.counts.needs_approval}{" "}
                    needing approval
                  </p>
                </div>
                <Share page={p} />
                <div className="booking-web-actions">
                  <Button
                    disabled={op.blocked || !pages.fresh || !canEdit(p)}
                    onClick={() =>
                      void leave().then((ok) => {
                        if (ok && op.owner()) setEditing(p);
                      })
                    }
                  >
                    Edit page
                  </Button>
                  <Button
                    variant="danger"
                    disabled={op.blocked || !pages.fresh || !canEdit(p)}
                    onClick={() =>
                      void op.run(
                        () => client.deleteBookingPage(p.id),
                        () => {
                          if (editing !== "new" && editing?.id === p.id)
                            setEditing(null);
                          onChanged();
                        },
                        {
                          title: "Delete booking page?",
                          body: `Delete ${p.title}. This stops new bookings from its URL; existing meeting history remains subject to the server's rules.`,
                          action: "Delete page",
                          danger: true,
                        },
                      )
                    }
                  >
                    Delete page
                  </Button>
                </div>
                {!canEdit(p) && (
                  <p>You can view bookings but cannot change this page.</p>
                )}
              </li>
            ))}
        </ul>
      </ReadState>
      <CommandState op={op} />
      {editing && (
        <PageEditor
          key={editing === "new" ? "new" : editing.id}
          page={editing === "new" ? null : editing}
          priorIds={pages.data?.map((p) => p.id) || []}
          canWrite={
            pages.fresh &&
            (editing === "new" ||
              !!pages.data?.some((p) => p.id === editing.id && canEdit(p)))
          }
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
          onClose={() =>
            void leave().then((ok) => {
              if (ok && op.owner()) setEditing(null);
            })
          }
        />
      )}
    </section>
  );
}
export function Share({ page }: { page: BookingPage }) {
  const url = new URL("/book/" + encodeURIComponent(page.slug), location.origin)
      .href,
    escape = (v: string) =>
      v
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;"),
    iframe = `<iframe src="${escape(url + "?embed=1")}" title="${escape(page.title)}" width="100%" height="760" style="border:0" loading="lazy"></iframe>`;
  return (
    <details>
      <summary>Share and embed</summary>
      <p className="booking-web-wrap">{url}</p>
      <CopyButton text={url} label="Copy page URL" />
      <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">
        Open public page
      </a>
      {!!page.team_id && (
        <p>Public access also depends on this team's booking policy.</p>
      )}
      {!page.active && (
        <p>The public URL is unavailable while this page is paused.</p>
      )}
      <Field label="Embed code">
        <TextArea readOnly value={iframe} />
      </Field>
      <CopyButton text={iframe} label="Copy embed code" />
    </details>
  );
}
function PageEditor({
  page: incoming,
  priorIds,
  onSaved,
  onClose,
  canWrite,
}: {
  page: BookingPage | null;
  priorIds: string[];
  onSaved: () => void;
  onClose: () => void;
  canWrite: boolean;
}) {
  const form = useRef<HTMLFormElement>(null),
    slugTouched = useRef(!!incoming);
  const { user } = useAccount(),
    page = useRef(incoming).current,
    base = useRef(page ? pageDraft(page) : newPage()).current,
    [draft, setDraft] = useState<PageDraft>(base),
    [durations, setDurations] = useState(base.durations.join(", ")),
    [reminders, setReminders] = useState(base.remind_before_minutes.join(", ")),
    [dirty, setDirty] = useState(false),
    [observed, setObserved] = useState<BookingPage | null>(null),
    people = usePeople(draft.team_id),
    op = useCommand(),
    prior = useRef(new Set(priorIds)).current,
    attempt = useRef<{ body: PageDraft; at: number } | null>(null);
  useExit({ dirty });
  const primary = page?.owner_id || user?.id || "",
    allowed =
      canWrite && (!page || (page.can_edit ?? page.owner_id === user?.id));
  function change<K extends keyof PageDraft>(key: K, value: PageDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }
  function receiptMatches(r: BookingPage, body: PageDraft) {
    const actual = pageDraft(r),
      co = (v: { user_id: string; required: boolean }[]) =>
        [...v].sort((a, b) => a.user_id.localeCompare(b.user_id));
    return matches(
      { ...actual, co_hosts: co(actual.co_hosts) },
      { ...body, co_hosts: co(body.co_hosts) },
    );
  }
  async function save() {
    if (!allowed) {
      op.reject("You cannot manage this page.");
      return;
    }
    const parsed = bookingPageInput.safeParse({
      ...draft,
      durations: durations.split(",").map((v) => Number(v.trim())),
      remind_before_minutes: reminders.trim()
        ? reminders.split(",").map((v) => Number(v.trim()))
        : [],
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const key = String(issue?.path[0] || ""),
        section = ["questions", "routing"].includes(key)
          ? "questions"
          : ["availability", "date_overrides"].includes(key)
            ? "availability"
            : "";
      if (section)
        form.current
          ?.querySelector<HTMLDetailsElement>(
            `details[data-booking-section="${section}"]`,
          )
          ?.setAttribute("open", "");
      op.reject(
        `${issue?.path.join(" · ") || "Page"}: ${issue?.message || "Check this field."}`,
      );
      return;
    }
    const body = {
      ...parsed.data,
      durations: [...parsed.data.durations].sort((a, b) => a - b),
      date_overrides: [...parsed.data.date_overrides].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    };
    if (new Set(body.durations).size !== body.durations.length) {
      op.reject("Each offered duration should appear once.");
      return;
    }
    const teamChanged = !page || body.team_id !== base.team_id,
      hostsChanged = teamChanged || !matches(body.co_hosts, base.co_hosts);
    if (
      body.team_id &&
      teamChanged &&
      (!people.fresh ||
        !people.data?.selected ||
        !["owner", "admin"].includes(people.data.selected.role || ""))
    ) {
      op.reject(
        "Only a current team owner or administrator can create or move a page into this team.",
      );
      return;
    }
    if (page && base.team_id && !body.team_id && page.owner_id !== user?.id) {
      op.reject(
        "Only the primary page owner can make this team page personal.",
      );
      return;
    }
    if (
      body.team_id &&
      hostsChanged &&
      !people.data?.people.some((p) => p.user_id === primary)
    ) {
      op.reject("The primary host must be a member of the selected team.");
      return;
    }
    if (
      hostsChanged &&
      (body.co_hosts.some(
        (h) =>
          !people.fresh ||
          !people.data?.people.some((p) => p.user_id === h.user_id) ||
          h.user_id === primary,
      ) ||
        new Set(body.co_hosts.map((h) => h.user_id)).size !==
          body.co_hosts.length)
    ) {
      op.reject(
        "Choose distinct available co-hosts in the current team context.",
      );
      return;
    }
    const hosts = new Set([primary, ...body.co_hosts.map((h) => h.user_id)]);
    if (
      body.routing.some(
        (r) =>
          !body.questions.some((q) => q.id === r.question_id) ||
          !hosts.has(r.host_user_id),
      )
    ) {
      op.reject("Each routing rule needs a current question and page host.");
      return;
    }
    const patch = bookingPageUpdate.safeParse(
      Object.fromEntries(
        Object.entries(body).filter(
          ([key, v]) => !matches(v, Reflect.get(base, key)),
        ),
      ),
    );
    if (page && !patch.success) {
      if (matches(body, base)) {
        setDirty(false);
        return;
      }
      op.reject(patch.error.issues[0]?.message || "Check page changes.");
      return;
    }
    await op.run(
      () => {
        attempt.current = { body, at: Date.now() };
        return page && patch.success
          ? client.updateBookingPage(page.id, patch.data)
          : client.createBookingPage(body);
      },
      (r) => {
        if (
          !validId(r.id) ||
          (page && r.id !== page.id) ||
          (!page && (prior.has(r.id) || r.owner_id !== user?.id)) ||
          !receiptMatches(r, body)
        )
          throw new Error("Page receipt does not match this submitted page.");
        setDirty(false);
        onSaved();
      },
      {
        title: page
          ? "Save booking page changes?"
          : body.active
            ? "Create a public booking page?"
            : "Create paused booking page?",
        body: body.active
          ? "The saved active page can accept real public requests and share its title, questions and host names."
          : "The page remains paused and unavailable for public booking.",
        action: page ? "Save page" : "Create page",
      },
    );
  }
  async function reconcile() {
    const a = attempt.current;
    if (!a) return false;
    const rows = await inspectPages();
    if (!op.owner()) return false;
    const candidates = rows.filter((r) =>
      page
        ? r.id === page.id
        : !prior.has(r.id) &&
          r.owner_id === user?.id &&
          Date.parse(r.created_at) >= a.at - 2000,
    );
    const match = candidates.find(
      (r) =>
        (r.can_edit ?? r.owner_id === user?.id) && receiptMatches(r, a.body),
    );
    if (match) setObserved(match);
    // No request identity/CAS exists here. A matching snapshot is not an operation receipt.
    return false;
  }
  const hosts = [
    {
      user_id: primary,
      name:
        page?.hosts.find((h) => h.user_id === primary)?.name ||
        user?.name ||
        "Primary host",
    },
    ...draft.co_hosts.map((h) => ({
      user_id: h.user_id,
      name:
        people.data?.people.find((p) => p.user_id === h.user_id)?.name ||
        h.user_id,
    })),
  ];
  return (
    <section className="booking-web-editor" aria-label="Booking page editor">
      <h2>{page ? "Edit booking page" : "New booking page"}</h2>
      <form
        ref={form}
        onInvalidCapture={(e) => {
          const el = e.target;
          if (el instanceof HTMLElement) {
            el.closest("details")?.setAttribute("open", "");
            el.focus();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={op.blocked || !allowed}>
          <legend>Page details</legend>
          <Field label="Title">
            <Input
              required
              maxLength={120}
              value={draft.title}
              onChange={(e) => {
                const title = e.target.value;
                change("title", title);
                if (!slugTouched.current)
                  change(
                    "slug",
                    (
                      title
                        .normalize("NFKD")
                        .toLowerCase()
                        .match(/[a-z0-9]+/g) || []
                    )
                      .join("-")
                      .slice(0, 60)
                      .replace(/-+$/, ""),
                  );
              }}
            />
          </Field>
          <Field
            label="Public URL slug"
            hint="Lowercase letters, numbers and single dashes; 3–60 characters."
          >
            <Input
              required
              minLength={3}
              maxLength={60}
              value={draft.slug}
              onChange={(e) => {
                slugTouched.current = true;
                change("slug", e.target.value);
              }}
            />
          </Field>
          <Field label="Description">
            <TextArea
              maxLength={2000}
              value={draft.description}
              onChange={(e) => change("description", e.target.value)}
            />
          </Field>
          <div className="booking-web-form-grid">
            <Field
              label="Offered lengths in minutes"
              hint="1–4 comma-separated values, each 5–480."
            >
              <Input
                required
                value={durations}
                onChange={(e) => {
                  setDurations(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
            <Field label="Page color">
              <Input
                type="color"
                value={draft.color}
                onChange={(e) => change("color", e.target.value)}
              />
            </Field>
            <Field label="Location">
              <Input
                maxLength={300}
                value={draft.location}
                onChange={(e) => change("location", e.target.value)}
              />
            </Field>
            <Field label="Meeting URL">
              <Input
                type="url"
                maxLength={2000}
                value={draft.meeting_url}
                onChange={(e) => change("meeting_url", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Workspace">
            <SelectBox
              value={draft.team_id || ""}
              disabled={op.blocked || !people.fresh}
              onChange={(e) => change("team_id", e.target.value || null)}
            >
              <option value="">Personal</option>
              {draft.team_id &&
                !people.data?.teams.some((t) => t.id === draft.team_id) && (
                  <option value={draft.team_id}>Saved team unavailable</option>
                )}
              {people.data?.teams
                .filter(
                  (t) =>
                    ["owner", "admin"].includes(t.role || "") ||
                    t.id === draft.team_id,
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </SelectBox>
          </Field>
          <ReadState read={people} />
          <label>
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => change("active", e.target.checked)}
            />
            Page is active and accepts public bookings
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.requires_approval}
              onChange={(e) => change("requires_approval", e.target.checked)}
            />
            Require host approval
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.allow_reschedule}
              onChange={(e) => change("allow_reschedule", e.target.checked)}
            />
            Allow bookers to reschedule from their private manage link
          </label>
          <CoHosts
            values={draft.co_hosts}
            owner={primary}
            people={people}
            onChange={(v) => change("co_hosts", v)}
            disabled={op.blocked}
          />
          <PageRules
            value={draft}
            change={change}
            disabled={op.blocked}
            hosts={hosts}
          />
          <details>
            <summary>Event, reminders and confirmation</summary>
            <Field
              label="Host event title"
              hint="Supports {page}, {name} and {email}."
            >
              <Input
                required
                maxLength={200}
                value={draft.event_title}
                onChange={(e) => change("event_title", e.target.value)}
              />
            </Field>
            <Field
              label="Booker reminders in minutes"
              hint="Up to 3 comma-separated values, each 10–10080. Empty turns reminders off."
            >
              <Input
                value={reminders}
                onChange={(e) => {
                  setReminders(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
            <Field label="Confirmation message">
              <TextArea
                maxLength={1000}
                value={draft.confirmation_message}
                onChange={(e) => change("confirmation_message", e.target.value)}
              />
            </Field>
          </details>
          <Button variant="primary" type="submit" disabled={!!page && !dirty}>
            {page
              ? "Save page changes"
              : draft.active
                ? "Create public page"
                : "Create paused page"}
          </Button>
        </fieldset>
      </form>
      <Button disabled={op.busy || op.unknown} onClick={onClose}>
        Close page editor
      </Button>
      <CopyButton
        text={JSON.stringify({ ...draft, durations, reminders }, null, 2)}
        label="Copy page draft"
      />
      {!allowed && (
        <p role="alert">
          Editing is unavailable until a fresh authorized page read succeeds.
          Your draft is retained.
        </p>
      )}
      {observed && (
        <p role="status">
          The latest saved read contains “{observed.title}” at /book/
          {observed.slug}, updated{" "}
          {new Date(observed.updated_at).toLocaleString()}. The original request
          is still unconfirmed; no new write is permitted.
        </p>
      )}
      <CommandState op={op} check={reconcile} />
    </section>
  );
}
