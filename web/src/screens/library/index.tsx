import type { ScreenProps } from "../../app/routes";
import { usePath } from "../../lib/router";
import { Library } from "./Library";
import "./library.css";

/** One Library, inside and outside a page. Memory and Agent notes share it. */
export default function LibraryScreen({ params }: ScreenProps) {
  const path = usePath();
  const fixed = path.startsWith("/app/memory")
    ? "memory"
    : path.startsWith("/app/agent-notes")
      ? "agent"
      : undefined;
  return <Library fixedKind={fixed} pageId={params.id} />;
}
