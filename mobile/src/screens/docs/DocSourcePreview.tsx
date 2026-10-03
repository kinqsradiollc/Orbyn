import React, { useMemo, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import {
  docFragmentIndex,
  parseAppLink,
  docSourceMap,
  docSourceBlockAt,
  docReferenceLinks,
  footnoteNumbers,
  footnoteTexts,
  type DocBlock,
} from "@orbyn/core";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/Button";
import { shared } from "../../styles";
import { colors, radii } from "../../theme";
import { DocBody } from "./DocBody";
import { FootnoteContext } from "./footnotes";
import { DocNavigationContext } from "./doc-navigation";

/** A source toggle over the current editor state, without a second draft/save path. */
export function DocSourcePreview({
  blocks,
  docId,
  onAppLink,
  report,
  onClose,
}: {
  blocks: DocBlock[];
  docId: string;
  onAppLink: (url: string) => void;
  report: (error: unknown) => void;
  onClose: () => void;
}) {
  const [sourceVisible, setSourceVisible] = useState(true);
  const [selected, setSelected] = useState(0);
  const [sourceSelection, setSourceSelection] = useState<
    { start: number; end: number } | undefined
  >();
  const scroll = useRef<ScrollView>(null);
  const map = useMemo(() => docSourceMap(blocks), [blocks]);
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
        onClose();
        onAppLink(url);
      }
    },
    report,
  };
  return (
    <Sheet visible title="Source and preview" onClose={onClose}>
      <View style={{ flex: 1, minHeight: 0, padding: 16, gap: 12 }}>
        <Text style={shared.small}>
          Current document, including unsaved edits. Close this view to continue
          editing.
        </Text>
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
        {sourceVisible ? (
          <TextInput
            accessibilityLabel="Markdown source"
            value={map.source}
            editable={false}
            selection={sourceSelection}
            multiline
            scrollEnabled
            showSoftInputOnFocus={false}
            style={{
              flex: 1,
              textAlignVertical: "top",
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
    </Sheet>
  );
}
