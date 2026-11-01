import { useEffect, useRef, useState } from "react";
import {
  addDays,
  bookingRequest,
  inviteBookingRequest,
  isTimeZone,
  localDateKey,
  type BookingQuestion,
  type BookingReceipt,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input, TextArea, SelectBox } from "../../ui/kit";
import {
  assertBookingReceipt,
  CommandState,
  ReadState,
  Receipt,
  SlotRange,
  Slots,
  useCommand,
  useExit,
  useRead,
  zone,
  requireReceipt,
} from "./shared";
function questionError(
  questions: BookingQuestion[],
  answers: Record<string, string>,
) {
  for (const q of questions) {
    const a = (answers[q.id] || "").trim();
    if (q.required && !a) return `${q.label} is required.`;
    if (!a) continue;
    if (a.length > (q.type === "long_text" ? 2000 : 300))
      return `${q.label} is too long.`;
    if (q.type === "choice" && !q.options.includes(a))
      return `Choose an available answer for ${q.label}.`;
    if (q.type === "phone" && !/^\+?[\d\s().-]{6,30}$/.test(a))
      return `Enter a valid phone number for ${q.label}.`;
  }
  return "";
}
function Contact({
  name,
  email,
  note,
  answers,
  questions,
  disabled,
  onName,
  onEmail,
  onNote,
  onAnswer,
}: {
  name: string;
  email: string;
  note: string;
  answers: Record<string, string>;
  questions: BookingQuestion[];
  disabled: boolean;
  onName: (v: string) => void;
  onEmail: (v: string) => void;
  onNote: (v: string) => void;
  onAnswer: (id: string, v: string) => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>Your details</legend>
      <Field label="Name">
        <Input
          required
          autoComplete="name"
          maxLength={120}
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
      </Field>
      <Field label="Email">
        <Input
          required
          type="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => onEmail(e.target.value)}
        />
      </Field>
      {questions.map((q) => (
        <Field
          key={q.id}
          label={q.label}
          hint={q.required ? "Required" : "Optional"}
        >
          {q.type === "choice" ? (
            <SelectBox
              required={q.required}
              value={answers[q.id] || ""}
              onChange={(e) => onAnswer(q.id, e.target.value)}
            >
              <option value="">Choose an answer</option>
              {q.options.map((v, i) => (
                <option key={i} value={v}>
                  {v}
                </option>
              ))}
            </SelectBox>
          ) : q.type === "long_text" ? (
            <TextArea
              required={q.required}
              maxLength={2000}
              value={answers[q.id] || ""}
              onChange={(e) => onAnswer(q.id, e.target.value)}
            />
          ) : (
            <Input
              type={q.type === "phone" ? "tel" : "text"}
              required={q.required}
              maxLength={300}
              value={answers[q.id] || ""}
              onChange={(e) => onAnswer(q.id, e.target.value)}
            />
          )}
        </Field>
      ))}
      <Field
        label="Anything the host should know?"
        hint="Optional; shared with the host."
      >
        <TextArea
          maxLength={2000}
          value={note}
          onChange={(e) => onNote(e.target.value)}
        />
      </Field>
    </fieldset>
  );
}
export function PublicBook({ slug }: { slug: string }) {
  const op = useCommand(),
    [tz, setTz] = useState(zone()),
    [date, setDate] = useState(() => localDateKey(new Date(), zone())),
    [duration, setDuration] = useState<number | undefined>(),
    [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [note, setNote] = useState(""),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [receipt, setReceipt] = useState<BookingReceipt | null>(null),
    read = useRead(() => {
      if (!isTimeZone(tz))
        return Promise.reject(new Error("Enter a valid timezone."));
      return client.getPublicBookingPage(slug, {
        timezone: tz,
        date,
        days: 7,
        duration,
      });
    }, [slug, tz, date, duration]);
  useExit({
    dirty:
      !receipt &&
      !!(name || email || note || Object.values(answers).some(Boolean)),
  });
  const identity = useRef("");
  useEffect(() => {
    const next = JSON.stringify([slug, tz, date, duration]);
    if (identity.current !== next) {
      identity.current = next;
      setSelected("");
    }
  }, [slug, tz, date, duration]);
  async function submit() {
    if (
      !read.fresh ||
      !read.data ||
      !selected ||
      !read.data.slots.some((s) => s.start_at === selected)
    ) {
      op.reject("Choose a currently available time.");
      return;
    }
    const error = questionError(read.data.questions, answers);
    if (error) {
      op.reject(error);
      return;
    }
    const currentAnswers = Object.fromEntries(
      read.data.questions.map((q) => [q.id, answers[q.id] || ""]),
    );
    const parsed = bookingRequest.safeParse({
      start_at: selected,
      duration: read.data.duration,
      name,
      email,
      note,
      timezone: tz,
      answers: currentAnswers,
    });
    if (!parsed.success) {
      op.reject(parsed.error.issues[0]?.message || "Check your details.");
      return;
    }
    await op.run(
      () => client.book(slug, parsed.data),
      (r) => {
        assertBookingReceipt(r);
        if (!["pending", "awaiting_approval", "confirmed"].includes(r.status))
          throw new Error("Unexpected booking receipt status.");
        requireReceipt(r, {
          start_at: parsed.data.start_at,
          end_at: new Date(
            Date.parse(parsed.data.start_at) + parsed.data.duration * 60000,
          ).toISOString(),
        });
        setReceipt(r);
      },
    );
  }
  useEffect(() => {
    if (op.status === 409 && !op.unknown && !op.busy) {
      setSelected("");
      void read.reload();
    }
  }, [op.error]);
  const lastPage = useRef<typeof read.data>(undefined);
  if ([401, 403, 404, 410].includes(read.status ?? 0))
    lastPage.current = undefined;
  if (read.fresh && read.data) lastPage.current = read.data;
  const page =
    read.data ??
    (![401, 403, 404, 410].includes(read.status ?? 0)
      ? lastPage.current
      : undefined);
  return (
    <>
      <ReadState read={read}>
        {page && (
          <>
            <header>
              <p className="booking-web-eyebrow">
                Meet with {page.hosts.join(", ")}
              </p>
              <span
                className="booking-web-color-dot"
                aria-label="Page color"
                style={{
                  backgroundColor: "color" in page ? page.color : undefined,
                }}
              />
              <h1 dir="auto">{page.title}</h1>
              <p className="booking-web-description" dir="auto">
                {page.description}
              </p>
              <p>
                {page.location || "Location shared by host"}
                {page.has_meeting_link
                  ? " · Online meeting details follow confirmation"
                  : ""}
              </p>
            </header>
            {receipt ? (
              <Receipt value={receipt} />
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <fieldset disabled={op.blocked}>
                  <legend>Choose a time</legend>
                  <Field label="Meeting length">
                    <SelectBox
                      value={duration ?? page.duration}
                      onChange={(e) => {
                        setSelected("");
                        setDuration(Number(e.target.value));
                      }}
                    >
                      {page.durations.map((d) => (
                        <option key={d} value={d}>
                          {d} minutes
                        </option>
                      ))}
                    </SelectBox>
                  </Field>
                  <SlotRange
                    date={date}
                    onDate={(v) => {
                      setSelected("");
                      setDate(v);
                    }}
                    timezone={tz}
                    onZone={(v) => {
                      setSelected("");
                      setTz(v);
                    }}
                    disabled={op.blocked}
                  />
                  {read.fresh && isTimeZone(tz) && (
                    <Slots
                      slots={page.slots}
                      selected={selected}
                      onSelect={setSelected}
                      timezone={page.timezone}
                      disabled={op.blocked}
                    />
                  )}
                </fieldset>
                <Contact
                  name={name}
                  email={email}
                  note={note}
                  answers={answers}
                  questions={page.questions}
                  disabled={op.blocked}
                  onName={setName}
                  onEmail={setEmail}
                  onNote={setNote}
                  onAnswer={(id, v) => setAnswers({ ...answers, [id]: v })}
                />
                <p>
                  {page.requires_approval
                    ? "The host must approve requests."
                    : "A confirmation email may be required before the meeting is booked."}{" "}
                  Submitting shares these details with the host.
                </p>
                <Button
                  type="submit"
                  variant="primary"
                  busy={op.busy}
                  disabled={
                    op.unknown || !read.fresh || !selected || !isTimeZone(tz)
                  }
                >
                  Request this time
                </Button>
              </form>
            )}
          </>
        )}
      </ReadState>
      {read.error && duration !== undefined && (
        <Button
          disabled={op.blocked}
          onClick={() => {
            setSelected("");
            setDuration(undefined);
          }}
        >
          Reset meeting length
        </Button>
      )}
      <CommandState op={op} />
    </>
  );
}
export function PublicInviteBook({ token }: { token: string }) {
  const op = useCommand(),
    [tz, setTz] = useState(zone()),
    [date, setDate] = useState<string | null>(null),
    [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [note, setNote] = useState(""),
    [receipt, setReceipt] = useState<BookingReceipt | null>(null),
    read = useRead(
      () =>
        isTimeZone(tz)
          ? client.getPublicInvite(token, tz)
          : Promise.reject(new Error("Enter a valid timezone.")),
      [token, tz],
    );
  useExit({ dirty: !receipt && !!(name || email || note) });
  async function submit() {
    if (
      !read.fresh ||
      read.data?.status !== "open" ||
      !selected ||
      !read.data.slots.some((s) => s.start_at === selected)
    ) {
      op.reject("Choose an available time from this open invite.");
      return;
    }
    const parsed = inviteBookingRequest.safeParse({
      start_at: selected,
      name,
      email,
      note,
      timezone: tz,
    });
    if (!parsed.success) {
      op.reject(parsed.error.issues[0]?.message || "Check your details.");
      return;
    }
    await op.run(
      () => client.bookInvite(token, parsed.data),
      (r) => {
        assertBookingReceipt(r);
        requireReceipt(r, {
          start_at: parsed.data.start_at,
          status: "confirmed",
        });
        setReceipt(r);
      },
    );
  }
  useEffect(() => {
    if (op.status === 409 && !op.unknown && !op.busy) {
      setSelected("");
      void read.reload();
    }
  }, [op.error]);
  const lastPage = useRef<typeof read.data>(undefined);
  if ([401, 403, 404, 410].includes(read.status ?? 0))
    lastPage.current = undefined;
  if (read.fresh && read.data) lastPage.current = read.data;
  const page =
    read.data ??
    (![401, 403, 404, 410].includes(read.status ?? 0)
      ? lastPage.current
      : undefined);
  const shownDate =
    date ||
    (page?.slots[0]
      ? localDateKey(new Date(page.slots[0].start_at), page.timezone)
      : localDateKey(new Date(), zone()));
  const shownSlots =
    page?.slots.filter((s) => {
      const day = localDateKey(new Date(s.start_at), page.timezone);
      return day >= shownDate && day < addDays(shownDate, 7);
    }) || [];
  return (
    <ReadState read={read}>
      {page && (
        <>
          <header>
            <p className="booking-web-eyebrow">
              One-time invitation from {page.hosts.join(", ")}
            </p>
            <h1 dir="auto">{page.title}</h1>
            <p>
              {page.duration} minutes · {page.location}
            </p>
            <p>Invite expires {new Date(page.expires_at).toLocaleString()}.</p>
          </header>
          {receipt ? (
            <Receipt value={receipt} />
          ) : page.status !== "open" ? (
            <p role="status">
              This invite is {page.status}. It cannot accept another booking.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <SlotRange
                date={shownDate}
                onDate={(value) => {
                  setDate(value);
                  setSelected("");
                }}
                timezone={tz}
                onZone={(value) => {
                  setTz(value);
                  setDate(null);
                  setSelected("");
                }}
                disabled={op.blocked}
              />
              {read.fresh && isTimeZone(tz) && (
                <Slots
                  slots={shownSlots}
                  selected={selected}
                  onSelect={setSelected}
                  timezone={page.timezone}
                  disabled={op.blocked}
                />
              )}
              <Contact
                name={name}
                email={email}
                note={note}
                questions={[]}
                answers={{}}
                disabled={op.blocked}
                onName={setName}
                onEmail={setEmail}
                onNote={setNote}
                onAnswer={() => {}}
              />
              <p>
                This one-use invite books the selected time immediately. Your
                details are shared with the host.
              </p>
              <Button
                variant="primary"
                type="submit"
                busy={op.busy}
                disabled={op.unknown || !read.fresh || !selected}
              >
                Book this invitation
              </Button>
            </form>
          )}
          <CommandState op={op} />
        </>
      )}
    </ReadState>
  );
}
