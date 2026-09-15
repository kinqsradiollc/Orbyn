import { ListTodo, Search } from "lucide-react";
import type { Item } from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import { ItemRow } from "../../components/ItemRow";

type Props = {
  items: Item[];
  query: string;
  onQueryChange: (query: string) => void;
  busy: boolean;
  onToggle: (item: Item) => void;
  onEdit: (item: Item) => void;
};

export function TasksView({
  items,
  query,
  onQueryChange,
  busy,
  onToggle,
  onEdit,
}: Props) {
  return (
    <section className="card">
      <div className="section-heading">
        <h2>
          All items <span>{items.length}</span>
        </h2>
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Search items"
            placeholder="Find something…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>
      </div>
      {items
        .filter((i) =>
          (i.title + " " + i.notes).toLowerCase().includes(query.toLowerCase()),
        )
        .map((i) => (
          <ItemRow
            key={i.id}
            item={i}
            busy={busy}
            onToggle={onToggle}
            onEdit={onEdit}
          />
        ))}
      {!items.length && (
        <EmptyState
          icon={ListTodo}
          title="Give your ideas a home."
          body="Add a task or event to start building your plan."
        />
      )}
    </section>
  );
}
