import { useRef, useState } from "react";
import {
  fromDateTimeLocal,
  toDateTimeLocal,
  openInviteInput,
  type OpenInvite,
} from "@orbyn/core";
import { useAccount } from "../../app/account";
import { client } from "../../lib/session";
import { Button, Field, Input, SelectBox } from "../../ui/kit";
import {
  inviteHref,
  validId,
  CommandState,
  ReadState,
  requireReceipt,
  useCommand,
  useExit,
  useLeave,
  useRead,
  when,
  zone,
} from "./shared";
import { usePeople } from "./people";
import { CopyButton } from "./sharing";
export function Invites({ onChanged }: { onChanged: () => void }) {
  const read = useRead(() => client.listOpenInvites()),
    op = useCommand(),
    leave = useLeave(),
    [creating, setCreating] = useState(false),
    [confirmed, setConfirmed] = useState<OpenInvite | null>(null),
    [query, setQuery] = useState("");
  function created(value: OpenInvite) {
    setConfirmed(value);
    setCreating(false);
    void read.reload();
    onChanged();
  }
  return (
    <section>
      <div className="booking-web-actions">
        <h2>One-time invites</h2>
        <Button
          variant="primary"
          disabled={op.blocked || creating || !read.fresh}
          onClick={() => setCreating(true)}
        >
          Offer hand-picked times
        </Button>
        <Button disabled={read.loading} onClick={() => void read.reload()}>
          Refresh invites
        </Button>
      </div>
      <p>
        Each invite can be used once. Withdrawing a booked invite can cancel its
        meeting and notify the booker.
      </p>
      {confirmed && (
        <section className="booking-web-receipt" role="status">
          <h3>Invite link created</h3>
          <p>Keep this link private and send it to the intended recipient.</p>
          <p className="booking-web-wrap">{confirmed.url}</p>
          <CopyButton text={confirmed.url} label="Copy created invite link" />
        </section>
      )}
      {creating && (
        <InviteForm
          priorIds={read.data?.map((i) => i.id) || []}
          onCreated={created}
          onClose={() =>
            void leave().then((ok) => {
              if (ok && op.owner()) setCreating(false);
            })
          }
        />
      )}
      <Field label="Find an invite">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      <ReadState read={read}>
        {!read.loading && !read.data?.length && <p>No one-time invites yet.</p>}
        <ul className="booking-web-page-list">
          {read.data
            ?.filter((i) =>
              `${i.title} ${i.booking?.name || ""}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((inv) => (
              <li key={inv.id}>
                <h3 dir="auto">{inv.title}</h3>
                <p>
                  {inv.status} · {inv.duration} minutes · expires{" "}
                  {new Date(inv.expires_at).toLocaleString()}
                </p>
                <p>{inv.location}</p>
                <details>
                  <summary>Offered windows and hosts</summary>
                  <ul>
                    {inv.windows.map((w, n) => (
                      <li key={n}>{when(w.start_at, w.end_at, zone())}</li>
                    ))}
                  </ul>
                  <p>
                    Co-hosts:{" "}
                    {inv.co_hosts.map((h) => h.name).join(", ") || "none"}
                  </p>
                  <p>
                    Booker reminders:{" "}
                    {inv.remind_before_minutes.join(", ") || "off"} minutes
                  </p>
                  {inv.meeting_url && (
                    <p className="booking-web-wrap">
                      Meeting URL: {inv.meeting_url}
                    </p>
                  )}
                </details>
                {inv.status === "open" && (
                  <>
                    <p className="booking-web-wrap">{inv.url}</p>
                    <CopyButton text={inv.url} label="Copy invite link" />
                    {inviteHref(inv.url) && (
                      <a
                        className="btn btn-ghost"
                        href={inviteHref(inv.url) || undefined}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open invite
                      </a>
                    )}
                  </>
                )}
                {inv.booking && (
                  <p>
                    Booked by {inv.booking.name} ({inv.booking.email}) ·{" "}
                    {when(inv.booking.start_at, inv.booking.end_at, zone())} ·{" "}
                    {inv.booking.status}
                  </p>
                )}
                {["open", "booked"].includes(inv.status) && (
                  <Button
                    variant="danger"
                    disabled={op.blocked || !read.fresh}
                    onClick={() =>
                      void op.run(
                        () => client.cancelOpenInvite(inv.id),
                        () => {
                          if (confirmed?.id === inv.id) setConfirmed(null);
                          void read.reload();
                          onChanged();
                        },
                        {
                          title:
                            inv.status === "booked"
                              ? "Withdraw invite and cancel its booking?"
                              : "Withdraw this invite?",
                          body:
                            inv.status === "booked"
                              ? "The existing meeting can be cancelled and the booker notified."
                              : "This private link will stop accepting a time.",
                          action: "Withdraw invite",
                          danger: true,
                        },
                      )
                    }
                  >
                    Withdraw invite
                  </Button>
                )}
              </li>
            ))}
        </ul>
      </ReadState>
      <CommandState op={op} />
    </section>
  );
}
function InviteForm({
  priorIds,
  onCreated,
  onClose,
}: {
  priorIds: string[];
  onCreated: (value: OpenInvite) => void;
  onClose: () => void;
}) {
  const { user } = useAccount(),
    op = useCommand(),
    people = usePeople(null),
    [title, setTitle] = useState(""),
    [duration, setDuration] = useState(30),
    [windows, setWindows] = useState<{ start: string; end: string }[]>([
      { start: "", end: "" },
    ]),
    [locationText, setLocationText] = useState(""),
    [meeting, setMeeting] = useState(""),
    [hosts, setHosts] = useState<string[]>([]),
    [expires, setExpires] = useState(""),
    [reminders, setReminders] = useState("1440, 60"),
    prior = useRef(new Set(priorIds)).current;
  useExit({
    dirty: !!(
      title ||
      duration !== 30 ||
      reminders !== "1440, 60" ||
      windows.length !== 1 ||
      windows.some((w) => w.start || w.end) ||
      locationText ||
      meeting ||
      hosts.length ||
      expires
    ),
  });
  async function submit() {
    for (const w of windows) {
      if (!w.start || !w.end) {
        op.reject("Fill both ends of every offered window.");
        return;
      }
      const start = fromDateTimeLocal(w.start),
        end = fromDateTimeLocal(w.end);
      if (
        !start ||
        !end ||
        toDateTimeLocal(start) !== w.start ||
        toDateTimeLocal(end) !== w.end
      ) {
        op.reject(
          "A selected local time does not exist in your timezone. Choose another time around the daylight-saving change.",
        );
        return;
      }
    }
    if (
      hosts.some(
        (id) =>
          !people.fresh ||
          !people.data?.people.some((p) => p.user_id === id) ||
          id === user?.id,
      ) ||
      new Set(hosts).size !== hosts.length
    ) {
      op.reject("Choose distinct current teammates as co-hosts.");
      return;
    }
    const parsed = openInviteInput.safeParse({
      title,
      duration,
      windows: windows.map((w) => ({
        start_at: fromDateTimeLocal(w.start),
        end_at: fromDateTimeLocal(w.end),
      })),
      location: locationText,
      meeting_url: meeting,
      co_host_ids: hosts,
      remind_before_minutes: reminders.trim()
        ? reminders.split(",").map((v) => Number(v.trim()))
        : [],
      ...(expires ? { expires_at: fromDateTimeLocal(expires) } : {}),
    });
    if (!parsed.success) {
      op.reject(parsed.error.issues[0]?.message || "Check invite fields.");
      return;
    }
    if (expires && toDateTimeLocal(fromDateTimeLocal(expires)) !== expires) {
      op.reject("This expiry time does not exist in your device timezone.");
      return;
    }
    const merged: { start_at: string; end_at: string }[] = [];
    for (const w of [...parsed.data.windows].sort(
      (a, b) => Date.parse(a.start_at) - Date.parse(b.start_at),
    )) {
      const previous = merged.at(-1);
      if (previous && Date.parse(w.start_at) <= Date.parse(previous.end_at)) {
        if (Date.parse(w.end_at) > Date.parse(previous.end_at))
          previous.end_at = w.end_at;
      } else merged.push({ ...w });
    }
    const body = { ...parsed.data, windows: merged },
      maxEnd = Math.max(...body.windows.map((w) => Date.parse(w.end_at)));
    if (body.windows.some((w) => Date.parse(w.end_at) <= Date.now())) {
      op.reject("Every offered window must have future time remaining.");
      return;
    }
    if (maxEnd > Date.now() + 90 * 86400000) {
      op.reject("Offered windows can be at most 90 days ahead.");
      return;
    }
    if (body.expires_at && Date.parse(body.expires_at) > maxEnd) {
      op.reject("Expiry must be no later than the last offered window.");
      return;
    }
    await op.run(
      () => client.createOpenInvite(body),
      (r) => {
        if (
          !validId(r.id) ||
          prior.has(r.id) ||
          !inviteHref(r.url) ||
          r.status !== "open"
        )
          throw new Error("Invite creation receipt is incomplete.");
        requireReceipt(r, {
          windows: [...body.windows].sort((a, b) =>
            a.start_at.localeCompare(b.start_at),
          ),
          remind_before_minutes: body.remind_before_minutes,
          expires_at: body.expires_at || new Date(maxEnd).toISOString(),
          title: body.title,
          duration: body.duration,
          location: body.location,
          meeting_url: body.meeting_url,
        });
        requireReceipt(
          [...r.co_hosts.map((h) => h.user_id)].sort(),
          [...body.co_host_ids].sort(),
        );
        onCreated(r);
      },
      {
        title: "Create private one-time invite?",
        body: "Saves a real scheduling link. It does not send it to anyone; the first recipient to book consumes it.",
        action: "Create invite link",
      },
    );
  }
  return (
    <section className="booking-web-editor">
      <h3>Offer times</h3>
      <p>
        Windows use your device timezone: {zone()}. The preview includes
        timezone offsets.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={op.blocked}>
          <Field label="Meeting title">
            <Input
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Duration in minutes">
            <Input
              type="number"
              required
              min={5}
              max={480}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </Field>
          {windows.map((w, i) => (
            <div className="booking-web-editor-row" key={i}>
              <div className="booking-web-inline-fields">
                <Field label={`Window ${i + 1} starts`}>
                  <Input
                    type="datetime-local"
                    required
                    value={w.start}
                    onChange={(e) =>
                      setWindows(
                        windows.map((r, n) =>
                          n === i ? { ...r, start: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={`Window ${i + 1} ends`}>
                  <Input
                    type="datetime-local"
                    required
                    value={w.end}
                    onChange={(e) =>
                      setWindows(
                        windows.map((r, n) =>
                          n === i ? { ...r, end: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Button
                  onClick={() => setWindows(windows.filter((_, n) => n !== i))}
                >
                  Remove window
                </Button>
              </div>
              {w.start && w.end && (
                <p>
                  {when(
                    fromDateTimeLocal(w.start)!,
                    fromDateTimeLocal(w.end) || undefined,
                    zone(),
                  )}
                </p>
              )}
            </div>
          ))}
          <Button
            disabled={windows.length >= 20}
            onClick={() => setWindows([...windows, { start: "", end: "" }])}
          >
            Add offered window
          </Button>
          <Field label="Location">
            <Input
              maxLength={300}
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
            />
          </Field>
          <Field label="Meeting URL">
            <Input
              type="url"
              value={meeting}
              onChange={(e) => setMeeting(e.target.value)}
            />
          </Field>
          <ReadState read={people}>
            {hosts.map((id, i) => (
              <div className="booking-web-inline-fields" key={i}>
                <Field label={`Co-host ${i + 1}`}>
                  <SelectBox
                    value={id}
                    disabled={!people.fresh}
                    onChange={(e) =>
                      setHosts(
                        hosts.map((h, n) => (n === i ? e.target.value : h)),
                      )
                    }
                  >
                    <option value="">Choose teammate</option>
                    {id &&
                      !people.data?.people.some((p) => p.user_id === id) && (
                        <option value={id}>
                          Selected teammate unavailable
                        </option>
                      )}
                    {people.data?.people
                      .filter(
                        (p) =>
                          p.user_id !== user?.id &&
                          !hosts.some((h, n) => n !== i && h === p.user_id),
                      )
                      .map((p) => (
                        <option key={p.user_id} value={p.user_id}>
                          {p.name || p.email}
                        </option>
                      ))}
                  </SelectBox>
                </Field>
                <Button
                  onClick={() => setHosts(hosts.filter((_, n) => n !== i))}
                >
                  Remove co-host
                </Button>
              </div>
            ))}
            <Button
              disabled={!people.fresh || hosts.length >= 10}
              onClick={() => setHosts([...hosts, ""])}
            >
              Add required co-host
            </Button>
          </ReadState>
          <Field label="Invite expires (optional)">
            <Input
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </Field>
          <Field label="Booker reminders (minutes, comma-separated)">
            <Input
              value={reminders}
              onChange={(e) => setReminders(e.target.value)}
            />
          </Field>
          <Button variant="primary" type="submit">
            Create invite link
          </Button>
        </fieldset>
      </form>
      <Button disabled={op.blocked} onClick={onClose}>
        Close invite form
      </Button>
      <CopyButton
        text={JSON.stringify(
          {
            title,
            duration,
            windows,
            location: locationText,
            meeting_url: meeting,
            hosts,
            expires,
            reminders,
          },
          null,
          2,
        )}
        label="Copy invite draft"
      />
      <CommandState op={op} />
    </section>
  );
}
