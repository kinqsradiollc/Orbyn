import { saveFile } from "../../lib/download";
import { LatexHtmlPreview } from "../../components/LatexHtmlPreview";
import { DocEditorModes } from "./DocEditorModes";
import { useDocLatexPreview } from "./DocLatexPreview";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  docLatexBlock,
  docWholeLatex,
  docWholeLatexCanExport,
  withDocLatexSource,
  EMPTY_LATEX_DOCUMENT,
  docFragmentIndex,
  parseAppLink,
  docSourceMap,
  docSourceBlockAt,
  docReferenceLinks,
  footnoteNumbers,
  footnoteTexts,
  type DocBlock,
} from "@orbyn/core";
import { session } from "../../lib/session";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/Button";
import { shared } from "../../styles";
import { colors, fonts, radii, inputFontSize } from "../../theme";
import { DocBody } from "./DocBody";
import { FootnoteContext } from "./footnotes";
import { DocNavigationContext } from "./doc-navigation";

/** Source and preview delegate edits to the existing editor and its save path. */
export function DocSourcePreview({
  blocks,
  docId,
  onAppLink,
  beforeNavigate,
  report,
  onClose,
  onSourceChange,
  saveStatus,
  onCompileLatex,
  onAssist,
  onLatexChange,
  latexOnly = false,
  initialMode = "markdown",
  inline = false,
  sourceOnly = false,
  showModes = true,
  editorHeight,
  onModeChange,
  compileReady = true,
  leaveCheck,
  initialSourceNumber = -1,
  wholeDocumentExportable = true,
}: {
  initialSourceNumber?: number;
  wholeDocumentExportable?: boolean;
  blocks: DocBlock[];
  docId: string;
  onAppLink: (url: string) => void;
  beforeNavigate?: () => Promise<boolean>;
  report: (error: unknown) => void;
  onClose: () => void;
  onSourceChange?: (source: string, expected: DocBlock[]) => DocBlock[];
  saveStatus?: string;
  onCompileLatex: (source: string, signal: AbortSignal) => Promise<Blob>;
  onAssist?: (block: DocBlock) => void;
  onLatexChange?: (
    text: string,
    expected: DocBlock[],
    sourceNumber?: number,
  ) => DocBlock[];
  latexOnly?: boolean;
  initialMode?: "markdown" | "latex";
  inline?: boolean;
  sourceOnly?: boolean;
  showModes?: boolean;
  editorHeight?: number;
  onModeChange?: (mode: "markdown" | "latex") => void;
  compileReady?: boolean;
  leaveCheck?: { current: (() => boolean) | null };
}) {
  const [navigating, setNavigating] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const navigationPending = useRef(false);
  const navigationOwner = useRef(session.token).current;
  const navigationAlive = useRef(true);
  useEffect(() => {
    navigationAlive.current = true;
    return () => {
      navigationAlive.current = false;
    };
  }, []);
  const [mode, setMode] = useState<"markdown" | "latex">(
    latexOnly ? "latex" : initialMode,
  );
  const [sourceNumber, setSourceNumber] = useState(initialSourceNumber);
  const sources = blocks.filter(
    (block) => block.type === "code" && block.lang === "latex-document",
  );
  const latex = docLatexBlock(blocks, sourceNumber);
  const pdfSupported =
    sourceNumber >= 0 ||
    (wholeDocumentExportable && docWholeLatexCanExport(blocks));
  const wholeLatexTooLong =
    sourceNumber < 0 && docWholeLatex(blocks).length > 20_000;
  const [latexText, setLatexText] = useState(
    sourceNumber < 0
      ? docWholeLatex(blocks)
      : (latex?.text ?? EMPTY_LATEX_DOCUMENT),
  );
  const sharedPreview = useDocLatexPreview();
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState("");
  const [pdf, setPdf] = useState<{
    blob: Blob;
    source: string;
    sourceNumber: number;
    account: typeof session.token;
  } | null>(null);
  useEffect(() => {
    setPdf(null);
  }, [latexText, sourceNumber]);
  const compile = useRef<AbortController | null>(null);
  useEffect(() => {
    if (sourceNumber >= 0 && latex && !liveSourceError.current)
      setLatexText(latex.text);
  }, [latex?.text]);
  useEffect(
    () => () => {
      compile.current?.abort();
    },
    [],
  );
  const exportPdf = async () => {
    if (
      compile.current ||
      !compileReady ||
      !pdfSupported ||
      sourceError ||
      !(onSourceChange || onLatexChange)
    )
      return;
    const controller = new AbortController();
    compile.current = controller;
    setCompiling(true);
    setCompileError("");
    setPdf(null);
    const snapshot = latexText;
    const account = session.token;
    try {
      const blob = await onCompileLatex(snapshot, controller.signal);
      if (!controller.signal.aborted && account === session.token) {
        setPdf({ blob, source: snapshot, sourceNumber, account });
        await saveFile("document.pdf", blob, "application/pdf");
      }
    } catch (error) {
      if (!controller.signal.aborted && account === session.token)
        setCompileError(
          error instanceof Error
            ? error.message
            : "Couldn’t export this PDF. Check the source and try again.",
        );
    } finally {
      if (compile.current === controller) {
        compile.current = null;
        setCompiling(false);
      }
    }
  };
  const [sourceVisible, setSourceVisible] = useState(true);
  const [paneWidth, setPaneWidth] = useState(0);
  const { fontScale, height: windowHeight } = useWindowDimensions();
  const wide = paneWidth / fontScale >= 900;
  const split = wide && sourceVisible;
  const [selected, setSelected] = useState(0);
  const [controlsHeight, setControlsHeight] = useState<number>();
  const [sourceSelection, setSourceSelection] = useState<
    { start: number; end: number } | undefined
  >();
  const scroll = useRef<ScrollView>(null);
  const sourceInput = useRef<TextInput>(null);
  const canonical = useMemo(() => docSourceMap(blocks), [blocks]);
  // This buffer retains typed whitespace while the owning editor holds the
  // parsed blocks and the only save/revision path. External reconciliations
  // replace it; echoes of our own parsed source do not move the caret.
  const [sourceText, setSourceText] = useState(canonical.source);
  const [sourceError, setSourceError] = useState("");
  const liveSourceError = useRef(sourceError);
  liveSourceError.current = sourceError;
  const acceptedSource = useRef(canonical.source);
  const ownerBlocks = useRef(blocks);
  // React can commit an older edit after a newer native text event arrived.
  // Recognize every own block echo without retaining old document snapshots.
  const acceptedBlocks = useRef(new WeakSet<DocBlock[]>([blocks]));
  const mustRestore = useRef(false);
  // Retained browser/native input handlers must not rebase an older buffer
  // onto ownership adopted from another editor.
  const sourceEpoch = useRef(0);
  const renderedEpoch = sourceEpoch.current;
  useEffect(() => {
    if (
      acceptedBlocks.current.has(blocks) ||
      canonical.source === acceptedSource.current
    )
      return;
    sourceEpoch.current++;
    if (sourceError) {
      mustRestore.current = true;
      setSourceError(
        "The document changed while this source edit was invalid. Restore the current document before continuing.",
      );
      return;
    }
    acceptedSource.current = canonical.source;
    ownerBlocks.current = blocks;
    acceptedBlocks.current.add(blocks);
    setSourceText(canonical.source);
    if (sourceNumber < 0) setLatexText(docWholeLatex(blocks));
    setSourceError("");
  }, [blocks, canonical.source]);
  const map = useMemo(
    () =>
      onSourceChange && !sourceError
        ? docSourceMap(blocks, sourceText)
        : canonical,
    [blocks, canonical, sourceText, sourceError, onSourceChange],
  );
  const changeSource = (text: string) => {
    if (!navigationAlive.current || session.token !== navigationOwner) return;
    if (!onSourceChange || mustRestore.current || navigationPending.current)
      return;
    setSourceSelection(undefined);
    setSourceText(text);
    try {
      if (renderedEpoch !== sourceEpoch.current) {
        mustRestore.current = true;
        throw new Error(
          "The document changed before this source edit could be applied. Restore the current document before continuing.",
        );
      }
      const next = onSourceChange(text, ownerBlocks.current);
      ownerBlocks.current = next;
      acceptedBlocks.current.add(next);
      acceptedSource.current = docSourceMap(next).source;
      if (sourceNumber < 0) setLatexText(docWholeLatex(next));
      setSourceError("");
    } catch (error) {
      setSourceError(
        error instanceof Error
          ? error.message
          : "Couldn't apply the source edit.",
      );
    }
  };
  const changeLatex = (text: string) => {
    if (
      navigationPending.current ||
      !navigationAlive.current ||
      session.token !== navigationOwner
    )
      return;
    compile.current?.abort();
    setLatexText(text);
    if (!onLatexChange) {
      if (sourceNumber < 0) {
        setSourceError(
          "This editor cannot apply whole-document LaTeX changes. Your draft is retained; restore the document to continue in Note or Markdown.",
        );
        return;
      }
      try {
        changeSource(
          docSourceMap(
            withDocLatexSource(ownerBlocks.current, text, sourceNumber),
          ).source,
        );
      } catch (error) {
        setSourceError(
          error instanceof Error
            ? error.message
            : "Couldn’t apply LaTeX source.",
        );
      }
      return;
    }
    if (mustRestore.current) return;
    try {
      if (renderedEpoch !== sourceEpoch.current)
        throw new Error(
          "The document changed. Restore the current document before editing.",
        );
      const next = onLatexChange(text, ownerBlocks.current, sourceNumber);
      ownerBlocks.current = next;
      acceptedBlocks.current.add(next);
      acceptedSource.current = docSourceMap(next).source;
      setSourceText(acceptedSource.current);
      setSourceError("");
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : "Couldn’t apply LaTeX source.",
      );
    }
  };
  useEffect(() => {
    if (mode === "latex")
      sharedPreview?.setDraftSource(latexText, sourceNumber);
    return () => sharedPreview?.setDraftSource(null);
  }, [mode, latexText, sourceNumber, sharedPreview?.setDraftSource]);
  useEffect(() => {
    if (!leaveCheck) return;
    const ready = () =>
      !liveSourceError.current &&
      !mustRestore.current &&
      !navigationPending.current;
    leaveCheck.current = ready;
    return () => {
      if (leaveCheck.current === ready) leaveCheck.current = null;
    };
  }, [leaveCheck]);
  const closeSource = () => {
    if (!sourceError && !navigationPending.current) onClose();
  };
  const revertSource = () => {
    mustRestore.current = false;
    acceptedSource.current = canonical.source;
    ownerBlocks.current = blocks;
    acceptedBlocks.current.add(blocks);
    setSourceText(canonical.source);
    const restored = docLatexBlock(blocks, sourceNumber);
    if (!restored && sourceNumber > 0) setSourceNumber(0);
    setLatexText(
      sourceNumber < 0
        ? docWholeLatex(blocks)
        : ((restored ?? docLatexBlock(blocks))?.text ?? EMPTY_LATEX_DOCUMENT),
    );
    setSourceError("");
  };
  const notes = useMemo(
    () => ({
      references: docReferenceLinks(blocks),
      numbers: footnoteNumbers(blocks),
      texts: footnoteTexts(blocks),
    }),
    [blocks],
  );
  const positions = useMemo(() => new Map<number, number>(), [blocks]);
  const blockId = blocks[selected]?.id;
  const selectedRange = map.ranges[selected];
  const goToFragment = (fragment: string) => {
    const index = docFragmentIndex(blocks, fragment);
    if (index === null) return;
    setSelected(index);
    const y = positions.get(index);
    if (y !== undefined)
      scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: false });
  };
  const navigation = {
    onFragment: goToFragment,
    onAppLink: (url: string) => {
      const link = parseAppLink(url);
      if (link?.kind === "doc" && link.id === docId && link.block)
        goToFragment(link.block);
      else {
        if (sourceError || navigationPending.current) return;
        navigationPending.current = true;
        const navigationEpoch = sourceEpoch.current;
        setNavigating(true);
        setNavigationError("");
        void (async () => {
          try {
            if (beforeNavigate && !(await beforeNavigate())) return;
            if (
              sourceEpoch.current !== navigationEpoch ||
              liveSourceError.current
            )
              throw new Error(
                "The document changed. Review the source before opening this link.",
              );
            if (!navigationAlive.current || navigationOwner !== session.token)
              return;
            onClose();
            onAppLink(url);
          } catch (error) {
            if (navigationAlive.current && navigationOwner === session.token)
              setNavigationError(
                error instanceof Error
                  ? error.message
                  : "Couldn't open this link. Try again.",
              );
          } finally {
            navigationPending.current = false;
            if (navigationAlive.current) setNavigating(false);
          }
        })();
      }
    },
    report,
  };
  const content = (
    <View
      style={{ flex: 1, minHeight: 0, padding: 0, gap: 0 }}
      onLayout={(event) => {
        setPaneWidth(event.nativeEvent.layout.width);
        setControlsHeight(
          Math.max(0, (event.nativeEvent.layout.height - 44) * 0.45),
        );
      }}
    >
      <ScrollView
        style={{
          flexGrow: 0,
          flexShrink: 1,
          maxHeight: controlsHeight,
          display:
            inline &&
            sourceOnly &&
            !navigationError &&
            !navigating &&
            !sourceError &&
            !showModes
              ? "none"
              : "flex",
        }}
        contentContainerStyle={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {!!navigationError && (
          <Text accessibilityRole="alert" style={shared.small}>
            {navigationError}
          </Text>
        )}
        {navigating && (
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            Saving before opening…
          </Text>
        )}
        {!!sourceError && (
          <View style={{ gap: 8 }}>
            <Button
              style={{ marginBottom: 0 }}
              title="Restore current document"
              disabled={navigating}
              secondary
              onPress={revertSource}
            />
            <Text accessibilityRole="alert" style={shared.small}>
              {sourceError} This edit has not been saved.
            </Text>
          </View>
        )}
        {showModes && (
          <DocEditorModes
            value={mode}
            latexOnly={latexOnly}
            disabled={navigating || !!sourceError}
            onChange={(next) => {
              if (next === "note") {
                closeSource();
                return;
              }
              if (sourceError) return;
              setMode(next);
              onModeChange?.(next);
            }}
          />
        )}
        {!inline && (
          <Text style={shared.small}>
            {mode === "latex"
              ? "LaTeX is saved with this note."
              : onSourceChange
                ? "Edit Markdown. Keep block anchors to preserve comments and task links."
                : "Source is read-only."}
          </Text>
        )}
        {saveStatus && !inline && (
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            {saveStatus}
          </Text>
        )}
        {!inline && mode === "markdown" && onAssist && blocks[selected]?.id && (
          <Button
            style={{ marginBottom: 0 }}
            title="Ask assistant"
            secondary
            disabled={navigating || !!sourceError}
            onPress={() => onAssist(blocks[selected])}
          />
        )}
        {(!inline || !sourceOnly) && (
          <Button
            style={{ marginBottom: 0 }}
            title={
              sourceOnly
                ? "Hide source"
                : sourceVisible
                  ? wide
                    ? "Hide source"
                    : "Show preview"
                  : "Show source"
            }
            secondary
            onPress={() => {
              if (sourceOnly) {
                closeSource();
                return;
              }
              setSourceSelection(
                !sourceVisible && selectedRange
                  ? { start: selectedRange.start, end: selectedRange.start }
                  : undefined,
              );
              setSourceVisible(!sourceVisible);
            }}
          />
        )}
      </ScrollView>
      {mode === "latex" && sourceNumber < 0 && (
        <Text style={shared.small}>
          Edit existing text and equations. Keep block markers; use Note or
          Markdown for structure and rich text.
          {wholeLatexTooLong
            ? " This source exceeds the 20,000-character editing limit; continue in Note or Markdown."
            : !pdfSupported && " Export this document from Note."}
        </Text>
      )}
      {mode === "latex" && sourceNumber >= 0 && sources.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {sources.map((block, index) => (
            <Pressable
              key={block.id ?? index}
              accessibilityRole="button"
              accessibilityLabel={
                index === 0
                  ? "Embedded LaTeX document 1"
                  : `Embedded LaTeX document ${index + 1}`
              }
              accessibilityState={{ selected: sourceNumber === index }}
              disabled={!!sourceError || navigating}
              onPress={() => {
                setSourceNumber(index);
                setLatexText(
                  docLatexBlock(ownerBlocks.current, index)?.text ??
                    EMPTY_LATEX_DOCUMENT,
                );
              }}
              style={{
                minHeight: 44,
                paddingHorizontal: 12,
                justifyContent: "center",
                backgroundColor:
                  sourceNumber === index ? colors.surfaceMuted : undefined,
                borderRadius: radii.input,
              }}
            >
              <Text style={shared.small}>
                {index === 0
                  ? "Embedded document 1"
                  : `Embedded document ${index + 1}`}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {mode === "latex" && (
        <>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              paddingHorizontal: 12,
              paddingVertical: 4,
              gap: 8,
            }}
          >
            {(!inline || compiling || compileError) && (
              <Text accessibilityLiveRegion="polite" style={shared.small}>
                {compileError
                  ? "PDF export failed"
                  : compiling
                    ? "Exporting PDF…"
                    : "Web preview"}
              </Text>
            )}
            {(onSourceChange || onLatexChange) && (
              <Button
                style={{ marginBottom: 0 }}
                title="Export PDF"
                secondary
                disabled={
                  navigating ||
                  !compileReady ||
                  !pdfSupported ||
                  compiling ||
                  !!sourceError ||
                  !(onSourceChange || onLatexChange)
                }
                onPress={() => void exportPdf()}
              />
            )}
            {onAssist && latex?.id && (
              <Button
                style={{ marginBottom: 0 }}
                title="Ask assistant"
                secondary
                disabled={navigating || !!sourceError || !latex.text.trim()}
                onPress={() => onAssist(latex)}
              />
            )}
          </View>
          {pdf &&
            pdf.source === latexText &&
            pdf.sourceNumber === sourceNumber &&
            pdf.account === session.token && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                  paddingHorizontal: 12,
                }}
              >
                <Text accessibilityLiveRegion="polite" style={shared.small}>
                  PDF ready
                </Text>
                <Button
                  title="Save PDF"
                  secondary
                  style={{ marginBottom: 0 }}
                  onPress={() => {
                    if (pdf.account !== session.token) return;
                    void saveFile(
                      "document.pdf",
                      pdf.blob,
                      "application/pdf",
                    ).catch((error) => {
                      if (pdf.account !== session.token) return;
                      setCompileError(
                        error instanceof Error
                          ? error.message
                          : "Couldn’t save this PDF. Try again.",
                      );
                    });
                  }}
                />
              </View>
            )}
          {!!compileError && (
            <Text accessibilityRole="alert" style={shared.small}>
              {compileError}
            </Text>
          )}
          <View
            style={{
              flex: 1,
              minHeight: 0,
              gap: 12,
              flexDirection: !sourceOnly && split ? "row" : "column",
            }}
          >
            <View
              style={{
                flex: 1,
                minWidth: 0,
                display: sourceOnly || sourceVisible ? "flex" : "none",
              }}
            >
              <TextInput
                accessibilityLabel="LaTeX source"
                multiline
                scrollEnabled
                editable={!navigating && !!(onSourceChange || onLatexChange)}
                value={latexText}
                style={[
                  shared.input,
                  {
                    flex: 1,
                    minHeight: 0,
                    textAlignVertical: "top",
                    fontFamily: fonts.mono,
                    fontSize: inputFontSize,
                    lineHeight: 24,
                    padding: 16,
                    borderWidth: 0,
                    borderRadius: 0,
                    backgroundColor: colors.surfaceMuted,
                  },
                ]}
                onChangeText={changeLatex}
              />
            </View>
            <View
              style={{
                flex: 1,
                minWidth: 0,
                display:
                  !sourceOnly && (split || !sourceVisible) ? "flex" : "none",
              }}
            >
              <LatexHtmlPreview source={latexText} fill />
            </View>
          </View>
        </>
      )}
      <View
        style={{
          flex: 1,
          minHeight: 0,
          display: mode === "markdown" ? "flex" : "none",
        }}
      >
        <View
          style={{
            flex: 1,
            minHeight: 0,
            flexDirection: !sourceOnly && split ? "row" : "column",
            gap: 12,
          }}
        >
          <View
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: sourceOnly || sourceVisible ? "flex" : "none",
            }}
          >
            <TextInput
              accessibilityLabel="Markdown source"
              value={onSourceChange ? sourceText : map.source}
              editable={!navigating && !!onSourceChange}
              onChangeText={onSourceChange ? changeSource : undefined}
              ref={sourceInput}
              selection={onSourceChange ? undefined : sourceSelection}
              onLayout={() => {
                if (onSourceChange && sourceSelection) {
                  sourceInput.current?.setNativeProps({
                    selection: sourceSelection,
                  });
                  setSourceSelection(undefined);
                }
              }}
              multiline
              scrollEnabled
              showSoftInputOnFocus={!!onSourceChange}
              style={{
                flex: 1,
                textAlignVertical: "top",
                fontFamily: fonts.mono,
                fontSize: inputFontSize,
                lineHeight: 24,
                padding: 16,
                color: colors.text,
                borderColor: colors.border,
                borderWidth: 0,
                borderRadius: 0,
                backgroundColor: colors.surfaceMuted,
              }}
              onSelectionChange={(event) => {
                setSourceSelection(undefined);
                const range = docSourceBlockAt(
                  map,
                  event.nativeEvent.selection.start,
                );
                if (range) setSelected(range.blockIndex);
              }}
            />
          </View>
          {!sourceOnly && (
            <ScrollView
              ref={scroll}
              style={{
                flex: 1,
                minWidth: 0,
                display:
                  !sourceOnly && (!sourceVisible || split) ? "flex" : "none",
              }}
              contentContainerStyle={{ padding: 12 }}
              scrollEventThrottle={32}
              onScroll={(event) => {
                const top = event.nativeEvent.contentOffset.y;
                let current = 0;
                for (const [index, y] of positions)
                  if (y <= top + 12 && index > current) current = index;
                setSelected(current);
              }}
            >
              <DocNavigationContext.Provider value={navigation}>
                <FootnoteContext.Provider value={notes}>
                  <DocBody
                    content={blocks}
                    targetBlockId={blockId}
                    onLineLayout={(index, y) => positions.set(index, y)}
                    flash={blockId ?? null}
                    onTargetLayout={(y) =>
                      scroll.current?.scrollTo({
                        y: Math.max(0, y - 12),
                        animated: false,
                      })
                    }
                  />
                </FootnoteContext.Provider>
              </DocNavigationContext.Provider>
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
  return inline ? (
    <View
      style={{
        flex: sourceOnly ? 1 : undefined,
        height: sourceOnly
          ? undefined
          : (editorHeight ?? Math.max(400, windowHeight - 180)),
        minHeight: 0,
      }}
    >
      {content}
    </View>
  ) : (
    <Sheet
      visible
      title="Source and preview"
      onClose={closeSource}
      hideClose={!!sourceError}
      closeDisabled={!!sourceError}
    >
      {content}
    </Sheet>
  );
}
