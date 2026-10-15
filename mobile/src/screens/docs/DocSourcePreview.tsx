import { DocEditorModes } from "./DocEditorModes";
import { useDocLatexPreview } from "./DocLatexPreview";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  docLatexBlock,
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
import { DocumentPdfPreview } from "../../components/DocumentPdfPreview";
import { session } from "../../lib/session";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/Button";
import { shared } from "../../styles";
import { colors, fonts, radii } from "../../theme";
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
}: {
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
  onLatexChange?: (text: string, expected: DocBlock[]) => DocBlock[];
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
  const latex = docLatexBlock(blocks);
  const [latexText, setLatexText] = useState(
    latex?.text ?? EMPTY_LATEX_DOCUMENT,
  );
  const sharedPreview = useDocLatexPreview();
  const [localPdf, setPdf] = useState<{ blob: Blob; source: string } | null>(
    null,
  );
  const pdf = sharedPreview?.pdf ?? localPdf;
  const [localCompiling, setCompiling] = useState(false);
  const compiling = sharedPreview?.busy ?? localCompiling;
  const [localCompileError, setCompileError] = useState("");
  const compileError = sharedPreview?.error ?? localCompileError;
  const compile = useRef<AbortController | null>(null);
  useEffect(() => {
    if (latex) setLatexText(latex.text);
  }, [latex?.text]);
  useEffect(
    () => () => {
      compile.current?.abort();
    },
    [],
  );
  const compilePdf = async () => {
    if (sharedPreview) {
      sharedPreview.retry();
      return;
    }
    if (
      compile.current ||
      !compileReady ||
      sourceError ||
      !(onSourceChange || onLatexChange)
    )
      return;
    const controller = new AbortController();
    compile.current = controller;
    setCompiling(true);
    setCompileError("");
    const snapshot = latexText;
    const account = session.token;
    try {
      const blob = await onCompileLatex(snapshot, controller.signal);
      if (!controller.signal.aborted && account === session.token)
        setPdf({ blob, source: snapshot });
    } catch (error) {
      if (!controller.signal.aborted && account === session.token)
        setCompileError(
          error instanceof Error ? error.message : "Couldn’t compile LaTeX.",
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
    if (navigationPending.current) return;
    compile.current?.abort();
    setLatexText(text);
    if (!onLatexChange) {
      try {
        changeSource(
          docSourceMap(withDocLatexSource(ownerBlocks.current, text)).source,
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
      const next = onLatexChange(text, ownerBlocks.current);
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
  const compileLatest = useRef(compilePdf);
  compileLatest.current = compilePdf;
  const lastCompile = useRef(0);
  useEffect(() => {
    const previous = compile.current;
    previous?.abort();
    if (compile.current === previous) compile.current = null;
    setCompiling(false);
    if (
      sharedPreview ||
      mode !== "latex" ||
      !compileReady ||
      sourceError ||
      !(onSourceChange || onLatexChange)
    )
      return;
    const timer = setTimeout(
      () => {
        lastCompile.current = Date.now();
        void compileLatest.current();
      },
      Math.max(1200, 4000 - (Date.now() - lastCompile.current)),
    );
    return () => {
      clearTimeout(timer);
      compile.current?.abort();
    };
  }, [
    mode,
    latexText,
    compileReady,
    sourceError,
    docId,
    !!onSourceChange,
    !!onLatexChange,
  ]);
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
  useEffect(() => {
    if (
      sharedPreview &&
      mode === "latex" &&
      !docLatexBlock(ownerBlocks.current) &&
      (onSourceChange || onLatexChange) &&
      !sourceError
    )
      changeLatex(latexText);
  }, [mode, !!latex, !!sharedPreview]);
  const closeSource = () => {
    if (!sourceError && !navigationPending.current) onClose();
  };
  const revertSource = () => {
    mustRestore.current = false;
    acceptedSource.current = canonical.source;
    ownerBlocks.current = blocks;
    acceptedBlocks.current.add(blocks);
    setSourceText(canonical.source);
    setLatexText(docLatexBlock(blocks)?.text ?? EMPTY_LATEX_DOCUMENT);
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
      style={{ flex: 1, minHeight: 0, padding: 16, gap: 12 }}
      onLayout={(event) => {
        setPaneWidth(event.nativeEvent.layout.width);
        setControlsHeight(
          Math.max(0, (event.nativeEvent.layout.height - 44) * 0.45),
        );
      }}
    >
      <ScrollView
        style={{ flexGrow: 0, flexShrink: 1, maxHeight: controlsHeight }}
        contentContainerStyle={{ gap: 12 }}
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
        {saveStatus && (
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            {saveStatus}
          </Text>
        )}
        {mode === "markdown" && onAssist && blocks[selected]?.id && (
          <Button
            title="Ask assistant"
            secondary
            disabled={navigating || !!sourceError}
            onPress={() => onAssist(blocks[selected])}
          />
        )}
        <Button
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
      </ScrollView>
      {mode === "latex" && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Text accessibilityLiveRegion="polite" style={shared.small}>
              {compileError
                ? "Preview unavailable"
                : compiling
                  ? "Updating preview…"
                  : "Live preview"}
            </Text>
            {!sourceOnly && compileError && (
              <Button
                title="Retry preview"
                secondary
                disabled={
                  navigating ||
                  !compileReady ||
                  compiling ||
                  !!sourceError ||
                  !(onSourceChange || onLatexChange)
                }
                onPress={() => void compilePdf()}
              />
            )}
            {onAssist && latex?.id && (
              <Button
                title="Ask assistant"
                secondary
                disabled={navigating || !!sourceError || !latex.text.trim()}
                onPress={() => onAssist(latex)}
              />
            )}
          </View>
          {!sourceOnly && !!compileError && (
            <Text accessibilityRole="alert" style={shared.small}>
              {compileError}
            </Text>
          )}
          {!sourceOnly && pdf && pdf.source !== latexText && (
            <Text accessibilityLiveRegion="polite" style={shared.small}>
              Preview is updating.
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
                  { flex: 1, minHeight: 120, textAlignVertical: "top" },
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
              {!sourceOnly && pdf ? (
                <DocumentPdfPreview pdf={pdf.blob} report={report} />
              ) : (
                <Text style={shared.small}>
                  {onSourceChange || onLatexChange
                    ? "Preparing PDF preview…"
                    : "Editing access is needed to compile."}
                </Text>
              )}
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
                fontSize: 13,
                lineHeight: 20,
                padding: 12,
                color: colors.text,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: radii.input,
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
        height: editorHeight ?? Math.max(400, windowHeight - 180),
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
