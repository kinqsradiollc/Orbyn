/**
 * A small column chart for the admin console: one column per period, an
 * optional second value drawn over the first in the danger colour (errors
 * within requests), and a tooltip per column. Plain elements rather than
 * SVG so the labels stay crisp at any width.
 */
export function Bars({
  data,
  label,
  secondaryLabel,
  height = 120,
}: {
  data: { key: string; label: string; value: number; secondary?: number }[];
  /** What the columns count, for the accessible summary. */
  label: string;
  secondaryLabel?: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((n, d) => n + d.value, 0);
  const every = Math.max(1, Math.ceil(data.length / 8));
  return (
    <figure className="bars" aria-label={`${label}: ${total} in total`}>
      <div className="bars-plot" style={{ height }}>
        <span className="bars-max" aria-hidden="true">
          {max.toLocaleString()}
        </span>
        {data.map((d) => (
          <div
            key={d.key}
            className="bars-col"
            title={`${d.label}: ${d.value.toLocaleString()} ${label.toLowerCase()}${
              d.secondary ? ` · ${d.secondary} ${secondaryLabel ?? ""}` : ""
            }`}
          >
            <span
              className="bars-fill"
              style={{ height: `${(d.value / max) * 100}%` }}
            >
              {!!d.secondary && (
                <span
                  className="bars-secondary"
                  style={{
                    height: `${Math.min(100, (d.secondary / Math.max(1, d.value)) * 100)}%`,
                  }}
                />
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="bars-axis" aria-hidden="true">
        {data.map((d, n) => (
          <span key={d.key}>{n % every === 0 ? d.label : ""}</span>
        ))}
      </div>
    </figure>
  );
}
