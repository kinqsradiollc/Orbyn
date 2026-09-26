import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { Pressable } from "../../motion";
import Svg, {
  Circle as SvgCircle,
  G,
  Path as SvgPath,
  Rect as SvgRect,
  Text as SvgText,
} from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CALLOUT_LABELS,
  colourCode,
  colourable,
  diagramKind,
  docObjectLinks,
  fileSize,
  layoutFlowchart,
  isAudio,
  PAGE_FILE_TYPES,
  recordingClock,
  parseEmbed,
  parseFlowchart,
  parseTable,
  tableMarkdown,
  type CalloutKind,
  type DocBlock,
  type PageFile,
  type TableCells,
} from "@orbyn/core";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { client } from "../../lib/api";
import { saveFile } from "../../lib/download";
import { BottomSheet } from "../../components/BottomSheet";
import { Icon, type IconName } from "../../components/Icon";
import { showToast } from "../../components/Toast";
import { colors, controls, fonts, radii, themed, tint } from "../../theme";
import { Inline } from "./Inline";
import { openObject, pillKey, shortDue, usePagePills } from "./links";

/**
 * The richer lines of a page on the phone (D4b): callouts, tables (edited
 * in a sheet of cells), pictures with a full-screen viewer, files, footnotes,
 * coloured code, flowcharts drawn natively, and live embeds of another
 * page's section or of the tasks the page links to.
 */

// ------------------------------------------------------------- footnotes ---

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
          hitSlop={10}
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
  const [table, setTable] = useState<TableCells>(() => parseTable(text));
  const [at, setAt] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const inputs = useRef(new Map<string, TextInput | null>());
  useEffect(() => {
    if (visible) setTable(parseTable(text));
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
            onSave(tableMarkdown(table));
            onClose();
          }}
          style={({ pressed }) => [s.save, pressed && s.savePressed]}
        >
          <Text style={s.saveText}>Done</Text>
        </Pressable>
      }
    >
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
      hitSlop={{ top: 7, bottom: 7 }}
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

/** A short-lived link to show or download a file, fetched once and kept. */
export function fileLink(id: string): Promise<Link> {
  const kept = links.get(id);
  if (kept && kept.until > Date.now()) return Promise.resolve(kept);
  const running = waiting.get(id);
  if (running) return running;
  const made = client
    .pageFile(id)
    .then((l) => {
      const link = {
        url: client.urlFor(l.url_path),
        file: l.file,
        until: Date.parse(l.expires_at) - 5 * 60_000,
      };
      links.set(id, link);
      return link;
    })
    .finally(() => waiting.delete(id));
  waiting.set(id, made);
  return made;
}

function useFileLink(id: string): Link | null | "gone" {
  const [link, setLink] = useState<Link | null | "gone">(
    () => links.get(id) ?? null,
  );
  useEffect(() => {
    let live = true;
    fileLink(id).then(
      (l) => live && setLink(l),
      () => live && setLink("gone"),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return link;
}

/** Save a kept file on the phone: the share sheet offers Files and apps. */
export async function downloadFile(id: string) {
  const link = await fileLink(id);
  const res = await fetch(`${link.url}?download=1`);
  if (!res.ok) throw new Error("That file couldn't be downloaded.");
  await saveFile(link.file.name, await res.blob(), link.file.mime);
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
  const link = useFileLink(block.file);
  const [viewing, setViewing] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    if (!link || link === "gone") return;
    if (link.file.width && link.file.height) {
      setRatio(link.file.width / link.file.height);
      return;
    }
    Image.getSize(
      link.url,
      (w, h) => setRatio(w / h),
      () => setRatio(4 / 3),
    );
  }, [link]);
  if (link === "gone")
    return (
      <View style={s.imageMissing}>
        <Text style={s.muted}>This picture isn't there any more.</Text>
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
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.viewer}>
        <View style={[s.viewerBar, { paddingTop: insets.top + 8 }]}>
          <Text style={s.viewerName} numberOfLines={1}>
            {name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Download"
            hitSlop={10}
            onPress={() =>
              void downloadFile(block.file).catch(() =>
                showToast({ text: "That picture couldn't be downloaded." }),
              )
            }
            style={s.viewerButton}
          >
            <Icon name="download" size={20} color={colors.white} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            onPress={onClose}
            style={s.viewerButton}
          >
            <Icon name="x" size={20} color={colors.white} />
          </Pressable>
        </View>
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
          <View style={[s.viewerTools, { paddingBottom: insets.bottom + 12 }]}>
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
          </View>
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
        hitSlop={8}
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
        <Text style={s.fileName} numberOfLines={1}>
          {name}
        </Text>
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
          hitSlop={8}
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
  const link = useFileLink(block.file);
  const file = link && link !== "gone" ? link.file : null;
  const [busy, setBusy] = useState(false);
  if (link && link !== "gone" && file && isAudio(file.mime))
    return <AudioCard block={block} url={link.url} file={file} />;
  return (
    <View style={s.file}>
      <Icon name="paperclip" size={18} color={colors.muted} />
      <View style={s.fileText}>
        <Text style={s.fileName} numberOfLines={1}>
          {block.text || file?.name || "File"}
        </Text>
        <Text style={s.fileMeta}>
          {link === "gone"
            ? "This file isn't there any more"
            : file
              ? [
                  PAGE_FILE_TYPES[file.mime] ?? "File",
                  fileSize(file.bytes),
                  file.source === "import" ? "Original" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "…"}
        </Text>
      </View>
      {link !== "gone" && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Download ${block.text}`}
          disabled={busy}
          hitSlop={8}
          onPress={() => {
            setBusy(true);
            void downloadFile(block.file)
              .catch(() =>
                showToast({ text: "That file couldn't be downloaded." }),
              )
              .finally(() => setBusy(false));
          }}
          style={({ pressed }) => [s.fileButton, pressed && s.pressed]}
        >
          <Icon name="download" size={16} color={colors.accent} />
        </Pressable>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ code ---

/** A code block, coloured for the languages students and teams write most. */
export function CodeView({ text, lang }: { text: string; lang: string }) {
  const tokens = useMemo(
    () => (colourable(lang) ? colourCode(text, lang) : null),
    [text, lang],
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Text style={s.code}>
        {tokens
          ? tokens.map((t, i) => (
              <Text
                key={i}
                style={
                  t.kind === "keyword"
                    ? s.codeKeyword
                    : t.kind === "string"
                      ? s.codeString
                      : t.kind === "comment"
                        ? s.codeComment
                        : t.kind === "number"
                          ? s.codeNumber
                          : t.kind === "name"
                            ? s.codeName
                            : undefined
                }
              >
                {t.text}
              </Text>
            ))
          : text}
      </Text>
    </ScrollView>
  );
}

// -------------------------------------------------------------- diagrams ---

/**
 * A `mermaid` block (EDT-11). A flowchart is laid out and drawn here with
 * the palette's colours, and a node that links to a page or task opens it;
 * other kinds show their words, to be seen drawn on the web or desktop.
 */
export function DiagramView({ text }: { text: string }) {
  const chart = useMemo(() => parseFlowchart(text), [text]);
  const layout = useMemo(
    () => (chart ? layoutFlowchart(chart) : null),
    [chart],
  );
  if (!chart || !layout)
    return (
      <View style={s.block}>
        <Text style={s.muted}>
          This {diagramKind(text) === "unknown" ? "diagram" : diagramKind(text)}{" "}
          is drawn on the web and desktop. Its words:
        </Text>
        <CodeView text={text} lang="" />
      </View>
    );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View
        style={s.diagram}
        accessibilityRole="image"
        accessibilityLabel={`Flowchart: ${chart.nodes.map((n) => n.label).join(", ")}`}
      >
        <Svg width={layout.width} height={layout.height}>
          {layout.edges.map((e, i) => {
            const [[x1, y1], [x2, y2]] = e.points;
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const head = (a: number) =>
              `${x2 - 8 * Math.cos(angle + a)},${y2 - 8 * Math.sin(angle + a)}`;
            return (
              <G key={i}>
                <SvgPath
                  d={`M${x1},${y1} L${x2},${y2}`}
                  stroke={colors.muted}
                  strokeWidth={e.style === "thick" ? 2.4 : 1.4}
                  strokeDasharray={e.style === "dotted" ? "4 4" : undefined}
                  fill="none"
                />
                {e.arrow && (
                  <SvgPath
                    d={`M${head(0.45)} L${x2},${y2} L${head(-0.45)}`}
                    stroke={colors.muted}
                    strokeWidth={1.4}
                    fill="none"
                  />
                )}
                {!!e.label && (
                  <SvgText
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 4}
                    fontSize={11}
                    fontFamily={fonts.regular}
                    fill={colors.textSoft}
                    textAnchor="middle"
                  >
                    {e.label}
                  </SvgText>
                )}
              </G>
            );
          })}
          {layout.nodes.map((n) => {
            const cx = n.x + n.w / 2;
            const cy = n.y + n.h / 2;
            const open = n.link ? () => openObject(n.link!) : undefined;
            const shape =
              n.shape === "circle" ? (
                <SvgCircle
                  cx={cx}
                  cy={cy}
                  r={n.w / 2}
                  fill={colors.surface}
                  stroke={colors.accent}
                  strokeWidth={1.2}
                  onPress={open}
                />
              ) : n.shape === "diamond" ? (
                <SvgPath
                  d={`M${cx},${n.y} L${n.x + n.w},${cy} L${cx},${n.y + n.h} L${n.x},${cy} Z`}
                  fill={colors.surface}
                  stroke={colors.accent}
                  strokeWidth={1.2}
                  onPress={open}
                />
              ) : (
                <SvgRect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx={n.shape === "box" ? 6 : n.h / 2}
                  fill={colors.surface}
                  stroke={colors.accent}
                  strokeWidth={1.2}
                  onPress={open}
                />
              );
            const lines = n.label.split(/<br\s*\/?>|\n/);
            return (
              <G key={n.id}>
                {shape}
                {lines.map((line, i) => (
                  <SvgText
                    key={i}
                    x={cx}
                    y={cy + 4 + (i - (lines.length - 1) / 2) * 16}
                    fontSize={13}
                    fontFamily={fonts.regular}
                    fill={n.link ? colors.accent : colors.text}
                    textAnchor="middle"
                    onPress={open}
                  >
                    {line}
                  </SvgText>
                ))}
              </G>
            );
          })}
        </Svg>
      </View>
    </ScrollView>
  );
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

function SectionEmbed({ doc, block }: { doc: string; block: string | null }) {
  const [section, setSection] = useState<Section | null | "gone">(null);
  const load = useCallback(
    () =>
      client.docSection(doc, block).then(setSection, () => setSection("gone")),
    [doc, block],
  );
  useEffect(() => {
    void load();
    return client.watchDoc(doc, () => void load());
  }, [load, doc]);
  if (section === "gone")
    return (
      <View style={s.embed}>
        <Text style={s.muted}>
          The page this showed isn't there, or isn't yours to open.
        </Text>
      </View>
    );
  if (!section) return <View style={[s.embed, { minHeight: 60 }]} />;
  return (
    <View style={s.embed}>
      <View style={s.embedHead}>
        <Icon name="fileText" size={14} color={colors.muted} />
        <Text style={s.embedTitle} numberOfLines={1}>
          {section.title}
          {section.block_id && section.blocks[0]?.type === "heading"
            ? ` › ${section.blocks[0].text}`
            : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={() =>
            openObject({ kind: "doc", id: section.doc_id }, section.block_id)
          }
        >
          <Text style={s.embedOpen}>Open</Text>
        </Pressable>
      </View>
      {section.missing ? (
        <Text style={s.muted}>The part of the page this showed has gone.</Text>
      ) : (
        <SectionBody blocks={section.blocks} />
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
function SectionBody({ blocks }: { blocks: DocBlock[] }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DocBody } = require("./DocBody") as typeof import("./DocBody");
  return <DocBody content={blocks} />;
}

function LinkedTasks({ blocks }: { blocks: DocBlock[] }) {
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
        <Text style={s.embedTitle}>Tasks linked from this page</Text>
      </View>
      {!refs.length ? (
        <Text style={s.muted}>
          Link tasks in this page with [[ and they're listed here.
        </Text>
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
                hitSlop={12}
                onPress={() => onToggle?.(r.id, !done)}
                style={[s.check, done && s.checkDone]}
              >
                {done && <Icon name="check" size={13} color={colors.white} />}
              </Pressable>
              <Pressable style={{ flex: 1 }} onPress={() => openObject(r)}>
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
      minHeight: controls.compact,
      color: colors.text,
      fontSize: 13,
      padding: 0,
    },
    tableTools: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 12,
    },
    chip: {
      minHeight: controls.compact,
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
    saveText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 15 },
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
    sizes: { flexDirection: "row", gap: 8, justifyContent: "center" },
    size: {
      minHeight: controls.compact,
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
      fontSize: 15,
    },
    file: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 12,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    fileText: { flex: 1, minWidth: 0, gap: 2 },
    fileName: { color: colors.text, fontFamily: fonts.medium, fontSize: 15 },
    fileMeta: { color: colors.muted, fontSize: 11 },
    fileButton: {
      width: controls.compact + 4,
      height: controls.compact + 4,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentSoft,
    },
    code: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 19,
      fontFamily: "monospace",
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
    embedHead: { flexDirection: "row", alignItems: "center", gap: 6 },
    embedTitle: { flex: 1, color: colors.muted, fontSize: 11 },
    embedOpen: {
      color: colors.accent,
      fontFamily: fonts.semibold,
      fontSize: 13,
    },
    embedTask: { flexDirection: "row", alignItems: "center", gap: 10 },
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
