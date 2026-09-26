/**
 * One visibility rule for everything a person can open: their own personal
 * things, and everything in the teams they belong to. Every query that
 * lists or opens tasks, pages, projects, work records, folders or templates
 * on someone's behalf filters with one of these builders, so the rule lives
 * in one place: the app's routes, the assistant and agents (MCP) all use
 * them, and tests/visibility.test.ts fails if a copy of the rule appears
 * anywhere else in the code.
 *
 * A builder returns a SQL condition on a table alias. `scope` names the
 * query parameters to use:
 *
 * - `user`: the person's id (default `$1`, as the older copies assumed);
 * - `teams`: optionally, a uuid[] parameter that narrows the teams further
 *   (an agent connection that sees only some teams). Membership is still
 *   checked in the same statement, so a team someone has left is never
 *   visible whatever the list says;
 * - `personal`: optionally, a boolean parameter (or a literal) saying
 *   whether the Personal space is included.
 *
 * With the default scope the condition is exactly the one the app has always
 * used, so switching a query over changes nothing.
 */
export type Scope = {
  user: string;
  teams?: string;
  personal?: string | boolean;
  /**
   * The rows are read for an AI (an outside agent): leave out projects kept
   * out of the assistant, and everything in them.
   */
  ai?: boolean;
};

/** SQL: not in a project kept out of the assistant (for rows with project_id). */
const notKeptOut = (alias: string) =>
  ` AND NOT EXISTS (SELECT 1 FROM projects ko WHERE ko.id = ${alias}.project_id AND ko.assistant_off)`;

const DEFAULT_SCOPE: Scope = { user: "$1" };

const ALIAS = /^[a-z_][a-z0-9_]*$/;

/**
 * Rows `scope.user` may see in a table whose rows belong either to one
 * person (team_id NULL, owned by `owner`) or to a team.
 */
export function visibleOwned(
  alias: string,
  owner: string,
  scope: Scope = DEFAULT_SCOPE,
): string {
  if (!ALIAS.test(alias) || !ALIAS.test(owner))
    throw new Error(`Not a safe SQL name: ${alias}.${owner}`);
  const personal =
    scope.personal === undefined || scope.personal === true
      ? ""
      : scope.personal === false
        ? " AND false"
        : ` AND ${scope.personal}::boolean`;
  const teams = scope.teams
    ? ` AND ${alias}.team_id = ANY (${scope.teams}::uuid[])`
    : "";
  return (
    `((${alias}.team_id IS NULL AND ${alias}.${owner} = ${scope.user}${personal})` +
    ` OR (${inMyTeams(alias, scope)}${teams}))`
  );
}

/** Tasks, events and reminders (items) `scope.user` can see. */
export const visibleItems = (alias = "i", scope: Scope = DEFAULT_SCOPE) =>
  `(${visibleOwned(alias, "user_id", scope)}${scope.ai ? notKeptOut(alias) : ""})`;

/**
 * Pages (docs) `scope.user` can see: readable (see {@link readableDocs})
 * and not in the Trash. Lists, search, links, the assistant and agents use
 * this; a page in the Trash is found only through the Trash itself.
 */
export const visibleDocs = (alias = "d", scope: Scope = DEFAULT_SCOPE) =>
  `(${readableDocs(alias, scope)} AND ${alias}.deleted_at IS NULL${scope.ai ? notKeptOut(alias) : ""})`;

/**
 * Pages `scope.user` may read, whether or not they are in the Trash: for
 * the Trash itself, restoring, and history (a trashed page's history stays).
 */
export const readableDocs = (alias = "d", scope: Scope = DEFAULT_SCOPE) =>
  `(${visibleOwned(alias, "user_id", scope)}${scope.ai ? notKeptOut(alias) : ""})`;

/** Projects `scope.user` can see. */
export const visibleProjects = (alias = "p", scope: Scope = DEFAULT_SCOPE) =>
  `(${visibleOwned(alias, "user_id", scope)}${scope.ai ? ` AND NOT ${alias}.assistant_off` : ""})`;

/** Promises, decisions and experiments (work_records) `scope.user` can see. */
export const visibleRecords = (alias = "w", scope: Scope = DEFAULT_SCOPE) =>
  `(${visibleOwned(alias, "created_by", scope)}${scope.ai ? notKeptOut(alias) : ""})`;

/** Folders `scope.user` can see. */
export const visibleFolders = (alias = "f", scope: Scope = DEFAULT_SCOPE) =>
  visibleOwned(alias, "user_id", scope);

/** Project templates `scope.user` can see. */
export const visibleTemplates = (alias = "t", scope: Scope = DEFAULT_SCOPE) =>
  visibleOwned(alias, "user_id", scope);

/** Saved views `scope.user` can see: their own, and their teams'. */
export const visibleViews = (alias = "v", scope: Scope = DEFAULT_SCOPE) =>
  visibleOwned(alias, "user_id", scope);

/** Page templates `scope.user` can see. */
export const visiblePageTemplates = (
  alias = "t",
  scope: Scope = DEFAULT_SCOPE,
) => visibleOwned(alias, "user_id", scope);

/**
 * Rows `scope.user` may change (not only see) in a table owned by one
 * person or a team: their own personal rows, and rows in teams where they
 * are more than a viewer. `scope.teams` and `scope.personal` are not
 * applied; this is a write check on rows already found.
 */
export function writableOwned(
  alias: string,
  owner: string,
  scope: Scope = DEFAULT_SCOPE,
): string {
  if (!ALIAS.test(alias) || !ALIAS.test(owner))
    throw new Error(`Not a safe SQL name: ${alias}.${owner}`);
  return (
    `((${alias}.team_id IS NULL AND ${alias}.${owner} = ${scope.user})` +
    ` OR ${alias}.team_id IN (SELECT team_id FROM team_members` +
    ` WHERE user_id = ${scope.user} AND role IN ('owner', 'admin', 'member')))`
  );
}

/**
 * Rows in a team `scope.user` belongs to (a team-only table, or the team
 * half of a rule written some other way).
 */
export function inMyTeams(alias: string, scope: Scope = DEFAULT_SCOPE) {
  if (!ALIAS.test(alias)) throw new Error(`Not a safe SQL name: ${alias}`);
  return `${alias}.team_id IN (SELECT team_id FROM team_members WHERE user_id = ${scope.user})`;
}

/**
 * Collects query values and hands back their placeholders, so a query built
 * from pieces never miscounts `$n`.
 */
export class Params {
  readonly values: unknown[] = [];
  constructor(...initial: unknown[]) {
    for (const v of initial) this.add(v);
  }
  /** Adds a value and returns its placeholder (`$3`). */
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Which spaces a query may reach: the person, and optionally fewer teams. */
export type Spaces = {
  userId: string;
  /** null: every team the person belongs to. */
  teamIds: string[] | null;
  personal: boolean;
};

/**
 * A Scope for `spaces`, adding its values to `params`. Spaces are what an
 * agent connection reaches, so projects kept out of the assistant (and
 * everything in them) are always left out.
 */
export function scopeFor(spaces: Spaces, params: Params): Scope {
  const user = params.add(spaces.userId);
  return {
    user,
    teams: spaces.teamIds === null ? undefined : params.add(spaces.teamIds),
    personal: spaces.personal ? undefined : false,
    ai: true,
  };
}

/** Whether a row in `teamId` (null: Personal) is inside `spaces`. */
export function inSpaces(
  spaces: Pick<Spaces, "teamIds" | "personal">,
  teamId: string | null,
): boolean {
  if (teamId === null) return spaces.personal;
  return spaces.teamIds === null || spaces.teamIds.includes(teamId);
}
