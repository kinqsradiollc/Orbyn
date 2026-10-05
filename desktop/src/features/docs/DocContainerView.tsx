import { Fragment, useMemo } from "react";
import {
  CALLOUT_LABELS,
  listLayout,
  docContainerBlocks,
  docReferenceLinks,
  footnoteNumbers,
  footnoteTexts,
  type DocContainerNode,
  type DocBlock,
} from "@orbyn/core";
import { BlockView } from "./DocBlocks";
import { FootnoteContext } from "./RichBlocks";
import "./doc-containers.css";

/** Render full ownership with existing block widgets and one page-wide reference context. */
export function DocContainerView({
  nodes,
  renderLeaf,
}: {
  nodes: readonly DocContainerNode[];
  /** Existing editor widgets receive their complete-page leaf position. */
  renderLeaf?: (block: DocBlock, index: number) => React.ReactNode;
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
  const layout = useMemo(() => listLayout(blocks), [blocks]);
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
            <Fragment key={key}>{renderLeaf(node.block, position)}</Fragment>
          );
        return (
          <div
            key={key}
            data-container-path={here.join("/")}
            data-block-id={node.block.id}
          >
            <BlockView
              block={node.block}
              pageBlocks={blocks}
              number={layout[position].number}
              depth={layout[position].depth}
            />
          </div>
        );
      }
      if (node.kind === "quote")
        return (
          <blockquote
            key={key}
            className={node.callout ? "doc-container-callout" : undefined}
            data-container-path={here.join("/")}
          >
            {node.callout ? (
              <details open={!node.callout.folded}>
                <summary>{CALLOUT_LABELS[node.callout.tone]}</summary>
                {render(node.children, here)}
              </details>
            ) : (
              render(node.children, here)
            )}
          </blockquote>
        );
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          start={node.ordered ? node.start : undefined}
          data-container-path={here.join("/")}
        >
          {node.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {item.checked !== undefined && (
                <input
                  type="checkbox"
                  checked={item.checked}
                  disabled
                  aria-label="Checklist item"
                />
              )}
              <div className="doc-container-item">
                {render(item.children, [...here, itemIndex])}
              </div>
            </li>
          ))}
        </Tag>
      );
    });
  return (
    <FootnoteContext.Provider value={notes}>
      <div className="doc-containers">{render(nodes)}</div>
    </FootnoteContext.Provider>
  );
}
