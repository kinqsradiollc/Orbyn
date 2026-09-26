# Orbyn Clipper

A browser extension (Manifest V3) that saves what you're reading into Orbyn
(CAP-02, CAP-03, CAP-04):

- **Article**: the readable part of the page, cleaned by Orbyn, as a page
  with where and when it was clipped.
- **Paper**: the same, with its authors, year and DOI at the top.
- **Assignment**: a task with the page's link and a deadline when the page
  says one plainly (the popup shows it to confirm or change).
- **Read later**: a task with the link and an estimated reading time.
- **Highlights**: passages you highlight on the page (right-click, or
  Alt+Shift+H), saved as quotes with the link, or as cloze study cards on a
  page of cards.

Which shape a page gets comes from built-in site rules (papers on arXiv and
DOI sites, assignments on course sites) and your own, in the options.

## Signing in

The Clipper uses a **Clipper key** (`ocl_…`), made in Orbyn under Settings →
Connections → Orbyn Clipper and pasted into the Clipper's options. A Clipper
key can only list where clips may go and save a clip; the API refuses it
everywhere else. It is never a full-power key. The key is kept on this
computer only (not synced).

## Permissions

- `activeTab`, `scripting`: read the page you clip, only when you open the
  Clipper or highlight.
- `storage`: your settings, and highlights until you clip them.
- `contextMenus`: Highlight for Orbyn, and Clip this page.
- `https://orbyn.dev/*`: talking to Orbyn.
- Optional `<all_urls>`: only if you turn on "Keep highlights when I come
  back", to put highlights back on pages you return to.

## Trying it

Chrome or Edge: open `chrome://extensions`, turn on Developer mode, press
**Load unpacked** and choose this `clipper/` folder. Firefox: `about:debugging`
→ This Firefox → Load Temporary Add-on → `manifest.json`.

Publishing to the Chrome Web Store, Edge Add-ons and Firefox Add-ons is the
owner's step (the stores need an account and a review).
