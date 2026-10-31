import {
  agendaDay,
  agendaGroups,
  agendaMonthKey,
  favouriteKey,
  favouriteSet,
  type DocSummary,
  type Favourite,
  type Team,
} from "@orbyn/core";
import type { Filters, FixedKind, Place } from "./store";
import { teamName } from "./store";

export const when = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

export const KIND_LABEL: Record<string, string> = {
  doc: "Page",
  note: "Note",
  meeting: "Meeting note",
  agenda: "Daily brief",
  memory: "Memory",
  agent: "Agent note",
};

const inPlace = (
  doc: DocSummary,
  place: Place,
  starred: Set<string>,
  fading: Set<string>,
) => {
  switch (place.at) {
    case "favorites":
      return starred.has(favouriteKey("doc", doc.id));
    case "uploads":
      return !!doc.in_uploads;
    case "fading":
      return fading.has(doc.id) && doc.kind !== "agenda";
    case "kind":
      return doc.kind === place.kind;
    case "agenda":
      return (
        doc.kind === "agenda" &&
        (!place.month || agendaMonthKey(agendaDay(doc)) === place.month)
      );
    case "folder":
      return doc.folder_id === place.id && doc.kind !== "agenda";
    case "unfiled":
      return !doc.folder_id && doc.kind !== "agenda";
    default:
      return doc.kind !== "agenda";
  }
};

export function visibleDocs(
  docs: DocSummary[],
  place: Place,
  filters: Filters,
  stars: Favourite[],
  fading: Set<string>,
) {
  const starred = favouriteSet(stars);
  const words = filters.query.trim().toLocaleLowerCase();
  const inView = docs
    .filter((doc) => inPlace(doc, place, starred, fading))
    .filter(
      (doc) =>
        !filters.project ||
        (filters.project === "none"
          ? !doc.project_id
          : doc.project_id === filters.project),
    )
    .filter(
      (doc) =>
        !filters.scope ||
        (filters.scope === "personal"
          ? !doc.team_id
          : doc.team_id === filters.scope),
    )
    .filter(
      (doc) =>
        !filters.source ||
        (filters.source === "original"
          ? !!doc.original
          : !!(doc.imported_from || doc.original)),
    )
    .filter((doc) => !filters.kind || doc.kind === filters.kind)
    .filter((doc) =>
      `${doc.title} ${doc.preview} ${doc.imported_from?.file_name ?? doc.original?.file_name ?? ""}`
        .toLocaleLowerCase()
        .includes(words),
    );
  const tagged = filters.tag
    ? inView.filter((doc) => doc.tags?.some((tag) => tag.id === filters.tag))
    : inView;
  const ordered = [...tagged].sort((a, b) =>
    place.at === "agenda"
      ? agendaDay(b).localeCompare(agendaDay(a))
      : filters.sort === "title"
        ? (a.title || "Untitled").localeCompare(b.title || "Untitled") ||
          a.id.localeCompare(b.id)
        : filters.sort === "created"
          ? b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)
          : b.updated_at.localeCompare(a.updated_at) ||
            a.id.localeCompare(b.id),
  );
  return { inView, ordered };
}

export function facets(
  docs: DocSummary[],
  inView: DocSummary[],
  teams: Team[],
) {
  const scope = (doc: DocSummary) => teamName(teams, doc);
  const projects = [
    ...new Map(
      docs.flatMap((doc) =>
        doc.project_id
          ? [
              [
                doc.project_id,
                {
                  id: doc.project_id,
                  name: doc.project_name || "Linked project",
                  scope: scope(doc),
                },
              ] as const,
            ]
          : [],
      ),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const spaces = [
    ...new Map(
      docs.flatMap((doc) =>
        doc.team_id ? [[doc.team_id, scope(doc)] as const] : [],
      ),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const tags = [
    ...new Map(
      inView.flatMap((doc) =>
        (doc.tags ?? []).map(
          (tag) => [tag.id, { ...tag, scope: scope(doc) }] as const,
        ),
      ),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return { projects, spaces, tags };
}

export function placeName(
  place: Place,
  fixed: FixedKind | undefined,
  folderName: string | undefined,
  docs: DocSummary[],
) {
  if (fixed) return fixed === "memory" ? "Memory" : "Agent notes";
  switch (place.at) {
    case "kind":
      return { doc: "Pages", note: "Notes", meeting: "Meeting notes" }[
        place.kind
      ];
    case "favorites":
      return "Favorites";
    case "uploads":
      return "Uploads";
    case "fading":
      return "Might be out of date";
    case "agenda": {
      if (!place.month) return "Daily briefs";
      const month = agendaGroups(docs)
        .flatMap((year) => year.months)
        .find((one) => one.key === place.month);
      return `Daily briefs · ${month?.label ?? ""} ${place.month.slice(0, 4)}`;
    }
    case "folder":
      return folderName || "Folder";
    case "unfiled":
      return "Unfiled";
    case "archived":
      return "Archived";
    case "trash":
      return "Trash";
    default:
      return "All documents";
  }
}
