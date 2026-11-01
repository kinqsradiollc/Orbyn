import { useRouteInput } from "../../lib/route-scope";
import { isClosed, type Item } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "../../app/account";
import { useNavigate } from "../../lib/router";
import { getSessionVersion, getToken } from "../../lib/session";
import { Button, Dialog, TextArea, useToast } from "../../ui/kit";
import { taskWebLink } from "./drag";

/** Own outside the menu portal: clipboard failure must survive menu dismissal. */
export function useTransferActions(item: Item) {
  const navigate = useNavigate();
  const inputAllowed = useRouteInput();
  const { version: generation } = useAccount(),
    mounted = useRef(true),
    pending = useRef<{ generation: number } | null>(null),
    toast = useToast();
  const [manual, setManual] = useState<{
    generation: number;
    text: string;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const live = () =>
    mounted.current && !!getToken() && getSessionVersion() === generation;
  const copy = async (close: () => void) => {
    if (
      !live() ||
      !inputAllowed() ||
      pending.current?.generation === generation
    )
      return;
    const attempt = { generation };
    pending.current = attempt;
    const text = taskWebLink(item.id);
    close();
    try {
      await navigator.clipboard.writeText(text);
      if (live()) toast({ text: "Task link copied" });
    } catch {
      if (live()) setManual({ generation, text });
    } finally {
      if (pending.current === attempt) pending.current = null;
    }
  };
  return {
    actions: (close: () => void) => (
      <>
        {item.kind === "task" && !isClosed(item.status) && (
          <button
            onClick={() => {
              if (!live() || !inputAllowed()) return;
              close();
              void navigate(
                "/app/calendar?plan=" + encodeURIComponent(item.id),
              );
            }}
          >
            Schedule
          </button>
        )}
        <button onClick={() => void copy(close)}>Copy task link</button>
      </>
    ),
    dialog: manual?.generation === generation && (
      <Dialog
        title="Copy task link"
        onClose={() => setManual(null)}
        actions={<Button onClick={() => setManual(null)}>Done</Button>}
      >
        <p>Copy this link, then paste it into a page.</p>
        <TextArea
          aria-label="Task link"
          readOnly
          value={manual.text}
          onFocus={(event) => event.currentTarget.select()}
        />
      </Dialog>
    ),
  };
}
