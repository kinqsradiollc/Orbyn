import { Bell } from "lucide-react";
import { dateLabel, type Notice } from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";

type Props = {
  notices: Notice[];
  onRead: (notice: Notice) => void;
};

export function NotificationsView({ notices, onRead }: Props) {
  return (
    <section className="card">
      {notices.map((n) => (
        <button
          className={"notice " + (n.read ? "read" : "")}
          key={n.id}
          onClick={() => onRead(n)}
        >
          <Bell size={19} />
          <span>
            <strong>{n.title}</strong>
            <p>{n.body}</p>
            <small>
              {dateLabel(n.created_at)}
              {n.read ? " · Read" : ""}
            </small>
          </span>
          {!n.read && <i />}
        </button>
      ))}
      {!notices.length && (
        <EmptyState
          icon={Bell}
          title="You’re all caught up."
          body="Deadline reminders will appear here."
        />
      )}
    </section>
  );
}
