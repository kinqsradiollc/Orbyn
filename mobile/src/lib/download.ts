import { Platform, Share } from "react-native";
import { EXPORT_FORMATS, EXPORT_LABELS, type ExportFormat } from "@orbyn/core";
import { client } from "./api";

/**
 * Taking a page (or an export) away, on a phone.
 *
 * In the web build a blob and a link do it, the same way the desktop does.
 * On a phone the file is written to the app's cache and handed to the
 * system share sheet (expo-file-system and expo-sharing), so it can be
 * saved to Files, sent, or opened in another app — every format, PDF and
 * Word included.
 */

/** Save `data` as a file called `name`: a download on the web, the share sheet on a phone. */
export async function saveFile(
  name: string,
  data: Blob | string,
  mimeType: string,
): Promise<void> {
  if (Platform.OS === "web") {
    const blob =
      typeof data === "string" ? new Blob([data], { type: mimeType }) : data;
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    return;
  }
  const [{ File, Paths }, Sharing] = await Promise.all([
    import("expo-file-system"),
    import("expo-sharing"),
  ]);
  const file = new File(Paths.cache, name.replace(/[\\/:*?"<>|]+/g, "-"));
  file.create({ overwrite: true });
  file.write(
    typeof data === "string" ? data : new Uint8Array(await data.arrayBuffer()),
  );
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  else if (typeof data === "string")
    await Share.share({ title: name, message: data });
  else throw new Error("File sharing is unavailable on this device.");
}

/** Which formats can be taken away on this device: all of them now. */
export const formatsHere = (): ExportFormat[] => [...EXPORT_FORMATS];

export async function downloadDoc(
  docId: string,
  format: ExportFormat,
): Promise<void> {
  const { blob, name } = await client.exportDoc(docId, format);
  await saveFile(name, blob, blob.type || EXPORT_LABELS[format].type);
}

/** What the one control that reveals the shapes is called. */
export const takeAwayLabel = () =>
  Platform.OS === "web" ? "Download…" : "Share…";

/** What to call the action, given what it will actually do. */
export const downloadLabel = (format: ExportFormat) =>
  Platform.OS === "web"
    ? EXPORT_LABELS[format].name
    : `Share as ${EXPORT_LABELS[format].name}`;
