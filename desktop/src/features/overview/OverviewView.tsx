import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Clock,
  ListTodo,
  Plus,
  Sparkles,
  Sun,
} from "lucide-react";
import { dateLabel, groupItems, type Item } from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import { ItemRow } from "../../components/ItemRow";
import type { View } from "../../app/views";

type Props = {
  items: Item[];
  busy: boolean;
  onToggle: (item: Item) => void;
  onEdit: (item: Item) => void;
  onNewItem: () => void;
  onNavigate: (view: View) => void;
  onPlanDay: () => void;
};

export function OverviewView({
  items,
  busy,
  onToggle,
  onEdit,
  onNewItem,
  onNavigate,
  onPlanDay,
}: Props) {
  const { today, overdue, upcoming, done } = groupItems(items);
  const completed = done.length;
  const percent = items.length ? (completed / items.length) * 100 : 0;
  return (
    <>
      <section className="stats">
        <div>
          <span>
            <Sun size={17} /> On your radar today
          </span>
          <strong>
            {today.length}
            <small>planned for today</small>
          </strong>
        </div>
        <div>
          <span>
            <ListTodo size={17} /> A little progress
          </span>
          <strong>
            {completed}
            <small>items completed</small>
          </strong>
        </div>
        <div>
          <span>
            <Clock size={17} /> Needs a moment
          </span>
          <strong>
            {overdue.length}
            <small>overdue items</small>
          </strong>
        </div>
      </section>
      <div className="overview-grid">
        <div>
          <section className="card focus-card">
            <div className="section-heading">
              <h2>
                Today’s focus <span>{today.length}</span>
              </h2>
              <button
                className="text-button"
                onClick={() => onNavigate("My tasks")}
              >
                All tasks <ArrowRight size={14} />
              </button>
            </div>
            {today.length ? (
              today.map((i) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  busy={busy}
                  onToggle={onToggle}
                  onEdit={onEdit}
                />
              ))
            ) : (
              <EmptyState
                icon={Sun}
                title="A little breathing room."
                body="Your day is open. Add something worth making time for."
              >
                <button className="text-button" onClick={onNewItem}>
                  Plan your first item <Plus size={14} />
                </button>
              </EmptyState>
            )}
          </section>
          <section className="card">
            <div className="section-heading">
              <h2>Coming into view</h2>
              <CalendarDays size={18} />
            </div>
            {upcoming.slice(0, 4).map((i) => (
              <button className="upcoming" key={i.id} onClick={() => onEdit(i)}>
                <span className="date-tile">
                  <small>
                    {new Date(i.due_at!).toLocaleDateString([], {
                      month: "short",
                    })}
                  </small>
                  {new Date(i.due_at!).getDate()}
                </span>
                <span>
                  <strong>{i.title}</strong>
                  <small>
                    {dateLabel(i.due_at)} · {i.kind}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
            {!upcoming.length && (
              <p className="muted pad">
                No upcoming plans yet. Your next idea can start here.
              </p>
            )}
          </section>
        </div>
        <div>
          <section className="assistant-card">
            <span className="sparkle-box">
              <Sparkles size={23} />
            </span>
            <span className="eyebrow">A MIND BESIDE YOURS</span>
            <h2>
              Find your next
              <br />
              clear step.
            </h2>
            <p>Let’s turn a busy mind into a plan that feels possible.</p>
            <button onClick={onPlanDay}>
              Help me plan my day <ArrowUpRight size={17} />
            </button>
            <div className="abstract-orbit">
              <i />
              <i />
              <span>✦</span>
            </div>
          </section>
          <section className="card progress-card">
            <h2>Your momentum</h2>
            <div className="progress-line">
              <strong>{Math.round(percent)}%</strong>
              <span>of your plans complete</span>
            </div>
            <div className="progress-track">
              <div style={{ width: `${percent}%` }} />
            </div>
            <p>Progress happens one small step at a time.</p>
          </section>
        </div>
      </div>
    </>
  );
}
