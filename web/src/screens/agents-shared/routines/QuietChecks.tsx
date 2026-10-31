import {
  routineQuietPolicy,
  type FindHit,
  type RoutineQuietCheck,
  type RoutineQuietChecksPage,
  type RoutineQuietPolicy,
  type RoutineQuietPolicyPage,
  type RoutineQuietSource,
} from "@orbyn/core";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import {
  Button,
  ErrorNotice,
  IconButton,
  Input,
  Segmented,
} from "../../../ui/kit";
import { useOwned } from "../hooks";
import { Check } from "../parts";
import { unavailable, uuid } from "../words";

const keyOf = (source: RoutineQuietSource) => `${source.kind}:${source.id}`;

/** Which specific sources let a verified unchanged result stay quiet. */
export function QuietPolicyEditor({
  routineId,
  disabled,
}: {
  routineId: string;
  disabled: boolean;
}) {
  const owned = useOwned();
  const ticket = useRef(0);
  const searches = useRef(0);
  const lock = useRef(false);
  const blocked = useRef(disabled);
  blocked.current = disabled;
  const request = useRef<{ key: string; id: string } | null>(null);
  const [page, setPage] = useState<RoutineQuietPolicyPage | null>(null);
  const [draft, setDraft] = useState<RoutineQuietPolicy | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [stale, setStale] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"task" | "doc">("task");
  const [hits, setHits] = useState<FindHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");

  const clearSearch = (keepQuery = false) => {
    setHits([]);
    setSearched(false);
    setSearchError("");
    if (!keepQuery) setQuery("");
    searches.current++;
    setSearching(false);
  };
  const erase = () => {
    setPage(null);
    setDraft(null);
    setLabels({});
    clearSearch();
  };
  const adopt = (value: RoutineQuietPolicyPage, replace: boolean) => {
    setPage(value);
    if (value.visibility !== "available") {
      setDraft(null);
      setLabels({});
      clearSearch();
      return;
    }
    setDraft((old) => (replace ? value.policy : (old ?? value.policy)));
    const named = Object.fromEntries(
      value.labels.map((source) => [keyOf(source), source.title]),
    );
    setLabels((old) => (replace ? named : { ...old, ...named }));
  };
  const load = async () => {
    if (!owned() || lock.current) return;
    lock.current = true;
    const mine = ++ticket.current;
    setBusy(true);
    setError("");
    try {
      const value = await client.routineQuietPolicy(routineId);
      if (!owned() || mine !== ticket.current) return;
      adopt(value, false);
      setStale(false);
    } catch (failure) {
      if (owned() && mine === ticket.current) {
        if (unavailable(failure)) erase();
        setStale(true);
        setError(messageOf(failure, "Couldn't load quiet checks."));
      }
    } finally {
      if (mine === ticket.current) {
        lock.current = false;
        if (owned()) setBusy(false);
      }
    }
  };
  useEffect(() => {
    void load();
    return () => {
      ticket.current++;
      searches.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty =
    !!draft &&
    page?.visibility === "available" &&
    JSON.stringify(draft) !== JSON.stringify(page.policy);
  const save = async (clearRestricted = false) => {
    if (!owned() || blocked.current || lock.current || stale || !page) return;
    if (clearRestricted ? page.visibility !== "restricted" : !dirty) return;
    const checked = routineQuietPolicy.safeParse(
      clearRestricted ? { enabled: false, sources: [] } : draft,
    );
    if (!checked.success) {
      setError(
        checked.error.issues[0]?.message ?? "Check the selected sources.",
      );
      return;
    }
    const body = { expected_revision: page.revision, policy: checked.data };
    const key = JSON.stringify(body);
    if (request.current?.key !== key) request.current = { key, id: uuid() };
    lock.current = true;
    const mine = ++ticket.current;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const value = await client.updateRoutineQuietPolicy(routineId, {
        ...body,
        request_id: request.current.id,
      });
      if (!owned() || mine !== ticket.current) return;
      adopt(value, true);
      if (value.visibility === "available") setSaved(true);
    } catch (failure) {
      if (owned() && mine === ticket.current) {
        if (unavailable(failure)) erase();
        if ((failure as { statusCode?: number }).statusCode === 409)
          setStale(true);
        setError(messageOf(failure, "Couldn't save quiet checks."));
      }
    } finally {
      if (mine === ticket.current) {
        lock.current = false;
        if (owned()) setBusy(false);
      }
    }
  };
  const search = async () => {
    if (
      !owned() ||
      blocked.current ||
      busy ||
      !query.trim() ||
      page?.visibility !== "available"
    )
      return;
    const mine = ++searches.current;
    setSearching(true);
    setSearchError("");
    setHits([]);
    setSearched(false);
    try {
      const values = await client.find(query.trim(), { type: kind, limit: 20 });
      if (owned() && mine === searches.current && !blocked.current) {
        setHits(values.filter((value) => value.type === kind).slice(0, 20));
        setSearched(true);
      }
    } catch (failure) {
      if (owned() && mine === searches.current) {
        if (unavailable(failure)) erase();
        setSearchError(messageOf(failure, "Couldn't search sources."));
      }
    } finally {
      if (owned() && mine === searches.current) setSearching(false);
    }
  };
  const edit = (value: RoutineQuietPolicy) => {
    if (!owned() || blocked.current || busy) return;
    setDraft(value);
    setSaved(false);
  };
  const locked = busy || disabled || stale;
  return (
    <section className="agents-policy" aria-label="Quiet checks">
      <h3>Quiet checks</h3>
      <p className="muted small">
        Choose up to 20 specific tasks or pages. After a baseline, verified
        unchanged checks can stay quiet. Missing reads, changes, questions and
        approvals stay visible.
      </p>
      <p className="muted small">
        Checks cover a task's own fields and notes, or a page's title and block
        content. Linked files, child tasks, sessions and external sources are
        outside this check. Selecting a source grants no new access.
      </p>
      {disabled && (
        <p className="small">
          Save routine changes before editing quiet checks.
        </p>
      )}
      {error && <ErrorNotice message={error} />}
      {(!page || stale) && (
        <div className="agents-buttons">
          <Button disabled={busy} onClick={() => void load()}>
            {busy ? "Loading…" : "Reload quiet-check settings"}
          </Button>
        </div>
      )}
      {page?.visibility === "restricted" && (
        <>
          <p className="small">
            Selected source details are unavailable. Quiet checks are{" "}
            {page.enabled ? "enabled" : "off"} for {page.source_count} sources.
            You can turn off this check and choose accessible sources again.
          </p>
          <div className="agents-buttons">
            <Button disabled={locked} onClick={() => void save(true)}>
              Turn off and clear sources
            </Button>
          </div>
        </>
      )}
      {page?.visibility === "available" && draft && (
        <>
          <Check
            label="Quiet verified unchanged checks"
            checked={draft.enabled}
            disabled={locked}
            onChange={() => edit({ ...draft, enabled: !draft.enabled })}
          />
          <p className="muted small">
            {draft.sources.length} of 20 sources selected
          </p>
          {draft.sources.length > 0 && (
            <ul className="agents-sources-picked">
              {draft.sources.map((source) => {
                const label = labels[keyOf(source)];
                return (
                  <li key={keyOf(source)}>
                    <span dir="auto">
                      <span className="muted small">
                        {source.kind === "doc" ? "Page" : "Task"}
                      </span>{" "}
                      {label ?? "Source no longer available"}
                    </span>
                    <IconButton
                      label={`Remove ${label ?? "source"}`}
                      disabled={locked}
                      onClick={() =>
                        edit({
                          ...draft,
                          sources: draft.sources.filter(
                            (one) => keyOf(one) !== keyOf(source),
                          ),
                        })
                      }
                    >
                      <X />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="agents-search"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Segmented
              label="Source type"
              value={kind}
              options={[
                { value: "task", label: "Tasks" },
                { value: "doc", label: "Pages" },
              ]}
              onChange={(value) => {
                setKind(value);
                clearSearch(true);
              }}
            />
            <Input
              type="search"
              aria-label={
                kind === "task" ? "Find tasks to check" : "Find pages to check"
              }
              placeholder={
                kind === "task" ? "Find tasks to check" : "Find pages to check"
              }
              value={query}
              disabled={locked}
              onChange={(event) => {
                setQuery(event.target.value);
                clearSearch(true);
              }}
            />
            <Button
              type="submit"
              disabled={locked || searching || !query.trim()}
            >
              {searching ? "Searching…" : "Search sources"}
            </Button>
          </form>
          {searchError && <ErrorNotice message={searchError} />}
          {searched && !hits.length && !searchError && (
            <p className="muted small">
              No matching sources found. Try different words.
            </p>
          )}
          {hits.length > 0 && (
            <div className="agents-chips">
              {hits.map((hit) => {
                const source = { kind: hit.type as "task" | "doc", id: hit.id };
                const selected = draft.sources.some(
                  (one) => keyOf(one) === keyOf(source),
                );
                return (
                  <button
                    key={keyOf(source)}
                    type="button"
                    disabled={locked || selected || draft.sources.length >= 20}
                    dir="auto"
                    onClick={() => {
                      setLabels((old) => ({
                        ...old,
                        [keyOf(source)]: hit.title,
                      }));
                      edit({ ...draft, sources: [...draft.sources, source] });
                    }}
                  >
                    {selected ? "Selected" : "Add"}: {hit.title}
                  </button>
                );
              })}
            </div>
          )}
          <div className="agents-buttons">
            <Button disabled={locked || !dirty} onClick={() => void save()}>
              {busy ? "Saving…" : "Save quiet-check settings"}
            </Button>
            {saved && (
              <span className="agents-done small" role="status">
                Quiet-check settings saved.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const STATUS: Record<RoutineQuietCheck["status"], string> = {
  pending: "Check pending",
  baseline: "Baseline recorded",
  verified_unchanged: "Verified unchanged",
  changed: "Changes detected",
  reported: "No-change request recorded",
  incomplete: "Check incomplete",
};

/** What one occurrence actually observed about its sources. */
export function OccurrenceQuietChecks({
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
  const owned = useOwned();
  const ticket = useRef(0);
  const lock = useRef(false);
  const blocked = useRef(disabled);
  blocked.current = disabled;
  const [page, setPage] = useState<RoutineQuietChecksPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState(false);
  const load = async () => {
    if (!owned() || lock.current) return;
    lock.current = true;
    const mine = ++ticket.current;
    setBusy(true);
    setError("");
    setFresh(false);
    try {
      const value = await client.routineQuietChecks(routineId, occurrenceId);
      if (owned() && mine === ticket.current) {
        setPage(value);
        setFresh(true);
      }
    } catch (failure) {
      if (owned() && mine === ticket.current) {
        if (unavailable(failure)) setPage(null);
        setError(messageOf(failure, "Couldn't load quiet-check evidence."));
      }
    } finally {
      if (mine === ticket.current) {
        lock.current = false;
        if (owned()) setBusy(false);
      }
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="agents-stack">
      <div className="agents-buttons">
        <Button
          variant="ghost"
          disabled={busy || disabled}
          onClick={() => void load()}
        >
          {busy ? "Loading…" : "Refresh quiet-check evidence"}
        </Button>
      </div>
      {error && <ErrorNotice message={error} />}
      {page && !page.configured && (
        <p className="small">
          Quiet checks were not configured for this occurrence.
        </p>
      )}
      {page?.configured && page.checks.length === 0 && (
        <p className="small">
          No retained quiet-check evidence for this occurrence.
        </p>
      )}
      {page?.checks.map((check) => (
        <div key={check.id} className="agents-stack">
          <strong className="small">{STATUS[check.status]}</strong>
          <p className="muted small">
            {check.checked_count} of {check.expected_count} sources checked
            {check.observed_at
              ? ` · Observed ${new Date(check.observed_at).toLocaleString()}`
              : ""}
          </p>
          {check.status === "baseline" && (
            <p className="small">
              The first complete observation is a baseline, not proof that
              nothing changed.
            </p>
          )}
          {check.status === "reported" && (
            <p className="small">
              A no-change request alone does not verify the selected sources.
            </p>
          )}
          {!!check.reason && (
            <p className="small" dir="auto">
              {check.reason}
            </p>
          )}
          {check.visibility === "restricted" ? (
            <p className="small">
              Source and result details are no longer available.
            </p>
          ) : (
            <>
              {check.sources.map((source) => (
                <p key={keyOf(source)} className="small" dir="auto">
                  {source.kind === "doc" ? "Page" : "Task"}: {source.title} ·{" "}
                  {source.state}
                  {source.checked_at
                    ? ` · ${new Date(source.checked_at).toLocaleString()}`
                    : ""}
                  {source.reason ? ` · ${source.reason}` : ""}
                </p>
              ))}
              {check.chat_id && onOpenChat && (
                <div className="agents-buttons">
                  <Button
                    variant="ghost"
                    disabled={busy || disabled || !fresh}
                    onClick={() => {
                      if (owned() && !blocked.current && fresh && check.chat_id)
                        onOpenChat(check.chat_id);
                    }}
                  >
                    Open check result
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
