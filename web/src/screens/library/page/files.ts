import { IMAGE_MAX_SIDE, type PageFile } from "@orbyn/core";
import { client, getToken, onToken } from "../../../lib/session";

export type FileLink = { url: string; file: PageFile; until: number };
let ownerGeneration = 0;
const pending = new Map<string, Promise<FileLink>>();
onToken(() => {
  ownerGeneration++;
  pending.clear();
});
export const fileOwnerGeneration = () => ownerGeneration;

/** Only concurrent reads share a link; later opens recheck authorization. */
export function fileLink(id: string, fresh = false): Promise<FileLink> {
  const generation = ownerGeneration;
  const owner = getToken();
  const existing = pending.get(id);
  if (existing && !fresh) return existing;
  // A revalidation must also bypass the client's older in-flight GET sharing.
  if (fresh) client.noteExternalMutation();
  const request = client
    .pageFile(id)
    .then((link) => {
      if (generation !== ownerGeneration || owner !== getToken())
        throw new Error("The account changed. Reopen this file.");
      if (
        !Number.isFinite(Date.parse(link.expires_at)) ||
        Date.parse(link.expires_at) <= Date.now()
      )
        throw new Error("This file link has expired. Try again.");
      return {
        url: client.urlFor(link.url_path),
        file: link.file,
        until: Date.parse(link.expires_at),
      };
    })
    .finally(() => {
      if (pending.get(id) === request) pending.delete(id);
    });
  pending.set(id, request);
  return request;
}

/** A large photo is scaled before upload; a GIF keeps its frames. */
export async function scaledPicture(file: File, max = IMAGE_MAX_SIDE) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error("That picture couldn't be read."));
      next.src = url;
    });
    const { naturalWidth: width, naturalHeight: height } = image;
    if (Math.max(width, height) <= max || file.type === "image/gif")
      return { blob: file as Blob, width, height, type: file.type };
    const scale = max / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (made) =>
          made ? resolve(made) : reject(new Error("Couldn't scale it.")),
        type,
        0.86,
      ),
    );
    return { blob, width: canvas.width, height: canvas.height, type };
  } finally {
    URL.revokeObjectURL(url);
  }
}
