import { PagePublicationStore } from "@orbyn/api-client";
import {
  blockText,
  type Doc,
  type DocBlock,
  type PublishState,
} from "@orbyn/core";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { messageOf } from "../../../lib/resource";
import { client, getToken } from "../../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  useConfirm,
  useToast,
} from "../../../ui/kit";

const absolute = (path: string) => new URL(path, location.origin).href;

/** Publish a folder, or share a page's chosen blocks. */
export function PublishDialog({
  kind,
  id,
  title,
  onClose,
}: {
  kind: "doc" | "folder";
  id: string;
  title: string;
  onClose: () => void;
}) {
  if (kind === "doc") return <PublicationDialog id={id} onClose={onClose} />;
  return <FolderPublish id={id} title={title} onClose={onClose} />;
}

export function PublicationDialog({
  id,
  onChanged,
  onClose,
}: {
  id: string;
  onChanged?: (doc: Doc) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const store = useMemo(
    () =>
      new PagePublicationStore(client, id, getToken, (doc) =>
        changed.current?.(doc),
      ),
    [id],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.prepare();
    return () => store.dispose();
  }, [store]);
  const blocks: DocBlock[] = state.doc?.content ?? [];
  const publication = state.publication;
  const path = publication?.path;
  const url = path ? absolute(path) : "";
  const copy = (value: string) =>
    void navigator.clipboard.writeText(value).then(
      () => toast({ text: "Link copied" }),
      () => toast({ text: "Couldn't copy the link", error: true }),
    );
  return (
    <Dialog title="Share page" wide onClose={() => !state.busy && onClose()}>
      {state.error && (
        <ErrorNotice
          message={state.error}
          onRetry={state.doc ? undefined : () => void store.prepare()}
        />
      )}
      {!state.doc && !state.error && <Loading label="Loading sharing" />}
      {state.legacyPath && (
        <div className="page-note small">
          <span>An older link still shares this whole page.</span>
          <Button
            variant="ghost"
            disabled={state.busy}
            onClick={() => void store.revokeLegacy()}
          >
            Turn off
          </Button>
        </div>
      )}
      {state.folderPath && (
        <p className="small muted">
          This page is also public through its folder.
        </p>
      )}
      {publication && url && (
        <section aria-label="Current link" className="page-share-link">
          <Input readOnly aria-label="The address" value={url} />
          <Button onClick={() => copy(url)}>Copy link</Button>
          <Button
            variant="danger"
            disabled={state.busy}
            onClick={() => void store.revoke()}
          >
            Turn off sharing
          </Button>
        </section>
      )}
      {state.doc && (
        <>
          <fieldset className="page-blocks">
            <legend className="small">Shared blocks</legend>
            {blocks
              .filter((block) => block.id)
              .map((block) => (
                <label key={block.id} className="check small">
                  <input
                    type="checkbox"
                    checked={state.selected.includes(block.id!)}
                    disabled={state.busy}
                    onChange={(event) =>
                      store.configure({
                        selected: event.currentTarget.checked
                          ? [...state.selected, block.id!]
                          : state.selected.filter((one) => one !== block.id),
                      })
                    }
                  />
                  <span dir="auto">
                    {blockText(block).slice(0, 120) || block.type}
                  </span>
                </label>
              ))}
          </fieldset>
          <div className="page-share-options">
            <Field label="What it shows">
              <select
                className="input"
                value={state.mode}
                disabled={state.busy}
                onChange={(event) =>
                  store.configure({
                    mode: event.currentTarget.value as "snapshot" | "live",
                  })
                }
              >
                <option value="snapshot">Saved snapshot</option>
                <option value="live">Live selected blocks</option>
              </select>
            </Field>
            <Field label="Link ends">
              <select
                className="input"
                value={state.expiryDays}
                disabled={state.busy}
                onChange={(event) =>
                  store.configure({
                    expiryDays: Number(event.currentTarget.value) as 0 | 7 | 30,
                  })
                }
              >
                <option value={7}>In 7 days</option>
                <option value={30}>In 30 days</option>
                <option value={0}>Never</option>
              </select>
            </Field>
          </div>
          <label className="check small">
            <input
              type="checkbox"
              checked={state.consent}
              disabled={state.busy}
              onChange={(event) =>
                store.configure({ consent: event.currentTarget.checked })
              }
            />
            Anyone with the link can read the selected blocks.
          </label>
          <div className="dialog-actions">
            <Button variant="ghost" disabled={state.busy} onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              busy={state.busy}
              disabled={!state.consent || !state.selected.length}
              onClick={() => void store.save()}
            >
              {publication ? "Update link" : "Create link"}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function FolderPublish({
  id,
  title,
  onClose,
}: {
  id: string;
  title: string;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [state, setState] = useState<PublishState | null>(null);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [hidden, setHidden] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const take = (next: PublishState) => {
    setState(next);
    setSlug(next.published?.slug ?? "");
    setDescription(next.published?.description ?? "");
    setHidden(next.published?.noindex ?? true);
    setPassword("");
  };
  const load = () => {
    setError("");
    client
      .getPublish("folder", id)
      .then(take, (failure) =>
        setError(messageOf(failure, "Couldn't load publishing.")),
      );
  };
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await client.publish("folder", id, {
        slug: slug.trim() || undefined,
        description: description.trim() || null,
        noindex: hidden,
        ...(password ? { password } : {}),
      } as never);
      take(await client.getPublish("folder", id));
      toast({ text: "Folder published." });
    } catch (failure) {
      setError(messageOf(failure, "Couldn't publish this folder."));
    } finally {
      setBusy(false);
    }
  };
  const unpublish = async () => {
    const ok = await confirm({
      title: "Unpublish this folder?",
      body: "Its link stops working at once.",
      action: "Unpublish",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await client.unpublish("folder", id);
      take(await client.getPublish("folder", id));
    } catch (failure) {
      setError(messageOf(failure, "Couldn't unpublish this folder."));
    } finally {
      setBusy(false);
    }
  };
  const url = state?.published?.path ? absolute(state.published.path) : "";
  return (
    <Dialog title={`Publish ${title}`} onClose={onClose}>
      {error && (
        <ErrorNotice message={error} onRetry={state ? undefined : load} />
      )}
      {!state && !error && <Loading label="Loading publishing" />}
      {state && (
        <>
          {url && (
            <div className="page-share-link">
              <Input readOnly aria-label="The address" value={url} />
              <Button onClick={() => void navigator.clipboard.writeText(url)}>
                Copy link
              </Button>
            </div>
          )}
          <Field label="Address" hint="Made from the title when empty">
            <Input
              value={slug}
              placeholder="made from the title"
              onChange={(event) => setSlug(event.currentTarget.value)}
            />
          </Field>
          <Field label="Description">
            <Input
              value={description}
              placeholder="Short link preview"
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
          </Field>
          <label className="check small">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(event) => setHidden(event.currentTarget.checked)}
            />
            Hide from search engines
          </label>
          <Field
            label="Password"
            hint={
              state.published?.has_password
                ? "A password is set. Type a new one to change it."
                : "Optional"
            }
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </Field>
          <div className="dialog-actions">
            {url && (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void unpublish()}
              >
                Unpublish
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" busy={busy} onClick={() => void save()}>
              {url ? "Save" : "Publish"}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
