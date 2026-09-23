import { useEffect, useState } from "react";
import { hoursLabel, type AttentionCheck } from "@orbyn/core";
import { client } from "../../lib/api";

/**
 * Before a team meeting is saved: whose week it would take past the team's
 * meeting budget. Says nothing when the team has none, or nobody goes over.
 */
export function AttentionWarning({
  teamId,
  start,
  end,
  itemId,
}: {
  teamId: string | null;
  start: string | null;
  end: string | null;
  itemId?: string;
}) {
  const [check, setCheck] = useState<AttentionCheck | null>(null);
  useEffect(() => {
    setCheck(null);
    if (!teamId || !start || !end || Date.parse(end) <= Date.parse(start))
      return;
    let alive = true;
    const id = setTimeout(() => {
      client
        .checkAttention(teamId, {
          start_at: start,
          end_at: end,
          ...(itemId ? { item_id: itemId } : {}),
        })
        .then(
          (c) => alive && setCheck(c),
          () => {},
        );
    }, 400);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [teamId, start, end, itemId]);
  if (!check?.budget_minutes || !check.over.length) return null;
  const names = check.over.map((o) => o.name.split(" ")[0]);
  const who =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return (
    <p className="attention-warning" role="status">
      This puts {who} over the team&apos;s {hoursLabel(check.budget_minutes)}{" "}
      meeting budget this week.
    </p>
  );
}
