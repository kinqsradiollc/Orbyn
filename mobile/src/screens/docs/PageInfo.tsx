import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import {
  fileSize,
  MODE_LABELS,
  modesFor,
  savedAgo,
  type Doc,
  type DocInfo,
  type DocMode,
  type DocTag,
  type OutlineEntry,
  type PageFile,
  type PageFilesUsage,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { ContentsList } from "./ContentsSheet";
import { BottomSheet } from "../../components/BottomSheet";
import { Chip, ChipRow } from "../../components/Chip";
import { SmallAction } from "../../components/SmallAction";
import { PageFreshness } from "../../components/followthrough/PageFreshness";
import { colors, fonts, radii, themed } from "../../theme";
import { DocViewers } from "./DocViewers";
import { PageTags } from "./PageTags";
import { FieldsSection } from "../views/FieldsSection";
import { AliasesField } from "./AliasesField";
import { downloadFile } from "./RichBlocks";

const KIND_NAMES: Record<Doc["kind"], string> = {
  doc: "Page",
  note: "Note",
  agenda: "Agenda",
  meeting: "Meeting note",
};

/**
 * A page's Info (ⓘ in its header, NAV-04): how you're working on it, what
 * it belongs to, its tags, what links here, its contents, its versions,
 * who's here, its size and whether it's still true. The facts that used to
 * stack above the words live here, so the page starts with its title and
 * its text. Sections with nothing to say are left out.
 */
export function PageInfo({
  visible,
  doc,
  tags,
  mode,
  canWrite,
  reading,
  facts,
  onMode,
  onTags,
  onShowHistory,
  onClose,
  report,
  outline = [],
  current = -1,
  onJump,
  onShowLinked,
  fieldsStamp,
}: {
  visible: boolean;
  doc: Doc;
  tags: DocTag[];
  mode: DocMode;
  canWrite: boolean;
  /** The page is only being read (its tags can't be changed then). */
  reading: boolean;
  /** "1,204 words · 5 min read · Saved 2 min ago". */
  facts: string;
  onMode: (mode: DocMode) => void;
  onTags: (tags: DocTag[]) => void;
  onShowHistory: () => void;
  onClose: () => void;
  report: (e: unknown) => void;
  /** The page's headings, to jump to one. */
  outline?: OutlineEntry[];
  current?: number;
  onJump?: (entry: OutlineEntry) => void;
  /** Go to "Linked here" under the page. */
  onShowLinked?: () => void;
  /** Changes when someone else sets a field on the page. */
  fieldsStamp?: number;
}) {
  // What it belongs to, its links and versions: read when Info opens.
  const [aliases, setAliases] = useState(doc.aliases ?? []);
  useEffect(() => setAliases(doc.aliases ?? []), [doc.id, doc.aliases]);
  const [info, setInfo] = useState<DocInfo | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    if (!visible) return;
    let live = true;
    client.docInfo(doc.id).then(
      (next) => live && setInfo(next),
      (e) => live && reportRef.current(e),
    );
    return () => {
      live = false;
    };
  }, [visible, doc.id, doc.version]);
  const belongs = [
    KIND_NAMES[doc.kind],
    doc.team_name ? `in ${doc.team_name}` : "Only you",
    doc.project_name ? `for ${doc.project_name}` : null,
    info?.event ? `notes for ${info.event.title}` : null,
    info?.folder ? `in ${info.folder.name}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <BottomSheet visible={visible} title="Info" onClose={onClose}>
      <View style={s.body}>
        <Section label="How you’re working on this page">
          <ChipRow label="How you're working on this page">
            {modesFor(canWrite).map((m) => (
              <Chip
                key={m}
                compact
                label={MODE_LABELS[m].name}
                selected={mode === m}
                accessibilityHint={MODE_LABELS[m].blurb}
                onPress={() => onMode(m)}
              />
            ))}
          </ChipRow>
          <Text style={s.small}>{MODE_LABELS[mode].blurb}</Text>
        </Section>
        <Section label="Belongs to">
          <Text style={s.text}>{belongs}</Text>
        </Section>
        <Section label="Tags">
          <PageTags
            docId={doc.id}
            teamId={doc.team_id}
            tags={tags}
            canWrite={canWrite && !reading}
            onChange={onTags}
            report={report}
          />
          {!tags.length && !(canWrite && !reading) && (
            <Text style={s.small}>No tags.</Text>
          )}
        </Section>
        {(canWrite && !reading) || aliases.length ? (
          <Section label="Also called">
            <AliasesField
              aliases={aliases}
              canWrite={canWrite && !reading}
              onSave={(next) =>
                client.setDocAliases(doc.id, next).then(
                  (r) => {
                    setAliases(r.aliases);
                    return r.aliases;
                  },
                  (e) => {
                    report(e);
                    return aliases;
                  },
                )
              }
            />
          </Section>
        ) : null}
        {doc.imported_from?.original_file ? (
          <Section label="Original file">
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() =>
                void downloadFile(doc.imported_from!.original_file!).catch(
                  report,
                )
              }
            >
              <Text style={s.link}>{doc.imported_from.file_name}</Text>
            </Pressable>
          </Section>
        ) : null}
        {visible && (
          <FilesBlock
            docId={doc.id}
            originalFile={doc.imported_from?.original_file ?? null}
            canWrite={canWrite && !reading}
            revision={doc.version}
            report={report}
          />
        )}
        <FieldsBlock
          docId={doc.id}
          revision={`${doc.version}:${fieldsStamp ?? 0}`}
          report={report}
        />
        {!!info?.linked_here && (
          <Section label="Linked here">
            <Pressable
              accessibilityRole="button"
              onPress={onShowLinked}
              hitSlop={8}
            >
              <Text style={s.link}>
                {info.linked_here === 1
                  ? "1 place links here"
                  : `${info.linked_here} places link here`}
              </Text>
            </Pressable>
          </Section>
        )}
        {outline.length > 0 && onJump && (
          <Section label="Contents">
            <ContentsList outline={outline} current={current} onJump={onJump} />
          </Section>
        )}
        <Section label="This page">
          <Text style={s.small}>{facts}</Text>
          {/* Who else has it open, when anyone has. */}
          <DocViewers docId={doc.id} register={false} />
        </Section>
        <Section label="Versions">
          {info?.versions.recent.map((v) => (
            <View key={v.version} style={s.version}>
              <Text style={s.text}>{v.author ?? "Someone"}</Text>
              <Text style={s.small}>{savedAgo(v.created_at)}</Text>
            </View>
          ))}
          <View style={s.actions}>
            <SmallAction
              label={
                info && info.versions.count > info.versions.recent.length
                  ? `All ${info.versions.count} versions`
                  : "Show history"
              }
              disabled={false}
              onPress={onShowHistory}
            />
          </View>
        </Section>
        {doc.kind === "doc" && (
          <Section label="Confirmed still true">
            <PageFreshness
              doc={{
                ...doc,
                reviewed_at: info?.reviewed_at ?? doc.reviewed_at,
              }}
              canWrite={info?.can_write ?? canWrite}
              always
            />
          </Section>
        )}
      </View>
    </BottomSheet>
  );
}

/**
 * The pictures and files on a page (EDT-01), with how much of your space
 * they all take. Deleting one here frees its space at once; a picture
 * whose line is removed from every page frees it 30 days later.
 */
function FilesBlock({
  docId,
  originalFile,
  canWrite,
  revision,
  report,
}: {
  docId: string;
  originalFile: string | null;
  canWrite: boolean;
  revision: number;
  report: (e: unknown) => void;
}) {
  const [files, setFiles] = useState<PageFile[]>([]);
  const [usage, setUsage] = useState<PageFilesUsage | null>(null);
  const [asked, setAsked] = useState(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    let live = true;
    Promise.all([client.pageFiles(docId), client.filesUsage()]).then(
      ([list, used]) => {
        if (!live) return;
        setFiles(list.filter((f) => f.id !== originalFile));
        setUsage(used);
      },
      (e) => live && reportRef.current(e),
    );
    return () => {
      live = false;
    };
  }, [docId, originalFile, revision, asked]);
  // The space is always shown, so someone near the limit sees it on any page.
  if (!files.length && !usage) return null;
  const remove = (f: PageFile) =>
    Alert.alert(
      `Delete ${f.name} for good?`,
      "It frees its space now. Any line on a page that shows it will say it's gone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            void client
              .deletePageFile(f.id)
              .then(() => setAsked((n) => n + 1), report),
        },
      ],
    );
  const share = usage?.quota_bytes
    ? Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100)
    : 0;
  return (
    <Section label="Pictures and files">
      {files.map((f) => (
        <View key={f.id} style={s.fileRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Download ${f.name}`}
            hitSlop={8}
            style={s.fileName}
            onPress={() => void downloadFile(f.id).catch(report)}
          >
            <Text style={s.link} numberOfLines={1}>
              {f.name}
            </Text>
          </Pressable>
          <Text style={s.small}>{fileSize(f.bytes)}</Text>
          {/* Only the page a file was added to can delete it; a copy
              pasted here goes when its line does. */}
          {canWrite && f.doc_id === docId && (
            <SmallAction
              label="Delete"
              destructive
              disabled={false}
              onPress={() => remove(f)}
            />
          )}
        </View>
      ))}
      {usage && (
        <View style={s.space}>
          <View
            style={s.spaceBar}
            accessibilityRole="progressbar"
            accessibilityLabel="Your space for pictures and files"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: Math.round(share),
            }}
          >
            <View style={[s.spaceUsed, { width: `${share}%` }]} />
          </View>
          <Text style={s.small}>
            {fileSize(usage.used_bytes)} of {fileSize(usage.quota_bytes)} used
            in all your pages. A picture whose line you remove frees its space
            30 days later; pages in Trash keep theirs until the Trash is
            emptied.
          </Text>
        </View>
      )}
    </Section>
  );
}

/** Your own fields (ORG-02), under their own heading once there are any. */
function FieldsBlock({
  docId,
  revision,
  report,
}: {
  docId: string;
  revision: string;
  report: (e: unknown) => void;
}) {
  return (
    <FieldsSection
      target="page"
      targetId={docId}
      revision={revision}
      report={report}
      frame={(content) => <Section label="Fields">{content}</Section>}
    />
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    body: { gap: 18, paddingTop: 6, paddingBottom: 8 },
    section: { gap: 8 },
    label: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: colors.muted,
    },
    text: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
    small: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    actions: { flexDirection: "row", gap: 8 },
    link: { fontFamily: fonts.medium, fontSize: 15, color: colors.accent },
    fileRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    fileName: { flex: 1, minWidth: 0 },
    space: { gap: 6 },
    spaceBar: {
      height: 6,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
    },
    spaceUsed: {
      height: "100%",
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
    },
    version: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 8,
    },
  }),
);
