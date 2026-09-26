import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";

/** The largest file an import takes in one request. */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Choose one file and read it as base64, for an import sent in one request
 * (DATA-08): a zip of Markdown notes, a Notion export or one .md file.
 * Null when nothing was chosen.
 */
export async function pickFileBase64(
  types: string[],
): Promise<{ name: string; data: string; size: number } | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: types,
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const size = asset.size ?? 0;
  if (size > IMPORT_MAX_BYTES)
    throw new Error("That file is over 20 MB. Split the export and try again.");
  if (Platform.OS === "web" && asset.file) {
    const file = asset.file;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(String(reader.result ?? "").replace(/^data:[^,]*,/, ""));
      reader.onerror = () => reject(new Error("The file couldn't be read."));
      reader.readAsDataURL(file);
    });
    return { name: asset.name, data, size };
  }
  const { File } = await import("expo-file-system");
  const data = await new File(asset.uri).base64();
  return { name: asset.name, data, size };
}

/** Choose one text file (a CSV or an Orbyn export) and read its words. */
export async function pickFileText(
  types: string[],
): Promise<{ name: string; text: string } | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: types,
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  if ((asset.size ?? 0) > IMPORT_MAX_BYTES)
    throw new Error("That file is over 20 MB. Split it and try again.");
  if (Platform.OS === "web" && asset.file)
    return { name: asset.name, text: await asset.file.text() };
  const { File } = await import("expo-file-system");
  return { name: asset.name, text: await new File(asset.uri).text() };
}
