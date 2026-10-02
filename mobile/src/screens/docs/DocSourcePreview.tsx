import React, { useMemo, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import {
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

/** A source toggle over the current editor state, without a second draft/save path. */
export function DocSourcePreview({
  blocks,
  onClose,
}: {
  blocks: DocBlock[];
  onClose: () => void;
}) {
  const [sourceVisible, setSourceVisible] = useState(true);
  const [selected, setSelected] = useState(0);
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
  const blockId = blocks[selected]?.id;
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
          onPress={() => setSourceVisible(!sourceVisible)}
        />
        {sourceVisible ? (
          <TextInput
            accessibilityLabel="Markdown source"
            value={map.source}
            editable={false}
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
              const range = docSourceBlockAt(
                map,
                event.nativeEvent.selection.start,
              );
              if (range) setSelected(range.blockIndex);
            }}
          />
        ) : (
          <ScrollView ref={scroll} contentContainerStyle={{ padding: 12 }}>
            <FootnoteContext.Provider value={notes}>
              <DocBody
                content={blocks}
                targetBlockId={blockId}
                flash={blockId ?? null}
                onTargetLayout={(y) =>
                  scroll.current?.scrollTo({
                    y: Math.max(0, y - 12),
                    animated: false,
                  })
                }
              />
            </FootnoteContext.Provider>
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
}
