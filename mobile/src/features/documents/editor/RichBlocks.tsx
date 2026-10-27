import { DocNavigationContext } from "../library/doc-navigation";
import { openAppUrl } from "../../../hooks/useAppLinks";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Pressable } from "../../../motion";
import { MermaidDiagram } from "../../../components/MermaidDiagram";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CALLOUT_LABELS,
  FRONTMATTER_LANG,
  docCodeLabel,
  colourCode,
  colourable,
  docObjectLinks,
  docReferenceLinks,
  docReferenceMap,
  footnoteNumbers,
  fileSize,
  isAudio,
  PAGE_FILE_TYPES,
  recordingClock,
  parseEmbed,
  parseTable,
  tableMarkdown,
  type CalloutKind,
  type DocBlock,
  type PageFile,
  type TableCells,
} from "@orbyn/core";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { client } from "../../../lib/api";
import { session } from "../../../lib/session";
import { copyText } from "../../../lib/share";
import { saveFile } from "../../../lib/download";
import { BottomSheet } from "../../../components/BottomSheet";
import { Icon, type IconName } from "../../../components/Icon";
import {
  inputFontSize,
  colors,
  controls,
  fonts,
  radii,
  themed,
  tint,
} from "../../../theme";
import { Inline } from "./Inline";
import { openObject, pillKey, shortDue, usePagePills } from "./links";

/**
 * The richer lines of a page on the phone (D4b): callouts, tables (edited
 * in a sheet of cells), pictures with a full-screen viewer, files, footnotes,
 * coloured code, isolated Mermaid diagrams, and live embeds of another
 * page's section or of the tasks the page links to.
 */

// ------------------------------------------------------------- footnotes ---

import { FootnoteContext } from "./footnotes";
export { FootnoteContext } from "./footnotes";

/** A footnote's words, as the page lists them. */
export function FootnoteLine({
  block,
  number,
}: {
  block: Extract<DocBlock, { type: "footnote" }>;
  number: number | string;
}) {
  return (
    <View style={s.footnote}>
      <Text style={s.footnoteNumber}>{number}</Text>
      <Text style={s.footnoteText}>
        <Inline text={block.text} />
      </Text>
    </View>
  );
}

// -------------------------------------------------------------- callouts ---

const CALLOUT_ICONS: Record<CalloutKind, IconName> = {
  note: "info",
  tip: "lightbulb",
  warning: "alert",
  question: "circleHelp",
  summary: "clipboardList",
};

/** A callout: a set-apart box with its kind's icon, tint and name. */
export function CalloutView({
  block,
}: {
  block: Extract<DocBlock, { type: "callout" }>;
}) {
  const [open, setOpen] = useState(!block.folded);
  const tone =
    block.kind === "tip"
      ? s.tip
      : block.kind === "warning"
        ? s.warning
        : block.kind === "question"
          ? s.question
          : block.kind === "summary"
            ? s.summary
            : null;
  return (
    <View style={[s.callout, tone]}>
      <Icon
        name={CALLOUT_ICONS[block.kind]}
        size={16}
        color={
          block.kind === "warning"
            ? colors.warning
            : block.kind === "question"
              ? colors.highText
              : colors.accent
        }
      />
      <Text style={s.calloutText} numberOfLines={open ? undefined : 1}>
        <Text style={s.calloutLabel}>{CALLOUT_LABELS[block.kind]} </Text>
        <Inline text={block.text} />
      </Text>
      {block.folded && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "Fold" : "Unfold"}
          accessibilityState={{ expanded: open }}
          style={s.foldButton}
          onPress={() => setOpen((v) => !v)}
        >
          <Icon
            name={open ? "chevronDown" : "chevronRight"}
            size={16}
            color={colors.muted}
          />
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- tables ---

/** The narrowest a cell is drawn, so a table scrolls sideways rather than squeezes. */
const CELL_MIN = 110;

/**
 * A table (EDT-02), scrolling sideways on a narrow phone. Tapping it opens
 * its cells to edit, when the page can be changed.
 */
export function TableView({
  text,
  onEdit,
}: {
  text: string;
  onEdit?: () => void;
}) {
  const { rows, align } = useMemo(() => parseTable(text), [text]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.tableScroll}
    >
      <Pressable
        onPress={onEdit}
        disabled={!onEdit}
        accessibilityRole={onEdit ? "button" : undefined}
        accessibilityLabel={onEdit ? "Edit this table" : "Table"}
        style={s.table}
      >
        {rows.map((row, r) => (
          <View key={r} style={[s.tableRow, r === 0 && s.tableHead]}>
            {row.map((cell, c) => (
              <View key={c} style={s.tableCell}>
                <Text
                  style={[
                    s.tableText,
                    r === 0 && s.tableHeadText,
                    align[c] ? { textAlign: align[c]! } : null,
                  ]}
                >
                  <Inline text={cell} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </Pressable>
    </ScrollView>
  );
}

/**
 * A table's cells to edit, in a sheet: Return moves to the next cell, and
 * rows and columns are added and taken off at the end or where the caret is.
 */
export function TableEditor({
  visible,
  text,
  onSave,
  onClose,
}: {
  visible: boolean;
  text: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [saveError, setSaveError] = useState("");
  const [table, setTable] = useState<TableCells>(() => parseTable(text));
  const [at, setAt] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const inputs = useRef(new Map<string, TextInput | null>());
  useEffect(() => {
    if (visible) {
      setTable(parseTable(text));
      setSaveError("");
    }
  }, [visible, text]);
  const width = table.rows[0]?.length ?? 1;
  const set = (rows: string[][], align = table.align) =>
    setTable({ rows, align });
  const focus = (r: number, c: number) =>
    requestAnimationFrame(() => inputs.current.get(`${r}:${c}`)?.focus());
  const addRow = () => {
    const rows = table.rows.map((row) => row.slice());
    rows.splice(at.r + 1, 0, Array(width).fill(""));
    set(rows);
    focus(at.r + 1, 0);
  };
  const addColumn = () => {
    const rows = table.rows.map((row) => {
      const copy = row.slice();
      copy.splice(at.c + 1, 0, "");
      return copy;
    });
    const align = table.align.slice();
    align.splice(at.c + 1, 0, null);
    set(rows, align);
    focus(at.r, at.c + 1);
  };
  const removeRow = () => {
    if (table.rows.length <= 1) return;
    set(table.rows.filter((_, i) => i !== at.r));
    setAt({ r: Math.max(0, at.r - 1), c: at.c });
  };
  const removeColumn = () => {
    if (width <= 1) return;
    set(
      table.rows.map((row) => row.filter((_, i) => i !== at.c)),
      table.align.filter((_, i) => i !== at.c),
    );
    setAt({ r: at.r, c: Math.max(0, at.c - 1) });
  };
  return (
    <BottomSheet
      visible={visible}
      title="Table"
      onClose={onClose}
      footer={
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            try {
              setSaveError("");
              onSave(tableMarkdown(table));
              onClose();
            } catch (e) {
              setSaveError(
                e instanceof Error
                  ? e.message
                  : "Couldn't save the table. Try again.",
              );
            }
          }}
          style={({ pressed }) => [s.save, pressed && s.savePressed]}
        >
          <Text style={s.saveText}>Done</Text>
        </Pressable>
      }
    >
      {saveError && (
        <Text style={s.error} accessibilityLiveRegion="polite">
          {saveError}
        </Text>
      )}
      <View style={s.tableTools}>
        <ToolChip label="+ Row" onPress={addRow} />
        <ToolChip label="+ Column" onPress={addColumn} />
        <ToolChip
          label="Remove row"
          disabled={table.rows.length <= 1}
          onPress={removeRow}
        />
        <ToolChip
          label="Remove column"
          disabled={width <= 1}
          onPress={removeColumn}
        />
      </View>
      <ScrollView horizontal keyboardShouldPersistTaps="always">
        <View style={s.table}>
          {table.rows.map((row, r) => (
            <View key={r} style={[s.tableRow, r === 0 && s.tableHead]}>
              {row.map((cell, c) => (
                <View key={c} style={s.tableCell}>
                  <TextInput
                    ref={(el) => {
                      inputs.current.set(`${r}:${c}`, el);
                    }}
                    value={cell}
                    placeholder={r === 0 ? "Heading" : ""}
                    placeholderTextColor={colors.faint}
                    style={[s.tableInput, r === 0 && s.tableHeadText]}
                    accessibilityLabel={
                      r === 0
                        ? `Column ${c + 1} heading`
                        : `Row ${r}, column ${c + 1}`
                    }
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onFocus={() => setAt({ r, c })}
                    onChangeText={(v) => {
                      const rows = table.rows.map((x) => x.slice());
                      rows[r][c] = v.replace(/\n/g, " ");
                      set(rows);
                    }}
                    onSubmitEditing={() => {
                      const flat = r * width + c + 1;
                      if (flat >= table.rows.length * width) {
                        const rows = table.rows.map((x) => x.slice());
                        rows.push(Array(width).fill(""));
                        set(rows);
                      }
                      focus(Math.floor(flat / width), flat % width);
                    }}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

function ToolChip({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.chip,
        pressed && { backgroundColor: colors.surfaceMuted },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text style={s.chipText}>{label}</Text>
    </Pressable>
  );
}

// --------------------------------------------------- pictures and files ---

type Link = { url: string; file: PageFile; until: number };
const links = new Map<string, Link>();
const waiting = new Map<string, Promise<Link>>();
let linkOwner = "";

/** Short-lived file URLs belong to the session that resolved them. */
export function fileLink(id: string): Promise<Link> {
  const owner = session.token;
  if (linkOwner !== owner) {
    links.clear();
    waiting.clear();
    linkOwner = owner;
  }
  const kept = links.get(id);
  if (kept && kept.until > Date.now()) return Promise.resolve(kept);
  const running = waiting.get(id);
  if (running) return running;
  const made = client
    .pageFile(id)
    .then((l) => {
      if (session.token !== owner || linkOwner !== owner)
        throw new Error("The signed-in account changed.");
      const link = {
        url: client.urlFor(l.url_path),
        file: l.file,
        until: Date.parse(l.expires_at) - 5 * 60_000,
      };
      for (const [key, cached] of links)
        if (cached.until <= Date.now()) links.delete(key);
      links.set(id, link);
      return link;
    })
    .finally(() => {
      if (waiting.get(id) === made) waiting.delete(id);
    });
  waiting.set(id, made);
  return made;
}

function useFileLink(id: string) {
  const owner = session.token;
  const [result, setResult] = useState<{
    owner: string;
    id: string;
    link: Link | null;
    failed: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    const current = () => live && session.token === owner;
    setResult(null);
    fileLink(id).then(
      (link) => {
        if (current()) setResult({ owner, id, link, failed: false });
      },
      () => {
        if (current()) setResult({ owner, id, link: null, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [id, owner, retry]);
  const current = result?.owner === owner && result.id === id ? result : null;
  return {
    link: current?.link ?? null,
    failed: current?.failed ?? false,
    reload: () => setRetry((n) => n + 1),
  };
}

/** Save only while the account that requested the file remains signed in. */
export async function downloadFile(id: string) {
  const owner = session.token;
  const current = () => {
    if (session.token !== owner)
      throw new Error("The signed-in account changed.");
  };
  const link = await fileLink(id);
  current();
  const res = await fetch(`${link.url}?download=1`);
  if (!res.ok) throw new Error("Couldn't download this file.");
  const data = await res.blob();
  current();
  await saveFile(link.file.name, data, link.file.mime);
}

function useFileDownload(id: string) {
  const owner = session.token;
  const key = `${owner}:${id}`;
  const scope = useRef(key);
  scope.current = key;
  const alive = useRef(true);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setError("");
  }, [key]);
  const download = () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const current = () =>
      alive.current && scope.current === key && session.token === owner;
    void downloadFile(id)
      .catch(() => {
        if (current()) setError("Couldn't download this file. Try again.");
      })
      .finally(() => {
        pending.current = false;
        if (alive.current) setBusy(false);
      });
  };
  return { busy, error, download };
}

/** The picture sizes a phone offers, as shares of the page. */
const SIZES: { label: string; width: number }[] = [
  { label: "Small", width: 40 },
  { label: "Medium", width: 70 },
  { label: "Full width", width: 100 },
];

/**
 * A picture (EDT-01): drawn at its width, tapped to open full screen, where
 * it zooms with a pinch and closes with a swipe down; its size and caption
 * are set there when the page can be changed.
 */
export function ImageBlock({
  block,
  onChange,
}: {
  block: Extract<DocBlock, { type: "image" }>;
  onChange?: (block: DocBlock) => void;
}) {
  const { link, failed, reload } = useFileLink(block.file);
  const [viewing, setViewing] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    setViewing(false);
  }, [block.file, session.token]);
  useEffect(() => {
    let live = true;
    setRatio(null);
    if (!link) return;
    if (link.file.width && link.file.height) {
      setRatio(link.file.width / link.file.height);
      return;
    }
    Image.getSize(
      link.url,
      (w, h) => {
        if (live) setRatio(w / h);
      },
      () => {
        if (live) setRatio(4 / 3);
      },
    );
    return () => {
      live = false;
    };
  }, [link]);
  if (failed)
    return (
      <View style={s.imageMissing}>
        <Text style={s.muted}>Couldn’t load this picture.</Text>
        <ToolChip label="Retry" onPress={reload} />
      </View>
    );
  return (
    <View style={{ width: `${block.width ?? 100}%` }}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`${block.text || "Picture"}. Open full screen.`}
        onPress={() => link && setViewing(true)}
      >
        {link && ratio ? (
          <Image
            source={{ uri: link.url }}
            style={[s.image, { aspectRatio: ratio }]}
            resizeMode="cover"
          />
        ) : (
          <View style={[s.image, s.imageLoading]} />
        )}
      </Pressable>
      {!!block.text && <Text style={s.caption}>{block.text}</Text>}
      {link && (
        <ImageViewer
          key={`${session.token}:${block.file}`}
          visible={viewing}
          url={link.url}
          name={block.text || link.file.name}
          block={block}
          onChange={onChange}
          onClose={() => setViewing(false)}
        />
      )}
    </View>
  );
}

function ImageViewer({
  visible,
  url,
  name,
  block,
  onChange,
  onClose,
}: {
  visible: boolean;
  url: string;
  name: string;
  block: Extract<DocBlock, { type: "image" }>;
  onChange?: (block: DocBlock) => void;
  onClose: () => void;
}) {
  const download = useFileDownload(block.file);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [caption, setCaption] = useState(block.text);
  useEffect(() => {
    if (visible) {
      setScale(1);
      setPan({ x: 0, y: 0 });
      setCaption(block.text);
    }
  }, [visible, block.text]);
  const gesture = useRef({
    distance: 0,
    scale: 1,
    pan: { x: 0, y: 0 },
    lastTap: 0,
  });
  const state = useRef({ scale, pan });
  state.current = { scale, pan };
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const touches = e.nativeEvent.touches;
          gesture.current.scale = state.current.scale;
          gesture.current.pan = state.current.pan;
          gesture.current.distance =
            touches.length >= 2
              ? Math.hypot(
                  touches[0].pageX - touches[1].pageX,
                  touches[0].pageY - touches[1].pageY,
                )
              : 0;
          // A double tap zooms in, or back out.
          const now = Date.now();
          if (touches.length === 1 && now - gesture.current.lastTap < 280) {
            const next = state.current.scale > 1 ? 1 : 2.5;
            setScale(next);
            if (next === 1) setPan({ x: 0, y: 0 });
          }
          gesture.current.lastTap = now;
        },
        onPanResponderMove: (e, g) => {
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            const d = Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            );
            if (!gesture.current.distance) gesture.current.distance = d;
            const next = Math.max(
              1,
              Math.min(
                5,
                (gesture.current.scale * d) / gesture.current.distance,
              ),
            );
            setScale(next);
            return;
          }
          if (state.current.scale > 1)
            setPan({
              x: gesture.current.pan.x + g.dx,
              y: gesture.current.pan.y + g.dy,
            });
          else setPan({ x: 0, y: Math.max(0, g.dy) });
        },
        onPanResponderRelease: (_e, g) => {
          // Swiped down at its own size: put it away.
          if (state.current.scale === 1) {
            if (g.dy > 120) closeRef.current();
            setPan({ x: 0, y: 0 });
          }
        },
      }),
    [],
  );
  const setSize = (w: number) => {
    if (!onChange) return;
    const { width: _old, ...rest } = block;
    onChange(w >= 100 ? rest : { ...rest, width: w });
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.viewer}>
        <ScrollView
          style={{ maxHeight: height * 0.25, flexGrow: 0 }}
          contentContainerStyle={[s.viewerBar, { paddingTop: insets.top + 8 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.viewerName}>{name}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Download"
            disabled={download.busy}
            onPress={download.download}
            style={s.viewerButton}
          >
            <Icon name="download" size={20} color={colors.white} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={s.viewerButton}
          >
            <Icon name="x" size={20} color={colors.white} />
          </Pressable>
        </ScrollView>
        {download.error ? (
          <Text style={s.viewerError}>{download.error}</Text>
        ) : null}
        <View style={s.viewerStage} {...responder.panHandlers}>
          <Image
            source={{ uri: url }}
            resizeMode="contain"
            accessibilityLabel={name}
            style={{
              width,
              height: height * 0.7,
              transform: [
                { translateX: pan.x },
                { translateY: pan.y },
                { scale },
              ],
            }}
          />
        </View>
        {onChange && (
          <ScrollView
            style={{ maxHeight: height * 0.35, flexGrow: 0 }}
            contentContainerStyle={[
              s.viewerTools,
              { paddingBottom: insets.bottom + 12 },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.sizes}>
              {SIZES.map((size) => {
                const on = (block.width ?? 100) === size.width;
                return (
                  <Pressable
                    key={size.width}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => setSize(size.width)}
                    style={[s.size, on && s.sizeOn]}
                  >
                    <Text style={[s.sizeText, on && s.sizeTextOn]}>
                      {size.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={caption}
              placeholder="Add a caption"
              placeholderTextColor={colors.faint}
              style={s.viewerCaption}
              maxLength={300}
              accessibilityLabel="Caption"
              onChangeText={setCaption}
              onEndEditing={() => {
                if (caption !== block.text)
                  onChange({ ...block, text: caption });
              }}
            />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/** A file on a page: its name, kind and size, and Download. */
/**
 * What a page offers for its recordings (CAP-10): a summary from the
 * assistant. The editor provides it; a page shown elsewhere has none.
 */
export const RecordingContext = React.createContext<{
  summarise?: (fileId: string, name: string) => void;
}>({});

/** A recording on a page: play it here, and ask for its summary. */
function AudioCard({
  block,
  url,
  file,
}: {
  block: Extract<DocBlock, { type: "file" }>;
  url: string;
  file: PageFile;
}) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const recording = React.useContext(RecordingContext);
  const name = block.text || file.name;
  return (
    <View style={s.file}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? `Pause ${name}` : `Play ${name}`}
        onPress={() => (status.playing ? player.pause() : player.play())}
        style={({ pressed }) => [s.fileButton, pressed && s.pressed]}
      >
        <Icon
          name={status.playing ? "pause" : "play"}
          size={16}
          color={colors.accent}
        />
      </Pressable>
      <View style={s.fileText}>
        <Text style={s.fileName}>{name}</Text>
        <Text style={s.fileMeta}>
          {[
            "Recording",
            status.duration
              ? recordingClock(status.duration)
              : fileSize(file.bytes),
            status.currentTime && status.playing
              ? recordingClock(status.currentTime)
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      {recording.summarise && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Summarise ${name}`}
          onPress={() => recording.summarise?.(block.file, name)}
          style={({ pressed }) => [s.fileButton, pressed && s.pressed]}
        >
          <Icon name="sparkles" size={16} color={colors.accent} />
        </Pressable>
      )}
    </View>
  );
}

export function FileCard({
  block,
}: {
  block: Extract<DocBlock, { type: "file" }>;
}) {
  const { link, failed, reload } = useFileLink(block.file);
  const file = link?.file ?? null;
  const download = useFileDownload(block.file);
  if (link && file && isAudio(file.mime))
    return <AudioCard block={block} url={link.url} file={file} />;
  return (
    <View style={s.file}>
      <Icon name="paperclip" size={18} color={colors.muted} />
      <View style={s.fileText}>
        <Text style={s.fileName}>{block.text || file?.name || "File"}</Text>
        <Text style={s.fileMeta}>
          {failed
            ? "Couldn’t load this file"
            : file
              ? [
                  PAGE_FILE_TYPES[file.mime] ?? "File",
                  fileSize(file.bytes),
                  file.source === "import" ? "Original" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Loading file…"}
        </Text>
      </View>
      {failed ? (
        <ToolChip label="Retry" onPress={reload} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Download ${block.text}`}
          disabled={download.busy || !link}
          onPress={download.download}
          style={({ pressed }) => [s.fileButton, pressed && s.pressed]}
        >
          <Icon name="download" size={16} color={colors.accent} />
        </Pressable>
      )}
      {download.error ? <Text style={s.error}>{download.error}</Text> : null}
    </View>
  );
}

// ------------------------------------------------------------------ code ---

/** Copyable preserved source with contained scrolling and readable metadata naming. */
export function CodeView({ text, lang }: { text: string; lang: string }) {
  const metadata = lang === FRONTMATTER_LANG;
  const [open, setOpen] = useState(!metadata);
  const [source, setSource] = useState(false);
  const highlighted = colourable(lang);
  const tokens = useMemo(
    () => (highlighted && !source ? colourCode(text, lang) : null),
    [text, lang, source, highlighted],
  );
  return (
    <View style={s.codeBlock}>
      <View style={s.codeToolbar}>
        <Text style={s.codeLabel}>{docCodeLabel(lang)}</Text>
        {metadata ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen(!open)}
            style={s.codeButton}
          >
            <Text style={s.codeAction}>
              {open ? "Hide source" : "View source"}
            </Text>
          </Pressable>
        ) : highlighted ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: source }}
            onPress={() => setSource(!source)}
            style={s.codeButton}
          >
            <Text style={s.codeAction}>{source ? "Highlight" : "Source"}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void copyText(text, metadata ? "Metadata copied" : "Code copied")
          }
          style={s.codeButton}
        >
          <Text style={s.codeAction}>Copy</Text>
        </Pressable>
      </View>
      {open && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          accessibilityLabel={metadata ? "YAML metadata source" : "Code source"}
        >
          <Text selectable style={s.code}>
            {tokens
              ? tokens.map((token, index) => (
                  <Text
                    key={index}
                    style={
                      token.kind === "keyword"
                        ? s.codeKeyword
                        : token.kind === "string"
                          ? s.codeString
                          : token.kind === "comment"
                            ? s.codeComment
                            : token.kind === "number"
                              ? s.codeNumber
                              : token.kind === "name"
                                ? s.codeName
                                : undefined
                    }
                  >
                    {token.text}
                  </Text>
                ))
              : text}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

// -------------------------------------------------------------- diagrams ---

/** All supported Mermaid families render through the bundled isolated surface. */
export function DiagramView({ text }: { text: string }) {
  return <MermaidDiagram text={text} />;
}

// ---------------------------------------------------------------- embeds ---

type Section = Awaited<ReturnType<typeof client.docSection>>;

/**
 * A live embed (LNK-08): another page's section, read-only and kept up to
 * date, with Open to change it at its source; or the tasks this page links
 * to, with their ticks.
 */
export function EmbedBlock({
  text,
  pageBlocks,
}: {
  text: string;
  pageBlocks: DocBlock[];
}) {
  const spec = useMemo(() => parseEmbed(text), [text]);
  if (!spec)
    return (
      <View style={s.embed}>
        <Text style={s.muted}>This embed doesn't say what to show.</Text>
      </View>
    );
  if (spec.kind === "tasks") return <LinkedTasks blocks={pageBlocks} />;
  return <SectionEmbed doc={spec.doc} block={spec.block} />;
}

function SectionEmbed(props: { doc: string; block: string | null }) {
  return (
    <SectionEmbedBody
      key={`${session.token}:${props.doc}:${props.block ?? ""}`}
      {...props}
    />
  );
}

function SectionEmbedBody({
  doc,
  block,
}: {
  doc: string;
  block: string | null;
}) {
  const navigation = useContext(DocNavigationContext);
  const owner = session.token;
  const [section, setSection] = useState<Section | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    let request = 0;
    const load = async () => {
      const ticket = ++request;
      const current = () =>
        live && request === ticket && session.token === owner;
      setError("");
      try {
        const result = await client.docSection(doc, block);
        if (current()) setSection(result);
      } catch {
        if (current()) {
          setSection(null);
          setError("Couldn't load this section.");
        }
      }
    };
    void load();
    const unwatch = client.watchDoc(doc, () => {
      if (live) void load();
    });
    return () => {
      live = false;
      unwatch();
    };
  }, [doc, block, owner, retry]);
  const failure = error ? (
    <View style={s.embedHead}>
      <Text style={s.error}>{error}</Text>
      <ToolChip label="Retry" onPress={() => setRetry((n) => n + 1)} />
    </View>
  ) : null;
  if (!section)
    return (
      <View style={[s.embed, { minHeight: 60 }]}>
        {failure ?? <Text style={s.muted}>Loading section…</Text>}
      </View>
    );
  return (
    <View style={s.embed}>
      {failure}
      <View style={s.embedHead}>
        <Icon name="fileText" size={14} color={colors.muted} />
        <Text style={s.embedTitle}>
          {section.title}
          {section.block_id && section.blocks[0]?.type === "heading"
            ? ` › ${section.blocks[0].text}`
            : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={s.foldButton}
          onPress={() =>
            openObject(
              { kind: "doc", id: section.doc_id },
              section.block_id,
              navigation?.onAppLink,
            )
          }
        >
          <Text style={s.embedOpen}>Open</Text>
        </Pressable>
      </View>
      {section.missing ? (
        <Text style={s.muted}>This section was removed.</Text>
      ) : (
        <SectionBody
          docId={section.doc_id}
          blocks={section.blocks}
          references={section.references}
        />
      )}
      {section.more && (
        <Text style={s.muted}>Open the page to read the rest.</Text>
      )}
    </View>
  );
}

/**
 * An embedded section's lines, drawn as a page draws them. The page's own
 * body is read when it's needed rather than imported, since the body draws
 * embeds too.
 */
function SectionBody({
  docId,
  blocks,
  references,
}: {
  docId: string;
  blocks: DocBlock[];
  references?: [string, string, string?][];
}) {
  const parentNavigation = useContext(DocNavigationContext);
  const [linkError, setLinkError] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DocBody } = require("./DocBody") as typeof import("./DocBody");
  const context = useMemo(
    () => ({
      numbers: footnoteNumbers(blocks),
      texts: new Map(
        blocks
          .filter((b) => b.type === "footnote")
          .map((b) => [b.label, b.text]),
      ),
      references: references
        ? docReferenceMap(references)
        : docReferenceLinks(blocks),
    }),
    [blocks, references],
  );
  return (
    <DocNavigationContext.Provider
      value={{
        onFragment: (fragment) =>
          openObject(
            { kind: "doc", id: docId },
            fragment,
            parentNavigation?.onAppLink,
          ),
        onAppLink: parentNavigation?.onAppLink ?? openAppUrl,
        report:
          parentNavigation?.report ??
          (() => setLinkError("Couldn't open this link. Try again.")),
      }}
    >
      <FootnoteContext.Provider value={context}>
        {linkError ? <Text style={s.error}>{linkError}</Text> : null}
        <DocBody content={blocks} />
      </FootnoteContext.Provider>
    </DocNavigationContext.Provider>
  );
}

function LinkedTasks({ blocks }: { blocks: DocBlock[] }) {
  const navigation = useContext(DocNavigationContext);
  const { pills, onToggle } = usePagePills();
  const refs = useMemo(() => {
    const seen = new Set<string>();
    return docObjectLinks(blocks)
      .map((l) => l.ref)
      .filter((r) => {
        if (r.kind !== "task" || seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
  }, [blocks]);
  return (
    <View style={s.embed}>
      <View style={s.embedHead}>
        <Icon name="clipboardList" size={14} color={colors.muted} />
        <Text style={s.embedTitle}>Linked tasks</Text>
      </View>
      {!refs.length ? (
        <Text style={s.muted}>No linked tasks</Text>
      ) : (
        refs.map((r) => {
          const pill = pills.get(pillKey(r));
          if (pill && pill.state !== "ok") return null;
          const done = !!pill?.done;
          return (
            <View key={r.id} style={s.embedTask}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done, disabled: !onToggle }}
                accessibilityLabel={pill?.title ?? "Task"}
                disabled={!onToggle || !pill}
                onPress={() => onToggle?.(r.id, !done)}
                style={s.checkTarget}
              >
                <View style={[s.check, done && s.checkDone]}>
                  {done && (
                    <Icon name="check" size={13} color={colors.onAccent} />
                  )}
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${pill?.title ?? "task"}`}
                style={s.embedTaskMain}
                onPress={() => openObject(r, undefined, navigation?.onAppLink)}
              >
                <Text style={[s.embedTaskText, done && s.embedTaskDone]}>
                  {pill?.title ?? "…"}
                </Text>
              </Pressable>
              {pill?.due_at && !done ? (
                <Text style={s.muted}>{shortDue(pill.due_at)}</Text>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    error: { color: colors.danger, fontSize: 13, width: "100%" },
    viewerError: { color: colors.white, fontSize: 13, paddingHorizontal: 16 },
    foldButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    pressed: { backgroundColor: colors.surfaceMuted },
    block: {
      gap: 8,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      padding: 12,
    },
    footnote: { flexDirection: "row", gap: 6 },
    footnoteNumber: { color: colors.muted, fontSize: 11, minWidth: 14 },
    footnoteText: {
      flex: 1,
      color: colors.textSoft,
      fontSize: 13,
      lineHeight: 19,
    },
    callout: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      padding: 12,
      borderRadius: radii.input,
      backgroundColor: colors.soft,
    },
    tip: { backgroundColor: colors.accentSoft },
    warning: { backgroundColor: colors.warningSoft },
    question: { backgroundColor: colors.highBg },
    summary: { backgroundColor: colors.surfaceMuted },
    calloutText: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 22 },
    calloutLabel: { fontFamily: fonts.semibold },
    tableScroll: { paddingVertical: 2 },
    table: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.input,
      overflow: "hidden",
    },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    tableHead: { backgroundColor: colors.surfaceMuted },
    tableCell: {
      width: CELL_MIN + 20,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      justifyContent: "center",
    },
    tableText: { color: colors.text, fontSize: 13, lineHeight: 20 },
    tableHeadText: { fontFamily: fonts.semibold },
    tableInput: {
      minHeight: controls.tap,
      color: colors.text,
      fontSize: inputFontSize,
      padding: 0,
    },
    tableTools: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 12,
    },
    chip: {
      minHeight: controls.tap,
      paddingHorizontal: 12,
      justifyContent: "center",
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipText: {
      color: colors.textSoft,
      fontFamily: fonts.medium,
      fontSize: 13,
    },
    save: {
      minHeight: controls.tap,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
    },
    savePressed: { backgroundColor: colors.accentPressed },
    saveText: {
      color: colors.onAccent,
      fontFamily: fonts.semibold,
      fontSize: 15,
    },
    image: {
      width: "100%",
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
    },
    imageLoading: { aspectRatio: 4 / 3 },
    imageMissing: {
      minHeight: 100,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.input,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.border,
    },
    caption: {
      marginTop: 4,
      color: colors.muted,
      fontSize: 13,
      textAlign: "center",
    },
    viewer: { flex: 1, backgroundColor: tint(colors.shadow, 0.94) },
    viewerBar: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    viewerName: {
      flex: 1,
      color: colors.white,
      fontFamily: fonts.medium,
      fontSize: 15,
    },
    viewerButton: {
      width: controls.tap,
      height: controls.tap,
      alignItems: "center",
      justifyContent: "center",
    },
    viewerStage: { flex: 1, alignItems: "center", justifyContent: "center" },
    viewerTools: { gap: 10, paddingHorizontal: 16 },
    sizes: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      justifyContent: "center",
    },
    size: {
      minHeight: controls.tap,
      paddingHorizontal: 12,
      justifyContent: "center",
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: tint(colors.white, 0.4),
    },
    sizeOn: { backgroundColor: tint(colors.white, 0.18) },
    sizeText: { color: colors.white, fontSize: 13, fontFamily: fonts.medium },
    sizeTextOn: { fontFamily: fonts.bold },
    viewerCaption: {
      minHeight: controls.tap,
      paddingHorizontal: 12,
      borderRadius: radii.input,
      backgroundColor: tint(colors.white, 0.12),
      color: colors.white,
      fontSize: inputFontSize,
    },
    file: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 10,
      padding: 12,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    fileText: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 120,
      minWidth: 0,
      gap: 2,
    },
    fileName: { color: colors.text, fontFamily: fonts.medium, fontSize: 15 },
    fileMeta: { color: colors.muted, fontSize: 11 },
    fileButton: {
      width: controls.tap,
      height: controls.tap,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    codeBlock: { minWidth: 0, gap: 4 },
    codeToolbar: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 4,
    },
    codeLabel: {
      color: colors.muted,
      fontFamily: fonts.medium,
      fontSize: 13,
      flexShrink: 1,
      maxWidth: "100%",
    },
    codeButton: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: controls.tap,
    },
    codeAction: {
      color: colors.accent,
      fontFamily: fonts.regular,
      fontSize: 13,
    },
    code: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 19,
      fontFamily: fonts.mono,
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.input,
      padding: 12,
    },
    codeKeyword: { color: colors.accent, fontWeight: "600" },
    codeString: { color: colors.highText },
    codeComment: { color: colors.muted, fontStyle: "italic" },
    codeNumber: { color: colors.mediumText },
    codeName: { color: colors.accentPressed },
    diagram: {
      padding: 8,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    embed: {
      gap: 8,
      padding: 12,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      borderLeftWidth: 3,
      borderLeftColor: colors.softBorder,
      backgroundColor: colors.surface,
    },
    embedHead: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 6,
    },
    embedTitle: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 120,
      minWidth: 0,
      color: colors.muted,
      fontSize: 13,
    },
    embedOpen: {
      color: colors.accent,
      fontFamily: fonts.semibold,
      fontSize: 13,
    },
    embedTask: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    embedTaskMain: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 120,
      minWidth: 0,
      minHeight: 44,
      justifyContent: "center",
    },
    checkTarget: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    embedTaskText: { color: colors.text, fontSize: 15, lineHeight: 22 },
    embedTaskDone: { color: colors.muted, textDecorationLine: "line-through" },
    check: {
      width: 22,
      height: 22,
      borderRadius: radii.check,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    checkDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  }),
);
