import { Platform, Share } from "react-native";
import { EXPORT_LABELS, type ExportFormat } from "@orbyn/core";
import { client } from "./api";

/**
 * Taking a page away, on a phone.
 *
 * In the web build a blob and a link do it, the same way the desktop does.
 * On a real phone there is no file system here to write to: saving a PDF
 * would mean `expo-file-system` and `expo-sharing`, which are not installed
 * and could not be tested on a device from here. So a phone shares the text
 * shapes through the system sheet, which is the phone idiom anyway, and the
 * shapes that are files say plainly where to get them.
 */

/** Which formats can actually be taken away on this device. */
export const formatsHere = (): ExportFormat[] =>
  Platform.OS === "web" ? ["md", "txt", "html", "docx", "pdf"] : ["md", "txt"];

export async function downloadDoc(
  docId: string,
  format: ExportFormat,
): Promise<void> {
  const { blob, name } = await client.exportDoc(docId, format);
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  // A phone gets the words through the share sheet. Only ever the text
  // shapes reach here, so there is nothing binary to mangle.
  await Share.share({ title: name, message: await blob.text() });
}

/** What to call the action, given what it will actually do. */
export const downloadLabel = (format: ExportFormat) =>
  Platform.OS === "web"
    ? EXPORT_LABELS[format].name
    : `Share as ${EXPORT_LABELS[format].name}`;
