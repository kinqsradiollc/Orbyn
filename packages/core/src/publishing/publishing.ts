import { z } from "zod";

const lines = z
  .array(z.string().trim().max(500))
  .max(30)
  .transform((values) => values.filter(Boolean));
export const publishingContent = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().max(500),
    notes: z.object({ new: lines, better: lines, fixed: lines }).strict(),
    commentary: z.string().max(3000),
    image: z
      .string()
      .max(2_800_000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
      .nullable(),
    alt_text: z.string().trim().max(1000),
  })
  .strict();
export type PublishingContent = z.output<typeof publishingContent>;
export type PublishingState =
  "draft" | "scheduled" | "sending" | "published" | "failed" | "unknown";
export type PublishingDraft = {
  id: string;
  version: number;
  content: PublishingContent;
  state: PublishingState;
  scheduled_at: string | null;
  post_urn: string | null;
  error: string | null;
  updated_at: string;
  release: PublishedUpdate | null;
};
export type PublishingListEntry = Pick<
  PublishingDraft,
  "id" | "version" | "state" | "updated_at" | "scheduled_at"
> & { title: string };
export type PublishedUpdate = Omit<PublishingContent, "commentary"> & {
  id: string;
  published_at: string;
};
export type PublishingConnection = {
  configured: boolean;
  connected: boolean;
  organization: string | null;
  expires_at: string | null;
  renewable: boolean;
};
export const publishingVersion = z
  .object({ version: z.number().int().min(1) })
  .strict();
export const publishingSave = publishingVersion
  .extend({ content: publishingContent })
  .strict();
export const publishingSchedule = publishingVersion
  .extend({ at: z.iso.datetime({ offset: true }) })
  .strict();

/** Published snapshots join the bundled history without making drafts public. */
export function mergePublishedUpdates(
  updates: PublishedUpdate[],
  bundled: import("../changelog/release.js").ChangelogRelease[],
): import("../changelog/release.js").ChangelogRelease[] {
  return [
    ...updates.map((update) => ({
      id: update.id,
      date: update.published_at.slice(0, 10),
      title: update.title,
      summary: update.summary,
      sections: update.notes,
      ...update.notes,
      image: update.image,
      alt_text: update.alt_text,
    })),
    ...bundled,
  ].sort((a, b) => b.date.localeCompare(a.date));
}
