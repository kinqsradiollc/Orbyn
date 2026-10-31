import {
  assistantOutcomeDetails,
  type AssistantOutcomeReceipt,
} from "@orbyn/core";
import type { InputHTMLAttributes, ReactNode } from "react";

/** Optional detail. The summary is the control. */
export function More({
  summary,
  open,
  children,
}: {
  summary: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="agents-more" open={open}>
      <summary>{summary}</summary>
      <div className="agents-more-body">{children}</div>
    </details>
  );
}

export function Check({
  label,
  ...props
}: { label: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <label className="check agents-check">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Recorded evidence, kept apart from what a run said about itself. */
export function Evidence({
  receipt,
  summary = "Evidence & open questions",
}: {
  receipt: AssistantOutcomeReceipt;
  summary?: string;
}) {
  return (
    <More summary={summary}>
      <ul className="agents-lines">
        {assistantOutcomeDetails(receipt).map((line, index) => (
          <li key={index} dir="auto">
            {line}
          </li>
        ))}
      </ul>
    </More>
  );
}

export const Time = ({ at }: { at: string }) => (
  <time className="muted small" dateTime={at}>
    {new Date(at).toLocaleString()}
  </time>
);

/** A section of an agent screen: a title, then rows. */
export function Band({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="agents-band" aria-label={title}>
      <header>
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
