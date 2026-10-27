import React, { useContext, useEffect, useRef, useState } from "react";
import { OriginalSection } from "../editor/OriginalFile";
import { Linking, StyleSheet, Text, View } from "react-native";
import { session } from "../../../lib/session";
import { errorText } from "../../../lib/errors";
import { InlineDetails } from "../../../components/InlineDetails";
import { Segmented } from "../../../components/Segmented";
import { Pressable } from "../../../motion";
import {
  fileSize,
  MODE_LABELS,
  modesFor,
  savedAgo,
  sourceReadLabel,
  type Doc,
  type DocInfo,
  type DocMode,
  type DocTag,
  type OutlineEntry,
  type PageFile,
  type PageFilesUsage,
  type PageSource,
} from "@orbyn/core";
import { client } from "../../../lib/api";
import { ContentsList } from "../editor/ContentsSheet";
import { BottomSheet } from "../../../components/BottomSheet";
import { SmallAction } from "../../../components/SmallAction";
import { ActionSheet, MoreMenu } from "../../../components/MoreMenu";
import { PageFreshness } from "../../followthrough/PageFreshness";
import { colors, fonts, radii, themed } from "../../../theme";
import { DocViewers } from "../collaboration/DocViewers";
import { PageTags } from "./PageTags";
import { FieldsSection } from "../../views/FieldsSection";
import { AliasesField } from "./AliasesField";
import { DocNavigationContext } from "../library/doc-navigation";
import { openObject } from "../editor/links";
import { downloadFile } from "../editor/RichBlocks";
import { ConnectionsMap } from "../editor/ConnectionsMap";

const KIND_NAMES: Record<Doc["kind"], string> = {
  doc: "Page",
  note: "Note",
  agenda: "Agenda",
  meeting: "Meeting note",
  memory: "Memory note",
  agent: "Agent note",
};

/**
 * A page's Info (ⓘ in its header, NAV-04): how you're working on it, what
 * it belongs to, its tags, what links here, its contents, its versions,
 * who's here, its size and whether it's still true. The facts that used to
 * stack above the words live here, so the page starts with its title and
 * its text. Sections with nothing to say are left out.
 */
export function PageInfo(props: React.ComponentProps<typeof PageInfoBody>) {
  return <PageInfoBody key={`${session.token}:${props.doc.id}`} {...props} />;
}
function PageInfoBody({
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
  starredHeadings,
  onStarHeading,
}: {
  /** Starred headings by block id, and starring one (NAV-07). */
  starredHeadings?: Set<string>;
  onStarHeading?: (entry: OutlineEntry) => void;
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
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const owns = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const navigation = useContext(DocNavigationContext);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const nextAction = useRef<(() => void) | null>(null);
  const [pendingActions, setPendingActions] = useState(0);
  const pendingCount = useRef(0);
  const handoff = (action: () => void) => {
    if (
      !owns() ||
      !visibleRef.current ||
      pendingCount.current ||
      nextAction.current
    )
      return;
    nextAction.current = action;
    onClose();
  };
  const afterClose = () => {
    const action = nextAction.current;
    nextAction.current = null;
    if (owns() && !visibleRef.current) action?.();
  };
  const actionPending = (pending: boolean) => {
    if (!owns()) return;
    pendingCount.current = Math.max(
      0,
      pendingCount.current + (pending ? 1 : -1),
    );
    setPendingActions(pendingCount.current);
  };
  const [infoError, setInfoError] = useState("");
  const [infoLoading, setInfoLoading] = useState(false);
  // What it belongs to, its links and versions: read when Info opens.
  const [aliases, setAliases] = useState(doc.aliases ?? []);
  const aliasDocId = useRef(doc.id);
  aliasDocId.current = doc.id;
  useEffect(() => setAliases(doc.aliases ?? []), [doc.id, doc.aliases]);
  const [loaded, setLoaded] = useState<{
    version: number;
    info: DocInfo;
  } | null>(null);
  const info = loaded?.version === doc.version ? loaded.info : null;
  const [infoAsked, setInfoAsked] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    setInfoError("");
    setInfoLoading(true);
    client
      .docInfo(doc.id)
      .then(
        (info) => {
          if (live && owns()) setLoaded({ version: doc.version, info });
        },
        (e) => {
          if (live && owns()) setInfoError(errorText(e));
        },
      )
      .finally(() => {
        if (live && owns()) setInfoLoading(false);
      });
    return () => {
      live = false;
    };
  }, [visible, doc.id, doc.version, infoAsked]);
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
    <BottomSheet
      visible={visible}
      title="Page details"
      onClose={() => {
        if (owns() && !pendingCount.current) onClose();
      }}
      closeDisabled={pendingActions > 0}
      afterClose={afterClose}
    >
      <View style={s.body}>
        <Section label="Mode">
          <Segmented
            accessibilityLabel="Page mode"
            options={modesFor(canWrite)}
            labels={Object.fromEntries(
              modesFor(canWrite).map((m) => [m, MODE_LABELS[m].name]),
            )}
            value={mode}
            onChange={(value) => {
              if (owns() && !pendingCount.current) onMode(value);
            }}
            disabled={pendingActions > 0}
          />
        </Section>
        {infoLoading && <Text style={s.small}>Loading page details…</Text>}
        {!!infoError && (
          <View>
            <Text accessibilityRole="alert" style={s.error}>
              {infoError}
            </Text>
            <SmallAction
              label="Retry page details"
              disabled={pendingActions > 0}
              onPress={() => setInfoAsked((n) => n + 1)}
            />
          </View>
        )}
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
            onBusyChange={actionPending}
          />
          {!tags.length && !(canWrite && !reading) && (
            <Text style={s.small}>No tags.</Text>
          )}
        </Section>
        <InlineDetails title="More page details" reveal={!!infoError}>
          {(canWrite && !reading) || aliases.length ? (
            <Section label="Also called">
              <AliasesField
                key={doc.id}
                aliases={aliases}
                canWrite={canWrite && !reading}
                onSave={async (next) => {
                  if (!owns() || !canWrite || reading)
                    throw new Error("This page is view only.");
                  actionPending(true);
                  try {
                    const r = await client.setDocAliases(doc.id, next);
                    if (owns() && aliasDocId.current === doc.id)
                      setAliases(r.aliases);
                    return r.aliases;
                  } finally {
                    actionPending(false);
                  }
                }}
              />
            </Section>
          ) : null}
          {/* A file kept with "Keep the original": take it away or delete it. */}
          <OriginalSection
            doc={doc}
            canWrite={canWrite && !reading}
            report={report}
            onBusyChange={actionPending}
          />
          {visible && (
            <FilesBlock
              docId={doc.id}
              canWrite={canWrite && !reading}
              revision={doc.version}
              report={report}
              onBusyChange={actionPending}
            />
          )}
          {!!info?.sources?.length && (
            <SourcesBlock
              docId={doc.id}
              sources={info.sources}
              canWrite={(info.can_write ?? canWrite) && !reading}
              onRemoved={() => {
                if (owns()) setInfoAsked((n) => n + 1);
              }}
              onBusyChange={actionPending}
              report={report}
            />
          )}
          <FieldsBlock
            docId={doc.id}
            revision={`${doc.version}:${fieldsStamp ?? 0}`}
            report={report}
          />
          {!!info?.linked_here && onShowLinked && (
            <Section label="Linked here">
              <Pressable
                accessibilityRole="button"
                onPress={() => handoff(onShowLinked)}
                style={s.linkAction}
              >
                <Text style={s.link}>
                  {info.linked_here === 1
                    ? "1 place links here"
                    : `${info.linked_here} places link here`}
                </Text>
              </Pressable>
            </Section>
          )}
          {visible && (
            <ConnectionsMap
              kind="doc"
              id={doc.id}
              revision={doc.version}
              report={report}
              onOpen={(ref) =>
                handoff(() => openObject(ref, undefined, navigation?.onAppLink))
              }
            />
          )}
          {outline.length > 0 && onJump && (
            <Section label="Contents">
              <ContentsList
                outline={outline}
                current={current}
                onJump={(entry) => handoff(() => onJump(entry))}
                starred={starredHeadings}
                onStar={onStarHeading}
              />
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
                onPress={() => handoff(onShowHistory)}
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
          <InlineDetails title="About page modes">
            <Text style={s.small}>{MODE_LABELS[mode].blurb}</Text>
          </InlineDetails>
        </InlineDetails>
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
  canWrite,
  revision,
  onBusyChange,
}: {
  docId: string;
  canWrite: boolean;
  revision: number;
  report: (e: unknown) => void;
  onBusyChange: (pending: boolean) => void;
}) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const mutation = useRef(false);
  const busyChanged = useRef(onBusyChange);
  busyChanged.current = onBusyChange;
  const ticket = useRef(0);
  const permission = useRef(canWrite);
  permission.current = canWrite;
  const owns = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (mutation.current) {
        mutation.current = false;
        busyChanged.current(false);
      }
      ticket.current++;
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const currentRevision = useRef(revision);
  currentRevision.current = revision;
  const [removePrompt, setRemovePrompt] = useState<PageFile | null>(null);
  const [files, setFiles] = useState<PageFile[]>([]);
  const [usage, setUsage] = useState<PageFilesUsage | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (mutation.current) return;
    let live = true;
    const request = ++ticket.current;
    setLoading(true);
    setReadError("");
    Promise.all([client.pageFiles(docId), client.filesUsage()])
      .then(
        ([list, used]) => {
          if (!live || !owns() || request !== ticket.current) return;
          setFiles(list);
          setUsage(used);
        },
        (e) => {
          if (live && owns() && request === ticket.current)
            setReadError(errorText(e));
        },
      )
      .finally(() => {
        if (live && owns() && request === ticket.current) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [docId, revision, asked]);
  const remove = async (file: PageFile) => {
    if (
      !owns() ||
      mutation.current ||
      loading ||
      !permission.current ||
      file.doc_id !== docId
    )
      return;
    mutation.current = true;
    ticket.current++;
    setBusy(true);
    setError("");
    busyChanged.current(true);
    try {
      await client.deletePageFile(file.id);
      if (!owns()) return;
      setFiles((all) => all.filter((f) => f.id !== file.id));
      setUsage(null);
      setAsked((n) => n + 1);
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      mutation.current = false;
      if (owns()) {
        setBusy(false);
        busyChanged.current(false);
      }
    }
  };
  const download = async (file: PageFile) => {
    if (!owns() || mutation.current) return;
    mutation.current = true;
    const beganAtRevision = currentRevision.current;
    setBusy(true);
    setError("");
    busyChanged.current(true);
    try {
      await downloadFile(file.id);
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      mutation.current = false;
      if (owns()) {
        setBusy(false);
        busyChanged.current(false);
        if (currentRevision.current !== beganAtRevision) setAsked((n) => n + 1);
      }
    }
  };
  const share = usage?.quota_bytes
    ? Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100)
    : 0;
  return (
    <Section label="Files">
      {loading && <Text style={s.small}>Loading files…</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {!!readError && (
        <View>
          <Text accessibilityRole="alert" style={s.error}>
            {readError}
          </Text>
          <SmallAction
            label="Retry files"
            disabled={busy || loading}
            onPress={() => setAsked((n) => n + 1)}
          />
        </View>
      )}
      {!loading && !readError && !files.length && (
        <Text style={s.small}>No files.</Text>
      )}
      {files.map((f) => (
        <View key={f.id} style={s.fileRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Download ${f.name}`}
            disabled={busy}
            style={s.fileName}
            onPress={() => void download(f)}
          >
            <Text style={s.link}>{f.name}</Text>
          </Pressable>
          <Text style={s.small}>{fileSize(f.bytes)}</Text>
          {/* Only the page a file was added to can delete it; a copy
              pasted here goes when its line does. */}
          {canWrite && f.doc_id === docId && (
            <MoreMenu
              label={`Options for ${f.name}`}
              title={f.name}
              disabled={busy || loading}
              actions={[
                {
                  label: "Delete file",
                  destructive: true,
                  onPress: () => setRemovePrompt(f),
                },
              ]}
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
            across your pages.
          </Text>
          <InlineDetails title="File retention">
            <Text style={s.small}>
              Removed pictures free space after 30 days. Trash keeps files until
              emptied.
            </Text>
          </InlineDetails>
        </View>
      )}
      <ActionSheet
        visible={!!removePrompt}
        label="Delete file"
        title={`Delete “${removePrompt?.name ?? "file"}”?`}
        message="This permanently deletes the file. Pages using it will show it as missing."
        cancelLabel="Keep file"
        actions={[
          {
            label: "Delete file",
            destructive: true,
            disabled: busy || loading,
            onPress: () => {
              if (removePrompt) void remove(removePrompt);
            },
          },
        ]}
        onClose={() => setRemovePrompt(null)}
      />
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

/**
 * Sources an agent read and saved for this page (H2): title (opens the
 * address), site, author, the day it was read and the words it quoted.
 */
function SourcesBlock({
  docId,
  sources,
  canWrite,
  onRemoved,
  report,
  onBusyChange,
}: {
  docId: string;
  sources: PageSource[];
  canWrite: boolean;
  onRemoved: () => void;
  report: (e: unknown) => void;
  onBusyChange: (pending: boolean) => void;
}) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true),
    mutation = useRef(false);
  const busyChanged = useRef(onBusyChange);
  busyChanged.current = onBusyChange;
  const permission = useRef(canWrite);
  permission.current = canWrite;
  const owns = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (mutation.current) {
        mutation.current = false;
        busyChanged.current(false);
      }
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!mutation.current) setRemoved(new Set());
  }, [sources]);
  const [prompt, setPrompt] = useState<PageSource | null>(null);
  const remove = async (src: PageSource) => {
    if (
      !owns() ||
      !permission.current ||
      mutation.current ||
      removed.has(src.id)
    )
      return;
    mutation.current = true;
    setBusy(true);
    setError("");
    busyChanged.current(true);
    try {
      await client.removePageSource(docId, src.id);
      if (owns()) {
        setRemoved((all) => new Set([...all, src.id]));
        onRemoved();
      }
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      mutation.current = false;
      if (owns()) {
        setBusy(false);
        busyChanged.current(false);
      }
    }
  };
  return (
    <Section label="Sources">
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {sources
        .filter((src) => !removed.has(src.id))
        .map((src) => (
          <View key={src.id} style={s.sourceRow}>
            <View style={s.source}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open ${src.title}`}
                style={s.linkAction}
                disabled={busy}
                onPress={() =>
                  void Linking.openURL(src.url).catch((e) => {
                    if (owns()) report(e);
                  })
                }
              >
                <Text style={s.link}>{src.title}</Text>
              </Pressable>
              <Text style={s.small}>
                {[src.site, src.author, sourceReadLabel(src.accessed_on)]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {!!src.quote && (
                <InlineDetails title="Quoted text">
                  <Text style={s.quote}>{src.quote}</Text>
                </InlineDetails>
              )}
            </View>
            {canWrite && (
              <MoreMenu
                label={`Options for ${src.title}`}
                title={src.title}
                disabled={busy}
                actions={[
                  {
                    label: "Remove from this page",
                    icon: "trash",
                    destructive: true,
                    onPress: () => setPrompt(src),
                  },
                ]}
              />
            )}
          </View>
        ))}
      <ActionSheet
        visible={!!prompt}
        label="Remove source"
        title={`Remove “${prompt?.title ?? "source"}”?`}
        message="The page text and citations on other pages stay."
        cancelLabel="Keep source"
        actions={[
          {
            label: "Remove source",
            destructive: true,
            disabled: busy,
            onPress: () => {
              if (prompt) void remove(prompt);
            },
          },
        ]}
        onClose={() => setPrompt(null)}
      />
    </Section>
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
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
    linkAction: { minHeight: 44, justifyContent: "center" },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    link: { fontFamily: fonts.medium, fontSize: 15, color: colors.accent },
    fileRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 10,
    },
    sourceRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    source: { flex: 1, minWidth: 0, gap: 2 },
    quote: {
      marginTop: 2,
      paddingLeft: 8,
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.textSoft,
    },
    fileName: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 160,
      minWidth: 0,
      minHeight: 44,
      justifyContent: "center",
    },
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
      flexWrap: "wrap",
      gap: 8,
    },
  }),
);
