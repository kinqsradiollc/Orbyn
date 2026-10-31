import {
  parseQuickAdd,
  type ItemInput,
  type QuickAddChip,
  type QuickAddMember,
} from "@orbyn/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";
import { useAccount } from "../../app/account";
import {
  Button,
  Dialog,
  ErrorNotice,
  Input,
  Pill,
  useConfirm,
  useToast,
} from "../../ui/kit";
import {
  blankItem,
  buildInput,
  carriedFields,
  draftFrom,
  withQuickAdd,
  type Draft,
} from "./draft";
import { deviceTimeZone } from "./format";
import { tasks } from "./host-store";
import { ItemFields } from "./ItemFields";
import type { Pending } from "./pickers";
import { createItem, refreshPlanner, usePlanning } from "./store";

const CHIP_WORDS: Partial<Record<QuickAddChip["kind"], string>> = {
  kind: "Type",
  date: "Date",
  time: "Time",
  duration: "Length",
  estimate: "Estimate",
  all_day: "All day",
  location: "Place",
  person: "Person",
  list: "List",
  tag: "Tag",
  priority: "Priority",
  repeat: "Repeats",
  habit: "Habit",
};

/**
 * One line that understands dates, lists, tags and people, and Enter to add.
 * "More details" turns the line into the full form, keeping what it read.
 * Text that arrives from a link only fills the line: adding stays deliberate.
 */
export function NewItem({
  text = "",
  prefill,
  onClose,
}: {
  text?: string;
  prefill?: Partial<ItemInput>;
  onClose: () => void;
}) {
  const { user } = useAccount();
  const { lists, tags, teams, canWriteIn } = usePlanning();
  const confirm = useConfirm();
  const toast = useToast();
  const [line, setLine] = useState(text || prefill?.title || "");
  const [form, setForm] = useState<Draft | null>(null);
  const [base, setBase] = useState<ItemInput>(() => blankItem(prefill));
  const [start, setStart] = useState("");
  const [members, setMembers] = useState<QuickAddMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<Pending>({}).current;
  // Retrying a create that may have reached the server can't make a second.
  const id = useRef(crypto.randomUUID()).current;
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    let alive = true;
    const people = new Map<string, QuickAddMember>();
    void Promise.allSettled(teams.map((team) => client.getTeam(team.id))).then(
      (results) => {
        if (!alive) return;
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          for (const m of result.value.members) {
            const known = people.get(m.user_id);
            if (known) known.team_ids.push(result.value.id);
            else
              people.set(m.user_id, {
                user_id: m.user_id,
                name: m.name,
                email: m.email,
                team_ids: [result.value.id],
              });
          }
        }
        setMembers([...people.values()]);
      },
    );
    return () => {
      alive = false;
    };
  }, [teams]);

  const parsed = useMemo(() => {
    const words = line.trim();
    if (!words || words.length > 500) return null;
    try {
      return parseQuickAdd(words, {
        timeZone: deviceTimeZone(),
        lists: lists.map((l) => ({
          id: l.id,
          name: l.name,
          team_id: l.team_id,
        })),
        tags: tags.map((t) => ({ id: t.id, name: t.name, team_id: t.team_id })),
        members,
        selfId: user?.id,
      });
    } catch {
      return null;
    }
  }, [line, lists, tags, members, user?.id]);

  const made = (title: string) => {
    toast({ text: `Added “${title.slice(0, 40)}”` });
    tasks.closeCreate();
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(messageOf(e, "Couldn't add this. Your text is still here."));
    } finally {
      setBusy(false);
    }
  };

  const addLine = () =>
    run(async () => {
      if (!parsed) return setError("Add a title.");
      if (parsed.habit) {
        await client.quickAdd(line.trim(), deviceTimeZone());
        await refreshPlanner().catch(() => undefined);
        toast({
          text: `Habit added: ${parsed.habit.name}`,
          action: { label: "View", run: () => navigate("/app/settings") },
        });
        tasks.closeCreate();
        return;
      }
      if (!parsed.input.title) return setError("Add a title.");
      const merged = blankItem(
        withQuickAdd(prefill, parsed.input, parsed.chips),
      );
      if (!canWriteIn(merged.team_id))
        return setError("You can only view that team's work.");
      await createItem({ ...merged, id });
      made(parsed.input.title);
    });

  const open = () => {
    const merged = blankItem(
      withQuickAdd(prefill, parsed?.input, parsed?.chips),
    );
    const draft = draftFrom(merged, false);
    setBase(merged);
    setForm(draft);
    setStart(JSON.stringify(draft.repeat));
    setError("");
  };

  const addForm = () =>
    run(async () => {
      if (!form) return;
      const unfinished = Object.entries(pending).find(([, on]) => on)?.[0];
      if (unfinished)
        return setError(
          `Add or clear the unfinished ${unfinished.replace(/s$/, "")} before saving.`,
        );
      const built = buildInput(
        form,
        base,
        { links: true, invitees: true },
        start,
      );
      if (built.error !== undefined) return setError(built.error);
      await createItem({
        ...carriedFields(base, form.teamId),
        ...built.data,
        id,
      });
      made(built.data.title);
    });

  const close = async () => {
    if (busy) return;
    const changed = form
      ? true
      : line.trim() !== (text || prefill?.title || "").trim();
    if (
      changed &&
      !(await confirm({
        title: "Discard this item?",
        body: "It hasn't been added.",
        action: "Discard",
        danger: true,
      }))
    )
      return;
    onClose();
  };

  return (
    <Dialog
      title={
        form ? (form.kind === "event" ? "New event" : "New task") : "New item"
      }
      wide={!!form}
      onClose={() => void close()}
      actions={
        <>
          {!form && (
            <Button variant="ghost" disabled={busy} onClick={open}>
              More details
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" disabled={busy} onClick={() => void close()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={form ? !form.title.trim() : !parsed}
            onClick={() => void (form ? addForm() : addLine())}
          >
            {parsed?.habit && !form ? "Add habit" : "Add"}
          </Button>
        </>
      }
    >
      {form ? (
        <>
          <Input
            ref={input}
            aria-label="Title"
            dir="auto"
            maxLength={200}
            placeholder="Title"
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addForm();
              }
            }}
          />
          <ItemFields
            draft={form}
            update={(change) => setForm((d) => (d ? change(d) : d))}
            baseTeam={base.team_id ?? null}
            linksState="ready"
            inviteesState="ready"
            pending={pending}
            showStatus
          />
        </>
      ) : (
        <>
          <Input
            ref={input}
            aria-label="What needs doing"
            dir="auto"
            maxLength={500}
            placeholder="Call Sam tomorrow 3pm #work !high"
            value={line}
            onChange={(event) => setLine(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void addLine();
              }
            }}
          />
          {parsed && (
            <div className="st-parsed" aria-live="polite">
              <span dir="auto">
                <strong>{parsed.habit?.name ?? parsed.input.title}</strong>
              </span>
              {parsed.chips
                .filter((chip) => chip.text.trim())
                .map((chip, index) => (
                  <Pill key={index} tone="blue">
                    {CHIP_WORDS[chip.kind]}: {chip.text}
                  </Pill>
                ))}
            </div>
          )}
        </>
      )}
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}
