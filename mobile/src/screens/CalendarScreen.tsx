import React from "react";
import { byDueDate, type Item } from "@orbyn/core";
import { PlannerList, type ListHandlers } from "../components/PlannerList";

export function CalendarScreen({
  items,
  ...handlers
}: ListHandlers & { items: Item[] }) {
  const visible = [...items].sort(byDueDate);
  return (
    <PlannerList
      items={items}
      visible={visible}
      listed={visible.filter((i) => i.due_at)}
      title="Your agenda"
      {...handlers}
    />
  );
}
