import { useRouteScope } from "../../lib/route-scope";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { ReactNode } from "react";
import { useTitle, useSearch } from "../../lib/router";
import { IconButton, useToast } from "../../ui/kit";
import { Collection } from "./Collection";
import { Rail } from "./Rail";
import { UploadsProvider, useUploads } from "./Uploads";
import { PageScreen } from "./page/PageScreen";
import { useLibraryFeed, useLibraryState, type FixedKind } from "./store";

import { useLibraryView } from "./view";

/** The pane's actual width decides the layout, not the window's. */
function usePaneWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const pane = ref.current;
    if (!pane) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function Library({
  fixedKind,
  pageId,
  onSettle,
}: {
  fixedKind?: FixedKind;
  pageId?: string;
  onSettle?: (settle: (() => Promise<boolean>) | null) => void;
}) {
  useLibraryFeed();
  const scope = useRouteScope();
  const search = useSearch();
  const legacy = useLibraryView();
  useEffect(() => {
    if (scope) return;
    const query = new URLSearchParams(search),
      folder = query.get("folder");
    if (
      query.getAll("folder").length === 1 &&
      folder &&
      /^[A-Za-z0-9_-]{1,160}$/.test(folder)
    )
      legacy.goTo({ at: "folder", id: folder });
  }, [scope, search]);
  const content = (
    <UploadsProvider>
      <Frame fixedKind={fixedKind} pageId={pageId} onSettle={onSettle} />
    </UploadsProvider>
  );
  // Retained workspace supplies one view owner per pane/tab; legacy uses the shared view.
  return content;
}

function Frame({
  fixedKind,
  pageId,
  onSettle,
}: {
  fixedKind?: FixedKind;
  pageId?: string;
  onSettle?: (settle: (() => Promise<boolean>) | null) => void;
}) {
  const { railOpen } = useLibraryState();
  const { setRailOpen } = useLibraryView();
  const { ref, width } = usePaneWidth();
  const uploads = useUploads();
  const toast = useToast();
  const [dropping, setDropping] = useState(false);
  const [wide, setWide] = useState(false);
  /** A narrow pane shows the rail as a sheet over the work, on request. */
  const narrow = width > 0 && width < 900;
  const [sheet, setSheet] = useState(false);
  useEffect(() => setSheet(false), [pageId, fixedKind]);
  useTitle(
    pageId
      ? ""
      : fixedKind === "memory"
        ? "Memory"
        : fixedKind === "agent"
          ? "Agent notes"
          : "Library",
  );

  const showRail = narrow ? sheet : railOpen && !wide;
  const toggle = () => (narrow ? setSheet(!sheet) : setRailOpen(!railOpen));

  const onDrop = (event: DragEvent) => {
    setDropping(false);
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    toast({
      text: `Importing ${files.length === 1 ? files[0].name : `${files.length} files`}`,
    });
    void uploads.importFiles(files);
  };
  const toggleButton: ReactNode = (
    <IconButton
      label={showRail ? "Close library" : "Browse library"}
      aria-expanded={showRail}
      onClick={toggle}
    >
      {showRail ? <PanelLeftClose /> : <PanelLeftOpen />}
    </IconButton>
  );

  return (
    <div
      ref={ref}
      className="lib"
      data-narrow={narrow || undefined}
      data-sheet={(narrow && sheet) || undefined}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes("Files") || pageId) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropping(false);
      }}
      onDrop={pageId ? undefined : onDrop}
    >
      {showRail && (
        <>
          {narrow && (
            <button
              type="button"
              className="lib-scrim"
              aria-label="Close library"
              onClick={() => setSheet(false)}
            />
          )}
          <Rail
            fixedKind={fixedKind}
            openId={pageId ?? null}
            onChose={() => setSheet(false)}
          />
        </>
      )}
      <div className="lib-work">
        {pageId ? (
          <PageScreen
            key={pageId}
            id={pageId}
            railToggle={toggleButton}
            onWorkspaceWide={setWide}
            onSettle={onSettle}
          />
        ) : (
          <Collection fixedKind={fixedKind} railToggle={toggleButton} />
        )}
      </div>
      {dropping && (
        <div className="lib-drop" aria-hidden="true">
          <strong>Drop to import</strong>
        </div>
      )}
    </div>
  );
}
