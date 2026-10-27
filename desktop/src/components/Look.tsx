import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  Bell,
  Boxes,
  CalendarDays,
  ClipboardList,
  Clock,
  Coffee,
  FileText,
  Flag,
  Folder,
  GraduationCap,
  Hash,
  ImageIcon,
  Inbox,
  Key,
  Lightbulb,
  LinkIcon,
  ListTodo,
  MapPin,
  Mic,
  Network,
  Newspaper,
  Presentation,
  Sparkles,
  Star,
  Sun,
  Tag,
  Target,
  Users,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  isEmoji,
  LOOK_EMOJI,
  LOOK_ICON_LABELS,
  LOOK_ICON_NAMES,
  pageFileType,
  pageFileInput,
  parseLookIcon,
  type CoverPicture,
  type Look,
  type LookIconName,
} from "@orbyn/core";
import { client } from "../lib/api";
import { session } from "../lib/session";
import { errorText } from "../features/planner/planning";
import { useModalFocus } from "../hooks/useModalFocus";
import { useConfirm } from "./Confirm";
import {
  fileLink,
  isPicture,
  scaledPicture,
} from "../features/documents/editor/RichBlocks";
import { FilePicker } from "./FilePicker";
import "./look.css";

/**
 * Covers and icons (W6): what a project, a page or a Home hub wears. An
 * icon is an emoji or one of the app's own icons; a cover is a picture from
 * Orbyn's own file store, drawn across the top of a header or a card.
 */

const ICONS: Record<LookIconName, LucideIcon> = {
  fileText: FileText,
  boxes: Boxes,
  sun: Sun,
  calendar: CalendarDays,
  graduationCap: GraduationCap,
  sparkles: Sparkles,
  star: Star,
  folder: Folder,
  coffee: Coffee,
  target: Target,
  flag: Flag,
  lightbulb: Lightbulb,
  bell: Bell,
  users: Users,
  clock: Clock,
  mapPin: MapPin,
  video: Video,
  image: ImageIcon,
  mic: Mic,
  hash: Hash,
  inbox: Inbox,
  archive: Archive,
  presentation: Presentation,
  network: Network,
  clipboardList: ClipboardList,
  tag: Tag,
  link: LinkIcon,
  key: Key,
  listTodo: ListTodo,
  newspaper: Newspaper,
};

/** An icon value drawn: the emoji, or the app's icon; nothing for none. */
export function LookIcon({
  icon,
  size = 17,
  className = "",
}: {
  icon: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const read = parseLookIcon(icon);
  if (!read) return null;
  if (read.kind === "emoji")
    return (
      <span
        className={"look-emoji " + className}
        style={{ fontSize: size }}
        aria-hidden="true"
      >
        {read.text}
      </span>
    );
  const Icon = ICONS[read.name];
  return <Icon size={size} className={className} aria-hidden="true" />;
}

/** A cover picture's link: null while it loads or with none, "gone" if it can't be shown. */
export function useCoverUrl(
  fileId: string | null | undefined,
): string | null | "gone" {
  const owner = session.get();
  const [result, setResult] = useState<{
    owner: string | null;
    id: string;
    url: string | "gone";
  } | null>(null);
  useEffect(() => {
    if (!fileId) return;
    let alive = true;
    fileLink(fileId).then(
      (link) => {
        if (alive && session.get() === owner)
          setResult({ owner, id: fileId, url: link.url });
      },
      () => {
        if (alive && session.get() === owner)
          setResult({ owner, id: fileId, url: "gone" });
      },
    );
    return () => {
      alive = false;
    };
  }, [fileId, owner]);
  return result?.owner === owner && result.id === fileId ? result.url : null;
}

/** A cover across the top of a header or card; nothing without one. */
export function Cover({
  fileId,
  className = "",
}: {
  fileId: string | null | undefined;
  className?: string;
}) {
  const url = useCoverUrl(fileId);
  if (!fileId || url === "gone") return null;
  return (
    <div className={"look-cover " + className} aria-hidden="true">
      {url && <img src={url} alt="" draggable={false} />}
    </div>
  );
}

function Thumb({ picture }: { picture: CoverPicture }) {
  const url = useCoverUrl(picture.id);
  return url && url !== "gone" ? (
    <img src={url} alt="" draggable={false} />
  ) : (
    <ImageIcon size={17} aria-hidden="true" />
  );
}

type LookDialogProps = {
  title: string;
  scope?: string;
  look: Look;
  /** Uploads are stored on this page immediately; appearance is applied on Save. */
  uploadTo?: string | null;
  onSave: (look: Look) => Promise<void> | void;
  onClose: () => void;
  report: (error: unknown) => void;
};
export function LookDialog(props: LookDialogProps) {
  return (
    <LookDialogBody
      key={`${session.get()}:${props.scope ?? props.uploadTo ?? props.title}`}
      {...props}
    />
  );
}
function LookDialogBody({
  title,
  look,
  uploadTo,
  onSave,
  onClose,
  report,
}: LookDialogProps) {
  const owner = useRef(session.get()).current;
  const mounted = useRef(true),
    operation = useRef(false),
    closing = useRef(false),
    read = useRef(0);
  const owns = () => mounted.current && session.get() === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      read.current++;
    };
  }, []);
  const { ask } = useConfirm();
  const titleId = useId();
  const initial = useRef(look).current;
  const [category, setCategory] = useState<"emoji" | "icons" | "custom">(
    look.icon?.startsWith("icon:") ? "icons" : "emoji",
  );
  const [phase, setPhase] = useState<"upload" | "save" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const [pictureError, setPictureError] = useState("");
  const [query, setQuery] = useState("");
  const [icon, setIcon] = useState(look.icon);
  const [cover, setCover] = useState(look.cover_file_id);
  const [typed, setTyped] = useState("");
  const [pictures, setPictures] = useState<CoverPicture[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const request = ++read.current;
    setPictureError("");
    client.myPictures().then(
      (pictures) => {
        if (alive && owns() && request === read.current) setPictures(pictures);
      },
      (e) => {
        if (alive && owns() && request === read.current)
          setPictureError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [readAttempt]);
  const close = async () => {
    if (!owns() || operation.current || closing.current) return;
    closing.current = true;
    setConfirming(true);
    try {
      if (
        (icon === initial.icon &&
          cover === initial.cover_file_id &&
          !typed.trim()) ||
        (await ask({
          title: "Discard appearance changes?",
          body: "Uploaded pictures stay in the page's file library.",
          confirmLabel: "Discard changes",
          destructive: true,
        }))
      ) {
        if (owns() && !operation.current) onClose();
      }
    } finally {
      closing.current = false;
      if (owns()) setConfirming(false);
    }
  };
  const focus = useModalFocus(() => void close(), busy || confirming);
  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement | null;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const upload = async (file: File) => {
    if (!uploadTo || !owns() || operation.current || closing.current) return;
    if (!isPicture(file) || !pageFileType(file.name, file.type)) {
      setError("Choose a PNG, JPEG, GIF or WebP picture.");
      return;
    }
    if (
      !pageFileInput.safeParse({
        name: file.name,
        bytes: file.size,
        mime: file.type,
      }).success
    ) {
      setError("Choose a picture under 200 MB with a valid file name.");
      return;
    }
    operation.current = true;
    read.current++;
    setPhase("upload");
    setBusy(true);
    setError("");
    try {
      const body = await scaledPicture(file, 2000);
      if (!owns()) return;
      const metadata = pageFileInput.safeParse({
        name: file.name,
        bytes: body.blob.size,
        mime: body.type,
        width: body.width,
        height: body.height,
      });
      if (!metadata.success)
        throw new Error(
          "This picture cannot be uploaded. Choose another image.",
        );
      const made = await client.createPageFile(uploadTo, metadata.data);
      if (!owns()) return;
      await client.uploadPageFile(made.upload_path, body.blob, body.type);
      if (!owns()) return;
      setCover(made.file.id);
      setPictures((all) => [
        {
          id: made.file.id,
          name: made.file.name,
          doc_id: uploadTo,
          doc_title: null,
          width: body.width,
          height: body.height,
          created_at: made.file.created_at,
        },
        ...(all ?? []).filter((p) => p.id !== made.file.id),
      ]);
      setReadAttempt((n) => n + 1);
    } catch (e) {
      if (owns()) {
        setError(errorText(e));
        report(e);
      }
    } finally {
      operation.current = false;
      if (owns()) {
        setBusy(false);
        setPhase(null);
      }
    }
  };
  const save = async () => {
    if (!owns() || operation.current || closing.current) return;
    if (category !== "custom" && typed.trim()) {
      setCategory("custom");
      setError("Use or clear the custom emoji before saving.");
      return;
    }
    const custom = category === "custom" ? typed.trim() : "";
    if (custom && !isEmoji(custom)) {
      setError("Type or paste one emoji.");
      return;
    }
    operation.current = true;
    setBusy(true);
    setPhase("save");
    setError("");
    try {
      await onSave({ icon: custom || icon, cover_file_id: cover });
      if (owns()) onClose();
    } catch (e) {
      if (owns()) {
        setError(errorText(e));
        report(e);
      }
    } finally {
      operation.current = false;
      if (owns()) {
        setBusy(false);
        setPhase(null);
      }
    }
  };
  const preview =
    category === "custom" && isEmoji(typed.trim()) ? typed.trim() : icon;
  const offered = (pictures ?? []).filter((p) =>
    `${p.name} ${p.doc_title ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return createPortal(
    <dialog
      ref={focus.ref as React.RefObject<HTMLDialogElement>}
      data-modal-focus={focus.id}
      tabIndex={-1}
      className="modal look-dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) void close();
      }}
    >
      <div className="section-heading">
        <h2 id={titleId}>Appearance</h2>
        <span className="look-context">{title}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Close appearance"
          disabled={busy || confirming}
          onClick={() => void close()}
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-body look-body">
        <fieldset className="plain-fieldset" disabled={busy || confirming}>
          <div className="look-preview">
            <Cover fileId={cover} className="look-preview-cover" />
            <span className="look-preview-icon">
              {preview ? (
                <LookIcon icon={preview} size={24} />
              ) : (
                <small className="muted">No icon</small>
              )}
            </span>
          </div>
          <h3 className="look-heading">Icon</h3>
          <div
            className="segmented look-categories"
            role="group"
            aria-label="Icon type"
          >
            {(["emoji", "icons", "custom"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                className={category === value ? "active" : ""}
                onClick={() => {
                  setCategory(value);
                  setError("");
                }}
              >
                {value === "emoji"
                  ? "Emoji"
                  : value === "icons"
                    ? "Icons"
                    : "Custom"}
              </button>
            ))}
          </div>
          {category === "emoji" && (
            <div className="look-grid" role="group" aria-label="Emoji">
              {LOOK_EMOJI.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`look-choice ${icon === value ? "is-on" : ""}`}
                  aria-pressed={icon === value}
                  aria-label={`Emoji ${value}`}
                  onClick={() => {
                    setIcon(value);
                    setError("");
                  }}
                >
                  <span className="look-emoji">{value}</span>
                </button>
              ))}
            </div>
          )}
          {category === "icons" && (
            <div className="look-grid" role="group" aria-label="Icons">
              {LOOK_ICON_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`look-choice ${icon === `icon:${name}` ? "is-on" : ""}`}
                  aria-pressed={icon === `icon:${name}`}
                  aria-label={LOOK_ICON_LABELS[name]}
                  title={LOOK_ICON_LABELS[name]}
                  onClick={() => {
                    setIcon(`icon:${name}`);
                    setError("");
                  }}
                >
                  <LookIcon icon={`icon:${name}`} size={17} />
                </button>
              ))}
            </div>
          )}
          {category === "custom" && (
            <div className="look-typed">
              <input
                aria-label="Custom emoji"
                placeholder="One emoji"
                maxLength={16}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void save();
                  }
                }}
              />
            </div>
          )}
          <h3 className="look-heading">Cover</h3>
          {uploadTo ? (
            <>
              <FilePicker
                accept="image/png,image/jpeg,image/gif,image/webp"
                label="Upload picture"
                hint="PNG, JPEG, GIF or WebP"
                disabled={busy}
                onFile={(file) => void upload(file)}
              />
              <small className="field-hint">
                Uploaded pictures stay in this page's file library.
              </small>
            </>
          ) : (
            <p className="muted">
              Choose a stored picture, or add one to a page first.
            </p>
          )}
          <details className="look-library">
            <summary>Stored pictures</summary>
            <input
              aria-label="Find a picture"
              placeholder="Find a picture"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {!!pictureError && (
              <div className="error" role="alert">
                {pictureError}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setReadAttempt((n) => n + 1)}
                >
                  Retry pictures
                </button>
              </div>
            )}
            {pictures === null && !pictureError ? (
              <p className="muted">Loading pictures…</p>
            ) : offered.length ? (
              <div
                className="look-pictures"
                role="group"
                aria-label="Stored pictures"
              >
                {offered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`look-picture ${cover === p.id ? "is-on" : ""}`}
                    aria-pressed={cover === p.id}
                    aria-label={`${p.name}${p.doc_title ? `, from ${p.doc_title}` : ""}`}
                    onClick={() => setCover(p.id)}
                  >
                    <Thumb picture={p} />
                    <span className="look-picture-caption">
                      {p.name}
                      {p.doc_title && <small>{p.doc_title}</small>}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              !pictureError && (
                <p className="muted">
                  {query.trim() ? "No matching pictures." : "No pictures yet."}
                </p>
              )
            )}
          </details>
          {(icon || typed || cover) && (
            <details className="look-removals">
              <summary>Remove appearance</summary>
              <div className="look-reset">
                {(icon || typed) && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setIcon(null);
                      setTyped("");
                    }}
                  >
                    Remove icon
                  </button>
                )}
                {cover && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setCover(null)}
                  >
                    Remove cover
                  </button>
                )}
              </div>
            </details>
          )}
        </fieldset>
        {!!error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            disabled={busy || confirming}
            onClick={() => void close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || confirming}
            onClick={() => void save()}
          >
            {phase === "upload"
              ? "Uploading…"
              : phase === "save"
                ? "Saving…"
                : "Save"}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
