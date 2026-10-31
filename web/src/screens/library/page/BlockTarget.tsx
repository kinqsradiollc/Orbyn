import { blockText, type DocBlock } from "@orbyn/core";

/** Which line the conversation is about; the page by default. */
export function BlockTarget({
  blocks,
  value,
  onChange,
}: {
  blocks: DocBlock[];
  value: number | null;
  onChange: (index: number | null) => void;
}) {
  const lines = blocks
    .map((block, index) => ({ index, block, text: blockText(block).trim() }))
    .filter((line) => line.text && line.block.id && "text" in line.block);
  return (
    <select
      className="input"
      aria-label="What this is about"
      value={value ?? ""}
      onChange={(event) =>
        onChange(
          event.currentTarget.value === ""
            ? null
            : Number(event.currentTarget.value),
        )
      }
    >
      <option value="">The whole page</option>
      {lines.map((line) => (
        <option key={line.index} value={line.index}>
          {line.text.slice(0, 80)}
        </option>
      ))}
    </select>
  );
}
