import { createHash } from "node:crypto";
import { resolve } from "node:path";
export const FIXTURE = "orbyn-ui-demo-v2";
export const DEMO_PASSWORD = "Orbyn-Demo-2026!";
export function fixtureId(key) {
  const hex = createHash("sha256").update(`${FIXTURE}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const DEMO_ACCOUNTS = [
  {
    key: "admin",
    email: "admin@orbyn.local",
    name: "Morgan · Demo admin",
    role: "admin",
    onboarding: false,
  },
  {
    key: "member",
    email: "member@orbyn.local",
    name: "Alex · Demo member",
    role: "member",
    onboarding: false,
  },
  {
    key: "empty",
    email: "empty@orbyn.local",
    name: "Empty workspace · Demo",
    role: "member",
    onboarding: false,
  },
  {
    key: "onboarding",
    email: "new@orbyn.local",
    name: "New workspace · Demo",
    role: "member",
    onboarding: true,
  },
  {
    key: "live",
    email: "agent-demo@orbyn.local",
    name: "Live agent checks · Demo",
    role: "member",
    onboarding: false,
  },
].map((account) => ({ ...account, id: fixtureId(`account-${account.key}`) }));
export function seedOptions(args, root) {
  const result = {
    apply: false,
    envFile: resolve(root, ".env"),
    host: null,
    port: null,
    existingMemberId: null,
    date: null,
  };
  const names = {
    "--env-file": "envFile",
    "--db-host": "host",
    "--db-port": "port",
    "--existing-member-id": "existingMemberId",
    "--date": "date",
  };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const [name, ...rest] = args[i].split("=");
    if (seen.has(name)) throw new Error(`Duplicate option: ${name}`);
    seen.add(name);
    if (name === "--apply" && !rest.length) {
      result.apply = true;
      continue;
    }
    if (!(name in names)) throw new Error(`Unknown seed option: ${name}`);
    const value = rest.length ? rest.join("=") : args[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${name}`);
    result[names[name]] = name === "--env-file" ? resolve(root, value) : value;
  }
  if (
    result.existingMemberId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result.existingMemberId,
    )
  )
    throw new Error("Use a verified UUID for --existing-member-id.");
  return result;
}
export function seedTarget(connection, options) {
  if (!connection)
    throw new Error("The selected environment file needs DATABASE_URL.");
  let target;
  try {
    target = new URL(connection);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.search ||
    target.hash
  )
    throw new Error("Use a PostgreSQL URL without query options or fragments.");
  if (options.host) target.hostname = options.host;
  if (options.port) {
    if (
      !/^\d+$/.test(options.port) ||
      Number(options.port) < 1 ||
      Number(options.port) > 65535
    )
      throw new Error("Use a valid database port.");
    target.port = options.port;
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
    throw new Error(
      "Seed requires an explicit loopback database host (use --db-host for a Compose URL).",
    );
  const database = decodeURIComponent(target.pathname.slice(1));
  if (!/^(orbyn|[a-z0-9_]+_(?:local|dev|test))$/.test(database))
    throw new Error(
      "Seed requires orbyn or a database ending _local, _dev or _test.",
    );
  const port = Number(target.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Use a valid database port.");
  return {
    connectionString: target.toString(),
    database,
    display: `${target.hostname}:${port}/${database}`,
  };
}
export function assertSeedDatabase(
  { database, marker, environment },
  expected,
) {
  if (database !== expected)
    throw new Error("Connected database differs from the selected target.");
  if (!["development-demo", "ui-ux-polish"].includes(marker))
    throw new Error(
      "Database requires a persisted database-level orbyn.ui_fixture=development-demo marker after operator verification.",
    );
  if (
    environment &&
    !["development", "dev", "local", "test"].includes(environment)
  )
    throw new Error(
      "Refusing a database marked for a non-development environment.",
    );
}
export function assertAccountOwnership(accounts, rows) {
  for (const account of accounts) {
    const matches = rows.filter(
      (row) =>
        row.id === account.id ||
        row.email.toLowerCase() === account.email.toLowerCase(),
    );
    if (
      matches.some(
        (row) =>
          row.id !== account.id ||
          row.email.toLowerCase() !== account.email.toLowerCase(),
      )
    )
      throw new Error(
        `Fixture account collision: ${account.email}. No account will be reset or promoted.`,
      );
    if (matches.some((row) => row.role !== account.role))
      throw new Error(
        `Fixture role was changed for ${account.email}; refusing to reset it.`,
      );
  }
}
export const SCENARIOS = [
  "admin management",
  "member personal/team visibility",
  "empty workspace",
  "first-run onboarding",
  "isolated live-agent check account (starts empty and paused)",
  "overdue/in-progress/blocked/completed tasks",
  "long titles and Unicode",
  "calendar and manual focus sessions",
  "private/team/project pages",
  "structured notes, tables and maths",
  "memory and study",
  "saved views and habits",
  "synthetic conversations and Review proposals",
  "terminal-only Background/Overnight history (no model execution or verified outcomes)",
  "paused routine examples",
  "disabled booking pages",
];
