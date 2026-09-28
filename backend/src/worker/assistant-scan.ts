/**
 * Shared rules for the Assistant's background scans (ideas, goals, routines).
 * Each helper returns a SQL condition; `now` names the query parameter that
 * holds the scan's clock.
 */

/** A running job whose heartbeat is older than this has died with its worker. */
export const STALE_RUN_MINUTES = 15;
/** A job waiting on the person this long no longer holds its routine back. */
export const STALE_WAIT_HOURS = 12;
/** A failed background run waits this long before one more try. */
export const FAILED_RETRY_HOURS = 6;
/** The most tries per goal per week, and per idea slot per day. */
export const MAX_AUTOMATION_ATTEMPTS = 3;
/** Ideas are only written for people who used Orbyn in this many days. */
export const ACTIVE_DAYS = 14;

/** SQL true when `userColumn` has an assistant grant that is neither revoked nor suspended. */
export const assistantActive = (userColumn: string) =>
  `EXISTS (SELECT 1 FROM agent_grants ag
            WHERE ag.user_id = ${userColumn} AND ag.kind = 'assistant'
              AND ag.revoked_at IS NULL AND ag.suspended_at IS NULL)`;

/**
 * SQL true when the person used Orbyn recently: a signed-in session was seen
 * (sessions.last_seen_at) or the assistant was used (agent_grants.last_used_at).
 */
export const recentlyActive = (userColumn: string, now: string) =>
  `(EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = ${userColumn}
             AND s.last_seen_at > ${now}::timestamptz - make_interval(days => ${ACTIVE_DAYS}))
    OR EXISTS (SELECT 1 FROM agent_grants ag WHERE ag.user_id = ${userColumn}
             AND ag.kind = 'assistant'
             AND ag.last_used_at > ${now}::timestamptz - make_interval(days => ${ACTIVE_DAYS})))`;

/** SQL true when the ai_jobs row `jobColumn` names is failed, or running with a stale heartbeat. */
export const jobDead = (jobColumn: string, now: string) =>
  `EXISTS (SELECT 1 FROM ai_jobs dj WHERE dj.id = ${jobColumn} AND (
     dj.state = 'failed' OR (dj.state = 'running'
       AND dj.heartbeat_at < ${now}::timestamptz - make_interval(mins => ${STALE_RUN_MINUTES}))))`;

/**
 * SQL true when the job no longer holds its routine: finished, failed, gone,
 * running with a stale heartbeat, or waiting on the person for too long.
 */
export const jobReleased = (jobColumn: string, now: string) =>
  `(${jobColumn} IS NULL OR NOT EXISTS (
     SELECT 1 FROM ai_jobs hj WHERE hj.id = ${jobColumn} AND (
       (hj.state = 'running'
         AND hj.heartbeat_at >= ${now}::timestamptz - make_interval(mins => ${STALE_RUN_MINUTES}))
       OR (hj.state = 'waiting'
         AND hj.heartbeat_at >= ${now}::timestamptz - make_interval(hours => ${STALE_WAIT_HOURS})))))`;
