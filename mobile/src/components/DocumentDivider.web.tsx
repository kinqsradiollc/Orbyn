import { colors } from "../theme";
export type DocumentDividerProps = {
  value: number;
  width: number;
  onChange: (value: number) => void;
};
export function DocumentDivider({
  value,
  width,
  onChange,
}: DocumentDividerProps) {
  const change = (n: number) =>
    onChange(Math.max(30, Math.min(70, Math.round(n))));
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize source and preview"
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={30}
      aria-valuemax={70}
      style={{
        flex: "0 0 12px",
        alignSelf: "stretch",
        cursor: "col-resize",
        touchAction: "none",
        background: colors.surfaceMuted,
        borderInline: `1px solid ${colors.border}`,
      }}
      onKeyDown={(event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          change(
            event.key === "Home"
              ? 30
              : event.key === "End"
                ? 70
                : value + (event.key === "ArrowRight" ? 5 : -5),
          );
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          const box =
            event.currentTarget.parentElement!.getBoundingClientRect();
          change(((event.clientX - box.left) / Math.max(1, width)) * 100);
        }
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    />
  );
}
