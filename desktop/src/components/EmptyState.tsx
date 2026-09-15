import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Props = {
  icon: LucideIcon;
  title: string;
  body: string;
  children?: ReactNode;
};

export function EmptyState({ icon: Icon, title, body, children }: Props) {
  return (
    <div className="empty">
      <Icon size={30} />
      <h3>{title}</h3>
      <p>{body}</p>
      {children}
    </div>
  );
}
