import { useEffect, useState } from "react";
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
  parseLookIcon,
  type CoverPicture,
  type Look,
  type LookIconName,
} from "@orbyn/core";
import { client } from "../lib/api";
import {
  fileLink,
  isPicture,
  scaledPicture,
} from "../features/docs/RichBlocks";
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
  const [url, setUrl] = useState<string | null | "gone">(null);
  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      return;
    }
    let live = true;
    fileLink(fileId).then(
      (l) => live && setUrl(l.url),
      () => live && setUrl("gone"),
    );
    return () => {
      live = false;
    };
  }, [fileId]);
  return url;
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

/**
 * Change a cover and icon: pick an emoji or one of the app's icons, and
 * upload a picture (onto `uploadTo`, a page, when there is one) or choose
 * one of yours. Nothing is saved until "Save".
 */
export function LookDialog({
  title,
  look,
  uploadTo,
  onSave,
  onClose,
  report,
}: {
  title: string;
  look: Look;
  /** The page a new picture is added to; without one, pick from yours. */
  uploadTo?: string | null;
  onSave: (look: Look) => Promise<void> | void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const [icon, setIcon] = useState<string | null>(look.icon);
  const [cover, setCover] = useState<string | null>(look.cover_file_id);
  const [typed, setTyped] = useState("");
  const [pictures, setPictures] = useState<CoverPicture[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    client.myPictures().then(setPictures, () => setPictures([]));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".popover")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const upload = async (file: File) => {
    if (!uploadTo) return;
    if (!isPicture(file) || !pageFileType(file.name, file.type)) {
      setNote("Covers are pictures: PNG, JPEG, GIF or WebP.");
      return;
    }
    setBusy(true);
    setNote("Adding the picture…");
    try {
      const body = await scaledPicture(file, 2000);
      const made = await client.createPageFile(uploadTo, {
        name: file.name.slice(0, 300) || "Cover",
        bytes: body.blob.size,
        mime: body.type,
        width: body.width,
        height: body.height,
      });
      await client.uploadPageFile(made.upload_path, body.blob, body.type);
      setCover(made.file.id);
      setPictures((p) => [
        {
          id: made.file.id,
          name: made.file.name,
          doc_id: uploadTo,
          doc_title: null,
          width: body.width,
          height: body.height,
          created_at: made.file.created_at,
        },
        ...(p ?? []),
      ]);
      setNote("");
    } catch (e) {
      setNote("");
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave({ icon, cover_file_id: cover });
      onClose();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const takeTyped = () => {
    const t = typed.trim();
    if (!t) return;
    if (isEmoji(t)) {
      setIcon(t);
      setTyped("");
      setNote("");
    } else setNote("That isn't an emoji. Type or paste one emoji.");
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal look-dialog scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="look-dialog-title"
      >
        <div className="section-heading">
          <h2 id="look-dialog-title">{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body look-body">
          <div className="look-preview">
            <Cover fileId={cover} className="look-preview-cover" />
            <span className="look-preview-icon">
              {icon ? (
                <LookIcon icon={icon} size={24} />
              ) : (
                <small className="muted">No icon</small>
              )}
            </span>
          </div>

          <h3 className="look-heading">Icon</h3>
          <div className="look-grid" role="group" aria-label="Emoji">
            {LOOK_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                className={"look-choice" + (icon === e ? " is-on" : "")}
                aria-pressed={icon === e}
                aria-label={`Emoji ${e}`}
                onClick={() => setIcon(e)}
              >
                <span className="look-emoji">{e}</span>
              </button>
            ))}
          </div>
          <div className="look-grid" role="group" aria-label="The app's icons">
            {LOOK_ICON_NAMES.map((n) => {
              const value = `icon:${n}`;
              return (
                <button
                  key={n}
                  type="button"
                  className={"look-choice" + (icon === value ? " is-on" : "")}
                  aria-pressed={icon === value}
                  aria-label={LOOK_ICON_LABELS[n]}
                  title={LOOK_ICON_LABELS[n]}
                  onClick={() => setIcon(value)}
                >
                  <LookIcon icon={value} size={17} />
                </button>
              );
            })}
          </div>
          <div className="look-typed">
            <input
              aria-label="Another emoji"
              placeholder="Another emoji…"
              maxLength={16}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  takeTyped();
                }
              }}
            />
            <button type="button" className="secondary" onClick={takeTyped}>
              Use it
            </button>
            {icon && (
              <button
                type="button"
                className="text-button"
                onClick={() => setIcon(null)}
              >
                No icon
              </button>
            )}
          </div>

          <h3 className="look-heading">Cover</h3>
          {!uploadTo && (
            <p className="muted">
              Choose one of your pictures. To use a new one, add it to any page
              first.
            </p>
          )}
          {uploadTo && (
            <FilePicker
              accept="image/png,image/jpeg,image/gif,image/webp"
              label="Upload a picture"
              hint="PNG, JPEG, GIF or WebP"
              disabled={busy}
              onFile={(f) => void upload(f)}
            />
          )}
          {pictures === null ? (
            <p className="muted">Loading your pictures…</p>
          ) : pictures.length ? (
            <div
              className="look-pictures"
              role="group"
              aria-label="Your pictures"
            >
              {pictures.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={"look-picture" + (cover === p.id ? " is-on" : "")}
                  aria-pressed={cover === p.id}
                  aria-label={`${p.name}${p.doc_title ? `, from ${p.doc_title}` : ""}`}
                  title={p.doc_title ? `From ${p.doc_title}` : p.name}
                  onClick={() => setCover(p.id)}
                >
                  <Thumb picture={p} />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">
              {uploadTo
                ? "No pictures yet. Upload one above."
                : "No pictures yet."}
            </p>
          )}
          {cover && (
            <button
              type="button"
              className="text-button"
              onClick={() => setCover(null)}
            >
              No cover
            </button>
          )}
          {note && (
            <p className="muted" role="status">
              {note}
            </p>
          )}
          <div className="button-row">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void save()}
            >
              Save
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
