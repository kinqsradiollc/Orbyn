import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  IMPORT_ACTIVE,
  IMPORT_LIMITS,
  IMPORT_MIME,
  importRefusal,
  importStatusLine,
  type DocSummary,
  type ImportJob,
} from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";

/**
 * Importing files into Docs on the phone: pick a PDF, Word file or photo of
 * notes; it uploads, is read on the server, and becomes a page in Uploads.
 * The imports going on are refreshed while any is still being read.
 */
export function useImports(onError: (m: string) => void, onReady: () => void) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [uploading, setUploading] = useState(0);
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

  /** Choose files and upload them one after another. */
  const pickAndImport = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: Object.values(IMPORT_MIME),
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    for (const asset of picked.assets) {
      const refused = importRefusal(asset.name, asset.mimeType);
      if (refused) {
        onError(refused);
        continue;
      }
      if ((asset.size ?? 0) > IMPORT_LIMITS.maxBytes) {
        onError(
          `${asset.name} is over the ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB limit.`,
        );
        continue;
      }
      setUploading((n) => n + 1);
      let startedId: string | null = null;
      try {
        // On the web the picker hands over the File itself; on a phone, a
        // local copy that fetch can read as a Blob.
        const body: Blob =
          Platform.OS === "web" && asset.file
            ? asset.file
            : await (await fetch(asset.uri)).blob();
        const { upload_path, import: started } = await client.createImport({
          file_name: asset.name,
          bytes: asset.size ?? body.size,
          mime: asset.mimeType ?? undefined,
        });
        startedId = started.id;
        await refresh();
        await client.uploadImportFile(
          upload_path,
          body,
          asset.mimeType ?? "application/octet-stream",
        );
      } catch (e) {
        onError((e as Error).message);
        // The upload didn't arrive: don't leave the import waiting for it.
        if (startedId) await client.removeImport(startedId).catch(() => {});
      } finally {
        setUploading((n) => n - 1);
        void refresh();
      }
    }
  };

  const remove = async (job: ImportJob) => {
    setJobs((all) => all.filter((j) => j.id !== job.id));
    try {
      await client.removeImport(job.id);
    } catch (e) {
      onError((e as Error).message);
    }
    void refresh();
  };

  return { jobs, pickAndImport, remove, busy: uploading > 0 };
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
}: {
  jobs: ImportJob[];
  docs: DocSummary[];
  busy: boolean;
  onOpen: (id: string) => void;
  onFile: (doc: DocSummary) => void;
  onRemove: (job: ImportJob) => void;
  onImport: () => void;
}) {
  const waiting = docs.filter((d) => d.in_uploads);
  const shownJobs = jobs.filter(
    (j) =>
      j.status !== "ready" ||
      !j.doc_id ||
      !waiting.some((d) => d.id === j.doc_id),
  );
  return (
    <View style={s.list}>
      <Text style={s.intro}>
        PDFs, Word files and photos of notes become pages here. Orbyn reads the
        file, then deletes it; only the page stays.
      </Text>
      {!waiting.length && !shownJobs.length && (
        <View style={s.empty}>
          <View style={s.emptyIcon}>
            <Icon name="fileText" size={22} color={colors.accent} />
          </View>
          <Text style={s.emptyTitle}>Import a lecture PDF or Word file</Text>
          <Text style={s.emptyBody}>
            Scanned pages take a few minutes each to read. You can close the app
            meanwhile; you&apos;ll get a notification.
          </Text>
          <SmallAction
            label={busy ? "Uploading…" : "Choose a file"}
            disabled={busy}
            onPress={onImport}
          />
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
    kindText: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.5 },
    main: { flex: 1, minWidth: 0, gap: 3 },
    title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    status: {
      fontFamily: fonts.regular,
      fontSize: 12.5,
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
  }),
);
