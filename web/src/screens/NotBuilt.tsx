import { Empty } from "../ui/kit";

/** A route whose new screen isn't finished. Tracked in the coverage ledger. */
export function NotBuilt({ name }: { name: string }) {
  return (
    <Empty title={name}>
      <p>This screen hasn't been rebuilt yet.</p>
    </Empty>
  );
}
