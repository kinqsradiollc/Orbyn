import { useEffect, useState } from "react";
import type { Doc } from "@orbyn/core";
import { client } from "../../../lib/api";
import { LegacyDocEditor } from "./LegacyDocEditor";
import { StructuredDocEditor } from "./StructuredDocEditor";

/** Load the authoritative content, then choose its format-specific editor. */
export function DocEditor(props: Parameters<typeof LegacyDocEditor>[0]) {
  const [complete, setComplete] = useState<Doc | null>(
    props.doc.document ? props.doc : null,
  );
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setLoadError(false);
    if (props.doc.document) {
      setComplete(props.doc);
      return;
    }
    let active = true;
    client.getDocForEditor(props.doc.id).then(
      (doc) => {
        if (active) setComplete(doc);
      },
      (error) => {
        if (active) {
          setLoadError(true);
          props.report(error);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [props.doc.id, props.doc.document, props.report, retry]);
  if (!complete || complete.id !== props.doc.id)
    return loadError ? (
      <div role="alert">
        <p>Page couldn’t be loaded.</p>
        <button
          className="text-button"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry
        </button>
      </div>
    ) : (
      <p role="status">Opening page…</p>
    );
  return complete.document?.format === 2 ? (
    <StructuredDocEditor
      doc={complete}
      canWrite={props.canWrite ?? true}
      onChanged={props.onChanged}
      onBack={props.onBack}
      initialBlockId={props.initialBlockId}
      userId={props.userId}
      report={props.report}
    />
  ) : (
    <LegacyDocEditor {...props} doc={complete} />
  );
}
