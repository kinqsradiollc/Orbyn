/**
 * Words from an add link (orbyn://add?text=…) waiting for Today's quick
 * add. They fill the box once per link: Today is mounted only while its tab
 * is open, so leaving it and coming back must not put the same words back
 * (and open the keyboard) after they were added or cleared.
 *
 * No React Native here, so the server's test run covers it.
 */

export type LinkPrefill = { text: string; key: number };

/** Most a link can put in the box. */
export const PREFILL_MAX = 500;

/**
 * A taker that hands out each link's words once, however many times the
 * box mounts; a newer link (a new key) fills it again.
 */
export function prefillTaker() {
  let lastKey: number | null = null;
  return (prefill: LinkPrefill | null | undefined): string | null => {
    if (!prefill || prefill.key === lastKey) return null;
    lastKey = prefill.key;
    return prefill.text.slice(0, PREFILL_MAX);
  };
}

/** The app's one taker, kept for the whole session. */
export const takeLinkPrefill = prefillTaker();
