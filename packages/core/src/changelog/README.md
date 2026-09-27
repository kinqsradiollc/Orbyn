# What's new

Each release Orbyn ships is one file here, named `YYYY-MM-DD-a-word.ts`. The
public `/changelog` page and the "What's new" sheets on the web and on phones
all read these files through `index.ts`.

## Adding a release

1. Copy the newest release file and rename it with today's date and a word or
   two (`2026-10-02-calendar.ts`). Set `id` to the new file name without
   `.ts`, and `date` to the day it ships.
2. Write a short `title`, a one-sentence `summary`, and optionally a
   `highlight`: the one change worth reading if nothing else is.
3. Under `sections`, write one plain sentence per item under `new`, `better`
   (improvements) and `fixed` (shown as "No longer broken"). Leave out a
   heading with nothing under it.
4. In `index.ts`, add one import for the file and put its name at the top of
   `RELEASES`.

`backend/tests/changelog.unit.test.ts` fails if a file is missing from the
index, an id is used twice or doesn't match its file, a date isn't real, or a
release has no items.

## How to write it

- Write for the person using Orbyn: "You can now…", "Pages open…". Say what
  they will notice, not how it was built.
- No internal names: no track or milestone codes, pull request numbers, file
  or table names.
- Only what has shipped. Work that isn't live yet waits for its own release.
