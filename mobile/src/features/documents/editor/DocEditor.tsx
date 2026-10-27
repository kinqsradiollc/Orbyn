import { useEffect, useState } from "react";
import type { Doc } from "@orbyn/core";
import { client } from "../../../lib/api";
import { LegacyDocEditor } from "./LegacyDocEditor";
import { StructuredDocEditor } from "./StructuredDocEditor";
import { docContainerBlocks } from "@orbyn/core";
import { Text, View } from "react-native";
import { SmallAction } from "../../../components/SmallAction";
import { session as authSession } from "../../../lib/session";
import { colors, themed } from "../../../theme";

/** Load the authoritative content, then choose its format-specific editor. */
export function DocEditor(props: Parameters<typeof LegacyDocEditor>[0]) {
  return (
    <DocEditorBody key={`${authSession.token}:${props.doc.id}`} {...props} />
  );
}

function DocEditorBody(props: Parameters<typeof LegacyDocEditor>[0]) {
  const account = authSession.token;
  const [openingFailed, setOpeningFailed] = useState(false);
  const [openingAttempt, setOpeningAttempt] = useState(0);
  const [complete, setComplete] = useState<Doc | null>(
    props.doc.document ? props.doc : null,
  );
  useEffect(() => {
    setOpeningFailed(false);
    if (props.doc.document) {
      setComplete(props.doc);
      return;
    }
    let active = true;
    client.getDocForEditor(props.doc.id).then(
      (doc) => {
        if (active && account === authSession.token) setComplete(doc);
      },
      () => {
        if (active && account === authSession.token) setOpeningFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [props.doc.id, props.doc.document, openingAttempt, account]);
  useEffect(() => {
    if (complete?.id !== props.doc.id || complete.document?.format !== 2)
      return;
    props.onBlocksChange?.(
      docContainerBlocks(complete.document.nodes, { projected: true }),
    );
  }, [complete, props.doc.id, props.onBlocksChange]);
  if (!complete || complete.id !== props.doc.id)
    return (
      <View style={{ gap: 8 }}>
        <Text style={openingStyles.hint} accessibilityLiveRegion="polite">
          {openingFailed ? "Couldn't open page." : "Opening page…"}
        </Text>
        {openingFailed && (
          <SmallAction
            label="Retry"
            disabled={false}
            onPress={() => {
              setOpeningFailed(false);
              setOpeningAttempt((attempt) => attempt + 1);
            }}
          />
        )}
      </View>
    );
  return complete.document?.format === 2 ? (
    <StructuredDocEditor
      doc={complete}
      comments={props.comments}
      userId={props.userId}
      beforeLeave={props.beforeLeave}
      initialBlockId={props.initialBlockId}
      onTargetOffset={props.onTargetOffset}
      canWrite={props.canWrite ?? true}
      onChanged={props.onChanged}
      onShowHistory={props.onShowHistory}
      onShowComments={props.onShowComments}
      onShowInLibrary={props.onShowInLibrary}
      onMoveTo={props.onMoveTo}
      report={props.report}
    />
  ) : (
    <LegacyDocEditor {...props} doc={complete} />
  );
}

const openingStyles = themed(() => ({
  hint: { color: colors.faint, fontSize: 13, lineHeight: 18 },
}));
