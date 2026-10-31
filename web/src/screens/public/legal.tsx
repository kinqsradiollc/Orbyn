import { DATA_ANSWER, SECURITY_PAGE, securityPageDate } from "@orbyn/core";
import { client } from "../../lib/session";
import { useResource } from "../../lib/resource";
import { usePath, useTitle } from "../../lib/router";
import { ErrorNotice, Loading } from "../../ui/kit";
import { go, PlainText, PublicFrame } from "./PublicFrame";

const TABS = [
  ["/security", "Security and data"],
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Service"],
];

function Security() {
  useTitle("Security and data");
  return (
    <>
      <h1>Security and data</h1>
      <p className="muted">Last checked {securityPageDate()}</p>
      <h2>{DATA_ANSWER.q}</h2>
      <p>{DATA_ANSWER.a}</p>
      {SECURITY_PAGE.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          <ul>
            {section.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Document({ doc }: { doc: "terms" | "privacy" }) {
  useTitle(doc === "terms" ? "Terms of Service" : "Privacy Policy");
  const text = useResource(() => client.legalDocument(doc), [doc]);
  if (text.error && !text.data)
    return (
      <ErrorNotice message={text.error} onRetry={() => void text.reload()} />
    );
  if (!text.data) return <Loading />;
  return (
    <>
      <p className="small muted">Version {text.data.version}</p>
      <PlainText body={text.data.body} />
    </>
  );
}

export default function Legal() {
  const path = usePath();
  return (
    <PublicFrame>
      <main className="reading">
        <nav className="segmented" aria-label="About your data">
          {TABS.map(([to, label]) => (
            <a
              key={to}
              href={to}
              onClick={go(to)}
              aria-current={path === to ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        <article className="prose">
          {path === "/security" ? (
            <Security />
          ) : (
            <Document doc={path === "/terms" ? "terms" : "privacy"} />
          )}
        </article>
      </main>
    </PublicFrame>
  );
}
