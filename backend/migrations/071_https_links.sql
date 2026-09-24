-- Addresses this server calls for people (webhooks, subscribed calendars)
-- must be https now (backend/src/lib/netguard.ts). Links saved before that
-- would otherwise just start failing, so:
-- - a subscribed calendar moves to https:// (calendar hosts serve it; if one
--   doesn't, the error shows next to it in Settings) and is read again on
--   the next pass;
-- - a webhook, whose other end may not take https, is turned off with a note
--   next to it in Settings -> Connections saying what to do.
-- Local and private addresses are left alone: they only ever worked in local
-- development, where ALLOW_PRIVATE_WEBHOOKS still allows http. Safe to run
-- again: it only changes rows still on http://.
UPDATE calendar_subscriptions
   SET url = 'https://' || substr(url, 8),
       etag = NULL,
       last_modified = NULL,
       last_fetched_at = NULL,
       last_error = NULL
 WHERE url ILIKE 'http://%'
   AND length(url) < 1000
   AND url !~* '^http://((localhost|host\.docker\.internal|[^/:?#]*\.(local|internal|localhost))([:/?#]|$)|127\.|10\.|0\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[)';

UPDATE webhooks
   SET active = false,
       last_error = 'Turned off: webhooks now go only to https:// addresses. Delete this one and add it again with https://.'
 WHERE active
   AND url ILIKE 'http://%'
   AND url !~* '^http://((localhost|host\.docker\.internal|[^/:?#]*\.(local|internal|localhost))([:/?#]|$)|127\.|10\.|0\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[)';
