import type { Doc } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import { Button, Dialog, Field, Input, useToast } from "../../../ui/kit";
import { fileLink } from "./Blocks";
import { scaledPicture } from "./files";

export function Look({ doc }: { doc: Doc }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (doc.cover_file_id)
      fileLink(doc.cover_file_id).then(
        (link) => live && setUrl(link.url),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [doc.cover_file_id]);
  return (
    <>
      {url && <img className="page-cover" src={url} alt="" />}
      {doc.icon && (
        <div className="page-icon" aria-hidden="true">
          {doc.icon}
        </div>
      )}
    </>
  );
}

export function LookDialog({
  doc,
  onClose,
  onSaved,
}: {
  doc: Doc;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [icon, setIcon] = useState(doc.icon ?? "");
  const [cover, setCover] = useState(doc.cover_file_id ?? null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const save = async () => {
    setBusy(true);
    try {
      const before = {
        cover_file_id: doc.cover_file_id ?? null,
        icon: doc.icon ?? null,
      };
      await client.setDocLook(doc.id, {
        cover_file_id: cover,
        icon: icon.trim() || null,
      });
      onSaved();
      onClose();
      toast({
        text: "Cover and icon saved",
        action: {
          label: "Undo",
          run: () => void client.setDocLook(doc.id, before).then(onSaved),
        },
      });
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't save the cover."),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const picture = await scaledPicture(file);
      const { file: row, upload_path } = await client.createPageFile(doc.id, {
        name: file.name.slice(0, 300) || "Cover",
        bytes: picture.blob.size,
        mime: picture.type,
        width: picture.width,
        height: picture.height,
      });
      await client.uploadPageFile(upload_path, picture.blob, picture.type);
      setCover(row.id);
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't add this picture."),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Cover and icon"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Icon" hint="One emoji or short mark">
        <Input
          value={icon}
          maxLength={16}
          onChange={(event) => setIcon(event.currentTarget.value)}
        />
      </Field>
      <div className="page-look-row">
        <Button disabled={busy} onClick={() => input.current?.click()}>
          {cover ? "Change cover" : "Add cover"}
        </Button>
        {cover && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setCover(null)}
          >
            Remove cover
          </Button>
        )}
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept="image/*"
        aria-label="Choose a cover picture"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
    </Dialog>
  );
}
