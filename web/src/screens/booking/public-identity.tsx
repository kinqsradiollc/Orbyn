import { inspectRsvp } from "./receipts";
import { useState } from "react";
import {
  addDays,
  localDateKey,
  describeRrule,
  type RsvpView,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, SelectBox } from "../../ui/kit";
import {
  CommandState,
  ReadState,
  requireReceipt,
  useCommand,
  useRead,
  when,
  zone,
} from "./shared";
export function Profile({ handle }: { handle: string }) {
  const read = useRead(() => client.getPublicProfile(handle), [handle]);
  return (
    <ReadState read={read}>
      {read.data && (
        <>
          <h1 dir="auto">{read.data.name}</h1>
          <p dir="auto" className="booking-web-description">
            {read.data.bio}
          </p>
          <h2>Book a meeting</h2>
          {!read.data.pages.length ? (
            <p>No public booking pages are available.</p>
          ) : (
            <ul className="booking-web-public-pages">
              {read.data.pages.map((p) => (
                <li key={p.slug}>
                  <a
                    href={`/book/${encodeURIComponent(p.slug)}`}
                    rel="noreferrer"
                  >
                    <strong dir="auto">
                      <span
                        className="booking-web-color-dot"
                        style={{ backgroundColor: p.color }}
                        aria-label="Page color"
                      />
                      {p.title}
                    </strong>
                    <span dir="auto">{p.description}</span>
                    <small>
                      {p.durations.map((d) => `${d} min`).join(" · ")}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </ReadState>
  );
}
export function Rsvp({ token }: { token: string }) {
  const read = useRead(() => client.getRsvp(token), [token]);
  return (
    <ReadState read={read}>
      {read.data && (
        <RsvpForm
          key={token}
          token={token}
          value={read.data}
          fresh={read.fresh}
          accept={read.commit}
        />
      )}
    </ReadState>
  );
}
function RsvpForm({
  token,
  value,
  fresh,
  accept,
}: {
  token: string;
  value: RsvpView;
  fresh: boolean;
  accept: (v: RsvpView) => void;
}) {
  const op = useCommand(),
    suggested = new URLSearchParams(location.search).get("r"),
    [choice, setChoice] = useState<"accepted" | "declined" | "tentative">(
      suggested === "accepted" ||
        suggested === "declined" ||
        suggested === "tentative"
        ? suggested
        : value.status === "accepted" ||
            value.status === "declined" ||
            value.status === "tentative"
          ? value.status
          : "accepted",
    ),
    [submitted, setSubmitted] = useState<string | null>(null);
  const allDay = value.all_day
    ? `${localDateKey(new Date(value.start_at), value.timezone)}${value.end_at ? " through " + addDays(localDateKey(new Date(value.end_at), value.timezone), -1) : ""} (${value.timezone})`
    : when(value.start_at, value.end_at || undefined, zone());
  async function check() {
    const r = await inspectRsvp(token);
    if (!op.owner()) return false;
    accept(r);
    // RSVP updates are not versioned. A matching status cannot prove the earlier POST settled.
    return false;
  }
  return (
    <>
      <p className="booking-web-eyebrow">Invitation from {value.organizer}</p>
      <h1 dir="auto">{value.title}</h1>
      <p>{allDay}</p>
      <p>{value.location}</p>
      {value.meeting_url && /^https?:\/\//.test(value.meeting_url) && (
        <a href={value.meeting_url} rel="noreferrer" target="_blank">
          Open meeting link
        </a>
      )}
      {value.rrule && (
        <details>
          <summary>Repeats</summary>
          <p>{describeRrule(value.rrule)}</p>
        </details>
      )}
      <p>
        For {value.name || value.email} · Saved response: {value.status}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const status = choice;
          void op.run(
            () => {
              setSubmitted(status);
              return client.answerRsvp(token, status);
            },
            (r) => {
              requireReceipt(r, { status });
              accept(r);
            },
          );
        }}
      >
        <Field label="Your response">
          <SelectBox
            disabled={op.blocked || !fresh}
            value={choice}
            onChange={(e) => setChoice(e.target.value as typeof choice)}
          >
            <option value="accepted">Accept</option>
            <option value="tentative">Maybe</option>
            <option value="declined">Decline</option>
          </SelectBox>
        </Field>
        <p>Opening this link or choosing an answer does not send a response.</p>
        <Button variant="primary" type="submit" disabled={op.blocked || !fresh}>
          Send response
        </Button>
      </form>
      <CommandState op={op} check={check} />
    </>
  );
}
