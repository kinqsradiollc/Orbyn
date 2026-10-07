import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import {
  docFragmentIndex,
  parseAppLink,
  docSourceMap,
  versionedDocLeafSourceMap,
  docContainerBlocks,
  type VersionedDocContent,
  docSourceBlockAt,
  docReferenceLinks,
  footnoteNumbers,
  footnoteTexts,
  type DocBlock,
} from "@orbyn/core";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/Button";
import { shared } from "../../styles";
import { colors, fonts, radii } from "../../theme";
import { DocBody } from "./DocBody";
import { DocContainerBody } from "./DocContainerBody";
import { FootnoteContext } from "./footnotes";
import { DocNavigationContext } from "./doc-navigation";

/** Source and preview delegate edits to the existing editor and its save path. */
export function DocSourcePreview({
  blocks: flatBlocks,
  document: ownedDocument,
  onDocumentSourceChange,
  docId,
  onAppLink,
  report,
  onClose,
  onSourceChange,
  saveStatus,
}: {
  blocks: DocBlock[];
  /** Complete ownership is authoritative when supplied by the normal editor. */
  document?: VersionedDocContent;
  onDocumentSourceChange?: (
    source: string,
    expected: VersionedDocContent,
  ) => VersionedDocContent;
  docId: string;
  onAppLink: (url: string) => void;
  report: (error: unknown) => void;
  onClose: () => void;
  onSourceChange?: (source: string, expected: DocBlock[]) => DocBlock[];
  saveStatus?: string;
}) {
  const [sourceVisible, setSourceVisible] = useState(true);
  const [selected, setSelected] = useState(0);
  const [controlsHeight, setControlsHeight] = useState<number>();
  const [sourceSelection, setSourceSelection] = useState<
    { start: number; end: number } | undefined
  >();
  const scroll = useRef<ScrollView>(null);
  const sourceInput = useRef<TextInput>(null);
  const owner = ownedDocument ?? flatBlocks;
  const editable = ownedDocument ? !!onDocumentSourceChange : !!onSourceChange;
  const sourceMap = (value: VersionedDocContent | DocBlock[], raw?: string) =>
    Array.isArray(value)
      ? docSourceMap(value, raw)
      : versionedDocLeafSourceMap(value, raw, { projected: true });
  const canonical = useMemo(() => sourceMap(owner), [owner]);
  // This buffer retains typed whitespace while the owning editor holds the
  // parsed blocks and the only save/revision path. External reconciliations
  // replace it; echoes of our own parsed source do not move the caret.
  const [sourceText, setSourceText] = useState(canonical.source);
  const [sourceError, setSourceError] = useState("");
  const acceptedSource = useRef(canonical.source);
  const ownerBlocks = useRef<VersionedDocContent | DocBlock[]>(owner);
  // React can commit an older edit after a newer native text event arrived.
  // Recognize every own block echo without retaining old document snapshots.
  const acceptedBlocks = useRef(new WeakSet<object>([owner]));
  const mustRestore = useRef(false);
  // Retained browser/native input handlers must not rebase an older buffer
  // onto ownership adopted from another editor.
  const sourceEpoch = useRef(0);
  const renderedEpoch = sourceEpoch.current;
  useEffect(() => {
    if (acceptedBlocks.current.has(owner)) return;
    const previousOwner = ownerBlocks.current;
    const sameFormat = Array.isArray(owner)
      ? Array.isArray(previousOwner)
      : !Array.isArray(previousOwner) && owner.format === previousOwner.format;
    if (sameFormat && canonical.source === acceptedSource.current) {
      ownerBlocks.current = owner;
      acceptedBlocks.current.add(owner);
      return;
    }
    sourceEpoch.current++;
    if (sourceError) {
      mustRestore.current = true;
      setSourceError(
        "The document changed while this source edit was invalid. Restore the current document before continuing.",
      );
      return;
    }
    acceptedSource.current = canonical.source;
    ownerBlocks.current = owner;
    acceptedBlocks.current.add(owner);
    setSourceText(canonical.source);
    setSourceError("");
  }, [owner, canonical.source]);
  // A delayed own echo renders the newest accepted owner, not an older tree
  // beside a newer input buffer. External ownership renders its own canonical
  // map until the reconciliation effect restores the corresponding buffer.
  const previewOwner = acceptedBlocks.current.has(owner)
    ? ownerBlocks.current
    : owner;
  const blocks = useMemo(
    () =>
      Array.isArray(previewOwner)
        ? previewOwner
        : previewOwner.format === 1
          ? previewOwner.blocks
          : docContainerBlocks(previewOwner.nodes, { projected: true }),
    [previewOwner],
  );
  const previewCanonical = useMemo(
    () => sourceMap(previewOwner),
    [previewOwner],
  );
  const map = useMemo(() => {
    if (!editable || sourceError) return previewCanonical;
    try {
      return sourceMap(previewOwner, sourceText);
    } catch {
      return previewCanonical;
    }
  }, [previewOwner, previewCanonical, sourceText, sourceError, editable]);
  const changeSource = (text: string) => {
    if (!editable || mustRestore.current) return;
    setSourceSelection(undefined);
    setSourceText(text);
    try {
      if (renderedEpoch !== sourceEpoch.current) {
        mustRestore.current = true;
        throw new Error(
          "The document changed before this source edit could be applied. Restore the current document before continuing.",
        );
      }
      const expected = ownerBlocks.current;
      const next = Array.isArray(expected)
        ? onSourceChange!(text, expected)
        : onDocumentSourceChange!(text, expected);
      ownerBlocks.current = next;
      acceptedBlocks.current.add(next);
      acceptedSource.current = sourceMap(next).source;
      setSourceError("");
    } catch (error) {
      setSourceError(
        error instanceof Error
          ? error.message
          : "Couldn't apply the source edit.",
      );
    }
  };
  const closeSource = () => {
    if (!sourceError) onClose();
  };
  const revertSource = () => {
    mustRestore.current = false;
    acceptedSource.current = canonical.source;
    ownerBlocks.current = owner;
    acceptedBlocks.current.add(owner);
    setSourceText(canonical.source);
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
  const previewRoot = useRef<View>(null);
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
        if (sourceError) return;
        closeSource();
        onAppLink(url);
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
    >
      <View
        style={{ flex: 1, minHeight: 0, padding: 16, gap: 12 }}
        onLayout={(event) =>
          setControlsHeight(
            Math.max(0, (event.nativeEvent.layout.height - 44) * 0.45),
          )
        }
      >
        <ScrollView
          style={{ flexGrow: 0, flexShrink: 1, maxHeight: controlsHeight }}
          contentContainerStyle={{ gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {!!sourceError && (
            <View style={{ gap: 8 }}>
              <Button
                title="Restore current document"
                secondary
                onPress={revertSource}
              />
              <Text accessibilityRole="alert" style={shared.small}>
                {sourceError} This edit has not been saved.
              </Text>
            </View>
          )}
          <Text style={shared.small}>
            {editable
              ? "Edit Markdown here. Source and preview share the same document. Keep block anchors to preserve comments and task links."
              : "Current document, including unsaved edits. Source editing is available in Editing mode."}
          </Text>
          {saveStatus && (
            <Text accessibilityLiveRegion="polite" style={shared.small}>
              {saveStatus}
            </Text>
          )}
          <Button
            title={sourceVisible ? "Show preview" : "Show Markdown source"}
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
        {sourceVisible ? (
          <TextInput
            accessibilityLabel="Markdown source"
            value={editable ? sourceText : map.source}
            editable={editable}
            onChangeText={editable ? changeSource : undefined}
            ref={sourceInput}
            selection={editable ? undefined : sourceSelection}
            onLayout={() => {
              if (editable && sourceSelection) {
                sourceInput.current?.setNativeProps({
                  selection: sourceSelection,
                });
                setSourceSelection(undefined);
              }
            }}
            multiline
            scrollEnabled
            showSoftInputOnFocus={editable}
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
        ) : (
          <ScrollView
            ref={scroll}
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
                {!Array.isArray(previewOwner) && previewOwner.format === 2 ? (
                  <View ref={previewRoot}>
                    <DocContainerBody
                      nodes={previewOwner.nodes}
                      renderLeaf={(block, index) => {
                        let leaf: View | null = null;
                        const measure = () => {
                          const current = () =>
                            previewOwner === ownerBlocks.current &&
                            renderedEpoch === sourceEpoch.current;
                          if (!previewRoot.current || !current()) return;
                          leaf?.measureLayout(
                            previewRoot.current,
                            (_x, y) => {
                              if (!current()) return;
                              positions.set(index, y);
                              if (index === selected)
                                scroll.current?.scrollTo({
                                  y: Math.max(0, y - 12),
                                  animated: false,
                                });
                            },
                            () => {},
                          );
                        };
                        return (
                          <View
                            key={block.id ?? index}
                            ref={(node) => {
                              leaf = node;
                            }}
                            onLayout={measure}
                          >
                            <DocBody
                              content={[block]}
                              pageContent={blocks}
                              pageIndex={index}
                              targetBlockId={blockId}
                              flash={blockId ?? null}
                              onTargetLayout={measure}
                            />
                          </View>
                        );
                      }}
                    />
                  </View>
                ) : (
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
                )}
              </FootnoteContext.Provider>
            </DocNavigationContext.Provider>
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
}
