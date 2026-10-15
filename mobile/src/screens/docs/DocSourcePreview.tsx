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
    latexOnly ? "latex" : "markdown",
  );
  const latex = docLatexBlock(blocks);
  const [latexText, setLatexText] = useState(
    latex?.text ?? EMPTY_LATEX_DOCUMENT,
  );
  const [pdf, setPdf] = useState<{ blob: Blob; source: string } | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState("");
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
    if (compile.current || sourceError || !(onSourceChange || onLatexChange))
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
  const { fontScale } = useWindowDimensions();
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
  return (
    <Sheet
      visible
      title="Source and preview"
      onClose={closeSource}
      hideClose={!!sourceError}
      closeDisabled={!!sourceError}
    >
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
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button
              title="Note"
              secondary
              disabled={navigating || !!sourceError}
              onPress={closeSource}
            />
            {!latexOnly && (
              <Button
                title="Markdown"
                disabled={navigating}
                secondary={mode !== "markdown"}
                onPress={() => setMode("markdown")}
              />
            )}
            <Button
              title="LaTeX"
              disabled={navigating}
              secondary={mode !== "latex"}
              onPress={() => setMode("latex")}
            />
          </View>
          <Text style={shared.small}>
            {mode === "latex"
              ? "LaTeX is saved with this note."
              : onSourceChange
                ? "Edit Markdown. Keep block anchors to preserve comments and task links."
                : "Source is read-only."}
          </Text>
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
              sourceVisible
                ? wide
                  ? "Hide source"
                  : "Show preview"
                : "Show source"
            }
            secondary
            onPress={() => {
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
              <Button
                title={compiling ? "Compiling…" : "Compile PDF"}
                disabled={
                  navigating ||
                  compiling ||
                  !!sourceError ||
                  !(onSourceChange || onLatexChange)
                }
                onPress={() => void compilePdf()}
              />
              {onAssist && latex?.id && (
                <Button
                  title="Ask assistant"
                  secondary
                  disabled={navigating || !!sourceError || !latex.text.trim()}
                  onPress={() => onAssist(latex)}
                />
              )}
            </View>
            {!!compileError && (
              <Text accessibilityRole="alert" style={shared.small}>
                {compileError}
              </Text>
            )}
            {pdf && pdf.source !== latexText && (
              <Text accessibilityLiveRegion="polite" style={shared.small}>
                PDF shows an earlier draft. Compile to update it.
              </Text>
            )}
            <View
              style={{
                flex: 1,
                minHeight: 0,
                gap: 12,
                flexDirection: split ? "row" : "column",
              }}
            >
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: sourceVisible ? "flex" : "none",
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
                  display: split || !sourceVisible ? "flex" : "none",
                }}
              >
                {pdf ? (
                  <DocumentPdfPreview pdf={pdf.blob} report={report} />
                ) : (
                  <Text style={shared.small}>
                    {onSourceChange || onLatexChange
                      ? "Compile to preview the PDF."
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
              flexDirection: split ? "row" : "column",
              gap: 12,
            }}
          >
            <View
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: sourceVisible ? "flex" : "none",
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
            <ScrollView
              ref={scroll}
              style={{
                flex: 1,
                minWidth: 0,
                display: !sourceVisible || split ? "flex" : "none",
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
          </View>
        </View>
      </View>
    </Sheet>
  );
}
