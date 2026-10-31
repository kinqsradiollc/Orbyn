import {
  LOOK_EMOJI,
  LOOK_ICON_LABELS,
  LOOK_ICON_NAMES,
  isEmoji,
  pageFileInput,
  pageFileType,
  parseLookIcon,
  type CoverPicture,
  type Look,
  type LookIconName,
} from "@orbyn/core";
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
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client, getToken } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Input,
  Loading,
  Segmented,
  useConfirm,
} from "../../ui/kit";

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
export function LookIcon({ icon }: { icon: string | null | undefined }) {
  const read = parseLookIcon(icon);
  if (!read) return null;
  if (read.kind === "emoji") return <span aria-hidden="true">{read.text}</span>;
  const Icon = ICONS[read.name];
  return <Icon aria-hidden="true" />;
}

const links = new Map<string, { url: string; until: number }>();

async function fileUrl(id: string) {
  const kept = links.get(id);
  if (kept && kept.until > Date.now()) return kept.url;
  const link = await client.pageFile(id);
  const url = client.urlFor(link.url_path);
  links.set(id, { url, until: Date.parse(link.expires_at) - 5 * 60_000 });
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
  const url = useResource(
    () => (fileId ? fileUrl(fileId) : Promise.resolve("")),
    [fileId],
  );
  if (!fileId || !url.data) return null;
  return (
    <div className={className} aria-hidden="true">
      <img src={url.data} alt="" draggable={false} />
    </div>
  );
}

function Thumb({ picture }: { picture: CoverPicture }) {
  const url = useResource(() => fileUrl(picture.id), [picture.id]);
  return url.data ? (
    <img src={url.data} alt="" draggable={false} />
  ) : (
    <ImageIcon aria-hidden="true" />
  );
}

async function scaled(file: File, max: number) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That picture couldn't be read."));
      i.src = url;
    });
    const { naturalWidth: w, naturalHeight: h } = img;
    if (Math.max(w, h) <= max || file.type === "image/gif")
      return { blob: file as Blob, width: w, height: h, type: file.type };
    const scale = max / Math.max(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Couldn't scale it."))),
        type,
        0.86,
      ),
    );
    return { blob, width: canvas.width, height: canvas.height, type };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Choosing what a project or hub wears. Nothing changes until Save. */
export function LookDialog({
  title,
  look,
  uploadTo,
  onSave,
  onClose,
}: {
  title: string;
  look: Look;
  /** Uploads land on this page straight away. Hubs have none. */
  uploadTo?: string | null;
  onSave: (look: Look) => Promise<void> | void;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const owner = useRef(getToken()).current;
  const initial = useRef(look).current;
  const [category, setCategory] = useState<"emoji" | "icons" | "custom">(
    look.icon?.startsWith("icon:") ? "icons" : "emoji",
  );
  const [icon, setIcon] = useState(look.icon);
  const [cover, setCover] = useState(look.cover_file_id);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  const pictures = useResource(() => client.myPictures(), [round]);
  const file = useRef<HTMLInputElement>(null);
  const close = async () => {
    if (busy) return;
    const same =
      icon === initial.icon && cover === initial.cover_file_id && !typed.trim();
    if (
      same ||
      (await confirm({
        title: "Discard appearance changes?",
        body: "Uploaded pictures stay in the page's file library.",
        action: "Discard changes",
        danger: true,
      }))
    )
      onClose();
  };
  const upload = async (picked: File) => {
    if (!uploadTo || busy) return;
    if (!pageFileType(picked.name, picked.type))
      return setError("Choose a PNG, JPEG, GIF or WebP picture.");
    setBusy(true);
    setError("");
    try {
      const body = await scaled(picked, 2000);
      const meta = pageFileInput.safeParse({
        name: picked.name,
        bytes: body.blob.size,
        mime: body.type,
        width: body.width,
        height: body.height,
      });
      if (!meta.success)
        throw new Error(
          "This picture can't be uploaded. Choose another image.",
        );
      const made = await client.createPageFile(uploadTo, meta.data);
      await client.uploadPageFile(made.upload_path, body.blob, body.type);
      if (owner !== getToken()) return;
      setCover(made.file.id);
      setRound((n) => n + 1);
    } catch (failure) {
      setError(messageOf(failure, "Couldn't upload that picture."));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (busy) return;
    if (category !== "custom" && typed.trim()) {
      setCategory("custom");
      return setError("Use or clear the custom emoji before saving.");
    }
    const custom = category === "custom" ? typed.trim() : "";
    if (custom && !isEmoji(custom)) return setError("Type or paste one emoji.");
    setBusy(true);
    setError("");
    try {
      await onSave({ icon: custom || icon, cover_file_id: cover });
      onClose();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't save the appearance."));
    } finally {
      setBusy(false);
    }
  };
  const offered = (pictures.data ?? []).filter((p) =>
    `${p.name} ${p.doc_title ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <Dialog
      title={`Appearance · ${title}`}
      onClose={() => void close()}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => void close()}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="look-preview">
        <Cover fileId={cover} className="look-preview-cover" />
        <span className="look-preview-icon">
          {icon || isEmoji(typed.trim()) ? (
            <LookIcon icon={isEmoji(typed.trim()) ? typed.trim() : icon} />
          ) : (
            <span className="muted small">No icon</span>
          )}
        </span>
      </div>
      <h3>Icon</h3>
      <Segmented
        label="Icon type"
        value={category}
        options={[
          { value: "emoji", label: "Emoji" },
          { value: "icons", label: "Icons" },
          { value: "custom", label: "Custom" },
        ]}
        onChange={setCategory}
      />
      {category === "emoji" && (
        <div className="look-grid" role="group" aria-label="Emoji">
          {LOOK_EMOJI.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={icon === value}
              aria-label={`Emoji ${value}`}
              onClick={() => setIcon(value)}
            >
              {value}
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
              aria-pressed={icon === `icon:${name}`}
              aria-label={LOOK_ICON_LABELS[name]}
              title={LOOK_ICON_LABELS[name]}
              onClick={() => setIcon(`icon:${name}`)}
            >
              <LookIcon icon={`icon:${name}`} />
            </button>
          ))}
        </div>
      )}
      {category === "custom" && (
        <Input
          aria-label="Custom emoji"
          placeholder="One emoji"
          maxLength={16}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      )}
      <Button variant="ghost" disabled={!icon} onClick={() => setIcon(null)}>
        Remove icon
      </Button>
      <h3>Cover</h3>
      {uploadTo ? (
        <>
          <Button disabled={busy} onClick={() => file.current?.click()}>
            Upload picture
          </Button>
          <input
            ref={file}
            hidden
            type="file"
            aria-label="Choose a picture"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              event.target.value = "";
              if (picked) void upload(picked);
            }}
          />
        </>
      ) : (
        <p className="muted small">
          Choose a stored picture, or add one to a page first.
        </p>
      )}
      <Input
        aria-label="Find a picture"
        placeholder="Find a stored picture"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {pictures.error && (
        <ErrorNotice
          message={pictures.error}
          onRetry={() => void pictures.reload()}
        />
      )}
      {pictures.loading && !pictures.data && (
        <Loading label="Loading pictures" />
      )}
      {pictures.data && !offered.length && (
        <p className="muted small">No stored pictures.</p>
      )}
      {offered.length > 0 && (
        <div
          className="look-pictures"
          role="group"
          aria-label="Stored pictures"
        >
          {offered.map((picture) => (
            <button
              key={picture.id}
              type="button"
              aria-pressed={cover === picture.id}
              aria-label={picture.name}
              title={picture.name}
              onClick={() => setCover(picture.id)}
            >
              <Thumb picture={picture} />
            </button>
          ))}
        </div>
      )}
      <Button variant="ghost" disabled={!cover} onClick={() => setCover(null)}>
        Remove cover
      </Button>
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}
