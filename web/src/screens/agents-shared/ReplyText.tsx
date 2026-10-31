import { parseRichText, type RichInline } from "@orbyn/core";
import { Fragment, type ReactNode } from "react";

function Inlines({ parts }: { parts: RichInline[] }) {
  return parts.map((part, index) => {
    let node: ReactNode = part.code ? <code>{part.text}</code> : part.text;
    if (part.italic) node = <em>{node}</em>;
    if (part.bold) node = <strong>{node}</strong>;
    return <Fragment key={index}>{node}</Fragment>;
  });
}

/** A reply as headings, paragraphs, lists and tables. Wide tables scroll on their own. */
export function ReplyText({ text }: { text: string }) {
  return (
    <div className="agents-reply" dir="auto">
      {parseRichText(text).map((block, index) => {
        if (block.type === "heading")
          return (
            <h3 key={index}>
              <Inlines parts={block.inlines} />
            </h3>
          );
        if (block.type === "table")
          return (
            <div
              key={index}
              className="agents-table"
              role="region"
              aria-label="Table"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    {block.header.map((cell, at) => (
                      <th key={at} scope="col">
                        <Inlines parts={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, at) => (
                    <tr key={at}>
                      {row.map((cell, column) => (
                        <td key={column}>
                          <Inlines parts={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index}>
              {block.items.map((item, at) => (
                <li key={at}>
                  <Inlines parts={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={index}>
            <Inlines parts={block.inlines} />
          </p>
        );
      })}
    </div>
  );
}
