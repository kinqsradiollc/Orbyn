-- Repair pre-upgrade team host assignments. Personal-page hosts are independent
-- of team membership and must remain intact. Freeze scope/membership changes
-- while selecting rows so a concurrent rejoin cannot preserve a stale grant.
LOCK TABLE team_members, booking_pages IN SHARE MODE;
LOCK TABLE booking_hosts IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM booking_hosts h USING booking_pages p
WHERE h.page_id = p.id AND p.team_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM team_members m
    WHERE m.team_id = p.team_id AND m.user_id = h.user_id
  );
