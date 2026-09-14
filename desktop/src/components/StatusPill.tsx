import { statusLabels, type Status } from "@orbyn/core";

type Props = { status: Status; className?: string };

/**
 * Task status in the shared wording and tone from @orbyn/core. The dot uses
 * the tone color; the label is darkened in CSS for readable contrast.
 */
export function StatusPill({ status, className = "" }: Props) {
  return (
    <span className={`task-status tone-${status} ${className}`}>
      <i aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}
