import React, { useCallback, useEffect, useRef, useState } from "react";
import { KeepOriginals } from "./OriginalFile";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../motion";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import {
  IMPORT_ACTIVE,
  IMPORT_LIMITS,
  IMPORT_MIME,
  importHint,
  importRefusal,
  importStatusLine,
  importTypeOf,
  readShared,
  type ImportCapabilities,
  type SharedContent,
  type DocSummary,
  type ImportJob,
} from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { errorText } from "../../lib/errors";
import { AssistChips } from "../../components/AssistChips";

type LocalFile = {
  name: string;
  size?: number | null;
  mimeType?: string | null;
  uri: string;
  file?: File;
};

/**
 * Upload one local file for importing: start the import, send the bytes,
 * and cancel the import if the upload doesn't arrive.
 */
export async function sendLocalFile(
  file: LocalFile,
  projectId?: string,
  projectTeamId?: string | null,
): Promise<void> {
  // On the web the picker hands over the File itself; on a phone, a local
  // copy that fetch can read as a Blob.
  const body: Blob =
    Platform.OS === "web" && file.file
      ? file.file
      : await (await fetch(file.uri)).blob();
  const { upload_path, import: started } = await client.createImport({
    file_name: file.name,
    bytes: file.size ?? body.size,
    mime: file.mimeType ?? undefined,
    project_id: projectId,
    project_team_id: projectId ? projectTeamId : undefined,
  });
  try {
    await client.uploadImportFile(
      upload_path,
      body,
      file.mimeType ?? "application/octet-stream",
    );
  } catch (e) {
    await client.removeImport(started.id).catch(() => {});
    throw e;
  }
}

/**
 * What another app shared to Orbyn (the share sheet): files — PDF, Word and
 * photos — to import into Docs → Uploads, and text or a link to send where
 * the person chooses (the "Share into Orbyn" sheet). Receiving shares needs
 * a native build with the share extension; anywhere else (the web, Expo Go)
 * this finds nothing.
 */
export async function takeShared(): Promise<{
  files: LocalFile[];
  shared: SharedContent | null;
}> {
  const none = { files: [], shared: null };
  if (Platform.OS === "web") return none;
  try {
    const Sharing = await import("expo-sharing");
    const raw = Sharing.getSharedPayloads();
    if (!raw.length) return none;
    // Words and links are read as they came; only files need resolving.
    const words = raw.filter(
      (p) => p.shareType === "text" || p.shareType === "url",
    );
    const resolved = raw.some(
      (p) => p.shareType !== "text" && p.shareType !== "url",
    )
      ? await Sharing.getResolvedSharedPayloadsAsync()
      : [];
    Sharing.clearSharedPayloads();
    const files = resolved
      .filter(
        (p): p is typeof p & { contentUri: string } =>
          !!p.contentUri &&
          p.contentType !== "website" &&
          p.contentType !== "text" &&
          p.shareType !== "text" &&
          p.shareType !== "url",
      )
      .map((p) => ({
        name:
          p.originalName ??
          `Shared ${p.contentMimeType?.includes("pdf") ? "file.pdf" : "notes.jpg"}`,
        size: p.contentSize,
        mimeType: p.contentMimeType,
        uri: p.contentUri,
      }));
    const read = readShared(
      words.map((p) =>
        p.shareType === "url" ? { url: p.value } : { text: p.value },
      ),
    );
    return {
      files,
      shared: read.url || read.text ? read : null,
    };
  } catch {
    return none;
  }
}

/**
 * Photograph a page of notes and send it to be read into a page, from
 * anywhere (the + sheet's Scan notes, the app icon's quick action). False
 * when nothing was sent: no camera allowed, the photo put away, or the
 * server not reading photos; `onError` says which.
 */
export async function scanAndSend(
  onError: (message: string) => void,
): Promise<boolean> {
  const caps = await client.importCapabilities().catch(() => null);
  if (caps && (!caps.enabled || !caps.photos)) {
    onError(
      caps.enabled
        ? "Photos of notes can't be read on this server. Import a PDF or Word file instead."
        : "Importing files isn't set up on this server yet.",
    );
    return false;
  }
  const photo = await takeNotesPhoto(onError);
  if (!photo) return false;
  try {
    await sendLocalFile(photo);
    return true;
  } catch (e) {
    onError(errorText(e));
    return false;
  }
}

/** The camera, for one page of notes; null when none was taken. */
async function takeNotesPhoto(
  onError: (message: string) => void,
): Promise<LocalFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    onError(
      "Orbyn needs the camera to scan notes. Allow it in Settings, or choose a file instead.",
    );
    return null;
  }
  const shot = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 0.85,
    exif: false,
  });
  if (shot.canceled || !shot.assets[0]) return null;
  const photo = shot.assets[0];
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", " ")
    .replace(":", ".");
  return {
    name: `Scanned notes ${stamp}.jpg`,
    size: photo.fileSize ?? null,
    mimeType: "image/jpeg",
    uri: photo.uri,
  };
}

/**
 * Importing files into Docs on the phone: pick a PDF, Word file or photo of
 * notes; it uploads, is read on the server, and becomes a page in Uploads.
 * The imports going on are refreshed while any is still being read.
 */
export function useImports(
  onError: (m: string) => void,
  onReady: () => void,
  projectId?: string,
  projectTeamId?: string | null,
) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [uploading, setUploading] = useState(0);
  const [caps, setCaps] = useState<ImportCapabilities | null>(null);
  useEffect(() => {
    client.importCapabilities().then(setCaps, () => setCaps(null));
  }, []);
  const ready = useRef(new Set<string>());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const refresh = useCallback(
    () =>
      client.listImports().then(
        (list) => {
          const fresh = list.filter(
            (j) => j.status === "ready" && !ready.current.has(j.id),
          );
          for (const j of list)
            if (j.status === "ready") ready.current.add(j.id);
          if (fresh.length) onReadyRef.current();
          setJobs(list);
        },
        () => {},
      ),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = jobs.some((j) => IMPORT_ACTIVE.includes(j.status));
  useEffect(() => {
    if (!active && !uploading) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, uploading, refresh]);

  /** Upload one file (picked or photographed). */
  const upload = async (file: LocalFile) => {
    const refused = importRefusal(file.name, file.mimeType ?? undefined);
    if (refused) {
      onError(refused);
      return;
    }
    const type = importTypeOf(file.name, file.mimeType ?? undefined);
    if (caps && !caps.enabled) {
      onError("Importing files isn't set up on this server yet.");
      return;
    }
    if ((type === "png" || type === "jpeg") && caps && !caps.photos) {
      onError(
        "Photos of notes can't be read on this server. Import a PDF or Word file instead.",
      );
      return;
    }
    if ((file.size ?? 0) > IMPORT_LIMITS.maxBytes) {
      onError(
        `${file.name} is over the ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB limit.`,
      );
      return;
    }
    setUploading((n) => n + 1);
    try {
      await sendLocalFile(file, projectId, projectTeamId);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setUploading((n) => n - 1);
      void refresh();
    }
  };

  /** Choose files and upload them one after another. */
  const pickAndImport = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: Object.values(IMPORT_MIME),
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    for (const asset of picked.assets) await upload(asset);
  };

  /** Photograph a page of notes and import it. */
  const scanNotes = async () => {
    const photo = await takeNotesPhoto(onError);
    if (photo) await upload(photo);
  };

  const remove = async (job: ImportJob) => {
    setJobs((all) => all.filter((j) => j.id !== job.id));
    try {
      await client.removeImport(job.id);
    } catch (e) {
      onError(errorText(e));
    }
    void refresh();
  };

  return {
    jobs,
    pickAndImport,
    scanNotes,
    remove,
    busy: uploading > 0,
    caps,
  };
}

const kindLabel = (type: string) =>
  type === "docx" ? "DOC" : type === "pdf" ? "PDF" : "IMG";

/**
 * Uploads: files being imported, and imported pages not filed yet. Filing
 * a page into a folder (or Unfiled) takes it out of here.
 */
export function UploadsList({
  jobs,
  docs,
  busy,
  onOpen,
  onFile,
  onRemove,
  onImport,
  onScan,
  onMakeCards,
  onChanged,
  caps,
  report,
}: {
  caps: ImportCapabilities | null;
  /** Shows errors ("Keep the original", your account's setting, and more). */
  report?: (e: unknown) => void;
  onScan?: () => void;
  onMakeCards?: (docId: string, title: string, max?: number) => void;
  /** The assistant's chips added tasks or changed a page (AI-01). */
  onChanged?: () => void;
  jobs: ImportJob[];
  docs: DocSummary[];
  busy: boolean;
  onOpen: (id: string) => void;
  onFile: (doc: DocSummary) => void;
  onRemove: (job: ImportJob) => void;
  onImport: () => void;
}) {
  const waiting = docs.filter((d) => d.in_uploads);
  // A finished import is shown as its page (below) while it waits to be
  // filed; once filed or deleted, it's gone from Uploads.
  const shownJobs = jobs.filter((j) => j.status !== "ready");
  return (
    <View style={s.list}>
      <Text style={s.intro}>
        Import PDFs, Word files or photos as pages. The original is deleted
        after import unless you choose to keep it.
      </Text>
      {/* "Keep the original" is your account's setting, on every device. */}
      <KeepOriginals report={report ?? (() => {})} />
      <Text style={s.hint}>{importHint(caps)}</Text>
      {!waiting.length && !shownJobs.length && (
        <View style={s.empty}>
          <View style={s.emptyIcon}>
            <Icon name="fileText" size={22} color={colors.accent} />
          </View>
          <Text style={s.emptyTitle}>Import a lecture PDF or Word file</Text>
          <Text style={s.emptyBody}>
            Scans can take a few minutes. You can leave; we'll notify you.
          </Text>
          <View style={s.actions}>
            <SmallAction
              label={busy ? "Uploading…" : "Choose a file"}
              disabled={busy}
              onPress={onImport}
            />
            {onScan && caps?.photos && Platform.OS !== "web" && (
              <SmallAction
                label="Scan notes"
                disabled={busy}
                onPress={onScan}
              />
            )}
          </View>
        </View>
      )}
      {shownJobs.map((job) => {
        const active = IMPORT_ACTIVE.includes(job.status);
        const progress =
          job.status === "ocr" && job.ocr_pages
            ? job.ocr_done / job.ocr_pages
            : job.status === "reading"
              ? 0.1
              : null;
        return (
          <View key={job.id} style={s.row}>
            <View style={[s.kind, kindTone(job.file_type)]}>
              <Text style={[s.kindText, kindText(job.file_type)]}>
                {kindLabel(job.file_type)}
              </Text>
            </View>
            <View style={s.main}>
              <Text style={s.title} numberOfLines={1}>
                {job.file_name}
              </Text>
              <Text
                style={[s.status, job.status === "failed" && s.failed]}
                numberOfLines={3}
              >
                {importStatusLine(job)}
              </Text>
              {progress !== null && (
                <View
                  style={s.bar}
                  accessibilityRole="progressbar"
                  accessibilityValue={{
                    min: 0,
                    max: 100,
                    now: Math.round(progress * 100),
                  }}
                >
                  <View
                    style={[
                      s.barFill,
                      { width: `${Math.max(progress, 0.04) * 100}%` },
                    ]}
                  />
                </View>
              )}
              <View style={s.actions}>
                {job.status === "ready" && job.doc_id && (
                  <SmallAction
                    label="Open"
                    disabled={false}
                    onPress={() => onOpen(job.doc_id!)}
                  />
                )}
                {job.status === "failed" && (
                  <SmallAction
                    label="Import again"
                    disabled={busy}
                    onPress={onImport}
                  />
                )}
                <SmallAction
                  label={active ? "Cancel" : "Clear"}
                  disabled={false}
                  onPress={() => onRemove(job)}
                />
              </View>
            </View>
          </View>
        );
      })}
      {waiting.map((doc) => (
        <View key={doc.id} style={s.row}>
          <View
            style={[s.kind, kindTone(doc.imported_from?.file_type ?? "pdf")]}
          >
            <Icon name="fileText" size={16} color={colors.accent} />
          </View>
          <View style={s.main}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${doc.title || "Untitled"}`}
              onPress={() => onOpen(doc.id)}
            >
              <Text style={s.title} numberOfLines={2}>
                {doc.title || "Untitled"}
              </Text>
              <Text style={s.status} numberOfLines={2}>
                Ready · from {doc.imported_from?.file_name ?? "an upload"}
              </Text>
            </Pressable>
            <View style={s.actions}>
              <SmallAction
                label="Open"
                disabled={false}
                onPress={() => onOpen(doc.id)}
              />
              <SmallAction
                label="Move to folder"
                disabled={false}
                onPress={() => onFile(doc)}
              />
            </View>
            {/* The assistant's chips, as suggestions (AI-01). */}
            <View style={s.assist}>
              <AssistChips
                docId={doc.id}
                title={doc.title || "Untitled"}
                onMakeCards={onMakeCards}
                onChanged={onChanged}
              />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const kindTone = (type: string) =>
  type === "pdf"
    ? { backgroundColor: colors.dangerSoft }
    : type === "docx"
      ? { backgroundColor: colors.accentSoft }
      : { backgroundColor: colors.surfaceMuted };
const kindText = (type: string) =>
  type === "pdf"
    ? { color: colors.danger }
    : type === "docx"
      ? { color: colors.accent }
      : { color: colors.textSoft };

const s = themed(() =>
  StyleSheet.create({
    list: { gap: 10 },
    hint: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 17,
      color: colors.faint,
      marginTop: -4,
    },
    intro: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.muted,
    },
    empty: {
      alignItems: "center",
      gap: 8,
      paddingVertical: 28,
      paddingHorizontal: 20,
      borderRadius: radii.card,
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    emptyIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    emptyTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      textAlign: "center",
    },
    emptyBody: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.muted,
      textAlign: "center",
      marginBottom: 4,
    },
    row: {
      flexDirection: "row",
      gap: 12,
      padding: 12,
      borderRadius: radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    kind: {
      width: 36,
      height: 42,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    kindText: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5 },
    main: { flex: 1, minWidth: 0, gap: 3 },
    title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    status: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
    },
    failed: { color: colors.danger },
    bar: {
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
      marginTop: 4,
    },
    barFill: {
      height: "100%",
      borderRadius: 3,
      backgroundColor: colors.accent,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    assist: { marginTop: 10 },
  }),
);
