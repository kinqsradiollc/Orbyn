# Titled inline object-link privacy — 6 October 2026

Status: implemented candidate; immutable combined full/CI qualification remains open.

The old object-link regular expression recognized only untitled simple links.
With the expanded balanced inline syntax, titled/formatted links could be rendered
while `objectRefsIn` collected no target and `redactLine` left private labels and
hints intact. A local probe confirmed that `[Secret](orbyn://doc/<uuid> "Private
hint")` produced no references and unchanged redacted text. This is a confirmed
source/API privacy gap; it does not establish who encountered it in production.

Object-target collection, label redaction, quote-label collection, save restoration
and export conversion now use the same balanced scanner as Docs, with code/math/
escape ranges masked. Case-insensitive schemes cannot bypass the collector.
Private labels become neutral and authored hints are removed. Accessible links
retain titles and formatting; web exports convert their targets. Saves using the
server's neutral placeholder restore the original source and title for readers
who retain target access, preserving its brackets/quote delimiters exactly.

Evidence:

- `/tmp/orbyn-doc-inline-privacy-focused.log`:18 pure cases passed.
- `/tmp/orbyn-channel-doc-inline-privacy-focused-current.log`:77 mounted API,
  editor and pure cases passed,0 failures/skips in9173ms in fresh marked DB27.
- `/tmp/orbyn-channel-doc-inline-privacy-focused.log`: first integrated run76/1;
  the failing exact-source restoration assertion caught canonicalization of angle
  destinations. Original source preservation was repaired; assertion unchanged.

Integrate this repair into reference-title PR211 and qualify that immutable
combined head. Original PR211 exact `e04f2c57` already passed fresh local full
3427/0/1 and all four CI37355677316 jobs. Those earlier results do not qualify
this added source. Preserve full D1/U1, native/visual and agent/provider gates.
