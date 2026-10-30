import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  HttpError,
  errorMessage,
  routineQuietPolicy,
  type RoutineQuietSource,
  type RoutineQuietPolicy,
  type RoutineQuietPolicyPage,
  type RoutineQuietCheck,
  type RoutineQuietChecksPage,
  type FindHit,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
const uuid = () => crypto.randomUUID();
const binding = () => session.binding();
const Block = ({ children }: { children: ReactNode }) => (
  <div className="settings-subform">{children}</div>
);
const Copy = ({ children }: { children: ReactNode }) => (
  <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{children}</p>
);
const Heading = ({ children }: { children: ReactNode }) => (
  <strong>{children}</strong>
);
const Notice = ({ children }: { children: ReactNode }) => (
  <p className="error" role="alert">
    {children}
  </p>
);
const Action = ({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) => (
  <button
    type="button"
    className="text-button"
    disabled={disabled}
    onClick={onPress}
  >
    {label}
  </button>
);
const Toggle = ({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) => (
  <label>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
    {label}
  </label>
);
const SearchField = ({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) => (
  <label className="settings-field">
    {label}
    <input
      type="search"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  </label>
);
const sourceKey = (source: RoutineQuietSource) => `${source.kind}:${source.id}`;
const identity = () => `${binding().generation}:${binding().token}`;
const unavailable = (error: unknown) =>
  error instanceof HttpError && [401, 403, 404].includes(error.statusCode);
export function RoutineQuietPolicyEditor(props: {
  routineId: string;
  disabled: boolean;
}) {
  return <PolicyBody key={`${identity()}:${props.routineId}`} {...props} />;
}
function PolicyBody({
  routineId,
  disabled,
}: {
  routineId: string;
  disabled: boolean;
}) {
  const owner = useRef(identity()).current,
    mounted = useRef(true),
    sequence = useRef(0),
    searches = useRef(0),
    lock = useRef(false),
    latestDisabled = useRef(disabled),
    request = useRef<{ key: string; id: string } | null>(null);
  latestDisabled.current = disabled;
  const current = () => mounted.current && identity() === owner;
  const [page, setPage] = useState<RoutineQuietPolicyPage | null>(null),
    [draft, setDraft] = useState<RoutineQuietPolicy | null>(null),
    [labels, setLabels] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [stale, setStale] = useState(false);
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState<"task" | "doc">("task"),
    [hits, setHits] = useState<FindHit[]>([]),
    [searching, setSearching] = useState(false),
    [searched, setSearched] = useState(false),
    [searchError, setSearchError] = useState("");
  const erase = () => {
    setPage(null);
    setDraft(null);
    setLabels({});
    setHits([]);
    setSearched(false);
    setQuery("");
    ++searches.current;
    setSearching(false);
  };
  const load = async () => {
    if (!current() || lock.current) return;
    lock.current = true;
    const ticket = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const value = await client.routineQuietPolicy(routineId);
      if (!current() || ticket !== sequence.current) return;
      setPage(value);
      setStale(false);
      if (value.visibility === "available") {
        setDraft((old) => old ?? value.policy);
        setLabels((old) => ({
          ...old,
          ...Object.fromEntries(
            value.labels.map((source) => [sourceKey(source), source.title]),
          ),
        }));
      } else {
        setDraft(null);
        setLabels({});
        setHits([]);
        setSearched(false);
        setQuery("");
        ++searches.current;
        setSearching(false);
      }
    } catch (error) {
      if (current() && ticket === sequence.current) {
        if (unavailable(error)) erase();
        setStale(true);
        setError(errorMessage(error));
      }
    } finally {
      if (ticket === sequence.current) {
        lock.current = false;
        if (current()) setBusy(false);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      ++sequence.current;
      ++searches.current;
      lock.current = false;
    };
  }, []);
  const dirty =
    !!draft &&
    page?.visibility === "available" &&
    JSON.stringify(draft) !== JSON.stringify(page.policy);
  const save = async (clearRestricted = false) => {
    if (
      !current() ||
      latestDisabled.current ||
      lock.current ||
      stale ||
      (!dirty && !clearRestricted) ||
      (!draft && !clearRestricted) ||
      !page
    )
      return;
    if (clearRestricted && page.visibility !== "restricted") return;
    const checked = routineQuietPolicy.safeParse(
      clearRestricted ? { enabled: false, sources: [] } : draft,
    );
    if (!checked.success) {
      setError(
        checked.error.issues[0]?.message ?? "Check the selected sources.",
      );
      return;
    }
    const body = { expected_revision: page.revision, policy: checked.data },
      key = JSON.stringify(body);
    if (request.current?.key !== key) request.current = { key, id: uuid() };
    lock.current = true;
    const ticket = ++sequence.current;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const value = await client.updateRoutineQuietPolicy(routineId, {
        ...body,
        request_id: request.current.id,
      });
      if (!current() || ticket !== sequence.current) return;
      setPage(value);
      if (value.visibility === "available") {
        setDraft(value.policy);
        setLabels(
          Object.fromEntries(
            value.labels.map((source) => [sourceKey(source), source.title]),
          ),
        );
        setSaved(true);
      } else {
        setDraft(null);
        setLabels({});
        setHits([]);
        setSearched(false);
        setQuery("");
        ++searches.current;
        setSearching(false);
      }
    } catch (error) {
      if (current() && ticket === sequence.current) {
        if (unavailable(error)) erase();
        if (error instanceof HttpError && error.statusCode === 409)
          setStale(true);
        setError(errorMessage(error));
      }
    } finally {
      if (ticket === sequence.current) {
        lock.current = false;
        if (current()) setBusy(false);
      }
    }
  };
  const search = async () => {
    if (
      !current() ||
      latestDisabled.current ||
      busy ||
      !query.trim() ||
      page?.visibility !== "available"
    )
      return;
    const ticket = ++searches.current;
    setSearching(true);
    setSearchError("");
    setHits([]);
    setSearched(false);
    try {
      const values = await client.find(query.trim(), { type: kind, limit: 20 });
      if (current() && ticket === searches.current && !latestDisabled.current) {
        setHits(values.filter((value) => value.type === kind).slice(0, 20));
        setSearched(true);
      }
    } catch (error) {
      if (current() && ticket === searches.current) {
        if (unavailable(error)) erase();
        setSearchError(errorMessage(error));
      }
    } finally {
      if (current() && ticket === searches.current) setSearching(false);
    }
  };
  const edit = (value: RoutineQuietPolicy) => {
    if (!current() || latestDisabled.current || busy) return;
    setDraft(value);
    setSaved(false);
  };
  return (
    <Block>
      <Heading>Quiet checks</Heading>
      <Copy>
        Choose up to 20 specific tasks or pages. After a baseline, verified
        unchanged checks can stay quiet. Missing reads, changes, questions and
        approvals stay visible.
      </Copy>
      <Copy>
        Checks cover a task’s own fields and notes, or a page’s title and block
        content. Linked files, child tasks, sessions and external sources are
        outside this check. Selecting a source grants no new access.
      </Copy>
      {disabled && (
        <Copy>Save routine changes before editing quiet checks.</Copy>
      )}
      {!!error && <Notice>{error}</Notice>}
      {(!page || stale) && (
        <Action
          label={busy ? "Loading…" : "Reload quiet-check settings"}
          disabled={busy}
          onPress={() => void load()}
        />
      )}
      {page?.visibility === "restricted" && (
        <Block>
          <Copy>
            Selected source details are unavailable. Quiet checks are{" "}
            {page.enabled ? "enabled" : "off"} for {page.source_count} sources.
            You can turn off this check and choose accessible sources again.
          </Copy>
          <Action
            label="Turn off and clear sources"
            disabled={busy || disabled || stale}
            onPress={() => void save(true)}
          />
        </Block>
      )}
      {page?.visibility === "available" && draft && (
        <Block>
          <Toggle
            label="Quiet verified unchanged checks"
            checked={draft.enabled}
            disabled={busy || disabled || stale}
            onChange={() => edit({ ...draft, enabled: !draft.enabled })}
          />
          <Copy>{draft.sources.length} of 20 sources selected</Copy>
          {draft.sources.map((source) => (
            <Block key={sourceKey(source)}>
              <Copy>
                {source.kind === "doc" ? "Page" : "Task"}:{" "}
                {labels[sourceKey(source)] ?? "Source no longer available"}
              </Copy>
              <Action
                label={`Remove ${labels[sourceKey(source)] ?? "source"}`}
                disabled={busy || disabled || stale}
                onPress={() =>
                  edit({
                    ...draft,
                    sources: draft.sources.filter(
                      (value) => sourceKey(value) !== sourceKey(source),
                    ),
                  })
                }
              />
            </Block>
          ))}
          <Block>
            <Action
              label={kind === "task" ? "Search tasks selected" : "Search tasks"}
              disabled={busy || disabled || stale}
              onPress={() => {
                setKind("task");
                setHits([]);
                setSearched(false);
                setSearchError("");
                ++searches.current;
                setSearching(false);
              }}
            />
            <Action
              label={kind === "doc" ? "Search pages selected" : "Search pages"}
              disabled={busy || disabled || stale}
              onPress={() => {
                setKind("doc");
                setHits([]);
                setSearched(false);
                setSearchError("");
                ++searches.current;
                setSearching(false);
              }}
            />
            <SearchField
              label={
                kind === "task" ? "Find tasks to check" : "Find pages to check"
              }
              value={query}
              disabled={busy || disabled || stale}
              onChange={(value) => {
                setQuery(value);
                setHits([]);
                setSearched(false);
                setSearchError("");
                ++searches.current;
                setSearching(false);
              }}
            />
            <Action
              label={searching ? "Searching…" : "Search sources"}
              disabled={busy || disabled || stale || searching || !query.trim()}
              onPress={() => void search()}
            />
            {!!searchError && <Notice>{searchError}</Notice>}
            {searched && !hits.length && !searchError && (
              <Copy>No matching sources found. Try different words.</Copy>
            )}
            {hits.map((hit) => {
              const source = { kind: hit.type as "task" | "doc", id: hit.id },
                selected = draft.sources.some(
                  (value) => sourceKey(value) === sourceKey(source),
                );
              return (
                <Action
                  key={sourceKey(source)}
                  label={`${selected ? "Selected" : "Add"}: ${hit.title}`}
                  disabled={
                    busy ||
                    disabled ||
                    stale ||
                    selected ||
                    draft.sources.length >= 20
                  }
                  onPress={() => {
                    setLabels((old) => ({
                      ...old,
                      [sourceKey(source)]: hit.title,
                    }));
                    edit({ ...draft, sources: [...draft.sources, source] });
                  }}
                />
              );
            })}
          </Block>
          <Action
            label={busy ? "Saving…" : "Save quiet-check settings"}
            disabled={busy || disabled || stale || !dirty}
            onPress={() => void save()}
          />
          {saved && <Copy>Quiet-check settings saved.</Copy>}
        </Block>
      )}
    </Block>
  );
}
const statuses: Record<RoutineQuietCheck["status"], string> = {
  pending: "Check pending",
  baseline: "Baseline recorded",
  verified_unchanged: "Verified unchanged",
  changed: "Changes detected",
  reported: "No-change request recorded",
  incomplete: "Check incomplete",
};
export function RoutineQuietChecks(props: {
  routineId: string;
  occurrenceId: string;
  disabled: boolean;
  onOpenChat?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Block>
      <Action
        label={open ? "Hide quiet-check evidence" : "Quiet-check evidence"}
        disabled={props.disabled}
        onPress={() => setOpen((value) => !value)}
      />
      {open && (
        <ChecksBody key={`${identity()}:${props.occurrenceId}`} {...props} />
      )}
    </Block>
  );
}
function ChecksBody({
  routineId,
  occurrenceId,
  disabled,
  onOpenChat,
}: {
  routineId: string;
  occurrenceId: string;
  disabled: boolean;
  onOpenChat?: (id: string) => void;
}) {
  const owner = useRef(identity()).current,
    mounted = useRef(true),
    sequence = useRef(0),
    lock = useRef(false),
    latestDisabled = useRef(disabled);
  latestDisabled.current = disabled;
  const [page, setPage] = useState<RoutineQuietChecksPage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fresh, setFresh] = useState(false);
  const current = () => mounted.current && identity() === owner;
  const load = async () => {
    if (!current() || lock.current) return;
    lock.current = true;
    const ticket = ++sequence.current;
    setBusy(true);
    setError("");
    setFresh(false);
    try {
      const value = await client.routineQuietChecks(routineId, occurrenceId);
      if (current() && ticket === sequence.current) {
        setPage(value);
        setFresh(true);
      }
    } catch (error) {
      if (current() && ticket === sequence.current) {
        if (unavailable(error)) setPage(null);
        setError(errorMessage(error));
      }
    } finally {
      if (ticket === sequence.current) {
        lock.current = false;
        if (current()) setBusy(false);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      ++sequence.current;
      lock.current = false;
    };
  }, []);
  return (
    <Block>
      <Action
        label={busy ? "Loading…" : "Refresh quiet-check evidence"}
        disabled={busy || disabled}
        onPress={() => void load()}
      />
      {!!error && <Notice>{error}</Notice>}
      {page && !page.configured && (
        <Copy>Quiet checks were not configured for this occurrence.</Copy>
      )}
      {page?.configured && page.checks.length === 0 && (
        <Copy>No retained quiet-check evidence for this occurrence.</Copy>
      )}
      {page?.checks.map((check) => (
        <Block key={check.id}>
          <Heading>{statuses[check.status]}</Heading>
          <Copy>
            {check.checked_count} of {check.expected_count} sources checked
            {check.observed_at
              ? ` · Observed ${new Date(check.observed_at).toLocaleString()}`
              : ""}
          </Copy>
          {check.status === "baseline" && (
            <Copy>
              The first complete observation is a baseline, not proof that
              nothing changed.
            </Copy>
          )}
          {check.status === "reported" && (
            <Copy>
              A no-change request alone does not verify the selected sources.
            </Copy>
          )}
          {!!check.reason && <Copy>{check.reason}</Copy>}
          {check.visibility === "restricted" ? (
            <Copy>Source and result details are no longer available.</Copy>
          ) : (
            <Block>
              {check.sources.map((source) => (
                <Copy key={sourceKey(source)}>
                  {source.kind === "doc" ? "Page" : "Task"}: {source.title} ·{" "}
                  {source.state}
                  {source.checked_at
                    ? ` · ${new Date(source.checked_at).toLocaleString()}`
                    : ""}
                  {source.reason ? ` · ${source.reason}` : ""}
                </Copy>
              ))}
              {check.chat_id && onOpenChat && (
                <Action
                  label="Open check result"
                  disabled={busy || disabled || !fresh}
                  onPress={() => {
                    if (
                      current() &&
                      !latestDisabled.current &&
                      fresh &&
                      check.chat_id
                    )
                      onOpenChat(check.chat_id);
                  }}
                />
              )}
            </Block>
          )}
        </Block>
      ))}
    </Block>
  );
}
