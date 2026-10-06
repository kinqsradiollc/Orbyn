import React, { useMemo, useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  CALLOUT_LABELS,
  docContainerBlocks,
  docReferenceLinks,
  footnoteNumbers,
  footnoteTexts,
  type DocContainerNode,
  type DocBlock,
  type DocContentOperation,
} from "@orbyn/core";
import { DocBody } from "./DocBody";
import { FootnoteContext } from "./footnotes";
import { Pressable } from "../../motion";
import { colors, fonts } from "../../theme";

/** Native nested ownership uses existing block widgets and complete page reference/footnote context. */
export function DocContainerBody({
  nodes,
  renderLeaf,
  onOperation,
}: {
  nodes: readonly DocContainerNode[];
  /** Existing editor widgets receive their complete-page leaf position. */
  renderLeaf?: (
    block: DocBlock,
    index: number,
    path: number[],
  ) => React.ReactNode;
  /** The owner applies this operation against these exact rendered nodes. */
  onOperation?: (
    operation: DocContentOperation,
    expectedNodes: readonly DocContainerNode[],
  ) => void;
}) {
  const blocks = useMemo(
    () => docContainerBlocks(nodes, { projected: true }),
    [nodes],
  );
  const notes = useMemo(
    () => ({
      references: docReferenceLinks(blocks),
      numbers: footnoteNumbers(blocks),
      texts: footnoteTexts(blocks),
    }),
    [blocks],
  );
  let leafIndex = 0;
  const render = (
    children: readonly DocContainerNode[],
    path: number[] = [],
  ): React.ReactNode =>
    children.map((node, index) => {
      const here = [...path, index];
      const key =
        node.kind === "block"
          ? (node.block.id ?? here.join("/"))
          : (node.id ?? here.join("/"));
      if (node.kind === "block") {
        const position = leafIndex++;
        if (renderLeaf)
          return (
            <React.Fragment key={key}>
              {renderLeaf(node.block, position, here)}
            </React.Fragment>
          );
        return (
          <DocBody
            key={key}
            content={[node.block]}
            pageContent={blocks}
            pageIndex={position}
          />
        );
      }
      if (node.kind === "quote")
        return (
          <View
            key={key}
            style={{
              minWidth: 0,
              paddingLeft: 12,
              paddingVertical: 8,
              marginVertical: 4,
              borderLeftWidth: 2,
              borderLeftColor: node.callout ? colors.accent : colors.border,
            }}
          >
            {node.callout ? (
              <ContainerCallout
                tone={node.callout.tone}
                folded={node.callout.folded}
              >
                {render(node.children, here)}
              </ContainerCallout>
            ) : (
              render(node.children, here)
            )}
          </View>
        );
      return (
        <View key={key} style={{ minWidth: 0, marginVertical: 4 }}>
          {node.items.map((item, itemIndex) => (
            <View
              key={itemIndex}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 8,
                paddingVertical: 4,
              }}
            >
              <View
                style={{
                  maxWidth: "35%",
                  flexDirection: "row",
                  alignItems: "flex-start",
                }}
              >
                {(node.ordered || item.checked === undefined) && (
                  <Text
                    style={{ color: colors.text, fontFamily: fonts.regular }}
                  >
                    {node.ordered
                      ? `${node.start + itemIndex}${node.delimiter}`
                      : "•"}
                  </Text>
                )}
                {item.checked !== undefined && (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel="Checklist item"
                    accessibilityState={{
                      checked: item.checked,
                      disabled: !onOperation,
                    }}
                    disabled={!onOperation}
                    onPress={
                      onOperation
                        ? () =>
                            onOperation(
                              {
                                kind: "check-item",
                                list: here,
                                item: itemIndex,
                                checked: !item.checked,
                              },
                              nodes,
                            )
                        : undefined
                    }
                    hitSlop={5}
                    style={{
                      minWidth: 34,
                      minHeight: 34,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{ color: colors.text, fontFamily: fonts.regular }}
                    >
                      {item.checked ? "☑" : "☐"}
                    </Text>
                  </Pressable>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                {render(item.children, [...here, itemIndex])}
              </View>
            </View>
          ))}
        </View>
      );
    });
  return (
    <FootnoteContext.Provider value={notes}>
      <View style={{ minWidth: 0 }}>{render(nodes)}</View>
    </FootnoteContext.Provider>
  );
}

function ContainerCallout({
  tone,
  folded,
  children,
}: {
  tone: keyof typeof CALLOUT_LABELS;
  folded: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!folded);
  useEffect(() => setOpen(!folded), [folded]);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        hitSlop={8}
        style={{ minHeight: 34, justifyContent: "center", paddingVertical: 4 }}
      >
        <Text style={{ fontFamily: fonts.semibold, color: colors.text }}>
          {open ? "▾" : "▸"} {CALLOUT_LABELS[tone]}
        </Text>
      </Pressable>
      {open && children}
    </View>
  );
}
